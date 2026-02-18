"""Visual asset generation for cave route itineraries.

Generates:
- 2D map overview images (PIL) per level with base map background
- 2D map crop images (PIL) showing zoomed view at each instruction point
- 3D screenshots (pyrender) from traveler's perspective
"""

import io
import logging
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)

# Cyberpunk palette
COLOR_BG = '#0a0a12'
COLOR_WALL = '#2a2a3e'
COLOR_TRAJECTORY = '#3a3a4e'
COLOR_ROUTE = '#00e5ff'
COLOR_WAYPOINT = '#00e5ff'
COLOR_POSITION = '#ff3366'
COLOR_POSITION_OUTLINE = '#ff6699'

# Heatmap color ramp (density 0→1): dark blue → cyan → yellow → red
_HEATMAP_COLORS = [
    (0.00, (10, 10, 24)),     # background
    (0.05, (15, 20, 60)),     # very low - deep blue
    (0.15, (0, 60, 120)),     # low - blue
    (0.30, (0, 140, 180)),    # medium-low - teal
    (0.50, (0, 200, 200)),    # medium - cyan
    (0.70, (80, 220, 100)),   # medium-high - green
    (0.85, (220, 200, 0)),    # high - yellow
    (1.00, (255, 60, 20)),    # max - red-orange
]


def _heatmap_color(value):
    """Map a 0-1 density value to an RGB color via the heatmap ramp."""
    if value <= 0:
        return _HEATMAP_COLORS[0][1]
    if value >= 1:
        return _HEATMAP_COLORS[-1][1]
    for i in range(len(_HEATMAP_COLORS) - 1):
        t0, c0 = _HEATMAP_COLORS[i]
        t1, c1 = _HEATMAP_COLORS[i + 1]
        if t0 <= value <= t1:
            f = (value - t0) / (t1 - t0)
            return tuple(int(c0[j] + f * (c1[j] - c0[j])) for j in range(3))
    return _HEATMAP_COLORS[-1][1]


def _build_heatmap_lut():
    """Pre-build a 256-entry lookup table for fast heatmap coloring."""
    lut = np.zeros((256, 3), dtype=np.uint8)
    for i in range(256):
        lut[i] = _heatmap_color(i / 255.0)
    return lut

_HEATMAP_LUT = _build_heatmap_lut()


def _render_heatmap_background(img, level, to_px_func, size):
    """Render heatmap density data as colored pixel background."""
    heatmap = level.get('heatmap')
    if not heatmap or not heatmap.get('data'):
        return

    data = np.array(heatmap['data'], dtype=np.float32)
    h_origin = heatmap['origin']  # [x_min, y_min]
    h_res = heatmap['resolution']
    h_h, h_w = data.shape

    # Convert density to uint8 for LUT
    data_u8 = np.clip(data * 255, 0, 255).astype(np.uint8)
    # Apply LUT to get RGB
    rgb = _HEATMAP_LUT[data_u8]  # shape (h_h, h_w, 3)

    # Create heatmap image in world coords, then paste relevant pixels
    # For each heatmap cell, compute pixel position and draw
    pixels = np.array(img)
    for row in range(h_h):
        wy = h_origin[1] + row * h_res
        for col in range(h_w):
            if data[row, col] < 0.02:  # skip near-zero
                continue
            wx = h_origin[0] + col * h_res
            px, py = to_px_func(wx, wy)
            # Draw a filled rectangle for this cell
            px2, py2 = to_px_func(wx + h_res, wy + h_res)
            x0, x1 = min(px, px2), max(px, px2)
            y0, y1 = min(py, py2), max(py, py2)
            x0 = max(0, x0)
            y0 = max(0, y0)
            x1 = min(size, x1 + 1)
            y1 = min(size, y1 + 1)
            if x0 < x1 and y0 < y1:
                pixels[y0:y1, x0:x1] = rgb[row, col]

    img.paste(Image.fromarray(pixels), (0, 0))


def _render_heatmap_background_fast(img, level, to_px_func, size):
    """Render heatmap as a colored image, scaled and positioned to fit viewport."""
    heatmap = level.get('heatmap')
    if not heatmap or not heatmap.get('data'):
        return

    data = np.array(heatmap['data'], dtype=np.float32)
    h_origin = heatmap['origin']
    h_res = heatmap['resolution']
    h_h, h_w = data.shape

    # Build full heatmap image at native resolution using LUT
    data_u8 = np.clip(data * 255, 0, 255).astype(np.uint8)
    hm_rgb = _HEATMAP_LUT[data_u8]  # (h_h, h_w, 3)
    # Flip Y: row 0 = y_min (bottom in world), but we need top of image = y_max
    hm_rgb = hm_rgb[::-1]

    # Compute pixel bounds of the heatmap in the output image
    # Top-left corner in world = (x_min, y_max), bottom-right = (x_max, y_min)
    x_min_w = h_origin[0]
    y_min_w = h_origin[1]
    x_max_w = x_min_w + h_w * h_res
    y_max_w = y_min_w + h_h * h_res

    px_left, py_top = to_px_func(x_min_w, y_max_w)
    px_right, py_bot = to_px_func(x_max_w, y_min_w)

    # Target pixel dimensions
    target_w = px_right - px_left
    target_h = py_bot - py_top

    if target_w <= 0 or target_h <= 0:
        return

    # Scale heatmap image to target size
    hm_img = Image.fromarray(hm_rgb)
    hm_img = hm_img.resize((target_w, target_h), Image.BILINEAR)

    # Composite onto output, clipping to image bounds
    # Create a mask: hide background-colored pixels (density near zero)
    hm_arr = np.array(hm_img)
    bg_color = np.array(_HEATMAP_COLORS[0][1], dtype=np.uint8)
    mask_arr = np.any(hm_arr != bg_color, axis=2).astype(np.uint8) * 255
    mask_img = Image.fromarray(mask_arr, mode='L')

    img.paste(hm_img, (px_left, py_top), mask=mask_img)


def _render_walls_background(draw, level, to_px_func, color=COLOR_WALL, width=2):
    """Render wall polylines for a level."""
    for wall in level.get('walls', []):
        if len(wall) < 2:
            continue
        points = [to_px_func(p[0], p[1]) for p in wall]
        draw.line(points, fill=color, width=width)


def _render_trajectory(draw, level, to_px_func, size, dot_radius=2):
    """Render trajectory dots for a level."""
    for tx, ty in level.get('trajectory', []):
        px, py = to_px_func(tx, ty)
        if 0 <= px < size and 0 <= py < size:
            draw.ellipse(
                [px - dot_radius, py - dot_radius,
                 px + dot_radius, py + dot_radius],
                fill=COLOR_TRAJECTORY,
            )


# ---------------------------------------------------------------------------
# 2D map crop (per-instruction)
# ---------------------------------------------------------------------------

def render_map_crop(map_data, level_idx, center_x, center_y, route_path,
                    heading_rad=0, output_path=None, size=400, radius_m=5.0,
                    map_mode='heatmap'):
    """Render a 2D map crop centered on an instruction point.

    Includes the base map background (heatmap density or wall polylines)
    matching the user's selected map mode.
    """
    img = Image.new('RGB', (size, size), COLOR_BG)
    draw = ImageDraw.Draw(img)

    scale = size / (2 * radius_m)

    def to_px(wx, wy):
        px = int((wx - center_x) * scale + size / 2)
        py = int(-(wy - center_y) * scale + size / 2)
        return px, py

    # Find the right level
    level = None
    for lv in map_data.get('levels', []):
        if lv['index'] == level_idx:
            level = lv
            break

    if level is None:
        return img

    # Base map background
    if map_mode == 'heatmap' and level.get('heatmap'):
        _render_heatmap_background_fast(img, level, to_px, size)
        draw = ImageDraw.Draw(img)  # re-acquire after paste
    else:
        # For wall-based modes, draw walls more prominently
        _render_walls_background(draw, level, to_px, width=2)

    # Trajectory dots
    _render_trajectory(draw, level, to_px, size)

    # Walls on top (thin) for heatmap mode overlay
    if map_mode == 'heatmap' and level.get('heatmap'):
        _render_walls_background(draw, level, to_px, color='#4a4a6e', width=1)

    # Draw route path (cyan line)
    route_on_level = [p for p in route_path if p[2] == level_idx]
    if len(route_on_level) >= 2:
        route_points = [to_px(p[0], p[1]) for p in route_on_level]
        draw.line(route_points, fill=COLOR_ROUTE, width=3)

    # Direction arrow at center
    cx, cy = size // 2, size // 2
    arrow_len = 20
    ax = cx + int(arrow_len * math.cos(-heading_rad))
    ay = cy + int(arrow_len * math.sin(-heading_rad))
    draw.line([cx, cy, ax, ay], fill=COLOR_ROUTE, width=2)
    for angle_offset in [2.5, -2.5]:
        hx = ax - int(8 * math.cos(-heading_rad + angle_offset))
        hy = ay - int(8 * math.sin(-heading_rad + angle_offset))
        draw.line([ax, ay, hx, hy], fill=COLOR_ROUTE, width=2)

    # Center position marker
    draw.ellipse(
        [cx - 5, cy - 5, cx + 5, cy + 5],
        fill=COLOR_POSITION, outline=COLOR_POSITION_OUTLINE,
    )

    # Scale bar (bottom-right)
    bar_m = 1.0
    bar_px = int(bar_m * scale)
    bx = size - 15 - bar_px
    by = size - 20
    draw.line([bx, by, bx + bar_px, by], fill='#ffffff', width=2)
    draw.line([bx, by - 3, bx, by + 3], fill='#ffffff', width=1)
    draw.line([bx + bar_px, by - 3, bx + bar_px, by + 3], fill='#ffffff', width=1)

    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        img.save(output_path, 'PNG')
        return str(output_path)

    return img


# ---------------------------------------------------------------------------
# 2D overview map (per-level)
# ---------------------------------------------------------------------------

def render_overview_map(map_data, route_path, waypoints, output_path=None,
                        size=800, level_idx=None, map_mode='heatmap'):
    """Render a full overview map with route for a specific level (or all).

    Args:
        map_data: full map_data dict.
        route_path: list of [x, y, level] points.
        waypoints: list of waypoint dicts.
        output_path: optional path to save PNG.
        size: image size in pixels.
        level_idx: if set, only render this level. None = all levels.
        map_mode: which map layer to use as background.

    Returns:
        PIL.Image if output_path is None, else saves and returns path.
    """
    img = Image.new('RGB', (size, size), COLOR_BG)
    draw = ImageDraw.Draw(img)

    # Determine bounds — either from specified level or overall
    if level_idx is not None:
        level = None
        for lv in map_data.get('levels', []):
            if lv['index'] == level_idx:
                level = lv
                break
        if level is None:
            return img
        levels_to_render = [level]
        # Compute bounds from this level's data
        bounds = _compute_level_bounds(level, route_path, waypoints, level_idx)
    else:
        levels_to_render = map_data.get('levels', [])
        bounds = map_data.get('bounds', [-5, -2, 5, 12])

    x_min, y_min, x_max, y_max = bounds
    margin = 1.0
    x_min -= margin
    y_min -= margin
    x_max += margin
    y_max += margin

    dx = x_max - x_min
    dy = y_max - y_min
    if dx == 0 or dy == 0:
        return img
    scale = min(size / dx, size / dy) * 0.9
    ox = size / 2 - (x_min + dx / 2) * scale
    oy = size / 2 + (y_min + dy / 2) * scale

    def to_px(wx, wy):
        px = int(wx * scale + ox)
        py = int(-wy * scale + oy)
        return px, py

    # Render base map per level
    for lv in levels_to_render:
        if map_mode == 'heatmap' and lv.get('heatmap'):
            _render_heatmap_background_fast(img, lv, to_px, size)
            draw = ImageDraw.Draw(img)
        else:
            level_colors = ['#3a3a5e', '#5a3a5e', '#3a5a5e']
            color = level_colors[lv['index'] % len(level_colors)]
            _render_walls_background(draw, lv, to_px, color=color, width=2)

        _render_trajectory(draw, lv, to_px, size, dot_radius=1)

        # Thin wall overlay for heatmap mode
        if map_mode == 'heatmap' and lv.get('heatmap'):
            _render_walls_background(draw, lv, to_px, color='#5a5a7e', width=1)

    # Draw route (filtered to rendered levels if single-level)
    rendered_level_idxs = {lv['index'] for lv in levels_to_render}
    route_on_levels = [
        p for p in route_path
        if level_idx is None or p[2] in rendered_level_idxs
    ]
    if len(route_on_levels) >= 2:
        points = [to_px(p[0], p[1]) for p in route_on_levels]
        draw.line(points, fill=COLOR_ROUTE, width=3)

    # Draw waypoints (filtered to rendered levels if single-level)
    for i, wp in enumerate(waypoints):
        wp_level = wp.get('level', 0)
        if level_idx is not None and wp_level not in rendered_level_idxs:
            continue
        px, py = to_px(wp['slam_x'], wp['slam_y'])
        r = 8
        draw.ellipse(
            [px - r, py - r, px + r, py + r],
            fill=COLOR_WAYPOINT, outline='#ffffff',
        )
        num = str(i + 1)
        bbox = draw.textbbox((0, 0), num)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text((px - tw // 2, py - th // 2), num, fill=COLOR_BG)

    # Level label
    if level_idx is not None:
        level_name = level.get('name', f'Level {level_idx + 1}')
        draw.text((10, 10), level_name, fill='#ffffff')

    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        img.save(output_path, 'PNG')
        return str(output_path)

    return img


def _compute_level_bounds(level, route_path, waypoints, level_idx):
    """Compute tight bounds for a single level from its data."""
    xs, ys = [], []

    # From walls
    for wall in level.get('walls', []):
        for p in wall:
            xs.append(p[0])
            ys.append(p[1])

    # From trajectory
    for tx, ty in level.get('trajectory', []):
        xs.append(tx)
        ys.append(ty)

    # From route points on this level
    for p in route_path:
        if p[2] == level_idx:
            xs.append(p[0])
            ys.append(p[1])

    # From waypoints on this level
    for wp in waypoints:
        if wp.get('level', 0) == level_idx:
            xs.append(wp['slam_x'])
            ys.append(wp['slam_y'])

    # From heatmap bounds if available
    hm = level.get('heatmap')
    if hm:
        xs.append(hm['origin'][0])
        xs.append(hm['origin'][0] + hm['width'] * hm['resolution'])
        ys.append(hm['origin'][1])
        ys.append(hm['origin'][1] + hm['height'] * hm['resolution'])

    if not xs:
        return [-5, -2, 5, 12]
    return [min(xs), min(ys), max(xs), max(ys)]


# ---------------------------------------------------------------------------
# 3D snapshot rendering (pyrender + trimesh)
# ---------------------------------------------------------------------------

def render_3d_snapshot(glb_scene_or_path, slam_x, slam_y, slam_z, heading_rad,
                       output_path=None, width=800, height=450):
    """Render a 3D screenshot from the cave mesh at a given position/heading.

    Uses the same SLAM→OpenGL coordinate transform as CaveExplorer:
      Three.js: x=slam_x, y=slam_z, z=-slam_y

    Args:
        glb_scene_or_path: trimesh.Scene (pre-loaded) or str path to mesh.glb
        slam_x, slam_y, slam_z: SLAM world coordinates
        heading_rad: travel direction in SLAM radians (0=+X, pi/2=+Y)
        output_path: optional path to save JPEG
        width, height: render resolution

    Returns:
        PIL.Image if output_path is None, else saves and returns path.
    """
    import os
    os.environ['PYOPENGL_PLATFORM'] = 'egl'

    try:
        import trimesh
        import pyrender
    except ImportError:
        logger.warning('pyrender/trimesh not available for 3D rendering')
        return None

    # Accept either a pre-loaded scene or a file path
    if isinstance(glb_scene_or_path, (str, Path)):
        glb_path = Path(glb_scene_or_path)
        if not glb_path.exists():
            return None
        try:
            scene = trimesh.load(str(glb_path))
        except Exception:
            logger.exception('Failed to load GLB')
            return None
    else:
        scene = glb_scene_or_path

    try:
        geom = list(scene.geometry.values())[0]
    except (AttributeError, IndexError):
        logger.warning('No geometry in GLB scene')
        return None

    # Create pyrender scene
    pr_scene = pyrender.Scene(bg_color=[10, 10, 18, 255])
    mesh = pyrender.Mesh.from_trimesh(geom, smooth=False)
    pr_scene.add(mesh)

    # Lighting — directional + ambient
    light = pyrender.DirectionalLight(color=[1.0, 1.0, 1.0], intensity=2.5)
    light_pose = np.eye(4)
    light_pose[:3, :3] = _rotation_matrix_y(-0.3) @ _rotation_matrix_x(-0.5)
    pr_scene.add(light, pose=light_pose)

    # Point light at camera position for cave illumination
    plight = pyrender.PointLight(color=[0.8, 0.9, 1.0], intensity=5.0)
    cam_gl_pos = _slam_to_gl(slam_x, slam_y, slam_z or 0.15)
    plight_pose = np.eye(4)
    plight_pose[:3, 3] = cam_gl_pos
    pr_scene.add(plight, pose=plight_pose)

    # Camera
    camera = pyrender.PerspectiveCamera(yfov=np.pi / 3.0, znear=0.05, zfar=50.0)
    cam_pose = _build_camera_pose(slam_x, slam_y, slam_z or 0.15, heading_rad)
    pr_scene.add(camera, pose=cam_pose)

    # Render
    try:
        r = pyrender.OffscreenRenderer(width, height)
        color, _ = r.render(pr_scene)
        r.delete()
    except Exception:
        logger.exception('Pyrender rendering failed')
        return None

    img = Image.fromarray(color)

    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        img.save(str(output_path), 'JPEG', quality=85)
        return str(output_path)

    return img


def _slam_to_gl(sx, sy, sz):
    """Convert SLAM coords to OpenGL/pyrender coords.

    SLAM: x=right, y=forward, z=up
    OpenGL: x=right, y=up, z=-forward
    Same as CaveExplorer: Three.js(x, y, z) = SLAM(x, z, -y)
    """
    return np.array([sx, sz, -sy])


def _build_camera_pose(slam_x, slam_y, slam_z, heading_rad):
    """Build a 4x4 camera pose matrix from SLAM position + heading.

    heading_rad: 0 = looking along +X in SLAM, pi/2 = +Y in SLAM.
    """
    pos = _slam_to_gl(slam_x, slam_y, slam_z)

    # Forward direction in SLAM: heading_rad from +X axis
    fwd_slam = np.array([math.cos(heading_rad), math.sin(heading_rad), 0.0])
    fwd_gl = np.array([fwd_slam[0], fwd_slam[2], -fwd_slam[1]])

    # Camera looks along -Z in its local frame, so we build a view matrix
    up = np.array([0.0, 1.0, 0.0])

    # Build rotation: camera -Z = forward direction → Z = -forward
    z_axis = -fwd_gl
    z_axis = z_axis / (np.linalg.norm(z_axis) + 1e-9)
    x_axis = np.cross(up, z_axis)
    x_norm = np.linalg.norm(x_axis)
    if x_norm < 1e-6:
        x_axis = np.array([1.0, 0.0, 0.0])
    else:
        x_axis = x_axis / x_norm
    y_axis = np.cross(z_axis, x_axis)

    pose = np.eye(4)
    pose[:3, 0] = x_axis
    pose[:3, 1] = y_axis
    pose[:3, 2] = z_axis
    pose[:3, 3] = pos
    return pose


def _rotation_matrix_x(angle):
    """3x3 rotation matrix around X axis."""
    c, s = math.cos(angle), math.sin(angle)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def _rotation_matrix_y(angle):
    """3x3 rotation matrix around Y axis."""
    c, s = math.cos(angle), math.sin(angle)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def _find_nearest_keyframe_z(spawn_data, slam_x, slam_y):
    """Find the Z coordinate from the nearest keyframe to a SLAM xy position."""
    if not spawn_data or 'keyframes' not in spawn_data:
        return 0.15  # default eye height
    best_z = 0.15
    best_dist = float('inf')
    for kf in spawn_data['keyframes']:
        pos = kf['position']
        dx = pos[0] - slam_x
        dy = pos[1] - slam_y
        dist = dx * dx + dy * dy
        if dist < best_dist:
            best_dist = dist
            best_z = pos[2]
    return best_z


# ---------------------------------------------------------------------------
# Batch generation
# ---------------------------------------------------------------------------

def generate_route_visuals(map_data, instructions, route_path, waypoints,
                           cave_media_dir, map_mode='heatmap',
                           spawn_data=None, heatmap_data=None):
    """Generate all visual assets for a route.

    Args:
        map_data: dict from the user's selected map mode JSON.
        heatmap_data: dict from heatmap JSON (if map_mode != 'heatmap',
                      provides density data for background rendering).

    Returns:
        {
            'overview_images': {level_idx: PIL.Image, ...},
            'crop_images': {instruction_index: PIL.Image, ...},
            'snapshot_images': {instruction_index: PIL.Image or None, ...},
        }
    """
    # Ensure heatmap density data is available in map_data levels.
    # When user is viewing a non-heatmap mode, inject heatmap data
    # from the separate heatmap JSON so we can render density backgrounds.
    effective_map_data = _ensure_heatmap_data(map_data, heatmap_data)

    levels_used = list({p[2] for p in route_path})
    levels_used.sort()

    glb_path = Path(cave_media_dir) / 'mesh.glb'
    has_glb = glb_path.exists()

    # Load GLB once for all snapshots
    glb_scene = None
    if has_glb:
        try:
            import trimesh
            glb_scene = trimesh.load(str(glb_path))
        except Exception:
            logger.exception('Failed to load GLB for 3D snapshots')

    # Per-level overview maps
    overview_images = {}
    for lv_idx in levels_used:
        overview_images[lv_idx] = render_overview_map(
            effective_map_data, route_path, waypoints,
            size=800, level_idx=lv_idx, map_mode=map_mode,
        )

    # Per-instruction crops + 3D snapshots
    crop_images = {}
    snapshot_images = {}
    for inst in instructions:
        idx = inst['index']
        heading = math.radians(inst.get('heading_deg', 0))
        level = inst.get('level', 0)

        crop_images[idx] = render_map_crop(
            effective_map_data, level,
            inst['slam_x'], inst['slam_y'],
            route_path,
            heading_rad=heading,
            size=400, radius_m=5.0,
            map_mode=map_mode,
        )

        # 3D snapshot
        if glb_scene is not None:
            slam_z = _find_nearest_keyframe_z(
                spawn_data, inst['slam_x'], inst['slam_y'],
            )
            snapshot_images[idx] = render_3d_snapshot(
                glb_scene,
                inst['slam_x'], inst['slam_y'], slam_z,
                heading,
                width=800, height=450,
            )
        else:
            snapshot_images[idx] = None

    return {
        'overview_images': overview_images,
        'crop_images': crop_images,
        'snapshot_images': snapshot_images,
    }


def _ensure_heatmap_data(map_data, heatmap_data):
    """Merge heatmap density data into map_data levels if missing.

    When the user is viewing a non-heatmap mode, the map_data JSON won't
    have heatmap density arrays. We inject them from the separate
    heatmap_data source so the visual renderers can draw density backgrounds.
    """
    if not heatmap_data:
        return map_data  # already heatmap mode or no heatmap available

    # Build lookup: level_idx → heatmap dict
    hm_by_level = {}
    for lv in heatmap_data.get('levels', []):
        if lv.get('heatmap'):
            hm_by_level[lv['index']] = lv['heatmap']

    if not hm_by_level:
        return map_data

    # Deep-ish copy of levels, inject heatmap data
    import copy
    result = copy.copy(map_data)
    new_levels = []
    for lv in map_data.get('levels', []):
        if lv['index'] in hm_by_level and not lv.get('heatmap'):
            lv = dict(lv)  # shallow copy
            lv['heatmap'] = hm_by_level[lv['index']]
        new_levels.append(lv)
    result['levels'] = new_levels

    # Also inject bounds from heatmap if missing
    if not map_data.get('bounds') and heatmap_data.get('bounds'):
        result['bounds'] = heatmap_data['bounds']

    return result
