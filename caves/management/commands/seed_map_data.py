"""
Seed realistic 2D cave map data, 3D mesh (GLB), spawn point, and POIs
for one of the existing caves so the frontend CaveMapSection and
CaveExplorer components can be tested.

Generates all 7 map render modes:
  quick, standard, detailed, heatmap, edges, raw_slice, points

Targets "Mammoth Cave System" (first seeded cave).

Usage:
    python manage.py seed_data          # create caves first
    python manage.py seed_map_data      # add map + mesh + POIs
    python manage.py seed_map_data --flush   # wipe and re-seed map data
"""

import json
import math
import shutil
from pathlib import Path

import numpy as np
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

TARGET_CAVE_NAME = 'Mammoth Cave System'


def generate_cave_path(seed=42, n_points=200, length=80.0):
    """Generate a sinuous cave centerline path in 2D."""
    rng = np.random.RandomState(seed)
    t = np.linspace(0, 1, n_points)
    # Main direction with sinuous curves
    x = t * length
    y = (
        4.0 * np.sin(t * 2 * np.pi * 1.5)
        + 2.0 * np.sin(t * 2 * np.pi * 3.7 + 1.2)
        + 1.0 * np.sin(t * 2 * np.pi * 7.1 + 0.5)
        + rng.randn(n_points) * 0.3
    )
    return np.column_stack([x, y])


def generate_walls(centerline, base_width=3.0, seed=42):
    """Generate left and right cave walls from a centerline."""
    rng = np.random.RandomState(seed)
    n = len(centerline)

    # Compute normals
    tangents = np.diff(centerline, axis=0, prepend=centerline[:1])
    tangents[0] = tangents[1]
    norms = np.sqrt((tangents ** 2).sum(axis=1, keepdims=True))
    norms[norms < 1e-6] = 1.0
    tangents = tangents / norms
    normals = np.column_stack([-tangents[:, 1], tangents[:, 0]])

    # Variable width with chambers
    width = base_width + 1.5 * np.sin(np.linspace(0, 8 * np.pi, n))
    width += rng.randn(n) * 0.4
    width = np.clip(width, 1.0, 8.0)

    # Add a few wide chambers
    for center_idx in [50, 120, 170]:
        if center_idx < n:
            spread = 15
            lo = max(0, center_idx - spread)
            hi = min(n, center_idx + spread)
            bump = 4.0 * np.exp(-0.5 * ((np.arange(lo, hi) - center_idx) / 6.0) ** 2)
            width[lo:hi] += bump

    left_wall = centerline + normals * (width / 2)[:, np.newaxis]
    right_wall = centerline - normals * (width / 2)[:, np.newaxis]
    return left_wall, right_wall, width


def generate_branch(centerline, branch_start_idx, branch_angle_deg, length=20.0, n_points=60, seed=99):
    """Generate a side branch from the main passage."""
    rng = np.random.RandomState(seed)
    origin = centerline[branch_start_idx]
    angle = math.radians(branch_angle_deg)

    t = np.linspace(0, 1, n_points)
    x = origin[0] + t * length * math.cos(angle) + rng.randn(n_points) * 0.2
    y = origin[1] + t * length * math.sin(angle) + 1.5 * np.sin(t * 4 * np.pi) + rng.randn(n_points) * 0.2
    return np.column_stack([x, y])


def compute_bounds(wall_arrays):
    """Compute [xMin, yMin, xMax, yMax] from a list of numpy wall arrays."""
    all_points = np.vstack(wall_arrays)
    return [
        float(all_points[:, 0].min()),
        float(all_points[:, 1].min()),
        float(all_points[:, 0].max()),
        float(all_points[:, 1].max()),
    ]


def downsample(arr, step):
    """Downsample a numpy array by taking every `step`-th point."""
    return arr[::step]


def interpolate_walls(arr, factor=2):
    """Linearly interpolate between wall points to increase resolution."""
    from scipy.interpolate import interp1d
    n = len(arr)
    x_old = np.linspace(0, 1, n)
    x_new = np.linspace(0, 1, n * factor)
    f = interp1d(x_old, arr, axis=0, kind='cubic')
    return f(x_new)


def generate_heatmap(centerline, left_wall, right_wall, resolution=0.5):
    """Generate a 2D density heatmap grid from wall and trajectory points."""
    all_pts = np.vstack([centerline, left_wall, right_wall])
    xmin, ymin = all_pts.min(axis=0) - 2
    xmax, ymax = all_pts.max(axis=0) + 2

    grid_w = int((xmax - xmin) / resolution) + 1
    grid_h = int((ymax - ymin) / resolution) + 1

    # Limit grid size for JSON
    grid_w = min(grid_w, 300)
    grid_h = min(grid_h, 300)

    grid = np.zeros((grid_h, grid_w), dtype=np.float32)

    # Accumulate point density
    rng = np.random.RandomState(42)
    # Scatter trajectory points with gaussian spread
    for pt in centerline:
        gx = int((pt[0] - xmin) / resolution)
        gy = int((pt[1] - ymin) / resolution)
        # Gaussian splat
        for dx in range(-3, 4):
            for dy in range(-3, 4):
                nx, ny = gx + dx, gy + dy
                if 0 <= nx < grid_w and 0 <= ny < grid_h:
                    dist = math.sqrt(dx * dx + dy * dy)
                    grid[ny, nx] += math.exp(-dist * dist / 2.0) * 2.0

    # Wall points contribute less
    for pt in np.vstack([left_wall, right_wall]):
        gx = int((pt[0] - xmin) / resolution)
        gy = int((pt[1] - ymin) / resolution)
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                nx, ny = gx + dx, gy + dy
                if 0 <= nx < grid_w and 0 <= ny < grid_h:
                    dist = math.sqrt(dx * dx + dy * dy)
                    grid[ny, nx] += math.exp(-dist * dist / 1.5) * 0.5

    # Normalize to 0-1
    mx = grid.max()
    if mx > 0:
        grid = grid / mx

    return {
        'width': grid_w,
        'height': grid_h,
        'origin': [round(float(xmin), 3), round(float(ymin), 3)],
        'resolution': resolution,
        'data': [[round(float(v), 3) for v in row] for row in grid],
    }


def generate_density_points(centerline, left_wall, right_wall, n_samples=2000):
    """Generate density-weighted point samples for the 'points' mode."""
    rng = np.random.RandomState(42)
    all_pts = np.vstack([centerline, left_wall, right_wall])

    # Sample from all points with jitter
    indices = rng.choice(len(all_pts), size=min(n_samples, len(all_pts) * 3), replace=True)
    samples = all_pts[indices] + rng.randn(len(indices), 2) * 0.15

    # Compute local density via nearest-neighbor distance
    from scipy.spatial import cKDTree
    tree = cKDTree(samples)
    dists, _ = tree.query(samples, k=6)
    avg_dist = dists[:, 1:].mean(axis=1)  # skip self
    # Invert: close neighbors = high density
    density = 1.0 / (avg_dist + 0.01)
    density = (density - density.min()) / (density.max() - density.min() + 1e-6)

    return [[round(float(x), 3), round(float(y), 3), round(float(d), 3)]
            for (x, y), d in zip(samples, density)]


def build_level(walls_list, trajectory, z_center, level_index, level_name,
                mode='standard', heatmap_data=None, density_data=None):
    """Build a single level dict for the map data JSON."""
    def to_list(arr):
        return [[round(float(x), 3), round(float(y), 3)] for x, y in arr]

    level = {
        'index': level_index,
        'name': level_name,
        'z_center': z_center,
        'walls': [to_list(w) for w in walls_list],
        'trajectory': to_list(trajectory),
    }

    # Compute per-level bounds from walls
    all_arrays = walls_list
    pts = np.vstack(all_arrays)
    level['bounds'] = [
        round(float(pts[:, 0].min()), 3),
        round(float(pts[:, 1].min()), 3),
        round(float(pts[:, 0].max()), 3),
        round(float(pts[:, 1].max()), 3),
    ]

    if heatmap_data:
        level['heatmap'] = heatmap_data
    if density_data:
        level['density'] = {'points': density_data}

    return level


def build_map_data(mode, centerline, left_wall, right_wall,
                   branch, branch_left, branch_right):
    """Build the complete map data JSON for a specific mode."""

    # Mode-specific wall processing
    if mode == 'quick':
        # Coarse walls — every 4th point
        lw = downsample(left_wall, 4)
        rw = downsample(right_wall, 4)
        cl = downsample(centerline, 4)
        blw = downsample(branch_left, 3)
        brw = downsample(branch_right, 3)
        br = downsample(branch, 3)
    elif mode == 'detailed':
        # Higher resolution via interpolation
        try:
            lw = interpolate_walls(left_wall, factor=2)
            rw = interpolate_walls(right_wall, factor=2)
            cl = interpolate_walls(centerline, factor=2)
            blw = interpolate_walls(branch_left, factor=2)
            brw = interpolate_walls(branch_right, factor=2)
            br = interpolate_walls(branch, factor=2)
        except ImportError:
            # scipy not available — use original resolution
            lw, rw, cl = left_wall, right_wall, centerline
            blw, brw, br = branch_left, branch_right, branch
    elif mode == 'edges':
        # Sharper representation — add noise for rough edges
        rng = np.random.RandomState(77)
        lw = left_wall + rng.randn(*left_wall.shape) * 0.08
        rw = right_wall + rng.randn(*right_wall.shape) * 0.08
        cl = centerline
        blw = branch_left + rng.randn(*branch_left.shape) * 0.08
        brw = branch_right + rng.randn(*branch_right.shape) * 0.08
        br = branch
    elif mode == 'raw_slice':
        # Raw Poisson slice — add slight irregularity
        rng = np.random.RandomState(55)
        lw = left_wall + rng.randn(*left_wall.shape) * 0.12
        rw = right_wall + rng.randn(*right_wall.shape) * 0.12
        cl = centerline
        blw = branch_left + rng.randn(*branch_left.shape) * 0.12
        brw = branch_right + rng.randn(*branch_right.shape) * 0.12
        br = branch
    else:
        # standard, heatmap, points — use full resolution
        lw, rw, cl = left_wall, right_wall, centerline
        blw, brw, br = branch_left, branch_right, branch

    # Upper level
    upper_walls = [lw, rw, blw, brw]

    # Heatmap data (only for heatmap mode)
    heatmap_data = None
    if mode == 'heatmap':
        heatmap_data = generate_heatmap(cl, lw, rw, resolution=0.5)

    # Density points (only for points mode)
    density_data = None
    if mode == 'points':
        density_data = generate_density_points(cl, lw, rw, n_samples=2000)

    level0 = build_level(
        upper_walls, cl, z_center=0.0,
        level_index=0, level_name='Upper Level',
        mode=mode,
        heatmap_data=heatmap_data,
        density_data=density_data,
    )

    # Lower level — offset subset
    if mode == 'quick':
        step = 4
        lower_center = downsample(centerline[40:140], step) + np.array([2.0, -8.0])
        lower_left = downsample(left_wall[40:140], step) + np.array([2.0, -8.0])
        lower_right = downsample(right_wall[40:140], step) + np.array([2.0, -8.0])
    else:
        lower_center = centerline[40:140] + np.array([2.0, -8.0])
        lower_left = left_wall[40:140] + np.array([2.0, -8.0])
        lower_right = right_wall[40:140] + np.array([2.0, -8.0])

    lower_heatmap = None
    lower_density = None
    if mode == 'heatmap':
        lower_heatmap = generate_heatmap(lower_center, lower_left, lower_right, resolution=0.5)
    if mode == 'points':
        lower_density = generate_density_points(lower_center, lower_left, lower_right, n_samples=800)

    level1 = build_level(
        [lower_left, lower_right], lower_center, z_center=-5.0,
        level_index=1, level_name='Lower Level',
        mode=mode,
        heatmap_data=lower_heatmap,
        density_data=lower_density,
    )

    # Global bounds
    all_wall_arrays = upper_walls + [lower_left, lower_right]
    global_bounds = compute_bounds(all_wall_arrays)

    return {
        'bounds': [round(v, 3) for v in global_bounds],
        'levels': [level0, level1],
        'mode': mode,
    }


def generate_glb_mesh(centerline_3d, width_profile, output_path):
    """Generate a cave tube GLB mesh using trimesh."""
    import trimesh

    n = len(centerline_3d)
    vertices = []
    faces = []
    n_sides = 12  # Cross-section polygon sides

    for i in range(n):
        pos = centerline_3d[i]
        radius = width_profile[i] / 2.0

        # Compute local frame
        if i < n - 1:
            forward = centerline_3d[i + 1] - centerline_3d[i]
        else:
            forward = centerline_3d[i] - centerline_3d[i - 1]
        forward_len = np.linalg.norm(forward)
        if forward_len < 1e-6:
            forward = np.array([1, 0, 0])
        else:
            forward = forward / forward_len

        # Choose an up vector
        up = np.array([0, 1, 0])
        if abs(np.dot(forward, up)) > 0.99:
            up = np.array([0, 0, 1])
        right = np.cross(forward, up)
        right = right / np.linalg.norm(right)
        up = np.cross(right, forward)

        # Generate ring of vertices
        for j in range(n_sides):
            angle = 2 * math.pi * j / n_sides
            offset = right * (radius * math.cos(angle)) + up * (radius * math.sin(angle))
            vertices.append(pos + offset)

    vertices = np.array(vertices)

    # Generate faces connecting adjacent rings
    for i in range(n - 1):
        for j in range(n_sides):
            j_next = (j + 1) % n_sides
            v0 = i * n_sides + j
            v1 = i * n_sides + j_next
            v2 = (i + 1) * n_sides + j_next
            v3 = (i + 1) * n_sides + j
            faces.append([v0, v1, v2])
            faces.append([v0, v2, v3])

    # Cap the ends
    # Start cap
    center_start = centerline_3d[0]
    start_center_idx = len(vertices)
    vertices = np.vstack([vertices, [center_start]])
    for j in range(n_sides):
        j_next = (j + 1) % n_sides
        faces.append([start_center_idx, j_next, j])

    # End cap
    center_end = centerline_3d[-1]
    end_center_idx = len(vertices)
    vertices = np.vstack([vertices, [center_end]])
    base = (n - 1) * n_sides
    for j in range(n_sides):
        j_next = (j + 1) % n_sides
        faces.append([end_center_idx, base + j, base + j_next])

    faces = np.array(faces)

    # Create mesh and add some rock-like vertex colors
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces)

    # Brownish-grey rock colors with variation
    rng = np.random.RandomState(42)
    base_color = np.array([0.35, 0.30, 0.25, 1.0])
    colors = np.tile(base_color, (len(vertices), 1))
    colors[:, :3] += rng.randn(len(vertices), 3) * 0.05
    colors = np.clip(colors, 0, 1)
    colors = (colors * 255).astype(np.uint8)
    mesh.visual.vertex_colors = colors

    # Export as GLB
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(str(output_path), file_type='glb')
    return len(vertices), len(faces)


def generate_spawn_json(centerline_3d, output_path):
    """Generate spawn.json for the CaveExplorer."""
    # Spawn at the entrance (first point, looking inward)
    pos = centerline_3d[0].tolist()
    # Identity quaternion (looking along +Z after SLAM conversion)
    orientation = [0.0, 0.0, 0.0, 1.0]
    data = {
        'spawn': {
            'position': pos,
            'orientation': orientation,
        }
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)


def generate_pois(centerline, width_profile):
    """Generate realistic POIs along the cave."""
    pois = []

    # Entrance at the start
    pois.append({
        'label': 'Main Entrance',
        'poi_type': 'entrance',
        'description': 'Primary entrance to the Broadway passage',
        'slam_x': float(centerline[0, 0]),
        'slam_y': float(centerline[0, 1]),
        'slam_z': 0.0,
        'source': 'mapping',
    })

    # Junction where branch meets (around index 80)
    pois.append({
        'label': 'Broadway Junction',
        'poi_type': 'junction',
        'description': 'Main junction where Fat Man\'s Misery branches off',
        'slam_x': float(centerline[80, 0]),
        'slam_y': float(centerline[80, 1]),
        'slam_z': 0.0,
        'source': 'mapping',
    })

    # Squeeze (narrow section)
    narrow_idx = np.argmin(width_profile)
    pois.append({
        'label': 'The Squeeze',
        'poi_type': 'squeeze',
        'description': 'Tight passage — 0.5m clearance. Side-crawl required.',
        'slam_x': float(centerline[narrow_idx, 0]),
        'slam_y': float(centerline[narrow_idx, 1]),
        'slam_z': 0.0,
        'source': 'mapping',
    })

    # Water feature
    pois.append({
        'label': 'Echo River Pool',
        'poi_type': 'water',
        'description': 'Standing pool connected to the Echo River system. Depth ~1.5m.',
        'slam_x': float(centerline[130, 0]),
        'slam_y': float(centerline[130, 1]),
        'slam_z': -0.5,
        'source': 'mapping',
    })

    # Formation (chamber area)
    pois.append({
        'label': 'Frozen Niagara',
        'poi_type': 'formation',
        'description': 'Spectacular flowstone cascade. Do not touch formations.',
        'slam_x': float(centerline[50, 0]),
        'slam_y': float(centerline[50, 1]),
        'slam_z': 0.0,
        'source': 'mapping',
    })

    # Hazard
    pois.append({
        'label': 'Unstable Ceiling',
        'poi_type': 'hazard',
        'description': 'Loose rock fall zone. Helmet required. Move through quickly.',
        'slam_x': float(centerline[160, 0]),
        'slam_y': float(centerline[160, 1]),
        'slam_z': 0.0,
        'source': 'mapping',
    })

    # Biology
    pois.append({
        'label': 'Cricket Colony',
        'poi_type': 'biology',
        'description': 'Large cave cricket population on ceiling. Bat roost nearby.',
        'slam_x': float(centerline[100, 0]),
        'slam_y': float(centerline[100, 1]),
        'slam_z': 1.5,
        'source': 'mapping',
    })

    # Survey station
    pois.append({
        'label': 'SS-14',
        'poi_type': 'survey_station',
        'description': 'Survey station 14. Benchmark elevation 186.2m ASL.',
        'slam_x': float(centerline[150, 0]),
        'slam_y': float(centerline[150, 1]),
        'slam_z': 0.0,
        'source': 'mapping',
    })

    # Camp
    pois.append({
        'label': 'Camp Alpha',
        'poi_type': 'camp',
        'description': 'Flat dry area suitable for base camp. Space for 4 tents.',
        'slam_x': float(centerline[120, 0]) + 3.0,
        'slam_y': float(centerline[120, 1]) + 2.0,
        'slam_z': 0.0,
        'source': 'mapping',
    })

    # Transition (level change)
    pois.append({
        'label': 'Descent to Lower Level',
        'poi_type': 'transition',
        'description': 'Vertical drop (-5m) to the lower river passage. Rope required.',
        'slam_x': float(centerline[90, 0]),
        'slam_y': float(centerline[90, 1]),
        'slam_z': -2.5,
        'source': 'mapping',
    })

    return pois


ALL_MODES = ['quick', 'standard', 'detailed', 'heatmap', 'edges', 'raw_slice', 'points']


class Command(BaseCommand):
    help = 'Seed cave map data (2D map JSON for all modes, 3D GLB mesh, POIs) for Mammoth Cave'

    def add_arguments(self, parser):
        parser.add_argument(
            '--flush', action='store_true',
            help='Delete existing map data before seeding',
        )

    def handle(self, *args, **options):
        from caves.models import Cave
        from mapping.models import PointOfInterest
        from reconstruction.models import ReconstructionJob

        # Find target cave
        try:
            cave = Cave.objects.get(name=TARGET_CAVE_NAME)
        except Cave.DoesNotExist:
            self.stderr.write(self.style.ERROR(
                f'Cave "{TARGET_CAVE_NAME}" not found. Run seed_data first.'
            ))
            return

        media_root = Path(settings.MEDIA_ROOT)
        cave_dir = media_root / 'caves' / str(cave.id)
        recon_dir = media_root / 'reconstruction' / 'output'

        if options['flush']:
            self.stdout.write('Flushing existing map data...')
            PointOfInterest.objects.filter(cave=cave).delete()
            ReconstructionJob.objects.filter(cave=cave).delete()
            if cave_dir.exists():
                shutil.rmtree(cave_dir)
            self.stdout.write(self.style.WARNING('  Map data flushed.'))

        # ── Generate 2D cave geometry ──
        self.stdout.write('Generating cave geometry...')
        centerline = generate_cave_path(seed=42, n_points=200, length=80.0)
        left_wall, right_wall, width = generate_walls(centerline, base_width=3.0, seed=42)

        # Generate a side branch
        branch = generate_branch(centerline, 80, -60, length=25.0, n_points=60, seed=99)
        branch_left, branch_right, _ = generate_walls(branch, base_width=2.0, seed=99)

        # ── Save 2D map data for ALL modes ──
        cave_dir.mkdir(parents=True, exist_ok=True)

        for mode in ALL_MODES:
            self.stdout.write(f'  Generating {mode} map...')
            map_data = build_map_data(
                mode, centerline, left_wall, right_wall,
                branch, branch_left, branch_right,
            )
            path = cave_dir / f'map_data_{mode}.json'
            with open(path, 'w') as f:
                json.dump(map_data, f)
            self.stdout.write(f'    Saved: {path.name}')

        # Also save the default map_data.json (standard mode)
        default_data = build_map_data(
            'standard', centerline, left_wall, right_wall,
            branch, branch_left, branch_right,
        )
        default_path = cave_dir / 'map_data.json'
        with open(default_path, 'w') as f:
            json.dump(default_data, f)
        self.stdout.write(f'  Default: {default_path.name}')
        self.stdout.write(self.style.SUCCESS(f'  All {len(ALL_MODES)} map modes generated'))

        # ── Generate 3D mesh ──
        self.stdout.write('Generating 3D cave mesh (GLB)...')
        # Convert 2D centerline to 3D (x stays, y becomes z, add height variation)
        rng = np.random.RandomState(42)
        centerline_3d = np.column_stack([
            centerline[:, 0],                    # SLAM X
            centerline[:, 1],                    # SLAM Y
            np.cumsum(rng.randn(200) * 0.1),     # SLAM Z (gradual descent)
        ])

        # Save mesh
        recon_dir.mkdir(parents=True, exist_ok=True)
        mesh_path = recon_dir / 'textured_mesh.glb'
        vert_count, face_count = generate_glb_mesh(centerline_3d, width, mesh_path)
        self.stdout.write(f'  Mesh: {vert_count} vertices, {face_count} faces')
        self.stdout.write(f'  Saved: {mesh_path}')

        # Also save to per-cave directory for future per-cave support
        cave_mesh_path = cave_dir / 'mesh.glb'
        shutil.copy2(mesh_path, cave_mesh_path)

        # ── Generate spawn.json ──
        spawn_path = recon_dir / 'spawn.json'
        generate_spawn_json(centerline_3d, spawn_path)
        self.stdout.write(f'  Spawn: {spawn_path}')

        # Also save per-cave spawn
        cave_spawn_path = cave_dir / 'spawn.json'
        shutil.copy2(spawn_path, cave_spawn_path)

        # ── Create ReconstructionJob record ──
        self.stdout.write('Creating reconstruction job record...')
        job, created = ReconstructionJob.objects.get_or_create(
            cave=cave,
            status=ReconstructionJob.Status.COMPLETED,
            defaults={
                'quality': ReconstructionJob.Quality.STANDARD,
                'vertex_count': vert_count,
                'triangle_count': face_count,
                'point_count': vert_count,
                'texture_coverage': 0.0,
                'file_size_bytes': mesh_path.stat().st_size,
                'processing_time_seconds': 12.3,
                'completed_at': timezone.now(),
            },
        )
        if created:
            # Point the FileField at the mesh
            job.mesh_file.name = f'reconstruction/output/textured_mesh.glb'
            job.save(update_fields=['mesh_file'])
            self.stdout.write(f'  Job created: {job.id}')
        else:
            self.stdout.write(f'  Job already exists: {job.id}')

        # ── Create POIs ──
        self.stdout.write('Creating POIs...')
        poi_data = generate_pois(centerline, width)
        poi_count = 0
        for pd in poi_data:
            _, created = PointOfInterest.objects.get_or_create(
                cave=cave,
                label=pd['label'],
                defaults=pd,
            )
            if created:
                poi_count += 1
                self.stdout.write(f'  {pd["poi_type"]}: {pd["label"]}')
        self.stdout.write(f'  {poi_count} POIs created')

        # ── Update cave has_map flag ──
        if not cave.has_map:
            cave.has_map = True
            cave.slam_heading = 0.0
            cave.save(update_fields=['has_map', 'slam_heading', 'updated_at'])
            self.stdout.write('  Set has_map=True on cave')

        # ── Summary ──
        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS('Map data seeded successfully!'))
        self.stdout.write(f'  Cave: {cave.name} ({cave.id})')
        self.stdout.write(f'  Modes: {", ".join(ALL_MODES)}')
        self.stdout.write(f'  3D Mesh: {mesh_path} ({mesh_path.stat().st_size / 1024:.1f} KB)')
        self.stdout.write(f'  Spawn: {spawn_path}')
        self.stdout.write(f'  POIs: {PointOfInterest.objects.filter(cave=cave).count()}')
        self.stdout.write(f'  Reconstruction: {job.id}')
