"""
Generate 2D map data from real LiDAR keyframe data.

Ported from cave-server/scripts/generate_cave_map.py.
Adapted to load kf_*_cloud.npy files + keyframe_index.json
(cave-server expects kf_*.pcd; this supports both formats).

Seven rendering modes:
  quick      - Density-based wall extraction
  standard   - Poisson mesh + multi-height slicing
  detailed   - Poisson mesh + ceiling-aware adaptive slicing
  heatmap    - Point density grid as colored cells
  edges      - Gradient edge detection on density → polylines
  raw_slice  - Single-height Poisson mesh slice
  points     - Density-weighted point cloud with variable size/opacity

Usage:
    python manage.py generate_map_data \\
        --source-dir "/path/to/keyframe/session" \\
        --cave "Mammoth Cave System"

    python manage.py generate_map_data \\
        --source-dir "/path/to/session" \\
        --cave "Mammoth Cave System" \\
        --modes quick heatmap points
"""

import glob
import json
import math
import os
from collections import Counter
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import open3d as o3d
from django.conf import settings
from django.core.management.base import BaseCommand

ALL_MODES = ['quick', 'standard', 'detailed', 'heatmap', 'edges', 'raw_slice', 'points']


# ========================================================================
# Keyframe loading — supports both .npy and .pcd formats
# ========================================================================

def load_keyframes(source_dir, stdout=None):
    """
    Load keyframes from a session directory.

    Supports two data layouts:
      1. kf_*_cloud.npy + keyframe_index.json (cave-mapper output)
      2. kf_*.pcd (cave-server format)

    Also falls back to slam_map.pcd if no per-keyframe files found.

    Returns (combined_points, trajectory, o3d_pcd).
    """
    source_dir = Path(source_dir)

    def log(msg):
        if stdout:
            stdout.write(msg)
        else:
            print(msg)

    all_points = []
    trajectory = []

    # ── Try loading from .npy keyframe clouds + keyframe_index.json ──
    npy_files = sorted(source_dir.glob('kf_*_cloud.npy'))
    index_path = source_dir / 'keyframe_index.json'

    if npy_files and index_path.exists():
        log(f'  Found {len(npy_files)} keyframe .npy files + keyframe_index.json')

        with open(index_path) as f:
            index = json.load(f)
        kf_meta = {kf['keyframe_id']: kf for kf in index.get('keyframes', [])}

        for npy_file in npy_files:
            try:
                pts = np.load(str(npy_file)).astype(np.float64)
                if len(pts) == 0:
                    continue
                all_points.append(pts)

                # Extract keyframe ID from filename: kf_000003_cloud.npy -> 3
                kf_id = int(npy_file.stem.split('_')[1])
                meta = kf_meta.get(kf_id)
                if meta and 'position' in meta:
                    trajectory.append(meta['position'])
                else:
                    # Fallback: use mean of point cloud
                    trajectory.append(pts.mean(axis=0).tolist())
            except Exception as e:
                log(f'  Warning: skipped {npy_file.name}: {e}')

        if all_points:
            trajectory = np.array(trajectory, dtype=np.float64)
            points = np.vstack(all_points)
            log(f'  Total points: {len(points):,}, trajectory: {len(trajectory)} keyframes')

            o3d_pcd = o3d.geometry.PointCloud()
            o3d_pcd.points = o3d.utility.Vector3dVector(points)
            return points, trajectory, o3d_pcd

    # ── Try loading from kf_*.pcd (cave-server format) ──
    pcd_patterns = [
        source_dir / 'kf_*.pcd',
        source_dir / 'keyframes' / 'kf_*.pcd',
    ]
    pcd_files = []
    for pattern in pcd_patterns:
        pcd_files = sorted(glob.glob(str(pattern)))
        if pcd_files:
            break

    if pcd_files:
        log(f'  Found {len(pcd_files)} keyframe .pcd files')
        for f in pcd_files:
            try:
                pcd = o3d.io.read_point_cloud(f)
                pts = np.asarray(pcd.points)
                if len(pts) > 0:
                    all_points.append(pts)
                    trajectory.append(pts.mean(axis=0))
            except Exception as e:
                log(f'  Warning: skipped {os.path.basename(f)}: {e}')

        if all_points:
            points = np.vstack(all_points)
            trajectory = np.array(trajectory)
            log(f'  Total points: {len(points):,}, trajectory: {len(trajectory)} keyframes')
            o3d_pcd = o3d.geometry.PointCloud()
            o3d_pcd.points = o3d.utility.Vector3dVector(points)
            return points, trajectory, o3d_pcd

    # ── Fallback: slam_map.pcd ──
    slam_pcd_path = source_dir / 'slam_map.pcd'
    if slam_pcd_path.exists():
        log(f'  Loading slam_map.pcd (no per-keyframe files)')
        pcd = o3d.io.read_point_cloud(str(slam_pcd_path))
        points = np.asarray(pcd.points)

        # Synthesize trajectory from keyframe_index positions, or chunk the PCD
        if index_path.exists():
            with open(index_path) as f:
                index = json.load(f)
            trajectory = np.array(
                [kf['position'] for kf in index.get('keyframes', [])
                 if 'position' in kf],
                dtype=np.float64,
            )
        else:
            # No metadata — split into chunks
            chunk_size = max(1, len(points) // 20)
            trajectory = np.array([
                points[i:i + chunk_size].mean(axis=0)
                for i in range(0, len(points), chunk_size)
            ])

        log(f'  Total points: {len(points):,}, trajectory: {len(trajectory)} keyframes')
        return points, trajectory, pcd

    raise FileNotFoundError(
        f'No keyframe data found in {source_dir}. '
        f'Expected kf_*_cloud.npy, kf_*.pcd, or slam_map.pcd.'
    )


# ========================================================================
# Level detection
# ========================================================================

def detect_levels(trajectory_z, threshold=2.0):
    """Cluster keyframes by Z height to identify separate cave levels."""
    if len(trajectory_z) == 0:
        return []

    sorted_indices = np.argsort(trajectory_z)
    sorted_z = trajectory_z[sorted_indices]

    levels = []
    current_level_z = [sorted_z[0]]
    current_level_ids = [int(sorted_indices[0])]

    for i in range(1, len(sorted_z)):
        z = sorted_z[i]
        level_center = np.mean(current_level_z)

        if abs(z - level_center) > threshold:
            levels.append({
                'z_values': current_level_z,
                'keyframe_ids': current_level_ids,
            })
            current_level_z = [z]
            current_level_ids = [int(sorted_indices[i])]
        else:
            current_level_z.append(z)
            current_level_ids.append(int(sorted_indices[i]))

    levels.append({
        'z_values': current_level_z,
        'keyframe_ids': current_level_ids,
    })

    result = []
    for idx, level in enumerate(levels):
        z_arr = np.array(level['z_values'])
        result.append({
            'index': idx,
            'name': f'Level {idx + 1}',
            'z_min': float(z_arr.min()),
            'z_max': float(z_arr.max()),
            'z_center': float(z_arr.mean()),
            'keyframe_ids': level['keyframe_ids'],
        })

    return result


def detect_transitions(trajectory, levels, min_z_delta=1.0):
    """Detect level transitions by walking the trajectory in time order."""
    if len(levels) < 2 or len(trajectory) < 2:
        return []

    kf_to_level = {}
    for level in levels:
        for kf_id in level['keyframe_ids']:
            kf_to_level[kf_id] = level['index']

    transitions = []
    for i in range(len(trajectory) - 1):
        level_a = kf_to_level.get(i)
        level_b = kf_to_level.get(i + 1)

        if level_a is None or level_b is None or level_a == level_b:
            continue

        z_delta = abs(trajectory[i + 1][2] - trajectory[i][2])
        if z_delta < min_z_delta:
            continue

        mx = float((trajectory[i][0] + trajectory[i + 1][0]) / 2)
        my = float((trajectory[i][1] + trajectory[i + 1][1]) / 2)
        mz = float((trajectory[i][2] + trajectory[i + 1][2]) / 2)

        too_close = any(
            (t['x'] - mx) ** 2 + (t['y'] - my) ** 2 < 1.0
            for t in transitions
        )
        if too_close:
            continue

        transitions.append({
            'x': round(mx, 3), 'y': round(my, 3), 'z': round(mz, 3),
            'from_level': level_a, 'to_level': level_b,
        })

    return transitions


# ========================================================================
# Heading extraction
# ========================================================================

def extract_initial_heading(source_dir):
    """Extract magnetic heading from the first keyframe's metadata."""
    source_dir = Path(source_dir)

    # Try individual keyframe metadata
    for name in ['kf_000000.json', 'kf_0.json']:
        path = source_dir / name
        if path.is_file():
            try:
                with open(path) as f:
                    meta = json.load(f)
                if meta.get('magnetic_heading') is not None:
                    return math.degrees(meta['magnetic_heading']) % 360
            except (json.JSONDecodeError, TypeError, ValueError):
                pass

    # Try keyframe_index.json
    index_path = source_dir / 'keyframe_index.json'
    if index_path.is_file():
        try:
            with open(index_path) as f:
                index = json.load(f)
            kfs = index.get('keyframes', [])
            if kfs and kfs[0].get('magnetic_heading') is not None:
                return math.degrees(kfs[0]['magnetic_heading']) % 360
        except (json.JSONDecodeError, TypeError, ValueError, IndexError):
            pass

    return None


# ========================================================================
# Quick mode: density-based wall extraction
# ========================================================================

def density_to_polylines(xy_points, resolution=0.05, threshold_pct=70):
    """Convert 2D points to wall polylines using density thresholding."""
    if len(xy_points) < 10:
        return [], [0, 0, 1, 1]

    x_min = float(xy_points[:, 0].min()) - 0.5
    y_min = float(xy_points[:, 1].min()) - 0.5
    x_max = float(xy_points[:, 0].max()) + 0.5
    y_max = float(xy_points[:, 1].max()) + 0.5

    w = int((x_max - x_min) / resolution) + 1
    h = int((y_max - y_min) / resolution) + 1

    if w > 4000 or h > 4000:
        resolution = max(x_max - x_min, y_max - y_min) / 3000
        w = int((x_max - x_min) / resolution) + 1
        h = int((y_max - y_min) / resolution) + 1

    density, _, _ = np.histogram2d(
        xy_points[:, 1], xy_points[:, 0],
        bins=[h, w],
        range=[[y_min, y_max], [x_min, x_max]]
    )

    density = cv2.GaussianBlur(density.astype(np.float32), (3, 3), 0.5)

    nonzero = density[density > 0]
    if len(nonzero) == 0:
        return [], [x_min, y_min, x_max, y_max]

    threshold = np.percentile(nonzero, threshold_pct)
    walls = (density >= threshold).astype(np.uint8) * 255

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(walls, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    polylines = []
    for contour in contours:
        if len(contour) < 3:
            continue
        approx = cv2.approxPolyDP(contour, 2.0, closed=True)
        pts = []
        for pt in approx:
            px, py = pt[0]
            wx = round(px * resolution + x_min, 3)
            wy = round(py * resolution + y_min, 3)
            pts.append([wx, wy])
        if len(pts) >= 3:
            polylines.append(pts)

    return polylines, [x_min, y_min, x_max, y_max]


def process_level_quick(level_points, z_min, stdout=None):
    """Quick mode: density-based wall extraction for a single level."""
    floor_z = z_min
    wall_mask = (level_points[:, 2] >= floor_z + 0.5) & (level_points[:, 2] <= floor_z + 1.8)
    wall_points = level_points[wall_mask][:, :2]

    if len(wall_points) < 10:
        wall_mask = (level_points[:, 2] >= floor_z + 0.2) & (level_points[:, 2] <= floor_z + 2.5)
        wall_points = level_points[wall_mask][:, :2]

    if len(wall_points) < 10:
        return None, None

    if stdout:
        stdout.write(f'    Wall points: {len(wall_points)}')
    walls, bounds = density_to_polylines(wall_points, resolution=0.05, threshold_pct=70)
    if stdout:
        stdout.write(f'    Polylines: {len(walls)}')
    return walls, bounds


# ========================================================================
# Poisson mesh reconstruction (shared by standard + detailed + raw_slice)
# ========================================================================

def poisson_reconstruction(o3d_pcd, voxel_size=0.08, depth=9, stdout=None):
    """Poisson surface reconstruction from point cloud."""
    def log(msg):
        if stdout:
            stdout.write(msg)

    log('  Poisson reconstruction...')

    pcd_down = o3d_pcd.voxel_down_sample(voxel_size=voxel_size)
    log(f'    Downsampled: {len(pcd_down.points)} points')

    log('    Estimating normals...')
    pcd_down.estimate_normals(
        search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=0.4, max_nn=30)
    )
    pcd_down.orient_normals_consistent_tangent_plane(k=20)

    log(f'    Running Poisson (depth={depth})...')
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd_down, depth=depth, width=0, scale=1.1, linear_fit=False
    )

    densities = np.asarray(densities)
    vertices_to_remove = densities < np.quantile(densities, 0.05)
    mesh.remove_vertices_by_mask(vertices_to_remove)
    mesh.compute_vertex_normals()

    log(f'    Mesh: {len(mesh.vertices)} vertices, {len(mesh.triangles)} triangles')
    return mesh


def slice_mesh_at_z(mesh, z_height):
    """Slice a triangle mesh at a given Z height, returning 2D line segments."""
    vertices = np.asarray(mesh.vertices)
    triangles = np.asarray(mesh.triangles)

    segments = []
    for tri in triangles:
        v0, v1, v2 = vertices[tri]
        z0, z1, z2 = v0[2], v1[2], v2[2]

        if min(z0, z1, z2) > z_height or max(z0, z1, z2) < z_height:
            continue

        edges = [(v0, v1), (v1, v2), (v2, v0)]
        intersections = []

        for va, vb in edges:
            za, zb = va[2], vb[2]
            if (za <= z_height <= zb) or (zb <= z_height <= za):
                if abs(zb - za) > 1e-6:
                    t = (z_height - za) / (zb - za)
                    if 0 <= t <= 1:
                        pt = va + t * (vb - va)
                        intersections.append(pt[:2])

        if len(intersections) == 2:
            segments.append((tuple(intersections[0]), tuple(intersections[1])))

    return segments


def segments_to_polylines(segments, resolution=0.03):
    """Rasterize line segments to a grid and extract clean polylines."""
    if not segments:
        return [], None

    all_pts = []
    for (p1, p2) in segments:
        all_pts.extend([p1, p2])
    all_pts = np.array(all_pts)

    x_min, y_min = all_pts.min(axis=0) - 0.5
    x_max, y_max = all_pts.max(axis=0) + 0.5

    width = int((x_max - x_min) / resolution) + 1
    height = int((y_max - y_min) / resolution) + 1

    if width > 6000 or height > 6000:
        resolution = max(x_max - x_min, y_max - y_min) / 5000
        width = int((x_max - x_min) / resolution) + 1
        height = int((y_max - y_min) / resolution) + 1

    grid = np.zeros((height, width), dtype=np.uint8)
    for (p1, p2) in segments:
        x1 = int((p1[0] - x_min) / resolution)
        y1 = int((p1[1] - y_min) / resolution)
        x2 = int((p2[0] - x_min) / resolution)
        y2 = int((p2[1] - y_min) / resolution)
        cv2.line(grid, (x1, y1), (x2, y2), 255, thickness=2)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    grid = cv2.morphologyEx(grid, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(grid, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    polylines = []
    for contour in contours:
        if len(contour) < 3:
            continue
        approx = cv2.approxPolyDP(contour, 2, closed=False)
        pts = []
        for pt in approx:
            px, py = pt[0]
            wx = round(float(px * resolution + x_min), 3)
            wy = round(float(py * resolution + y_min), 3)
            pts.append([wx, wy])
        if len(pts) >= 2:
            polylines.append(pts)

    return polylines, [float(x_min), float(y_min), float(x_max), float(y_max)]


# ========================================================================
# Standard mode: Poisson + multi-height slicing
# ========================================================================

def process_level_standard(mesh, level_z_min, level_z_max, stdout=None):
    """Standard mode: slice Poisson mesh at multiple fixed heights within level."""
    floor_z = level_z_min
    ceiling_z = level_z_max

    slice_min = floor_z + 0.5
    slice_max = min(floor_z + 1.8, ceiling_z - 0.2)

    if slice_max <= slice_min:
        slice_min = floor_z + 0.2
        slice_max = ceiling_z - 0.1

    if slice_max <= slice_min:
        slice_min = slice_max = (floor_z + ceiling_z) / 2

    z_heights = np.arange(slice_min, slice_max + 0.1, 0.2)
    if len(z_heights) < 2:
        z_heights = np.array([slice_min, slice_max])

    if stdout:
        stdout.write(f'    Slicing at {len(z_heights)} heights: '
                     f'Z=[{z_heights[0]:.2f} .. {z_heights[-1]:.2f}]')

    all_segments = []
    for z in z_heights:
        segs = slice_mesh_at_z(mesh, z)
        all_segments.extend(segs)
        if stdout:
            stdout.write(f'      Z={z:.2f}m: {len(segs)} segments')

    if not all_segments:
        return None, None

    if stdout:
        stdout.write(f'    Total segments: {len(all_segments)}')
    polylines, bounds = segments_to_polylines(all_segments, resolution=0.03)
    if stdout:
        stdout.write(f'    Polylines: {len(polylines)}')
    return polylines, bounds


# ========================================================================
# Detailed mode: Poisson + ceiling-aware adaptive slicing
# ========================================================================

def detect_local_ceiling(points, x, y, search_radius=1.0):
    """Detect floor/ceiling at a given XY position from nearby points."""
    xy_distances = np.sqrt((points[:, 0] - x) ** 2 + (points[:, 1] - y) ** 2)
    nearby_mask = xy_distances < search_radius

    if not np.any(nearby_mask):
        return None

    z_values = points[nearby_mask, 2]
    return {
        'floor': float(np.percentile(z_values, 10)),
        'ceiling': float(np.percentile(z_values, 90)),
        'height': float(np.percentile(z_values, 90) - np.percentile(z_values, 10)),
    }


def compute_adaptive_slice_heights(points, trajectory, level_keyframe_ids,
                                   default_slice_z=1.0, min_clearance=0.3):
    """Compute slice height for each trajectory point, adapting for low ceilings."""
    slice_heights = []
    adapted_count = 0

    for kf_idx in level_keyframe_ids:
        if kf_idx >= len(trajectory):
            continue

        x, y, z = trajectory[kf_idx]
        local = detect_local_ceiling(points, x, y)

        if local is None:
            slice_heights.append({
                'x': float(x), 'y': float(y),
                'slice_z': default_slice_z, 'adapted': False,
            })
            continue

        ceiling_z = local['ceiling']
        floor_z = local['floor']
        passage_height = local['height']

        if ceiling_z > default_slice_z + min_clearance:
            slice_z = default_slice_z
            adapted = False
        else:
            slice_z = floor_z + (passage_height * 0.5)
            slice_z = min(slice_z, ceiling_z - min_clearance)
            slice_z = max(slice_z, floor_z + 0.2)
            adapted = True
            adapted_count += 1

        slice_heights.append({
            'x': float(x), 'y': float(y),
            'slice_z': float(slice_z), 'adapted': adapted,
        })

    return slice_heights


def process_level_detailed(mesh, points, trajectory, level, stdout=None):
    """Detailed mode: multi-height slicing + ceiling-aware adaptive slices."""
    floor_z = level['z_min']
    ceiling_z = level['z_max']
    z_band = 0.15

    slice_min = floor_z + 0.4
    slice_max = min(floor_z + 2.0, ceiling_z - 0.1)
    if slice_max <= slice_min:
        slice_min = floor_z + 0.2
        slice_max = ceiling_z - 0.05

    regular_heights = list(np.arange(slice_min, slice_max + 0.05, 0.15))
    if stdout:
        stdout.write(f'    Regular slices: {len(regular_heights)} '
                     f'(Z=[{regular_heights[0]:.2f} .. {regular_heights[-1]:.2f}])')

    default_abs_z = floor_z + 1.0
    slice_heights = compute_adaptive_slice_heights(
        points, trajectory, level['keyframe_ids'],
        default_slice_z=default_abs_z, min_clearance=0.3,
    )
    if stdout:
        adapted = sum(1 for sh in slice_heights if sh['adapted'])
        stdout.write(f'    Adaptive heights: {len(slice_heights)} points, {adapted} adapted')

    adaptive_z = [sh['slice_z'] for sh in slice_heights]
    all_z = sorted(set(round(z, 2) for z in regular_heights + adaptive_z))
    if stdout:
        stdout.write(f'    Combined unique slice heights: {len(all_z)}')

    all_segments = []
    for z in all_z:
        for dz in [-z_band, 0, z_band]:
            segs = slice_mesh_at_z(mesh, z + dz)
            all_segments.extend(segs)

    if not all_segments:
        return None, None

    if stdout:
        stdout.write(f'    Total segments: {len(all_segments)}')
    polylines, bounds = segments_to_polylines(all_segments, resolution=0.03)
    if stdout:
        stdout.write(f'    Polylines: {len(polylines)}')
    return polylines, bounds


# ========================================================================
# Heatmap mode: point density grid
# ========================================================================

def process_level_heatmap(level_points, z_min, resolution=0.08, stdout=None):
    """Heatmap mode: output a normalized density grid for canvas rendering."""
    floor_z = z_min
    wall_mask = (level_points[:, 2] >= floor_z + 0.3) & (level_points[:, 2] <= floor_z + 2.0)
    wall_points = level_points[wall_mask][:, :2]

    if len(wall_points) < 10:
        return None, None, None

    x_min = float(wall_points[:, 0].min()) - 0.5
    y_min = float(wall_points[:, 1].min()) - 0.5
    x_max = float(wall_points[:, 0].max()) + 0.5
    y_max = float(wall_points[:, 1].max()) + 0.5

    w = int((x_max - x_min) / resolution) + 1
    h = int((y_max - y_min) / resolution) + 1

    if w > 2000 or h > 2000:
        resolution = max(x_max - x_min, y_max - y_min) / 1500
        w = int((x_max - x_min) / resolution) + 1
        h = int((y_max - y_min) / resolution) + 1

    density, _, _ = np.histogram2d(
        wall_points[:, 1], wall_points[:, 0],
        bins=[h, w],
        range=[[y_min, y_max], [x_min, x_max]]
    )

    density = cv2.GaussianBlur(density.astype(np.float32), (5, 5), 1.0)
    density = np.log1p(density)
    max_val = density.max()
    if max_val > 0:
        density = density / max_val

    heatmap_info = {
        'data': np.round(density, 3).tolist(),
        'origin': [round(x_min, 3), round(y_min, 3)],
        'resolution': round(resolution, 4),
        'width': w,
        'height': h,
    }

    if stdout:
        stdout.write(f'    Heatmap grid: {w}x{h} cells, resolution={resolution:.3f}m')
    return [], [x_min, y_min, x_max, y_max], heatmap_info


# ========================================================================
# Edges mode: gradient edge detection → polylines
# ========================================================================

def process_level_edges(level_points, z_min, resolution=0.04, stdout=None):
    """Edges mode: Canny edge detection on density grid → polylines."""
    floor_z = z_min
    wall_mask = (level_points[:, 2] >= floor_z + 0.3) & (level_points[:, 2] <= floor_z + 2.0)
    wall_points = level_points[wall_mask][:, :2]

    if len(wall_points) < 10:
        return None, None

    x_min = float(wall_points[:, 0].min()) - 0.5
    y_min = float(wall_points[:, 1].min()) - 0.5
    x_max = float(wall_points[:, 0].max()) + 0.5
    y_max = float(wall_points[:, 1].max()) + 0.5

    w = int((x_max - x_min) / resolution) + 1
    h = int((y_max - y_min) / resolution) + 1

    if w > 4000 or h > 4000:
        resolution = max(x_max - x_min, y_max - y_min) / 3000
        w = int((x_max - x_min) / resolution) + 1
        h = int((y_max - y_min) / resolution) + 1

    density, _, _ = np.histogram2d(
        wall_points[:, 1], wall_points[:, 0],
        bins=[h, w],
        range=[[y_min, y_max], [x_min, x_max]]
    )

    density = cv2.GaussianBlur(density.astype(np.float32), (5, 5), 1.0)

    max_val = density.max()
    if max_val > 0:
        density_u8 = (density / max_val * 255).astype(np.uint8)
    else:
        return None, None

    edges = cv2.Canny(density_u8, 30, 100)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    edges = cv2.dilate(edges, kernel, iterations=1)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    polylines = []
    for contour in contours:
        if len(contour) < 3:
            continue
        approx = cv2.approxPolyDP(contour, 1.5, closed=False)
        pts = []
        for pt in approx:
            px, py = pt[0]
            wx = round(px * resolution + x_min, 3)
            wy = round(py * resolution + y_min, 3)
            pts.append([wx, wy])
        if len(pts) >= 2:
            polylines.append(pts)

    if stdout:
        stdout.write(f'    Edge detection: {len(polylines)} polylines from Canny edges')
    return polylines, [x_min, y_min, x_max, y_max]


# ========================================================================
# Raw slice mode: single-height Poisson mesh slice
# ========================================================================

def process_level_raw_slice(mesh, level_z_min, level_z_max, stdout=None):
    """Raw slice mode: single clean Poisson mesh slice at optimal height."""
    floor_z = level_z_min
    ceiling_z = level_z_max
    passage_height = ceiling_z - floor_z

    slice_z = floor_z + min(1.0, passage_height * 0.5)

    if stdout:
        stdout.write(f'    Single slice at Z={slice_z:.2f}m')
    segments = slice_mesh_at_z(mesh, slice_z)
    if stdout:
        stdout.write(f'    Segments: {len(segments)}')

    if not segments:
        return None, None

    polylines = []
    all_pts = []
    for (p1, p2) in segments:
        all_pts.extend([p1, p2])
        polylines.append([
            [round(float(p1[0]), 3), round(float(p1[1]), 3)],
            [round(float(p2[0]), 3), round(float(p2[1]), 3)],
        ])

    all_pts = np.array(all_pts)
    x_min, y_min = all_pts.min(axis=0) - 0.5
    x_max, y_max = all_pts.max(axis=0) + 0.5
    bounds = [float(x_min), float(y_min), float(x_max), float(y_max)]

    if stdout:
        stdout.write(f'    Raw polylines (segments): {len(polylines)}')
    return polylines, bounds


# ========================================================================
# Points mode: density-weighted point cloud
# ========================================================================

def process_level_points(level_points, z_min, grid_size=0.05, contrast=0.7, stdout=None):
    """Points mode: density-weighted point cloud matching cave_app rendering."""
    floor_z = z_min
    wall_mask = (level_points[:, 2] >= floor_z + 0.3) & (level_points[:, 2] <= floor_z + 2.0)
    wall_points = level_points[wall_mask][:, :2]

    if len(wall_points) < 10:
        return None, None, None

    cell_x = np.round(wall_points[:, 0] / grid_size).astype(int)
    cell_y = np.round(wall_points[:, 1] / grid_size).astype(int)

    cell_counts = Counter(zip(cell_x.tolist(), cell_y.tolist()))

    if not cell_counts:
        return None, None, None

    max_count = max(cell_counts.values())
    cell_set = set(cell_counts.keys())

    points_out = []
    for (cx, cy), count in cell_counts.items():
        neighbors = sum(
            1 for dx in (-1, 0, 1) for dy in (-1, 0, 1)
            if (dx != 0 or dy != 0) and (cx + dx, cy + dy) in cell_set
        )

        density = (count / max_count) * 0.5 + (neighbors / 8.0) * 0.5
        adjusted = density ** contrast

        if adjusted < 0.01:
            continue

        wx = round(cx * grid_size, 3)
        wy = round(cy * grid_size, 3)
        points_out.append([wx, wy, round(adjusted, 3)])

    if not points_out:
        return None, None, None

    xs = [p[0] for p in points_out]
    ys = [p[1] for p in points_out]
    bounds = [min(xs) - 0.5, min(ys) - 0.5, max(xs) + 0.5, max(ys) + 0.5]

    density_info = {
        'points': points_out,
        'grid_size': grid_size,
        'count': len(points_out),
    }

    if stdout:
        stdout.write(f'    Density points: {len(points_out)} cells, '
                     f'grid={grid_size}m, contrast={contrast}')
    return [], bounds, density_info


# ========================================================================
# Main processing pipeline
# ========================================================================

def process_cave_map(source_dir, output_dir, mode='quick', stdout=None):
    """
    Main pipeline: keyframe data -> JSON map file.

    Args:
        source_dir: Path to keyframe session directory
        output_dir: Path to output directory (cave media dir)
        mode: One of ALL_MODES
        stdout: Django management command stdout (or None for print)
    """
    def log(msg):
        if stdout:
            stdout.write(msg)
        else:
            print(msg)

    log(f'Mode: {mode}')

    points, trajectory, o3d_pcd = load_keyframes(source_dir, stdout=stdout)

    initial_heading = extract_initial_heading(source_dir)
    if initial_heading is not None:
        log(f'  Initial heading: {initial_heading:.1f} degrees')

    # Detect levels
    trajectory_z = trajectory[:, 2]
    levels = detect_levels(trajectory_z)
    log(f'Detected {len(levels)} level(s)')

    transitions = detect_transitions(trajectory, levels)
    if transitions:
        log(f'Detected {len(transitions)} level transition(s)')

    # Build Poisson mesh for modes that need it
    mesh = None
    if mode in ('standard', 'detailed', 'raw_slice'):
        mesh = poisson_reconstruction(o3d_pcd, stdout=stdout)

    # Process each level
    result_levels = []
    global_bounds = [float('inf'), float('inf'), float('-inf'), float('-inf')]

    for level in levels:
        z_min = level['z_min']
        z_max = level['z_max']
        z_range = z_max - z_min
        log(f"\n  {level['name']}: Z=[{z_min:.2f}, {z_max:.2f}], "
            f"{len(level['keyframe_ids'])} keyframes")

        margin = max(z_range * 0.2, 0.5)
        z_mask = (points[:, 2] >= z_min - margin) & (points[:, 2] <= z_max + margin)
        level_points = points[z_mask]

        if len(level_points) < 10:
            log(f'    Skipping: too few points ({len(level_points)})')
            continue

        heatmap_info = None
        density_info = None
        if mode == 'quick':
            walls, bounds = process_level_quick(level_points, z_min, stdout=stdout)
        elif mode == 'standard':
            walls, bounds = process_level_standard(mesh, z_min, z_max, stdout=stdout)
        elif mode == 'detailed':
            walls, bounds = process_level_detailed(
                mesh, level_points, trajectory, level, stdout=stdout,
            )
        elif mode == 'heatmap':
            walls, bounds, heatmap_info = process_level_heatmap(
                level_points, z_min, stdout=stdout,
            )
        elif mode == 'edges':
            walls, bounds = process_level_edges(level_points, z_min, stdout=stdout)
        elif mode == 'raw_slice':
            walls, bounds = process_level_raw_slice(mesh, z_min, z_max, stdout=stdout)
        elif mode == 'points':
            walls, bounds, density_info = process_level_points(
                level_points, z_min, stdout=stdout,
            )
        else:
            raise ValueError(f"Unknown mode '{mode}'")

        if bounds is None:
            log('    Skipping: no wall data produced')
            continue

        # Trajectory for this level
        level_traj_mask = np.isin(np.arange(len(trajectory)), level['keyframe_ids'])
        level_traj = trajectory[level_traj_mask][:, :2]
        level_traj_list = [[round(float(x), 3), round(float(y), 3)]
                           for x, y in level_traj]

        level_data = {
            'index': level['index'],
            'name': level['name'],
            'z_min': round(level['z_min'], 3),
            'z_max': round(level['z_max'], 3),
            'z_center': round(level['z_center'], 3),
            'walls': walls,
            'trajectory': level_traj_list,
        }
        if heatmap_info:
            level_data['heatmap'] = heatmap_info
        if density_info:
            level_data['density'] = density_info

        result_levels.append(level_data)

        global_bounds[0] = min(global_bounds[0], bounds[0])
        global_bounds[1] = min(global_bounds[1], bounds[1])
        global_bounds[2] = max(global_bounds[2], bounds[2])
        global_bounds[3] = max(global_bounds[3], bounds[3])

    if not result_levels:
        raise RuntimeError('No levels produced any map data')

    result = {
        'generated_at': datetime.now().isoformat(),
        'mode': mode,
        'bounds': [round(b, 3) for b in global_bounds],
        'levels': result_levels,
    }
    if transitions:
        result['transitions'] = transitions
    if initial_heading is not None:
        result['initial_heading_deg'] = round(initial_heading, 2)

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f'map_data_{mode}.json'

    with open(output_path, 'w') as f:
        json.dump(result, f)

    size_kb = output_path.stat().st_size / 1024
    log(f'\nOutput: {output_path.name} ({size_kb:.1f} KB)')

    return output_path


# ========================================================================
# Django management command
# ========================================================================

class Command(BaseCommand):
    help = 'Generate 2D map data from real LiDAR keyframe data for all 7 modes'

    def add_arguments(self, parser):
        parser.add_argument(
            '--source-dir', required=True,
            help='Path to keyframe session directory '
                 '(contains kf_*_cloud.npy + keyframe_index.json, or kf_*.pcd, or slam_map.pcd)',
        )
        parser.add_argument(
            '--cave', default='Mammoth Cave System',
            help='Name of the target cave (default: Mammoth Cave System)',
        )
        parser.add_argument(
            '--modes', nargs='+', choices=ALL_MODES, default=ALL_MODES,
            help=f'Modes to generate (default: all). Choices: {", ".join(ALL_MODES)}',
        )

    def handle(self, *args, **options):
        from caves.models import Cave

        source_dir = Path(options['source_dir'])
        if not source_dir.exists():
            self.stderr.write(self.style.ERROR(f'Source directory not found: {source_dir}'))
            return

        try:
            cave = Cave.objects.get(name=options['cave'])
        except Cave.DoesNotExist:
            self.stderr.write(self.style.ERROR(
                f'Cave "{options["cave"]}" not found. Run seed_data first.'
            ))
            return

        self.stdout.write(f'Cave: {cave.name} ({cave.id})')
        self.stdout.write(f'Source: {source_dir}')
        self.stdout.write(f'Modes: {", ".join(options["modes"])}')
        self.stdout.write('')

        media_root = Path(settings.MEDIA_ROOT)
        cave_dir = media_root / 'caves' / str(cave.id)

        # Extract initial heading to save on cave model
        heading = extract_initial_heading(source_dir)

        generated = []
        for mode in options['modes']:
            self.stdout.write(self.style.MIGRATE_HEADING(f'=== {mode.upper()} ==='))
            try:
                output_path = process_cave_map(
                    source_dir, cave_dir, mode=mode, stdout=self.stdout,
                )
                generated.append(mode)
                self.stdout.write(self.style.SUCCESS(f'  Done: {output_path.name}'))
            except Exception as e:
                self.stderr.write(self.style.ERROR(f'  FAILED: {e}'))
            self.stdout.write('')

        # Also save default map_data.json as a copy of standard (or first available)
        default_mode = 'standard' if 'standard' in generated else (generated[0] if generated else None)
        if default_mode:
            src = cave_dir / f'map_data_{default_mode}.json'
            dst = cave_dir / 'map_data.json'
            if src.exists():
                import shutil
                shutil.copy2(src, dst)
                self.stdout.write(f'Default map: {dst.name} (copy of {default_mode})')

        # Update cave model
        if generated:
            update_fields = ['has_map', 'updated_at']
            cave.has_map = True
            if heading is not None:
                cave.slam_heading = heading
                update_fields.append('slam_heading')
            cave.save(update_fields=update_fields)
            self.stdout.write(f'Set has_map=True on {cave.name}')

        # Summary
        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS(
            f'Generated {len(generated)}/{len(options["modes"])} map modes'
        ))
        for mode in generated:
            path = cave_dir / f'map_data_{mode}.json'
            size = path.stat().st_size / 1024
            self.stdout.write(f'  {mode}: {size:.1f} KB')
