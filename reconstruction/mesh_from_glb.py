"""
Standalone mesh generation from point cloud GLB files.

Extracts positions + colors from a point-cloud GLB, runs Open3D Ball Pivoting
Algorithm (BPA) surface reconstruction, and exports as mesh GLB.

BPA is preferred over Poisson for cave geometry because it:
- Only creates triangles where points exist (no inflation/closing)
- Naturally produces open surfaces (tunnels, entrances stay open)
- Preserves original vertex positions and colors directly

No dependency on ReconstructionJob — can be called from any context.
"""

import io
import json
import logging
import struct
import time

import numpy as np
import open3d as o3d
import trimesh

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

logger = logging.getLogger(__name__)


def extract_points_from_glb(glb_bytes):
    """
    Parse a point-cloud GLB and extract position + color arrays.

    Returns (positions, colors) where:
        positions: Nx3 float64 array
        colors: Nx3 float64 array (0-1 range), or None if no colors
    """
    scene = trimesh.load(io.BytesIO(glb_bytes), file_type='glb', process=False)

    # trimesh may return a Scene or a single geometry
    if isinstance(scene, trimesh.Scene):
        all_verts = []
        all_colors = []
        for name, geom in scene.geometry.items():
            if hasattr(geom, 'vertices') and len(geom.vertices) > 0:
                all_verts.append(np.asarray(geom.vertices, dtype=np.float64))
                if hasattr(geom, 'colors') and geom.colors is not None and len(geom.colors) > 0:
                    c = np.asarray(geom.colors, dtype=np.float64)
                    if c.max() > 1.0:
                        c = c / 255.0
                    all_colors.append(c[:, :3])
                elif hasattr(geom, 'visual') and hasattr(geom.visual, 'vertex_colors'):
                    vc = np.asarray(geom.visual.vertex_colors, dtype=np.float64)
                    if vc.max() > 1.0:
                        vc = vc / 255.0
                    all_colors.append(vc[:, :3])
                else:
                    all_colors.append(None)

        if not all_verts:
            raise ValueError("No geometry found in GLB")

        positions = np.vstack(all_verts)
        if all(c is not None for c in all_colors):
            colors = np.vstack(all_colors)
        else:
            colors = None
    elif hasattr(scene, 'vertices'):
        positions = np.asarray(scene.vertices, dtype=np.float64)
        if hasattr(scene, 'visual') and hasattr(scene.visual, 'vertex_colors'):
            vc = np.asarray(scene.visual.vertex_colors, dtype=np.float64)
            if vc.max() > 1.0:
                vc = vc / 255.0
            colors = vc[:, :3]
        else:
            colors = None
    else:
        raise ValueError("Could not extract point data from GLB")

    return positions, colors


def generate_mesh_from_arrays(positions, colors=None, voxel_size=0.05):
    """
    Generate a mesh from raw point arrays via Ball Pivoting Algorithm (BPA).

    BPA rolls a virtual ball across the point cloud surface, creating triangles
    where the ball contacts 3 points. Multiple passes with increasing radii
    handle varying point density. Unlike Poisson, BPA:
    - Only meshes where points actually exist
    - Preserves original vertex positions and colors
    - Naturally leaves openings (tunnels, entrances)

    Args:
        positions: Nx3 float64 array of point positions
        colors: Nx3 float64 array (0-1 range) or None
        voxel_size: Voxel size for downsampling (0 to skip)

    Returns: GLB bytes of the reconstructed mesh
    """
    logger.info("Generating BPA mesh from %d points (voxel=%.3f)",
                len(positions), voxel_size)

    # Build Open3D point cloud
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(positions)
    if colors is not None:
        pcd.colors = o3d.utility.Vector3dVector(colors)

    # Statistical outlier removal
    pcd_clean, inlier_idx = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
    logger.info("After outlier removal: %d points", len(pcd_clean.points))

    # Voxel downsample
    if voxel_size > 0:
        pcd_clean = pcd_clean.voxel_down_sample(voxel_size)
        logger.info("After downsampling: %d points", len(pcd_clean.points))

    # Estimate normals (required for BPA)
    pcd_clean.estimate_normals(
        search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=0.3, max_nn=30)
    )
    pcd_clean.orient_normals_consistent_tangent_plane(k=15)

    # Compute ball radii from average nearest-neighbor distance
    distances = pcd_clean.compute_nearest_neighbor_distance()
    avg_dist = np.mean(distances)
    radii = [avg_dist * 2, avg_dist * 4, avg_dist * 8, avg_dist * 16]
    logger.info("BPA radii (from avg_dist=%.4f): %s", avg_dist, radii)

    # Ball Pivoting Algorithm
    mesh = o3d.geometry.TriangleMesh.create_from_point_cloud_ball_pivoting(
        pcd_clean, o3d.utility.DoubleVector(radii)
    )
    mesh.compute_vertex_normals()

    mesh_verts = np.asarray(mesh.vertices)
    mesh_tris = np.asarray(mesh.triangles)
    logger.info("BPA mesh: %d vertices, %d triangles", len(mesh_verts), len(mesh_tris))

    if len(mesh_tris) == 0:
        raise ValueError("BPA produced no triangles — point cloud may be too sparse")

    # BPA preserves original vertices, so colors come directly from the mesh
    if mesh.has_vertex_colors():
        mesh_colors = np.asarray(mesh.vertex_colors)
    else:
        # Procedural rock color fallback
        normals = np.asarray(mesh.vertex_normals)
        n = len(normals)
        rng = np.random.RandomState(42)
        base = np.array([0.55, 0.50, 0.45])
        mesh_colors = np.clip(
            base + normals[:, 2:3] * 0.1 + rng.uniform(-0.03, 0.03, (n, 3)),
            0.0, 1.0
        )

    # Export via trimesh
    colors_uint8 = (np.clip(mesh_colors, 0, 1) * 255).astype(np.uint8)
    alpha = np.full((len(colors_uint8), 1), 255, dtype=np.uint8)
    colors_rgba = np.hstack([colors_uint8, alpha])

    tri_mesh = trimesh.Trimesh(
        vertices=mesh_verts,
        faces=mesh_tris,
        vertex_normals=np.asarray(mesh.vertex_normals),
        vertex_colors=colors_rgba,
    )

    buf = io.BytesIO()
    tri_mesh.export(buf, file_type='glb')
    glb_bytes = buf.getvalue()

    logger.info("Mesh GLB: %.2f MB", len(glb_bytes) / (1024 * 1024))
    return glb_bytes


def generate_wireframe_glb(mesh_glb_bytes, angle_threshold_deg=15):
    """
    Extract edges from a mesh GLB and export as a wireframe GLB (LINES primitive).

    Uses the same crease-angle threshold as Three.js EdgesGeometry to select
    visually significant edges (skip coplanar triangle edges).

    Returns: GLB bytes with LINES primitive mode.
    """
    scene = trimesh.load(io.BytesIO(mesh_glb_bytes), file_type='glb', process=False)

    all_edge_verts = []

    def process_geom(geom):
        if not hasattr(geom, 'faces') or len(geom.faces) == 0:
            return
        verts = np.asarray(geom.vertices, dtype=np.float32)
        faces = np.asarray(geom.faces)
        face_normals = np.asarray(geom.face_normals, dtype=np.float64)

        # Build edge → face adjacency
        from collections import defaultdict
        edge_faces = defaultdict(list)
        for fi, face in enumerate(faces):
            for i in range(3):
                a, b = int(face[i]), int(face[(i + 1) % 3])
                edge_key = (min(a, b), max(a, b))
                edge_faces[edge_key].append(fi)

        cos_threshold = np.cos(np.radians(angle_threshold_deg))
        edge_positions = []

        for (a, b), face_list in edge_faces.items():
            if len(face_list) == 1:
                # Boundary edge — always include
                edge_positions.append(verts[a])
                edge_positions.append(verts[b])
            elif len(face_list) == 2:
                # Include if angle between face normals exceeds threshold
                dot = np.dot(face_normals[face_list[0]], face_normals[face_list[1]])
                if dot < cos_threshold:
                    edge_positions.append(verts[a])
                    edge_positions.append(verts[b])

        if edge_positions:
            all_edge_verts.append(np.array(edge_positions, dtype=np.float32))

    if isinstance(scene, trimesh.Scene):
        for geom in scene.geometry.values():
            process_geom(geom)
    else:
        process_geom(scene)

    if not all_edge_verts:
        raise ValueError("No edges extracted from mesh")

    positions = np.vstack(all_edge_verts)
    logger.info("Wireframe: %d edge segments (%d vertices)",
                len(positions) // 2, len(positions))

    # Build minimal GLB with LINES primitive (mode=1)
    pos_bytes = positions.tobytes()

    gltf = {
        'asset': {'version': '2.0', 'generator': 'cave-backend-wireframe'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'mode': 1}]}],
        'accessors': [{
            'bufferView': 0, 'componentType': 5126, 'count': len(positions),
            'type': 'VEC3',
            'min': positions.min(axis=0).tolist(),
            'max': positions.max(axis=0).tolist(),
        }],
        'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(pos_bytes)}],
        'buffers': [{'byteLength': len(pos_bytes)}],
    }

    json_str = json.dumps(gltf, separators=(',', ':'))
    while len(json_str) % 4 != 0:
        json_str += ' '
    json_bytes = json_str.encode('utf-8')

    bin_data = bytearray(pos_bytes)
    while len(bin_data) % 4 != 0:
        bin_data += b'\x00'

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_data)

    buf = io.BytesIO()
    buf.write(b'glTF')
    buf.write(struct.pack('<I', 2))
    buf.write(struct.pack('<I', total))
    buf.write(struct.pack('<I', len(json_bytes)))
    buf.write(struct.pack('<I', 0x4E4F534A))  # JSON chunk
    buf.write(json_bytes)
    buf.write(struct.pack('<I', len(bin_data)))
    buf.write(struct.pack('<I', 0x004E4942))  # BIN chunk
    buf.write(bin_data)

    glb_bytes = buf.getvalue()
    logger.info("Wireframe GLB: %.2f MB", len(glb_bytes) / (1024 * 1024))
    return glb_bytes


def generate_mesh_from_glb(glb_bytes, **kwargs):
    """
    Parse a point-cloud GLB, extract positions+colors, run BPA, return mesh GLB bytes.
    """
    positions, colors = extract_points_from_glb(glb_bytes)
    return generate_mesh_from_arrays(positions, colors, **kwargs)


def generate_mesh_for_cave(cave_id):
    """
    High-level: load cave_pointcloud.glb from storage, generate mesh, save as cave_mesh.glb.
    Safe to call from a background thread.
    """
    start = time.time()
    pc_path = f'caves/{cave_id}/cave_pointcloud.glb'

    if not default_storage.exists(pc_path):
        logger.warning("No point cloud GLB found for cave %s", cave_id)
        return

    logger.info("Starting BPA mesh generation for cave %s", cave_id)

    try:
        with default_storage.open(pc_path, 'rb') as f:
            glb_bytes = f.read()

        mesh_glb = generate_mesh_from_glb(glb_bytes)

        mesh_path = f'caves/{cave_id}/cave_mesh.glb'
        if default_storage.exists(mesh_path):
            default_storage.delete(mesh_path)
        default_storage.save(mesh_path, ContentFile(mesh_glb))

        # Generate wireframe from the mesh
        wireframe_glb = generate_wireframe_glb(mesh_glb)
        wire_path = f'caves/{cave_id}/cave_wireframe.glb'
        if default_storage.exists(wire_path):
            default_storage.delete(wire_path)
        default_storage.save(wire_path, ContentFile(wireframe_glb))

        elapsed = time.time() - start
        logger.info("BPA mesh + wireframe generation complete for cave %s in %.1fs",
                     cave_id, elapsed)

    except Exception:
        logger.exception("Mesh generation failed for cave %s", cave_id)
