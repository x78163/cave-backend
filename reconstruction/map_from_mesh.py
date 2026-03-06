"""
Generate 2D map data from mesh GLB + trajectory.json.

Uses a top-down projection approach:
1. PCA on mesh vertices to find the floor plane
2. Project all vertices onto that plane → 2D points
3. Rasterize onto a fine grid → binary occupancy image
4. Extract boundary contours from the grid → wall polylines
5. Simplify with RDP

This avoids horizontal-slice artifacts for passages that curve through
3D space (arches, sloping passages, etc.).  The projection captures the
full cave footprint as seen from directly above.

No open3d dependency — only trimesh + numpy + scipy.
"""
import io
import json
import logging
import math
from collections import deque
from datetime import datetime

import numpy as np
import trimesh
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

logger = logging.getLogger(__name__)


# ── Loading ──────────────────────────────────────────────────────────

def _load_mesh(cave_id):
    """Load cave_mesh.glb from storage as a trimesh.Trimesh."""
    mesh_path = f'caves/{cave_id}/cave_mesh.glb'
    with default_storage.open(mesh_path, 'rb') as f:
        scene = trimesh.load(io.BytesIO(f.read()), file_type='glb', process=False)

    if isinstance(scene, trimesh.Scene):
        meshes = [g for g in scene.geometry.values()
                  if hasattr(g, 'faces') and len(g.faces) > 0]
        if not meshes:
            raise ValueError("No mesh geometry found in GLB")
        return trimesh.util.concatenate(meshes)
    return scene


def _load_pointcloud_vertices(cave_id):
    """Load cave_pointcloud.glb vertices from storage.

    Returns Nx3 numpy array or None.  The point cloud has full coverage
    even where the BPA mesh has holes.
    """
    pc_path = f'caves/{cave_id}/cave_pointcloud.glb'
    if not default_storage.exists(pc_path):
        return None
    try:
        with default_storage.open(pc_path, 'rb') as f:
            scene = trimesh.load(io.BytesIO(f.read()), file_type='glb', process=False)
        if isinstance(scene, trimesh.Scene):
            all_verts = []
            for g in scene.geometry.values():
                if hasattr(g, 'vertices') and len(g.vertices) > 0:
                    all_verts.append(g.vertices)
            if all_verts:
                return np.vstack(all_verts)
        elif hasattr(scene, 'vertices'):
            return np.array(scene.vertices)
    except Exception as e:
        logger.warning("Could not load point cloud for cave %s: %s", cave_id, e)
    return None


def _load_trajectory(cave_id):
    """Load trajectory.json from storage. Returns Nx3 numpy array or None."""
    traj_path = f'caves/{cave_id}/trajectory.json'
    if not default_storage.exists(traj_path):
        return None
    with default_storage.open(traj_path, 'r') as f:
        traj_data = json.load(f)
    positions = traj_data.get('positions', [])
    if len(positions) < 2:
        return None
    return np.array(positions, dtype=np.float64)


def _get_editor_transform(cave_id):
    """Get the cloud transform from the most recent editor project.

    Three.js Matrix4 stores elements in column-major order, so the 16-element
    array maps to a 4x4 matrix where element[0..3] is column 0, etc.
    Returns a 4x4 numpy matrix (row-major) or None.
    """
    try:
        from caves.models import EditorProject
        projects = EditorProject.objects.filter(
            cave_id=cave_id
        ).order_by('-updated_at')

        for project in projects:
            state = project.project_state or {}
            clouds = state.get('clouds', [])
            for cloud in clouds:
                t = cloud.get('transform')
                if t and len(t) == 16:
                    mat = np.array(t, dtype=np.float64).reshape(4, 4).T
                    # Return the most recent project's transform, even if
                    # identity.  Identity means no transform was applied,
                    # so POI coords ARE in raw SLAM space.
                    if np.allclose(mat, np.eye(4), atol=1e-6):
                        return None  # identity = no transform
                    return mat
    except Exception:
        pass
    return None


def _transform_positions(positions, transform):
    """Apply a 4x4 transform matrix to Nx3 positions."""
    n = len(positions)
    homogeneous = np.hstack([positions, np.ones((n, 1))])
    transformed = (transform @ homogeneous.T).T
    return transformed[:, :3]


# ── PCA orientation ──────────────────────────────────────────────────

def _find_pca_basis(vertices, floor_hint=None):
    """Find PCA basis for the mesh vertices.

    Returns (R, center) where R is a 3x3 matrix whose rows are the
    principal components:
      R[0] = most variance (cave length) → maps to X
      R[1] = second most (cave width)    → maps to Y
      R[2] = least variance (cave height) → maps to Z

    If floor_hint (Nx3 trajectory positions) is provided, orients the
    projection so we look from above (trajectory = floor = low Z side).
    """
    center = vertices.mean(axis=0)
    centered = vertices - center
    _, S, Vt = np.linalg.svd(centered, full_matrices=False)
    logger.info("PCA singular values: %.1f, %.1f, %.1f (ratio: %.1f:%.1f:1)",
                S[0], S[1], S[2], S[0] / max(S[2], 1e-6), S[1] / max(S[2], 1e-6))

    R = Vt.copy()
    if np.linalg.det(R) < 0:
        R[2] *= -1

    # Orient so we look from above (positive Z in PCA space = up).
    if floor_hint is not None and len(floor_hint) > 0:
        # Trajectory = floor → should be at negative Z in PCA space.
        traj_centered = floor_hint - center
        traj_z = (R[2] @ traj_centered.T).mean()
        mesh_z_median = np.median(R[2] @ centered.T)
        if traj_z > mesh_z_median:
            R[1] *= -1  # flip Y (mirrors the 2D view)
            R[2] *= -1  # flip Z (maintains right-handedness)
            logger.info("Flipped PCA orientation (trajectory was above mesh median)")
    else:
        # No trajectory available.  In raw SLAM space Z is gravity-up
        # (from IMU), so the real-world "up" vector is [0,0,1].
        # PCA's third component (R[2]) should point roughly upward.
        # If R[2] dot [0,0,1] < 0, we're looking from below — flip.
        up_dot = R[2, 2]  # dot product of R[2] with [0,0,1]
        if up_dot < 0:
            R[1] *= -1
            R[2] *= -1
            logger.info("Flipped PCA orientation (R[2] was pointing downward, dot=%.3f)", up_dot)

    return R, center


def _project_to_2d(positions_3d, R, center):
    """Project 3D positions onto the PCA floor plane (XY).

    Returns Nx2 array of (x, y) coordinates.
    """
    centered = positions_3d - center
    rotated = (R @ centered.T).T
    return rotated[:, :2]


# ── Grid rasterization + contour extraction ──────────────────────────

def _rasterize_vertices(pts_2d, cell_size=0.1):
    """Rasterize 2D points onto a binary grid.

    Returns (grid, x_min, y_min) where grid is a 2D bool array.
    """
    x_min, y_min = pts_2d.min(axis=0) - cell_size
    x_max, y_max = pts_2d.max(axis=0) + cell_size

    cols = int(math.ceil((x_max - x_min) / cell_size)) + 1
    rows = int(math.ceil((y_max - y_min) / cell_size)) + 1

    # Clamp grid size to prevent memory issues
    max_dim = 4000
    if cols > max_dim or rows > max_dim:
        scale = max(cols, rows) / max_dim
        cell_size = cell_size * scale
        cols = int(math.ceil((x_max - x_min) / cell_size)) + 1
        rows = int(math.ceil((y_max - y_min) / cell_size)) + 1
        logger.info("Grid clamped to %dx%d (cell_size=%.3fm)", cols, rows, cell_size)

    grid = np.zeros((rows, cols), dtype=bool)

    # Map points to grid cells
    ci = ((pts_2d[:, 0] - x_min) / cell_size).astype(int)
    ri = ((pts_2d[:, 1] - y_min) / cell_size).astype(int)

    # Clamp to grid bounds
    ci = np.clip(ci, 0, cols - 1)
    ri = np.clip(ri, 0, rows - 1)

    grid[ri, ci] = True

    return grid, x_min, y_min, cell_size


def _rasterize_mesh(vertices_2d, faces, cell_size=0.1):
    """Rasterize projected mesh onto a binary grid.

    Uses vectorized vertex rasterization + edge midpoint sampling for
    coverage, then dilation to fill interior.  Much faster than per-triangle
    scanline fill for dense meshes.

    Returns (grid, x_min, y_min, cell_size).
    """
    x_min, y_min = vertices_2d.min(axis=0) - cell_size
    x_max, y_max = vertices_2d.max(axis=0) + cell_size

    cols = int(math.ceil((x_max - x_min) / cell_size)) + 1
    rows = int(math.ceil((y_max - y_min) / cell_size)) + 1

    # Clamp grid size
    max_dim = 4000
    if cols > max_dim or rows > max_dim:
        scale = max(cols, rows) / max_dim
        cell_size = cell_size * scale
        cols = int(math.ceil((x_max - x_min) / cell_size)) + 1
        rows = int(math.ceil((y_max - y_min) / cell_size)) + 1
        logger.info("Grid clamped to %dx%d (cell_size=%.3fm)", cols, rows, cell_size)

    grid = np.zeros((rows, cols), dtype=bool)

    # Plot all vertices
    ci = np.clip(((vertices_2d[:, 0] - x_min) / cell_size).astype(int), 0, cols - 1)
    ri = np.clip(((vertices_2d[:, 1] - y_min) / cell_size).astype(int), 0, rows - 1)
    grid[ri, ci] = True

    # Rasterize every triangle edge with adaptive sampling so that
    # every grid cell the edge crosses gets filled — no gaps even for
    # large triangles.
    for e0, e1 in [(0, 1), (1, 2), (2, 0)]:
        v0 = vertices_2d[faces[:, e0]]  # Nx2
        v1 = vertices_2d[faces[:, e1]]  # Nx2
        # Number of samples per edge = max pixel distance + 1
        dx = np.abs(v1[:, 0] - v0[:, 0]) / cell_size
        dy = np.abs(v1[:, 1] - v0[:, 1]) / cell_size
        steps = np.maximum(dx, dy).astype(int) + 1
        max_steps = int(steps.max())
        # Interpolate all edges at once: shape (max_steps, N, 2)
        for s in range(0, max_steps, 1):
            # Which edges still need this step
            mask = steps > s
            if not mask.any():
                break
            t = np.zeros(len(v0))
            t[mask] = s / steps[mask].astype(float)
            pts = v0 * (1 - t[:, None]) + v1 * t[:, None]
            pc = np.clip(((pts[mask, 0] - x_min) / cell_size).astype(int), 0, cols - 1)
            pr = np.clip(((pts[mask, 1] - y_min) / cell_size).astype(int), 0, rows - 1)
            grid[pr, pc] = True

    # Also fill triangle interiors with median-edge sampling
    v0 = vertices_2d[faces[:, 0]]
    v1 = vertices_2d[faces[:, 1]]
    v2 = vertices_2d[faces[:, 2]]
    centroids = (v0 + v1 + v2) / 3.0
    cc = np.clip(((centroids[:, 0] - x_min) / cell_size).astype(int), 0, cols - 1)
    cr = np.clip(((centroids[:, 1] - y_min) / cell_size).astype(int), 0, rows - 1)
    grid[cr, cc] = True
    # Sample medians (vertex to opposite edge midpoint)
    for va, vb, vc in [(v0, v1, v2), (v1, v2, v0), (v2, v0, v1)]:
        mid_bc = (vb + vc) * 0.5
        for frac in [0.33, 0.67]:
            pt = va * (1 - frac) + mid_bc * frac
            pc = np.clip(((pt[:, 0] - x_min) / cell_size).astype(int), 0, cols - 1)
            pr = np.clip(((pt[:, 1] - y_min) / cell_size).astype(int), 0, rows - 1)
            grid[pr, pc] = True

    return grid, x_min, y_min, cell_size


def _dilate_grid(grid, radius=1):
    """Morphological dilation to close small gaps."""
    if radius <= 0:
        return grid
    from scipy.ndimage import binary_dilation
    struct = np.ones((2 * radius + 1, 2 * radius + 1), dtype=bool)
    return binary_dilation(grid, structure=struct)


def _extract_contours(grid, x_min, y_min, cell_size):
    """Extract boundary contours from a binary grid using marching squares.

    Uses matplotlib's C-implemented contour generator for correct,
    properly-ordered closed contours without crossing artifacts.

    Returns list of polylines [[(x, y), ...], ...] in world coordinates.
    """
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    rows, cols = grid.shape
    z = grid.astype(np.float64)

    # Create coordinate arrays in world space
    x_arr = np.arange(cols, dtype=np.float64) * cell_size + x_min
    y_arr = np.arange(rows, dtype=np.float64) * cell_size + y_min

    fig, ax = plt.subplots()
    cs = ax.contour(x_arr, y_arr, z, levels=[0.5])
    paths = cs.get_paths()

    polylines = []
    for path in paths:
        verts = path.vertices
        codes = path.codes
        if codes is None:
            if len(verts) >= 4:
                polylines.append([(float(v[0]), float(v[1])) for v in verts])
            continue

        # Split path at MOVETO codes into separate sub-paths
        # Do NOT close polylines — open paths render cleaner for caves
        from matplotlib.path import Path as MplPath
        sub_start = 0
        for i in range(1, len(codes)):
            if codes[i] == MplPath.MOVETO or codes[i] == MplPath.CLOSEPOLY:
                if codes[i] == MplPath.CLOSEPOLY:
                    # CLOSEPOLY vertex duplicates the first — exclude it
                    seg = verts[sub_start:i]
                    sub_start = i + 1
                else:
                    seg = verts[sub_start:i]
                    sub_start = i
                if len(seg) >= 4:
                    pts = [(float(v[0]), float(v[1])) for v in seg]
                    polylines.append(pts)

        # Handle final sub-path
        seg = verts[sub_start:]
        if len(seg) >= 4:
            pts = [(float(v[0]), float(v[1])) for v in seg]
            polylines.append(pts)

    plt.close(fig)
    return polylines


# ── Heading ──────────────────────────────────────────────────────────

def _compute_initial_heading(positions_2d):
    """Compute bearing from first trajectory segment.
    Returns degrees (0=North, CW) or None.
    """
    if len(positions_2d) < 2:
        return None
    n = min(5, len(positions_2d) - 1)
    dx = float(positions_2d[n][0] - positions_2d[0][0])
    dy = float(positions_2d[n][1] - positions_2d[0][1])
    if abs(dx) < 0.01 and abs(dy) < 0.01:
        return None
    return round(math.degrees(math.atan2(dx, dy)) % 360, 2)


# ── Polyline simplification (pure Python RDP) ───────────────────────

def _point_line_distance(px, py, ax, ay, bx, by):
    """Perpendicular distance from point (px,py) to line segment (a→b)."""
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq < 1e-12:
        return math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    proj_x, proj_y = ax + t * dx, ay + t * dy
    return math.sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)


def _simplify_rdp(points, epsilon):
    """Ramer-Douglas-Peucker polyline simplification."""
    if len(points) <= 2:
        return points

    ax, ay = points[0]
    bx, by = points[-1]
    max_dist = 0.0
    max_idx = 0
    for i in range(1, len(points) - 1):
        d = _point_line_distance(points[i][0], points[i][1], ax, ay, bx, by)
        if d > max_dist:
            max_dist = d
            max_idx = i

    if max_dist > epsilon:
        left = _simplify_rdp(points[:max_idx + 1], epsilon)
        right = _simplify_rdp(points[max_idx:], epsilon)
        return left[:-1] + right
    else:
        return [points[0], points[-1]]


def _polyline_length(pts):
    """Total 2D length of a polyline."""
    total = 0.0
    for i in range(len(pts) - 1):
        dx = pts[i + 1][0] - pts[i][0]
        dy = pts[i + 1][1] - pts[i][1]
        total += math.sqrt(dx * dx + dy * dy)
    return total


def _split_at_long_segments(pts, max_len):
    """Split a polyline wherever a segment exceeds max_len.

    Returns a list of sub-polylines.
    """
    if len(pts) < 2:
        return [pts]
    result = []
    current = [pts[0]]
    for i in range(1, len(pts)):
        dx = pts[i][0] - pts[i - 1][0]
        dy = pts[i][1] - pts[i - 1][1]
        seg_len = math.sqrt(dx * dx + dy * dy)
        if seg_len > max_len:
            if len(current) >= 2:
                result.append(current)
            current = [pts[i]]
        else:
            current.append(pts[i])
    if len(current) >= 2:
        result.append(current)
    return result


# ── Main entry point ─────────────────────────────────────────────────

def generate_map_data(cave_id):
    """Generate 2D map data from cave_mesh.glb + trajectory.json.

    1. Load mesh and trajectory
    2. PCA on mesh vertices → find floor plane
    3. Project mesh triangles onto floor plane → 2D raster
    4. Extract boundary contours → wall polylines
    5. Project trajectory onto same plane → trajectory points

    Saves map_data.json to storage and returns the data dict.
    Returns None on failure.
    """
    logger.info("Generating map data from mesh for cave %s", cave_id)

    try:
        mesh = _load_mesh(cave_id)
    except Exception as e:
        logger.error("Failed to load mesh for cave %s: %s", cave_id, e)
        return None

    logger.info("Mesh: %d vertices, %d faces", len(mesh.vertices), len(mesh.faces))

    # ── Work in raw SLAM space (Z = gravity-aligned up from IMU) ──
    # Do NOT apply editor transform to mesh/point cloud for projection.
    # The editor transform rotates SLAM space arbitrarily and destroys
    # the gravity alignment, causing PCA to choose a bad "up" direction.
    # Instead, project in raw SLAM coords and build coordinate transforms
    # that account for the editor transform separately (for POIs).
    transform = _get_editor_transform(cave_id)

    # Load trajectory (raw SLAM space)
    raw_positions = _load_trajectory(cave_id)

    # ── PCA on raw SLAM vertices ──
    # In SLAM space, Z is roughly vertical (IMU gravity).
    # PCA finds the horizontal orientation (which way the cave extends).
    R, center = _find_pca_basis(mesh.vertices, floor_hint=raw_positions)

    # ── Project mesh onto floor plane (raw SLAM space) ──
    verts_2d = _project_to_2d(mesh.vertices, R, center)

    # Choose cell size based on mesh extent
    extent = verts_2d.max(axis=0) - verts_2d.min(axis=0)
    max_extent = max(extent[0], extent[1])
    # Target ~2000 cells across the longest dimension
    cell_size = max(0.05, max_extent / 2000.0)
    logger.info("2D extent: %.1f x %.1f m, cell_size=%.3fm",
                extent[0], extent[1], cell_size)

    # ── Build primary raster from point cloud (full coverage) ──
    # The point cloud has complete cave coverage unlike the BPA mesh which
    # may have holes.  Use point cloud as the primary source, then filter
    # exterior noise by keeping only the largest connected component.
    pc_verts = _load_pointcloud_vertices(cave_id)
    if pc_verts is not None:
        pc_2d = _project_to_2d(pc_verts, R, center)  # raw SLAM space

        # Compute grid bounds from point cloud (wider than mesh)
        pc_extent = pc_2d.max(axis=0) - pc_2d.min(axis=0)
        pc_x_min = float(pc_2d[:, 0].min()) - cell_size
        pc_y_min = float(pc_2d[:, 1].min()) - cell_size
        pc_x_max = float(pc_2d[:, 0].max()) + cell_size
        pc_y_max = float(pc_2d[:, 1].max()) + cell_size
        pc_cols = int(math.ceil((pc_x_max - pc_x_min) / cell_size)) + 1
        pc_rows = int(math.ceil((pc_y_max - pc_y_min) / cell_size)) + 1

        # Clamp grid size
        max_dim = 4000
        if pc_cols > max_dim or pc_rows > max_dim:
            scale = max(pc_cols, pc_rows) / max_dim
            cell_size = cell_size * scale
            pc_cols = int(math.ceil((pc_x_max - pc_x_min) / cell_size)) + 1
            pc_rows = int(math.ceil((pc_y_max - pc_y_min) / cell_size)) + 1

        grid = np.zeros((pc_rows, pc_cols), dtype=bool)
        ci = np.clip(((pc_2d[:, 0] - pc_x_min) / cell_size).astype(int), 0, pc_cols - 1)
        ri = np.clip(((pc_2d[:, 1] - pc_y_min) / cell_size).astype(int), 0, pc_rows - 1)
        grid[ri, ci] = True
        gx_min, gy_min = pc_x_min, pc_y_min
        logger.info("Point cloud grid: %dx%d, %d cells",
                     pc_cols, pc_rows, grid.sum())
    else:
        # Fallback: mesh-only rasterization
        grid, gx_min, gy_min, cell_size = _rasterize_mesh(
            verts_2d, mesh.faces, cell_size=cell_size,
        )
        logger.info("Grid (mesh only): %dx%d, %d cells",
                     grid.shape[1], grid.shape[0], grid.sum())

    # ── Dilate to connect nearby points into solid regions ──
    grid = _dilate_grid(grid, radius=3)

    # ── Keep only the largest connected component (= the cave) ──
    # Exterior scan noise forms small disconnected blobs.
    from scipy.ndimage import label
    labels, num_labels = label(grid)
    if num_labels > 1:
        component_sizes = np.bincount(labels.ravel())
        component_sizes[0] = 0  # ignore background
        largest = component_sizes.argmax()
        grid = labels == largest
        logger.info("Kept largest component (%d of %d, %d cells)",
                     largest, num_labels, grid.sum())

    # ── Fill interior holes ──
    from scipy.ndimage import binary_fill_holes
    grid = binary_fill_holes(grid)

    # ── Extract contours ──
    raw_contours = _extract_contours(grid, gx_min, gy_min, cell_size)
    logger.info("Extracted %d raw contours", len(raw_contours))

    # ── Simplify and filter contours ──
    # Compute median segment length from raw contours for anomaly detection
    all_seg_lengths = []
    for contour in raw_contours:
        for i in range(len(contour) - 1):
            dx = contour[i + 1][0] - contour[i][0]
            dy = contour[i + 1][1] - contour[i][1]
            all_seg_lengths.append(math.sqrt(dx * dx + dy * dy))
    if all_seg_lengths:
        median_seg = float(np.median(all_seg_lengths))
        max_seg_len = max(median_seg * 20, 2.0)  # anomaly threshold
    else:
        max_seg_len = 10.0

    walls = []
    for contour in raw_contours:
        pts_list = [[p[0], p[1]] for p in contour]
        simplified = _simplify_rdp(pts_list, epsilon=cell_size * 1.5)

        # Split at anomalously long segments (cross-cave jumps)
        segments = _split_at_long_segments(simplified, max_seg_len)
        for seg in segments:
            if len(seg) < 3:
                continue
            length = _polyline_length(seg)
            if length < 0.5:
                continue
            poly = [[round(x, 3), round(y, 3)] for x, y in seg]
            walls.append(poly)

    logger.info("After simplification: %d wall polylines", len(walls))

    # ── Trajectory 2D projection (raw SLAM space) ──
    traj_2d = []
    if raw_positions is not None:
        traj_proj = _project_to_2d(raw_positions, R, center)
        for p in traj_proj:
            traj_2d.append([round(float(p[0]), 3), round(float(p[1]), 3)])

    # ── Bounds ──
    all_pts = []
    for poly in walls:
        all_pts.extend(poly)
    all_pts.extend(traj_2d)

    if all_pts:
        xs = [p[0] for p in all_pts]
        ys = [p[1] for p in all_pts]
        bounds = [min(xs), min(ys), max(xs), max(ys)]
    else:
        bounds = [0, 0, 0, 0]

    # ── Heading ──
    heading = _compute_initial_heading(traj_2d) if traj_2d else None

    # ── Z range (in PCA space, for reference) ──
    centered_raw = mesh.vertices - center
    z_vals = (R @ centered_raw.T)[2, :]
    z_min = float(z_vals.min())
    z_max = float(z_vals.max())

    # ── Build coordinate transforms for map consumers ──
    # Everything is projected in raw SLAM space (R, center from raw verts).
    #
    # 1. slam_to_map: raw SLAM coords → map 2D
    #    Chain: subtract center → R rotate → take XY
    #    (This is the natural transform since projection is in SLAM space)
    #
    # 2. world_to_map: editor-space coords → map 2D (for POIs that have
    #    the editor transform baked in)
    #    Chain: undo editor transform → subtract center → R rotate → XY

    # slam_to_map (direct — projection IS in SLAM space)
    M_slam = R[:2, :]  # 2x3
    offset_slam = -(R @ center)[:2]

    # world_to_map (undo editor transform first)
    if transform is not None:
        T_inv = np.linalg.inv(transform)
        T_inv_rot = T_inv[:3, :3]
        T_inv_trans = T_inv[:3, 3]
        M_world = (R @ T_inv_rot)[:2, :]
        offset_world = (R @ (T_inv_trans - center))[:2]
    else:
        M_world = M_slam
        offset_world = offset_slam

    def _fmt_transform(M, offset):
        return {
            'matrix': [[round(float(v), 8) for v in M[0]],
                        [round(float(v), 8) for v in M[1]]],
            'offset': [round(float(offset[0]), 6), round(float(offset[1]), 6)],
        }

    slam_to_map = _fmt_transform(M_slam, offset_slam)
    world_to_map = _fmt_transform(M_world, offset_world)

    data = {
        'generated_at': datetime.utcnow().isoformat(),
        'mode': 'standard',
        'source': 'mesh_projection',
        'bounds': [round(b, 3) for b in bounds],
        'initial_heading_deg': heading,
        'slam_to_map': slam_to_map,
        'world_to_map': world_to_map,
        'levels': [{
            'index': 0,
            'name': 'Level 1',
            'z_min': round(z_min, 3),
            'z_max': round(z_max, 3),
            'z_center': round(float(np.median(z_vals)), 3),
            'walls': walls,
            'trajectory': traj_2d,
        }],
        'transitions': [],
    }

    # Save to storage
    storage_path = f'caves/{cave_id}/map_data.json'
    content = json.dumps(data, separators=(',', ':'))
    if default_storage.exists(storage_path):
        default_storage.delete(storage_path)
    default_storage.save(storage_path, ContentFile(content.encode('utf-8')))
    logger.info("Saved map_data.json for cave %s (%d wall polylines, %d traj pts)",
                cave_id, len(walls), len(traj_2d))

    return data
