"""
3D Reconstruction Prototype — Side-by-side comparison of:
  A) Sparse keyframe cloud merge (bench_camera_test)
  B) Dense SLAM PCD (slam_map.pcd)

Outputs glTF files for browser viewing.
"""

import json
import os
import sys

import numpy as np
import open3d as o3d
import trimesh


def load_keyframe_clouds(keyframe_dir):
    """
    Merge all kf_*_cloud.npy files from a keyframe directory,
    transforming each by its pose from the keyframe JSON.
    """
    index_path = os.path.join(keyframe_dir, 'keyframe_index.json')
    with open(index_path, 'r') as f:
        index = json.load(f)

    all_points = []
    trajectory = []
    keyframe_poses = []

    for kf in index['keyframes']:
        kf_id = kf['keyframe_id']
        cloud_file = os.path.join(keyframe_dir, f'kf_{kf_id:06d}_cloud.npy')

        if not os.path.exists(cloud_file):
            print(f"  Skipping kf_{kf_id:06d} — no cloud file")
            continue

        points = np.load(cloud_file).astype(np.float64)
        pos = np.array(kf['position'], dtype=np.float64)
        quat = kf['orientation']  # [qx, qy, qz, qw]

        # Build rotation matrix from quaternion
        qx, qy, qz, qw = quat
        R = o3d.geometry.get_rotation_matrix_from_quaternion([qw, qx, qy, qz])

        # Transform points: rotated + translated
        transformed = (R @ points.T).T + pos

        all_points.append(transformed)
        trajectory.append(pos)
        keyframe_poses.append({
            'position': pos.tolist(),
            'orientation': [qx, qy, qz, qw],
        })

        print(f"  kf_{kf_id:06d}: {len(points)} points, pos=({pos[0]:.3f}, {pos[1]:.3f}, {pos[2]:.3f})")

    merged = np.vstack(all_points)
    trajectory = np.array(trajectory)

    print(f"\n  Total merged: {len(merged)} points from {len(all_points)} keyframes")
    print(f"  Bounds: X[{merged[:,0].min():.2f}, {merged[:,0].max():.2f}] "
          f"Y[{merged[:,1].min():.2f}, {merged[:,1].max():.2f}] "
          f"Z[{merged[:,2].min():.2f}, {merged[:,2].max():.2f}]")

    return merged, trajectory, keyframe_poses


def load_pcd_file(pcd_path):
    """Load a .pcd file using Open3D."""
    pcd = o3d.io.read_point_cloud(pcd_path)
    points = np.asarray(pcd.points)
    print(f"  Loaded PCD: {len(points)} points")
    print(f"  Bounds: X[{points[:,0].min():.2f}, {points[:,0].max():.2f}] "
          f"Y[{points[:,1].min():.2f}, {points[:,1].max():.2f}] "
          f"Z[{points[:,2].min():.2f}, {points[:,2].max():.2f}]")
    return points


def reconstruct_mesh(points, label, voxel_size=None, poisson_depth=9):
    """
    Run Poisson surface reconstruction on a point cloud.
    Returns an Open3D triangle mesh.
    """
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(points)

    # Remove statistical outliers
    pcd_clean, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
    print(f"  [{label}] After outlier removal: {len(pcd_clean.points)} points")

    # Voxel downsample if specified
    if voxel_size:
        pcd_clean = pcd_clean.voxel_down_sample(voxel_size)
        print(f"  [{label}] After voxel downsample ({voxel_size}m): {len(pcd_clean.points)} points")

    # Estimate normals (required for Poisson)
    pcd_clean.estimate_normals(
        search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=0.3, max_nn=30)
    )
    # Orient normals consistently
    pcd_clean.orient_normals_consistent_tangent_plane(k=15)

    print(f"  [{label}] Running Poisson reconstruction (depth={poisson_depth})...")
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd_clean, depth=poisson_depth, linear_fit=True
    )

    # Remove low-density vertices (noise at edges)
    densities = np.asarray(densities)
    density_threshold = np.quantile(densities, 0.05)
    vertices_to_remove = densities < density_threshold
    mesh.remove_vertices_by_mask(vertices_to_remove)

    mesh.compute_vertex_normals()

    vertices = np.asarray(mesh.vertices)
    triangles = np.asarray(mesh.triangles)
    print(f"  [{label}] Mesh: {len(vertices)} vertices, {len(triangles)} triangles")
    print(f"  [{label}] Bounds: X[{vertices[:,0].min():.2f}, {vertices[:,0].max():.2f}] "
          f"Y[{vertices[:,1].min():.2f}, {vertices[:,1].max():.2f}] "
          f"Z[{vertices[:,2].min():.2f}, {vertices[:,2].max():.2f}]")

    return mesh


def paint_mesh_rock_color(mesh):
    """
    Apply a neutral cave rock color to the mesh.
    Uses vertex normals to add subtle shading variation.
    """
    normals = np.asarray(mesh.vertex_normals)
    n_vertices = len(normals)

    # Base cave rock color (warm grey-brown)
    base_color = np.array([0.55, 0.50, 0.45])

    # Vary color slightly based on normal direction (simulates ambient occlusion)
    # Upward-facing surfaces slightly lighter, downward slightly darker
    up_factor = normals[:, 2] * 0.1  # Z component of normal
    variation = np.random.uniform(-0.03, 0.03, (n_vertices, 3))

    colors = np.clip(
        base_color + up_factor[:, np.newaxis] + variation,
        0.0, 1.0
    )

    mesh.vertex_colors = o3d.utility.Vector3dVector(colors)
    return mesh


def export_glb(mesh, output_path, label):
    """Export Open3D mesh to GLB (binary glTF) via trimesh."""
    vertices = np.asarray(mesh.vertices)
    triangles = np.asarray(mesh.triangles)
    vertex_normals = np.asarray(mesh.vertex_normals)

    # Get vertex colors if available
    if mesh.has_vertex_colors():
        colors_float = np.asarray(mesh.vertex_colors)
        colors_uint8 = (colors_float * 255).astype(np.uint8)
        # Add alpha channel
        alpha = np.full((len(colors_uint8), 1), 255, dtype=np.uint8)
        colors_rgba = np.hstack([colors_uint8, alpha])
    else:
        colors_rgba = None

    tri_mesh = trimesh.Trimesh(
        vertices=vertices,
        faces=triangles,
        vertex_normals=vertex_normals,
        vertex_colors=colors_rgba,
    )

    tri_mesh.export(output_path, file_type='glb')
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  [{label}] Exported: {output_path} ({size_mb:.2f} MB)")


def main():
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'media', 'reconstruction')
    os.makedirs(output_dir, exist_ok=True)

    keyframe_dir = "/mnt/c/Users/josep/Documents/Code/Data_Dump/cave_maps/keyframes/bench_camera_test"
    pcd_path = "/mnt/c/Users/josep/Documents/Code/Data_Dump/cave_maps/keyframes/Lab test good save/slam_map.pcd"

    # ─── Source A: Sparse keyframe merge ───
    print("=" * 60)
    print("SOURCE A: Keyframe cloud merge (bench_camera_test)")
    print("=" * 60)
    keyframe_points, trajectory, keyframe_poses = load_keyframe_clouds(keyframe_dir)

    # Export spawn.json — first keyframe position & orientation for the viewer
    if keyframe_poses:
        spawn_data = {
            'spawn': keyframe_poses[0],
            'keyframes': keyframe_poses,
        }
        spawn_path = os.path.join(output_dir, 'spawn.json')
        with open(spawn_path, 'w') as f:
            json.dump(spawn_data, f, indent=2)
        print(f"  Spawn data saved: {spawn_path}")

    print("\nReconstructing mesh from keyframe cloud...")
    mesh_keyframe = reconstruct_mesh(keyframe_points, "Keyframe", poisson_depth=8)
    mesh_keyframe = paint_mesh_rock_color(mesh_keyframe)

    glb_keyframe = os.path.join(output_dir, 'keyframe_mesh.glb')
    export_glb(mesh_keyframe, glb_keyframe, "Keyframe")

    # Also export raw point cloud as GLB for reference
    pcd_vis = o3d.geometry.PointCloud()
    pcd_vis.points = o3d.utility.Vector3dVector(keyframe_points)
    pcd_vis.paint_uniform_color([0.6, 0.55, 0.5])
    pts_path = os.path.join(output_dir, 'keyframe_points.ply')
    o3d.io.write_point_cloud(pts_path, pcd_vis)
    print(f"  [Keyframe] Point cloud saved: {pts_path}")

    # ─── Source B: Dense SLAM PCD ───
    print("\n" + "=" * 60)
    print("SOURCE B: Dense SLAM PCD (Lab test good save)")
    print("=" * 60)
    pcd_points = load_pcd_file(pcd_path)

    print("\nReconstructing mesh from dense PCD...")
    mesh_pcd = reconstruct_mesh(pcd_points, "Dense PCD", voxel_size=0.02, poisson_depth=10)
    mesh_pcd = paint_mesh_rock_color(mesh_pcd)

    glb_pcd = os.path.join(output_dir, 'dense_pcd_mesh.glb')
    export_glb(mesh_pcd, glb_pcd, "Dense PCD")

    # ─── Summary ───
    print("\n" + "=" * 60)
    print("COMPARISON SUMMARY")
    print("=" * 60)
    print(f"  Keyframe cloud: {len(keyframe_points)} points → {len(np.asarray(mesh_keyframe.triangles))} triangles")
    print(f"  Dense PCD:      {len(pcd_points)} points → {len(np.asarray(mesh_pcd.triangles))} triangles")
    print(f"\n  Output files:")
    print(f"    {glb_keyframe}")
    print(f"    {glb_pcd}")
    print(f"\n  Open the HTML viewer to compare side-by-side.")


if __name__ == '__main__':
    main()
