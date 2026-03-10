"""
Generate a 3D-printable STL shell from a cave point cloud.

Pipeline:
  1. Load point cloud from GLB
  2. Poisson surface reconstruction → watertight mesh
  3. Density-based trimming → remove hallucinated surfaces
  4. Shell generation → offset mesh along normals for wall thickness
  5. Export as binary STL

The result is a hollow shell that can be sliced and printed, or cut
apart in CAD software to reveal the interior passage structure.
"""

import io
import logging
import time

import numpy as np
import open3d as o3d
import trimesh

logger = logging.getLogger(__name__)


def generate_printable_stl(positions, colors=None, wall_thickness=0.05,
                           poisson_depth=10, density_quantile=0.10,
                           voxel_size=0.02, scale_factor=1.0,
                           poisson_scale=1.0, on_progress=None):
    """
    Generate a 3D-printable shell STL from raw point arrays.

    Args:
        positions: Nx3 float64 array of point positions
        colors: Nx3 float64 array (0-1 range) or None
        wall_thickness: Shell thickness in point cloud units (meters).
                        At 1:100 print scale, 0.05m → 0.5mm wall.
        poisson_depth: Octree depth for Poisson reconstruction (8-11).
                       Higher = more detail but slower.
        density_quantile: Fraction of lowest-density vertices to trim (0-1).
                          Higher = more aggressive trimming of hallucinated surfaces.
        voxel_size: Downsample voxel size. 0 = no downsampling.
        scale_factor: Scale the output mesh (e.g. 100 for cm, 1000 for mm).
        poisson_scale: Bounding box scale for Poisson (1.0=tight, 1.1=default padding).
                       Lower values reduce inflation/rounding artifacts.
        on_progress: Optional callback(stage: str, percent: int) for progress reporting.

    Returns: STL bytes (binary format)
    """
    def progress(stage, pct):
        if on_progress:
            on_progress(stage, pct)

    t0 = time.time()
    logger.info("STL export: %d points, wall=%.3fm, depth=%d, trim=%.2f, scale=%.2f",
                len(positions), wall_thickness, poisson_depth, density_quantile,
                poisson_scale)

    progress("Loading point cloud", 5)

    # Build Open3D point cloud
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(positions)
    if colors is not None:
        pcd.colors = o3d.utility.Vector3dVector(colors)

    # Statistical outlier removal
    progress("Removing outliers", 10)
    pcd, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
    logger.info("After outlier removal: %d points", len(pcd.points))

    # Voxel downsample
    if voxel_size > 0:
        progress("Downsampling", 15)
        pcd = pcd.voxel_down_sample(voxel_size)
        logger.info("After downsampling: %d points", len(pcd.points))

    # Estimate and orient normals (pointing outward from cave walls)
    progress("Estimating normals", 20)
    pcd.estimate_normals(
        search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=0.3, max_nn=30)
    )
    # Orient normals consistently — use camera at centroid (interior of cave)
    # so normals point AWAY from the interior (outward from cave walls)
    centroid = np.mean(np.asarray(pcd.points), axis=0)
    pcd.orient_normals_towards_camera_location(centroid)
    # Flip so normals point outward (away from centroid = into rock)
    pcd.normals = o3d.utility.Vector3dVector(-np.asarray(pcd.normals))

    # Poisson surface reconstruction (longest step ~60% of total time)
    progress("Poisson reconstruction", 30)
    logger.info("Running Poisson reconstruction (depth=%d, scale=%.2f)...",
                poisson_depth, poisson_scale)
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd, depth=poisson_depth, scale=poisson_scale, linear_fit=True
    )

    verts = np.asarray(mesh.vertices)
    tris = np.asarray(mesh.triangles)
    logger.info("Poisson mesh: %d vertices, %d triangles", len(verts), len(tris))

    # Density-based trimming — remove vertices far from actual data
    progress("Trimming mesh", 75)
    densities = np.asarray(densities)
    threshold = np.quantile(densities, density_quantile)
    mask = densities > threshold
    mesh.remove_vertices_by_mask(~mask)

    # Clean up
    mesh.remove_degenerate_triangles()
    mesh.remove_unreferenced_vertices()
    mesh.compute_vertex_normals()

    verts = np.asarray(mesh.vertices)
    tris = np.asarray(mesh.triangles)
    normals = np.asarray(mesh.vertex_normals)
    logger.info("After trimming: %d vertices, %d triangles", len(verts), len(tris))

    if len(tris) == 0:
        raise ValueError("Poisson reconstruction produced no triangles after trimming")

    # Generate shell — create inner surface offset along normals
    progress("Generating shell", 85)
    inner_verts = verts - normals * wall_thickness
    inner_tris = tris[:, ::-1]  # Reverse winding for inward-facing normals

    # Combine outer + inner into single mesh
    n_outer_verts = len(verts)
    combined_verts = np.vstack([verts, inner_verts])
    combined_tris = np.vstack([tris, inner_tris + n_outer_verts])

    # Find boundary edges and connect inner/outer surfaces at openings
    boundary_edges = _find_boundary_edges(tris)
    if len(boundary_edges) > 0:
        logger.info("Connecting %d boundary edges between inner/outer surfaces",
                     len(boundary_edges))
        bridge_tris = _bridge_boundaries(boundary_edges, n_outer_verts)
        combined_tris = np.vstack([combined_tris, bridge_tris])

    # Apply scale factor
    if scale_factor != 1.0:
        combined_verts *= scale_factor

    # Export as STL via trimesh with repair
    progress("Repairing mesh", 90)
    tri_mesh = trimesh.Trimesh(vertices=combined_verts, faces=combined_tris)

    # Remove degenerate faces (zero-area triangles)
    tri_mesh.update_faces(tri_mesh.nondegenerate_faces())
    tri_mesh.remove_unreferenced_vertices()

    # Merge vertices that are very close (fixes gaps at bridge seams)
    tri_mesh.merge_vertices()

    # Remove small disconnected fragments — keep only the largest connected component
    components = tri_mesh.split(only_watertight=False)
    if len(components) > 1:
        largest = max(components, key=lambda c: len(c.faces))
        removed = len(tri_mesh.faces) - len(largest.faces)
        logger.info("Removed %d disconnected fragments (%d faces), keeping largest (%d faces)",
                     len(components) - 1, removed, len(largest.faces))
        tri_mesh = largest

    # Fill small holes to make mesh more watertight
    trimesh.repair.fill_holes(tri_mesh)

    # Fix winding consistency and normals
    trimesh.repair.fix_winding(tri_mesh)
    trimesh.repair.fix_normals(tri_mesh)

    logger.info("After repair: %d vertices, %d faces, watertight=%s",
                len(tri_mesh.vertices), len(tri_mesh.faces), tri_mesh.is_watertight)

    progress("Exporting STL", 95)
    buf = io.BytesIO()
    tri_mesh.export(buf, file_type='stl')
    stl_bytes = buf.getvalue()

    elapsed = time.time() - t0
    logger.info("STL export complete: %.2f MB, %d tris, %.1fs",
                len(stl_bytes) / 1e6, len(combined_tris), elapsed)

    progress("Complete", 100)
    return stl_bytes


def _find_boundary_edges(triangles):
    """
    Find boundary edges (edges that belong to only one triangle).
    Returns Nx2 array of vertex index pairs.
    """
    from collections import Counter
    edge_count = Counter()
    for tri in triangles:
        for i in range(3):
            a, b = int(tri[i]), int(tri[(i + 1) % 3])
            edge_count[(min(a, b), max(a, b))] += 1

    boundary = np.array([list(e) for e, c in edge_count.items() if c == 1],
                        dtype=np.int64)
    return boundary


def _bridge_boundaries(boundary_edges, vertex_offset):
    """
    Create triangles connecting boundary edges on outer surface to their
    corresponding edges on the inner surface (offset by vertex_offset).

    Each boundary edge (a, b) on the outer surface maps to (a+offset, b+offset)
    on the inner surface. We create a quad (2 triangles) bridging them.
    """
    bridge_tris = []
    for a, b in boundary_edges:
        a_inner = a + vertex_offset
        b_inner = b + vertex_offset
        # Two triangles forming a quad: (a, b, b_inner) and (a, b_inner, a_inner)
        bridge_tris.append([a, b, b_inner])
        bridge_tris.append([a, b_inner, a_inner])

    return np.array(bridge_tris, dtype=np.int64)


def generate_stl_for_cave(cave_id, **kwargs):
    """
    High-level: load cave_pointcloud.glb, generate printable STL, return bytes.
    """
    from django.core.files.storage import default_storage
    from reconstruction.mesh_from_glb import extract_points_from_glb

    pc_path = f'caves/{cave_id}/cave_pointcloud.glb'
    if not default_storage.exists(pc_path):
        raise FileNotFoundError(f"No point cloud found for cave {cave_id}")

    with default_storage.open(pc_path, 'rb') as f:
        glb_bytes = f.read()

    positions, colors = extract_points_from_glb(glb_bytes)
    return generate_printable_stl(positions, colors, **kwargs)
