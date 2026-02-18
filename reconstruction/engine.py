"""
Reconstruction engine — processes PCD + keyframes into a textured 3D mesh.

This wraps the prototype pipeline into a reusable class that can be called
from Django views or management commands.
"""

import json
import logging
import os
import shutil
import tempfile
import time
import zipfile

import numpy as np
import open3d as o3d
from PIL import Image
import trimesh

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


class CameraModel:
    """Pinhole camera with estimated intrinsics."""

    def __init__(self, width=1920, height=1080, hfov_deg=90):
        self.width = width
        self.height = height
        self.fx = width / (2 * np.tan(np.radians(hfov_deg / 2)))
        self.fy = self.fx
        self.cx = width / 2
        self.cy = height / 2

    def project(self, points_camera):
        z = points_camera[:, 2]
        valid = z > 0.01
        u = np.full(len(points_camera), -1.0)
        v = np.full(len(points_camera), -1.0)
        u[valid] = self.fx * points_camera[valid, 0] / z[valid] + self.cx
        v[valid] = self.fy * points_camera[valid, 1] / z[valid] + self.cy
        return np.column_stack([u, v]), z, valid

    def in_frame(self, uv, margin=10):
        return (
            (uv[:, 0] >= margin) & (uv[:, 0] < self.width - margin) &
            (uv[:, 1] >= margin) & (uv[:, 1] < self.height - margin)
        )


class ReconstructionEngine:
    """Processes PCD + keyframes into a textured mesh."""

    def __init__(self, job):
        self.job = job
        self.work_dir = None

    def run(self):
        """Execute the full reconstruction pipeline."""
        from .models import ReconstructionJob

        self.job.status = ReconstructionJob.Status.PROCESSING
        self.job.started_at = timezone.now()
        self.job.save(update_fields=['status', 'started_at'])

        start_time = time.time()

        try:
            self.work_dir = tempfile.mkdtemp(prefix='cave_recon_')

            # Step 1: Load PCD
            pcd_path = self._resolve_pcd()
            points = self._load_pcd(pcd_path)
            self.job.point_count = len(points)

            # Step 2: Reconstruct mesh
            mesh = self._reconstruct_mesh(points)

            # Step 3: Project textures (if keyframes available)
            keyframe_dir = self._extract_keyframes()
            if keyframe_dir:
                mesh = self._project_textures(mesh, keyframe_dir)
                self._export_spawn_data(keyframe_dir)
            else:
                mesh = self._apply_rock_color(mesh)

            # Step 4: Export
            output_path = self._export_mesh(mesh)

            # Update job
            elapsed = time.time() - start_time
            self.job.status = ReconstructionJob.Status.COMPLETED
            self.job.completed_at = timezone.now()
            self.job.processing_time_seconds = round(elapsed, 2)
            self.job.save()

            logger.info("Reconstruction %s completed in %.1fs", self.job.id, elapsed)

        except Exception as e:
            self.job.status = ReconstructionJob.Status.FAILED
            self.job.error_message = str(e)
            self.job.completed_at = timezone.now()
            self.job.processing_time_seconds = round(time.time() - start_time, 2)
            self.job.save()
            logger.error("Reconstruction %s failed: %s", self.job.id, e)
            raise

        finally:
            if self.work_dir and os.path.exists(self.work_dir):
                shutil.rmtree(self.work_dir, ignore_errors=True)

    def _resolve_pcd(self):
        """Get the PCD file path."""
        if self.job.pcd_file:
            return self.job.pcd_file.path
        # Check if cave has a point_cloud_path
        cave = self.job.cave
        if cave.point_cloud_path:
            return os.path.join(str(settings.MEDIA_ROOT), cave.point_cloud_path)
        raise ValueError("No PCD file provided and cave has no point_cloud_path")

    def _load_pcd(self, pcd_path):
        """Load a PCD or NPY point cloud file."""
        logger.info("Loading point cloud: %s", pcd_path)

        if pcd_path.endswith('.npy'):
            points = np.load(pcd_path).astype(np.float64)
        elif pcd_path.endswith('.pcd') or pcd_path.endswith('.ply'):
            pcd = o3d.io.read_point_cloud(pcd_path)
            points = np.asarray(pcd.points)
        else:
            raise ValueError(f"Unsupported point cloud format: {pcd_path}")

        logger.info("Loaded %d points", len(points))
        return points

    def _reconstruct_mesh(self, points):
        """Run Poisson surface reconstruction."""
        logger.info("Reconstructing mesh (depth=%d, voxel=%f)...",
                     self.job.poisson_depth, self.job.voxel_size)

        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(points)

        # Clean
        pcd_clean, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)

        # Downsample
        if self.job.voxel_size > 0:
            pcd_clean = pcd_clean.voxel_down_sample(self.job.voxel_size)

        # Normals
        pcd_clean.estimate_normals(
            search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=0.3, max_nn=30)
        )
        pcd_clean.orient_normals_consistent_tangent_plane(k=15)

        # Poisson
        mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
            pcd_clean, depth=self.job.poisson_depth, linear_fit=True
        )

        # Remove low-density (noise)
        densities = np.asarray(densities)
        mesh.remove_vertices_by_mask(densities < np.quantile(densities, 0.05))
        mesh.compute_vertex_normals()

        verts = np.asarray(mesh.vertices)
        tris = np.asarray(mesh.triangles)
        self.job.vertex_count = len(verts)
        self.job.triangle_count = len(tris)

        logger.info("Mesh: %d vertices, %d triangles", len(verts), len(tris))
        return mesh

    def _extract_keyframes(self):
        """Extract keyframe archive to temp directory. Returns path or None."""
        if not self.job.keyframe_archive:
            return None

        extract_dir = os.path.join(self.work_dir, 'keyframes')
        archive_path = self.job.keyframe_archive.path

        if archive_path.endswith('.zip'):
            with zipfile.ZipFile(archive_path, 'r') as zf:
                zf.extractall(extract_dir)
        else:
            raise ValueError(f"Unsupported archive format: {archive_path}")

        # Find the directory containing keyframe_index.json
        for root, dirs, files in os.walk(extract_dir):
            if 'keyframe_index.json' in files:
                return root

        logger.warning("No keyframe_index.json found in archive")
        return None

    def _project_textures(self, mesh, keyframe_dir):
        """Project camera images onto mesh vertices."""
        index_path = os.path.join(keyframe_dir, 'keyframe_index.json')
        with open(index_path, 'r') as f:
            index = json.load(f)

        camera_model = CameraModel(hfov_deg=self.job.camera_hfov)
        vertices = np.asarray(mesh.vertices)
        normals = np.asarray(mesh.vertex_normals)
        n_verts = len(vertices)

        color_accum = np.zeros((n_verts, 3), dtype=np.float64)
        weight_accum = np.zeros(n_verts, dtype=np.float64)

        for kf in index['keyframes']:
            kf_id = kf['keyframe_id']
            pos = np.array(kf['position'], dtype=np.float64)
            qx, qy, qz, qw = kf['orientation']
            R = o3d.geometry.get_rotation_matrix_from_quaternion([qw, qx, qy, qz])

            for cam_suffix in ['forward', 'ceiling']:
                img_path = os.path.join(keyframe_dir, f'kf_{kf_id:06d}_{cam_suffix}.jpg')
                if not os.path.exists(img_path):
                    continue

                img = np.array(Image.open(img_path))

                # World to camera transform
                relative = vertices - pos
                pts_cam = (R.T @ relative.T).T

                # Project
                uv, depth, in_front = camera_model.project(pts_cam)
                in_frame = camera_model.in_frame(uv) & in_front

                if not np.any(in_frame):
                    continue

                u_px = np.clip(uv[in_frame, 0].astype(int), 0, img.shape[1] - 1)
                v_px = np.clip(uv[in_frame, 1].astype(int), 0, img.shape[0] - 1)

                colors = img[v_px, u_px, :3].astype(np.float64)

                view_dirs = pos - vertices[in_frame]
                distances = np.maximum(np.linalg.norm(view_dirs, axis=1), 0.01)
                quality = 1.0 / distances

                if cam_suffix == 'ceiling':
                    quality *= 0.5

                color_accum[in_frame] += colors * quality[:, np.newaxis]
                weight_accum[in_frame] += quality

        # Normalize
        textured_mask = weight_accum > 0
        textured_count = int(np.sum(textured_mask))

        final_colors = np.zeros((n_verts, 3), dtype=np.float64)

        if textured_count > 0:
            final_colors[textured_mask] = (
                color_accum[textured_mask] / weight_accum[textured_mask, np.newaxis]
            )

        # Rock fill for untextured
        untextured_mask = ~textured_mask
        rng = np.random.RandomState(42)
        base = np.array([140, 128, 115], dtype=np.float64)
        n_untex = int(np.sum(untextured_mask))
        if n_untex > 0:
            rock = base + normals[untextured_mask, 2:3] * 15 + rng.uniform(-12, 12, (n_untex, 3))
            final_colors[untextured_mask] = np.clip(rock, 0, 255)

        # Blend low-confidence edges
        if textured_count > 0:
            threshold = np.percentile(weight_accum[textured_mask], 20)
            low_conf = textured_mask & (weight_accum < threshold)
            n_low = int(np.sum(low_conf))
            if n_low > 0:
                rock_blend = base + normals[low_conf, 2:3] * 15 + rng.uniform(-12, 12, (n_low, 3))
                rock_blend = np.clip(rock_blend, 0, 255)
                final_colors[low_conf] = final_colors[low_conf] * 0.5 + rock_blend * 0.5

        self.job.texture_coverage = round(textured_count / n_verts * 100, 1)

        mesh.vertex_colors = o3d.utility.Vector3dVector(
            np.clip(final_colors, 0, 255) / 255.0
        )

        logger.info("Texture coverage: %.1f%%", self.job.texture_coverage)
        return mesh

    def _apply_rock_color(self, mesh):
        """Apply procedural rock color (no camera images available)."""
        normals = np.asarray(mesh.vertex_normals)
        n = len(normals)
        rng = np.random.RandomState(42)
        base = np.array([0.55, 0.50, 0.45])
        colors = np.clip(
            base + normals[:, 2:3] * 0.1 + rng.uniform(-0.03, 0.03, (n, 3)),
            0.0, 1.0
        )
        mesh.vertex_colors = o3d.utility.Vector3dVector(colors)
        self.job.texture_coverage = 0.0
        return mesh

    def _export_spawn_data(self, keyframe_dir):
        """Export spawn.json with keyframe poses for the viewer."""
        index_path = os.path.join(keyframe_dir, 'keyframe_index.json')
        with open(index_path, 'r') as f:
            index = json.load(f)

        poses = []
        for kf in index['keyframes']:
            q = kf['orientation']
            poses.append({
                'position': kf['position'],
                'orientation': [q[0], q[1], q[2], q[3]],
            })

        if not poses:
            return

        output_subdir = 'reconstruction/output'
        output_dir = os.path.join(str(settings.MEDIA_ROOT), output_subdir)
        os.makedirs(output_dir, exist_ok=True)

        spawn_path = os.path.join(output_dir, f'{self.job.cave_id}_spawn.json')
        with open(spawn_path, 'w') as f:
            json.dump({'spawn': poses[0], 'keyframes': poses}, f, indent=2)

        logger.info("Spawn data saved: %s (%d keyframe poses)", spawn_path, len(poses))

    def _export_mesh(self, mesh):
        """Export mesh to GLB and save to job."""
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

        # Save to media
        output_subdir = 'reconstruction/output'
        output_dir = os.path.join(str(settings.MEDIA_ROOT), output_subdir)
        os.makedirs(output_dir, exist_ok=True)

        filename = f'{self.job.cave_id}_{self.job.id}.glb'
        output_path = os.path.join(output_dir, filename)
        tri_mesh.export(output_path, file_type='glb')

        # Update job
        self.job.mesh_file.name = os.path.join(output_subdir, filename)
        self.job.file_size_bytes = os.path.getsize(output_path)

        logger.info("Exported: %s (%.2f MB)", output_path,
                     self.job.file_size_bytes / (1024 * 1024))
        return output_path
