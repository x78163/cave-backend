"""
Texture Projection Pipeline — Projects keyframe camera images onto a 3D mesh.

Pipeline:
1. Load reconstructed mesh (from Poisson reconstruction)
2. Load keyframe poses + camera images
3. For each mesh vertex, find the best camera view (most frontal, closest)
4. Project vertex into camera image to get RGB color
5. Where no camera sees a vertex, use a procedural rock texture
6. Export textured glTF

Camera intrinsics are estimated from image resolution + assumed FOV.
These will be refined once actual intrinsics are available from cave-mapper config.
"""

import json
import os
import sys

import numpy as np
import open3d as o3d
from PIL import Image
import trimesh


class CameraModel:
    """Pinhole camera with estimated intrinsics."""

    def __init__(self, width=1920, height=1080, hfov_deg=90):
        self.width = width
        self.height = height
        # Compute focal length from horizontal FOV
        self.fx = width / (2 * np.tan(np.radians(hfov_deg / 2)))
        self.fy = self.fx  # Square pixels
        self.cx = width / 2
        self.cy = height / 2

    def project(self, points_camera):
        """
        Project 3D points (in camera frame) to 2D pixel coordinates.
        points_camera: (N, 3) array in camera coordinate frame
        Returns: (N, 2) pixel coords, (N,) depth values
        """
        z = points_camera[:, 2]
        # Avoid division by zero / behind camera
        valid = z > 0.01

        u = np.full(len(points_camera), -1.0)
        v = np.full(len(points_camera), -1.0)

        u[valid] = self.fx * points_camera[valid, 0] / z[valid] + self.cx
        v[valid] = self.fy * points_camera[valid, 1] / z[valid] + self.cy

        return np.column_stack([u, v]), z, valid

    def in_frame(self, uv, margin=10):
        """Check which projected points fall within the image bounds."""
        return (
            (uv[:, 0] >= margin) & (uv[:, 0] < self.width - margin) &
            (uv[:, 1] >= margin) & (uv[:, 1] < self.height - margin)
        )


class KeyframeCamera:
    """A camera at a specific keyframe pose."""

    def __init__(self, keyframe_data, image_path, camera_model):
        self.kf_id = keyframe_data['keyframe_id']
        self.position = np.array(keyframe_data['position'], dtype=np.float64)

        # Quaternion to rotation matrix
        qx, qy, qz, qw = keyframe_data['orientation']
        self.R = o3d.geometry.get_rotation_matrix_from_quaternion([qw, qx, qy, qz])

        self.image_path = image_path
        self.camera = camera_model
        self._image = None

    @property
    def image(self):
        """Lazy-load image."""
        if self._image is None:
            self._image = np.array(Image.open(self.image_path))
        return self._image

    def world_to_camera(self, points_world):
        """Transform world points to camera coordinate frame."""
        # Camera looks along -Z in its local frame
        # Transform: p_cam = R^T @ (p_world - t)
        relative = points_world - self.position
        return (self.R.T @ relative.T).T

    def get_vertex_colors(self, vertices):
        """
        Project vertices into this camera and sample colors.
        Returns: (N, 3) RGB colors (0-255), (N,) visibility mask, (N,) quality scores
        """
        n = len(vertices)
        colors = np.zeros((n, 3), dtype=np.uint8)
        visible = np.zeros(n, dtype=bool)
        quality = np.zeros(n, dtype=np.float64)

        # Transform to camera frame
        pts_cam = self.world_to_camera(vertices)

        # Project to image plane
        uv, depth, in_front = self.camera.project(pts_cam)

        # Check which are in frame
        in_frame = self.camera.in_frame(uv) & in_front

        if not np.any(in_frame):
            return colors, visible, quality

        # Sample colors from image
        img = self.image
        u_px = uv[in_frame, 0].astype(int)
        v_px = uv[in_frame, 1].astype(int)

        # Clamp to image bounds
        u_px = np.clip(u_px, 0, img.shape[1] - 1)
        v_px = np.clip(v_px, 0, img.shape[0] - 1)

        colors[in_frame] = img[v_px, u_px, :3]
        visible[in_frame] = True

        # Quality score: prefer frontal views (normal · view_dir) and closer distance
        view_dirs = self.position - vertices[in_frame]
        distances = np.linalg.norm(view_dirs, axis=1)
        distances = np.maximum(distances, 0.01)

        # Simple quality: inverse distance (closer = better)
        quality[in_frame] = 1.0 / distances

        return colors, visible, quality


def generate_rock_texture(normals, seed=42):
    """
    Generate procedural rock colors for vertices not seen by any camera.
    Uses vertex normals for subtle variation.
    """
    rng = np.random.RandomState(seed)
    n = len(normals)

    # Base cave rock palette (warm grey-brown tones)
    base = np.array([140, 128, 115], dtype=np.float64)

    # Normal-based variation (up-facing slightly lighter)
    normal_factor = normals[:, 2:3] * 15  # Z component

    # Random noise for texture
    noise = rng.uniform(-12, 12, (n, 3))

    # Combine
    colors = np.clip(base + normal_factor + noise, 0, 255).astype(np.uint8)

    return colors


def project_textures(mesh, keyframe_dir, camera_hfov=90):
    """
    Main texture projection function.
    Projects all available camera images onto mesh vertices.
    Uses weighted blending where multiple cameras see a vertex.

    Args:
        mesh: Open3D triangle mesh
        keyframe_dir: Path to keyframe directory with index + images
        camera_hfov: Estimated horizontal field of view in degrees

    Returns:
        mesh with vertex colors set
    """
    # Load keyframe index
    index_path = os.path.join(keyframe_dir, 'keyframe_index.json')
    with open(index_path, 'r') as f:
        index = json.load(f)

    camera_model = CameraModel(hfov_deg=camera_hfov)
    vertices = np.asarray(mesh.vertices)
    normals = np.asarray(mesh.vertex_normals)
    n_verts = len(vertices)

    print(f"  Projecting {len(index['keyframes'])} cameras onto {n_verts} vertices...")

    # Accumulate weighted colors
    color_accum = np.zeros((n_verts, 3), dtype=np.float64)
    weight_accum = np.zeros(n_verts, dtype=np.float64)

    # Process each keyframe's forward camera
    for kf in index['keyframes']:
        kf_id = kf['keyframe_id']

        # Try forward camera image
        img_path = os.path.join(keyframe_dir, f'kf_{kf_id:06d}_forward.jpg')
        if not os.path.exists(img_path):
            continue

        cam = KeyframeCamera(kf, img_path, camera_model)
        colors, visible, quality = cam.get_vertex_colors(vertices)

        if np.any(visible):
            color_accum[visible] += colors[visible].astype(np.float64) * quality[visible, np.newaxis]
            weight_accum[visible] += quality[visible]

            vis_count = np.sum(visible)
            print(f"    kf_{kf_id:06d}_forward: {vis_count} vertices colored ({vis_count/n_verts*100:.1f}%)")

    # Also try ceiling camera (different viewing angle → more coverage)
    for kf in index['keyframes']:
        kf_id = kf['keyframe_id']
        img_path = os.path.join(keyframe_dir, f'kf_{kf_id:06d}_ceiling.jpg')
        if not os.path.exists(img_path):
            continue

        cam = KeyframeCamera(kf, img_path, camera_model)
        # Ceiling camera likely has a different orientation — for now treat as same
        # TODO: apply ceiling camera rotation offset when intrinsics are known
        colors, visible, quality = cam.get_vertex_colors(vertices)

        if np.any(visible):
            # Weight ceiling camera lower (uncertain orientation)
            quality *= 0.5
            color_accum[visible] += colors[visible].astype(np.float64) * quality[visible, np.newaxis]
            weight_accum[visible] += quality[visible]

    # Normalize accumulated colors
    textured_mask = weight_accum > 0
    textured_count = np.sum(textured_mask)

    final_colors = np.zeros((n_verts, 3), dtype=np.uint8)

    if textured_count > 0:
        final_colors[textured_mask] = (
            color_accum[textured_mask] / weight_accum[textured_mask, np.newaxis]
        ).astype(np.uint8)

    # Fill untextured vertices with procedural rock color
    untextured_mask = ~textured_mask
    untextured_count = np.sum(untextured_mask)

    if untextured_count > 0:
        rock_colors = generate_rock_texture(normals[untextured_mask])
        final_colors[untextured_mask] = rock_colors

    print(f"\n  Coverage: {textured_count} textured ({textured_count/n_verts*100:.1f}%), "
          f"{untextured_count} rock fill ({untextured_count/n_verts*100:.1f}%)")

    # Blend edge: where camera coverage is weak, blend with rock color
    # This prevents harsh edges between textured and untextured regions
    low_confidence = textured_mask & (weight_accum < np.percentile(weight_accum[textured_mask], 20))
    if np.any(low_confidence):
        rock_blend = generate_rock_texture(normals[low_confidence])
        # 50/50 blend for low-confidence areas
        final_colors[low_confidence] = (
            final_colors[low_confidence].astype(np.float64) * 0.5 +
            rock_blend.astype(np.float64) * 0.5
        ).astype(np.uint8)
        print(f"  Blended {np.sum(low_confidence)} low-confidence vertices with rock texture")

    mesh.vertex_colors = o3d.utility.Vector3dVector(final_colors.astype(np.float64) / 255.0)
    return mesh


def export_textured_glb(mesh, output_path):
    """Export textured mesh to GLB."""
    vertices = np.asarray(mesh.vertices)
    triangles = np.asarray(mesh.triangles)
    vertex_normals = np.asarray(mesh.vertex_normals)

    colors_float = np.asarray(mesh.vertex_colors)
    colors_uint8 = (colors_float * 255).astype(np.uint8)
    alpha = np.full((len(colors_uint8), 1), 255, dtype=np.uint8)
    colors_rgba = np.hstack([colors_uint8, alpha])

    tri_mesh = trimesh.Trimesh(
        vertices=vertices,
        faces=triangles,
        vertex_normals=vertex_normals,
        vertex_colors=colors_rgba,
    )

    tri_mesh.export(output_path, file_type='glb')
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  Exported: {output_path} ({size_mb:.2f} MB)")


def main():
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'media', 'reconstruction')
    os.makedirs(output_dir, exist_ok=True)

    keyframe_dir = "/mnt/c/Users/josep/Documents/Code/Data_Dump/cave_maps/keyframes/bench_camera_test"
    pcd_path = "/mnt/c/Users/josep/Documents/Code/Data_Dump/cave_maps/keyframes/Lab test good save/slam_map.pcd"

    # Load or reconstruct the dense PCD mesh
    mesh_glb = os.path.join(output_dir, 'dense_pcd_mesh.glb')
    pcd_mesh_path = os.path.join(output_dir, 'dense_pcd_mesh_o3d.ply')

    print("=" * 60)
    print("Loading dense PCD and reconstructing mesh...")
    print("=" * 60)

    pcd = o3d.io.read_point_cloud(pcd_path)
    points = np.asarray(pcd.points)
    print(f"  Dense PCD: {len(points)} points")

    # Reconstruct
    pcd_clean, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
    pcd_down = pcd_clean.voxel_down_sample(0.02)
    pcd_down.estimate_normals(search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=0.3, max_nn=30))
    pcd_down.orient_normals_consistent_tangent_plane(k=15)

    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(pcd_down, depth=10, linear_fit=True)
    densities = np.asarray(densities)
    mesh.remove_vertices_by_mask(densities < np.quantile(densities, 0.05))
    mesh.compute_vertex_normals()

    verts = np.asarray(mesh.vertices)
    tris = np.asarray(mesh.triangles)
    print(f"  Mesh: {len(verts)} vertices, {len(tris)} triangles")

    # Project textures
    print("\n" + "=" * 60)
    print("Projecting camera textures onto mesh...")
    print("=" * 60)

    mesh = project_textures(mesh, keyframe_dir, camera_hfov=90)

    # Export
    print("\n" + "=" * 60)
    print("Exporting textured mesh...")
    print("=" * 60)

    output_path = os.path.join(output_dir, 'textured_mesh.glb')
    export_textured_glb(mesh, output_path)

    print("\nDone! View at: http://localhost:8002/scripts/explorer.html")
    print("(Update explorer.html to load textured_mesh.glb)")


if __name__ == '__main__':
    main()
