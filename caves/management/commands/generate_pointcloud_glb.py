"""
Generate a point cloud GLB for the 3D explorer.

Supports two source modes:
  1. Keyframe mode (--source-dir): loads per-keyframe .npy clouds + JSON metadata,
     applies gravity correction using barometric altitude
  2. PCD mode (--pcd): loads a SLAM-optimized .pcd file directly (already in world
     coordinates with loop closure applied) — no gravity correction needed

Usage:
    # From keyframes with gravity correction:
    python manage.py generate_pointcloud_glb \\
        --source-dir "/path/to/keyframe/session" \\
        --cave "Big Cave"

    # From PCD file (SLAM-optimized):
    python manage.py generate_pointcloud_glb \\
        --pcd "/path/to/slam_map.pcd" \\
        --cave "Big Cave"
"""

import glob
import json
import math
import os
import struct

import numpy as np
from django.core.management.base import BaseCommand

from caves.models import Cave


def load_pcd_file(pcd_path):
    """
    Load a .pcd file using Open3D and extract positions + colors.
    PCD files from SLAM are already in world coordinates.
    Returns (positions_Nx3, colors_Nx3) as float32 arrays.
    """
    import open3d as o3d

    pcd = o3d.io.read_point_cloud(pcd_path)
    positions = np.asarray(pcd.points, dtype=np.float32)

    if pcd.has_colors():
        colors = np.asarray(pcd.colors, dtype=np.float32)
    else:
        # No colors — use grayscale based on intensity if available, else default
        colors = np.full((len(positions), 3), 0.7, dtype=np.float32)

    return positions, colors


def load_keyframes(source_dir):
    """Load all keyframe JSON files sorted by ID."""
    kf_files = sorted(glob.glob(os.path.join(source_dir, 'kf_*.json')))
    kf_files = [f for f in kf_files if '_cloud' not in f]
    keyframes = []
    for kf_path in kf_files:
        with open(kf_path) as f:
            keyframes.append(json.load(f))
    return keyframes


def compute_gravity_correction(keyframes):
    """
    Compute a rotation matrix that corrects SLAM vertical drift using
    barometric altitude data.

    Returns (rotation_matrix_3x3, per_kf_residuals).
    """
    positions = np.array([kf['position'] for kf in keyframes])
    baro_alts = np.array([kf['relative_altitude'] for kf in keyframes])

    # Barometric vertical change relative to start
    baro_delta = baro_alts - baro_alts[0]

    # SLAM vertical
    slam_y = positions[:, 1]

    # Travel direction in horizontal plane
    start, end = positions[0], positions[-1]
    travel = end - start
    travel_horiz = np.array([travel[0], 0, travel[2]])
    travel_dist = np.linalg.norm(travel_horiz)

    if travel_dist < 1.0:
        # Not enough travel to compute correction
        return np.eye(3), np.zeros(len(keyframes))

    travel_unit = travel_horiz / travel_dist

    # Project each position onto travel direction (distance along track)
    along_track = np.array([
        np.dot(p - start, np.array([travel_unit[0], 0, travel_unit[2]]))
        for p in positions
    ])

    # Find rotation angle theta that best maps:
    #   new_Y = Y * cos(theta) - along_track * sin(theta) ≈ baro_delta
    best_theta = 0
    best_err = float('inf')
    for theta_deg_10x in range(-200, 201):
        theta = math.radians(theta_deg_10x / 10.0)
        new_y = slam_y * math.cos(theta) - along_track * math.sin(theta)
        err = np.sum((new_y - baro_delta) ** 2)
        if err < best_err:
            best_err = err
            best_theta = theta

    # Cross-track axis (perpendicular to travel in horizontal plane)
    cross = np.array([-travel_unit[2], 0, travel_unit[0]])

    # Build rotation matrix around cross-track axis by best_theta
    # Using Rodrigues' rotation formula
    K = np.array([
        [0, -cross[2], cross[1]],
        [cross[2], 0, -cross[0]],
        [-cross[1], cross[0], 0],
    ])
    R = (np.eye(3)
         + math.sin(best_theta) * K
         + (1 - math.cos(best_theta)) * (K @ K))

    # Compute residuals after global rotation
    rotated_positions = (R @ positions.T).T
    rotated_y = rotated_positions[:, 1]
    residuals = baro_delta - rotated_y

    return R, residuals


def load_and_correct_points(source_dir, keyframes, R, residuals):
    """
    Load all keyframe point clouds, apply SLAM transforms, global rotation,
    and per-keyframe barometric residual correction.

    Returns (positions_Nx3, colors_Nx3) as float32 arrays.
    """
    all_positions = []
    all_colors = []

    # Build a mapping from along-track distance to residual for interpolation
    kf_positions = np.array([kf['position'] for kf in keyframes])
    kf_timestamps = np.array([kf['timestamp'] for kf in keyframes])

    for i, kf in enumerate(keyframes):
        cloud_file = os.path.join(source_dir, kf.get('pointcloud_file', f'kf_{i:06d}_cloud.npy'))
        if not os.path.exists(cloud_file):
            continue

        cloud = np.load(cloud_file)
        if cloud.size == 0:
            continue

        # cloud is Nx4+ (x, y, z, intensity, ...) or Nx3
        pts_local = cloud[:, :3].astype(np.float64)

        # Transform from keyframe-local to SLAM world frame
        kf_pos = np.array(kf['position'])
        kf_orient = kf['orientation']  # [qx, qy, qz, qw]
        rot_mat = quat_to_rotation_matrix(kf_orient)

        pts_world = (rot_mat @ pts_local.T).T + kf_pos

        # Apply global gravity correction rotation
        pts_corrected = (R @ pts_world.T).T

        # Apply per-keyframe residual (vertical shift)
        pts_corrected[:, 1] += residuals[i]

        all_positions.append(pts_corrected.astype(np.float32))

        # Extract color from intensity if available, else default gray
        if cloud.shape[1] >= 4:
            intensity = cloud[:, 3].astype(np.float32)
            # Normalize intensity to [0, 1]
            i_min, i_max = intensity.min(), intensity.max()
            if i_max > i_min:
                intensity = (intensity - i_min) / (i_max - i_min)
            else:
                intensity = np.full_like(intensity, 0.7)
            colors = np.column_stack([intensity, intensity, intensity])
        else:
            colors = np.full((len(pts_local), 3), 0.7, dtype=np.float32)

        all_colors.append(colors)

    if not all_positions:
        raise ValueError('No point cloud data found')

    return np.vstack(all_positions), np.vstack(all_colors)


def quat_to_rotation_matrix(q):
    """Convert quaternion [qx, qy, qz, qw] to 3x3 rotation matrix."""
    qx, qy, qz, qw = q
    return np.array([
        [1 - 2*(qy*qy + qz*qz), 2*(qx*qy - qz*qw), 2*(qx*qz + qy*qw)],
        [2*(qx*qy + qz*qw), 1 - 2*(qx*qx + qz*qz), 2*(qy*qz - qx*qw)],
        [2*(qx*qz - qy*qw), 2*(qy*qz + qx*qw), 1 - 2*(qx*qx + qy*qy)],
    ])


def build_glb(positions, colors):
    """
    Build a binary glTF 2.0 (.glb) file from position and color arrays.
    Returns bytes.
    """
    n_points = len(positions)
    pos_data = positions.astype(np.float32).tobytes()
    col_data = colors.astype(np.float32).tobytes()

    # Compute bounds
    pos_min = positions.min(axis=0).tolist()
    pos_max = positions.max(axis=0).tolist()

    # Buffer: positions then colors
    buffer_data = pos_data + col_data
    pos_byte_length = len(pos_data)
    col_byte_length = len(col_data)
    total_byte_length = pos_byte_length + col_byte_length

    # Pad buffer to 4-byte alignment
    pad = (4 - (total_byte_length % 4)) % 4
    buffer_data += b'\x00' * pad

    gltf = {
        "asset": {"version": "2.0", "generator": "cave-backend"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{
            "primitives": [{
                "attributes": {"POSITION": 0, "COLOR_0": 1},
                "mode": 0,  # POINTS
            }]
        }],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,  # FLOAT
                "count": n_points,
                "type": "VEC3",
                "min": pos_min,
                "max": pos_max,
            },
            {
                "bufferView": 1,
                "componentType": 5126,
                "count": n_points,
                "type": "VEC3",
            },
        ],
        "bufferViews": [
            {
                "buffer": 0,
                "byteOffset": 0,
                "byteLength": pos_byte_length,
            },
            {
                "buffer": 0,
                "byteOffset": pos_byte_length,
                "byteLength": col_byte_length,
            },
        ],
        "buffers": [{
            "byteLength": total_byte_length,
        }],
    }

    json_str = json.dumps(gltf, separators=(',', ':'))
    json_bytes = json_str.encode('utf-8')
    # Pad JSON to 4-byte alignment
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    json_bytes += b' ' * json_pad

    # GLB header: magic + version + length
    # Chunk 0: JSON
    # Chunk 1: BIN
    bin_data = buffer_data
    total_length = (
        12  # GLB header
        + 8 + len(json_bytes)  # JSON chunk header + data
        + 8 + len(bin_data)  # BIN chunk header + data
    )

    glb = bytearray()
    # Header
    glb += struct.pack('<I', 0x46546C67)  # magic: glTF
    glb += struct.pack('<I', 2)  # version
    glb += struct.pack('<I', total_length)
    # JSON chunk
    glb += struct.pack('<I', len(json_bytes))
    glb += struct.pack('<I', 0x4E4F534A)  # JSON
    glb += json_bytes
    # BIN chunk
    glb += struct.pack('<I', len(bin_data))
    glb += struct.pack('<I', 0x004E4942)  # BIN
    glb += bin_data

    return bytes(glb)


def generate_spawn_json(keyframes, R, residuals):
    """Generate spawn.json with corrected position."""
    kf0 = keyframes[0]
    pos = np.array(kf0['position'], dtype=np.float64)
    corrected_pos = (R @ pos) + np.array([0, residuals[0], 0])
    return {
        'spawn': {
            'position': corrected_pos.tolist(),
            'orientation': kf0['orientation'],
        }
    }


class Command(BaseCommand):
    help = 'Generate point cloud GLB from SLAM keyframe data or PCD file'

    def add_arguments(self, parser):
        source = parser.add_mutually_exclusive_group(required=True)
        source.add_argument('--source-dir',
                            help='Path to keyframe session directory')
        source.add_argument('--pcd',
                            help='Path to .pcd file (SLAM-optimized, already in world coords)')
        parser.add_argument('--cave', required=True,
                            help='Cave name or UUID')
        parser.add_argument('--keyframe-dir',
                            help='Path to keyframe directory for trajectory (used with --pcd)')
        parser.add_argument('--no-correction', action='store_true',
                            help='Skip gravity correction (keyframe mode only)')
        parser.add_argument('--downsample', type=float, default=0,
                            help='Voxel size for downsampling (0 = no downsampling)')

    def handle(self, *args, **options):
        cave_query = options['cave']

        # Find cave
        import uuid as _uuid
        try:
            _uuid.UUID(cave_query)
            cave = Cave.objects.get(id=cave_query)
        except (Cave.DoesNotExist, ValueError):
            cave = Cave.objects.filter(name__iexact=cave_query).first()
        if not cave:
            self.stderr.write(f'Cave not found: {cave_query}')
            return

        self.stdout.write(f'Cave: {cave.name} ({cave.id})')

        if options['pcd']:
            # ── PCD mode: load directly, no gravity correction needed ──
            pcd_path = options['pcd']
            self.stdout.write(f'Source PCD: {pcd_path}')
            self.stdout.write('Loading PCD file...')
            positions, colors = load_pcd_file(pcd_path)
            self.stdout.write(f'Total points: {len(positions):,}')
            # Optionally load keyframes for trajectory
            if options.get('keyframe_dir'):
                keyframes = load_keyframes(options['keyframe_dir'])
                self.stdout.write(f'Loaded {len(keyframes)} keyframes for trajectory')
            else:
                keyframes = None
        else:
            # ── Keyframe mode: load keyframes + apply gravity correction ──
            source_dir = options['source_dir']
            self.stdout.write(f'Source: {source_dir}')

            keyframes = load_keyframes(source_dir)
            self.stdout.write(f'Loaded {len(keyframes)} keyframes')

            if not keyframes:
                self.stderr.write('No keyframes found')
                return

            # Compute gravity correction
            if options['no_correction']:
                R = np.eye(3)
                residuals = np.zeros(len(keyframes))
                self.stdout.write('Gravity correction: DISABLED')
            else:
                R, residuals = compute_gravity_correction(keyframes)

                # Report correction stats
                positions = np.array([kf['position'] for kf in keyframes])
                baro_delta = np.array([kf['relative_altitude'] for kf in keyframes])
                baro_delta = baro_delta - baro_delta[0]

                slam_y = positions[:, 1]
                rotated = (R @ positions.T).T
                corrected_y = rotated[:, 1] + residuals

                angle = math.acos(np.clip((np.trace(R) - 1) / 2, -1, 1))

                self.stdout.write(f'Global tilt correction: {math.degrees(angle):.1f}°')
                self.stdout.write(f'SLAM Y range: {slam_y.min():.1f} to {slam_y.max():.1f}m')
                self.stdout.write(f'Baro delta range: {baro_delta.min():.1f} to {baro_delta.max():.1f}m')
                self.stdout.write(f'RMS before correction: {np.sqrt(np.mean((slam_y - baro_delta)**2)):.2f}m')
                self.stdout.write(f'RMS after correction:  {np.sqrt(np.mean((corrected_y - baro_delta)**2)):.2f}m')

            self.stdout.write('Loading point clouds...')
            positions, colors = load_and_correct_points(source_dir, keyframes, R, residuals)
            self.stdout.write(f'Total points: {len(positions):,}')

        # Optional downsampling
        if options['downsample'] > 0:
            voxel_size = options['downsample']
            self.stdout.write(f'Downsampling with voxel size {voxel_size}m...')
            indices = voxel_downsample(positions, voxel_size)
            positions = positions[indices]
            colors = colors[indices]
            self.stdout.write(f'After downsampling: {len(positions):,} points')

        # Build GLB
        self.stdout.write('Building GLB...')
        glb_data = build_glb(positions, colors)
        self.stdout.write(f'GLB size: {len(glb_data):,} bytes')

        # Save to media directory
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile

        cave_dir = f'caves/{cave.id}'

        glb_path = f'{cave_dir}/cave_pointcloud.glb'
        if default_storage.exists(glb_path):
            default_storage.delete(glb_path)
        default_storage.save(glb_path, ContentFile(glb_data))
        self.stdout.write(f'Saved: {glb_path}')

        # Generate spawn.json
        if keyframes:
            R_spawn = R if not options['no_correction'] else np.eye(3)
            res_spawn = residuals if not options['no_correction'] else np.zeros(len(keyframes))
            spawn_data = generate_spawn_json(keyframes, R_spawn, res_spawn)
        else:
            # PCD mode: spawn at centroid of point cloud
            centroid = positions.mean(axis=0).tolist()
            spawn_data = {
                'spawn': {
                    'position': centroid,
                    'orientation': [0, 0, 0, 1],  # identity quaternion
                }
            }

        spawn_json = json.dumps(spawn_data)
        spawn_path = f'{cave_dir}/spawn.json'
        if default_storage.exists(spawn_path):
            default_storage.delete(spawn_path)
        default_storage.save(spawn_path, ContentFile(spawn_json.encode()))
        self.stdout.write(f'Saved: {spawn_path}')

        # Generate trajectory.json from keyframe positions
        if keyframes:
            if options.get('pcd'):
                # PCD mode: keyframe positions are raw SLAM coords (no gravity correction)
                traj_positions = [kf['position'] for kf in keyframes]
            else:
                # Keyframe mode: apply gravity correction + residuals
                kf_positions = np.array([kf['position'] for kf in keyframes])
                corrected = (R @ kf_positions.T).T
                for i in range(len(keyframes)):
                    corrected[i, 1] += residuals[i]
                traj_positions = corrected.tolist()

            trajectory_data = {
                'positions': traj_positions,
                'keyframe_ids': [kf['keyframe_id'] for kf in keyframes],
            }
            traj_json = json.dumps(trajectory_data)
            traj_path = f'{cave_dir}/trajectory.json'
            if default_storage.exists(traj_path):
                default_storage.delete(traj_path)
            default_storage.save(traj_path, ContentFile(traj_json.encode()))
            self.stdout.write(f'Saved: {traj_path} ({len(keyframes)} points)')

        # Update cave has_map flag
        if not cave.has_map:
            cave.has_map = True
            cave.save(update_fields=['has_map', 'updated_at'])
            self.stdout.write('Set has_map=True')

        self.stdout.write(self.style.SUCCESS('Done'))


def voxel_downsample(positions, voxel_size):
    """Return indices of one point per voxel."""
    voxel_coords = np.floor(positions / voxel_size).astype(np.int32)
    _, unique_indices = np.unique(voxel_coords, axis=0, return_index=True)
    return unique_indices
