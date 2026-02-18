"""ROS-style occupancy grid + costmap + A* pathfinding for cave routing.

Mirrors the ROS nav2 pipeline:
  nav_msgs/OccupancyGrid → costmap_2d → NavFn (A*)

No Django imports — pure Python + numpy + scipy.
"""

import heapq
import math

import numpy as np
from scipy.ndimage import binary_dilation, distance_transform_edt, generate_binary_structure


# ---------------------------------------------------------------------------
# Coordinate conversions
# ---------------------------------------------------------------------------

def world_to_cell(x, y, origin, resolution):
    """Convert world (SLAM metres) to grid cell (row, col)."""
    col = int(round((x - origin[0]) / resolution))
    row = int(round((y - origin[1]) / resolution))
    return row, col


def cell_to_world(row, col, origin, resolution):
    """Convert grid cell (row, col) to world (SLAM metres)."""
    x = origin[0] + col * resolution
    y = origin[1] + row * resolution
    return x, y


# ---------------------------------------------------------------------------
# OccupancyGrid  (mirrors nav_msgs/OccupancyGrid)
# ---------------------------------------------------------------------------

class OccupancyGrid:
    """Binary occupancy grid from heatmap density data.

    Values: True = occupied (wall/rock), False = free space.
    Convention: grid[row][col], row = Y axis, col = X axis.
    Origin is at (x_min, y_min) = bottom-left in world space.
    """

    def __init__(self, heatmap_data, origin, resolution, width, height,
                 threshold=0.05):
        """Build occupancy grid from heatmap density array.

        Args:
            heatmap_data: 2D list/array of floats [0,1], shape [height][width].
            origin: [x_min, y_min] in world metres.
            resolution: metres per cell.
            width: number of columns (X).
            height: number of rows (Y).
            threshold: density values > threshold are considered occupied.
        """
        self.origin = np.array(origin, dtype=np.float64)
        self.resolution = float(resolution)
        self.width = int(width)
        self.height = int(height)

        density = np.array(heatmap_data, dtype=np.float64)
        # Occupied = density ABOVE threshold (walls/rock have high point density)
        # Free = density below threshold OR zero (open passage)
        # But wait — in the heatmap, HIGH density = lots of LiDAR points = wall surface.
        # FREE space has ZERO or very low density (the laser passes through it).
        # So: occupied WHERE density > threshold.
        self.grid = density > threshold

        # Also mark cells with zero density that are outside the scanned area
        # as unknown/occupied (conservative — can't route through unscanned space).
        # The trajectory tells us where the device actually went = definitely free.
        self._raw_density = density

    def mark_trajectory_free(self, trajectory, radius_cells=2):
        """Mark cells near the trajectory as definitely free.

        The device walked through these cells, so they must be passable.
        This handles cases where the heatmap has some density along the path
        (e.g. from floor reflections) that would otherwise be marked occupied.
        """
        for x, y in trajectory:
            r, c = world_to_cell(x, y, self.origin, self.resolution)
            r_min = max(0, r - radius_cells)
            r_max = min(self.height, r + radius_cells + 1)
            c_min = max(0, c - radius_cells)
            c_max = min(self.width, c + radius_cells + 1)
            self.grid[r_min:r_max, c_min:c_max] = False

    def in_bounds(self, row, col):
        return 0 <= row < self.height and 0 <= col < self.width

    def is_free(self, row, col):
        return self.in_bounds(row, col) and not self.grid[row, col]


# ---------------------------------------------------------------------------
# Costmap  (mirrors ROS costmap_2d)
# ---------------------------------------------------------------------------

class Costmap:
    """Costmap with inflation layer and distance-based traversal costs.

    Higher cost near walls, lower cost in open passages.
    Lethal cells (occupied + inflated buffer) have cost = infinity.
    """

    def __init__(self, occupancy_grid, inflation_radius_m=0.08,
                 trajectory=None):
        """Build costmap from occupancy grid.

        Two cost layers (mirrors ROS costmap_2d with custom plugins):
        1. Wall proximity: higher cost near walls, inf on occupied/inflated cells
        2. Trajectory proximity: MUCH higher cost far from the device's walked path.
           This keeps routes on mapped corridors and prevents cutting through
           unscanned open space.

        Args:
            occupancy_grid: OccupancyGrid instance.
            inflation_radius_m: buffer around obstacles in metres (default 0.08m = 1 cell).
            trajectory: optional list of [x, y] world coords — the device's actual path.
        """
        self.occ = occupancy_grid
        self.resolution = occupancy_grid.resolution
        self.origin = occupancy_grid.origin
        self.height = occupancy_grid.height
        self.width = occupancy_grid.width

        inflation_cells = max(1, int(round(inflation_radius_m / self.resolution)))

        # Inflate obstacles
        struct = generate_binary_structure(2, 2)  # 8-connected
        inflated = binary_dilation(
            occupancy_grid.grid,
            structure=struct,
            iterations=inflation_cells
        )

        # Protect trajectory cells from inflation — the device walked here,
        # so these cells MUST be traversable regardless of inflation
        if trajectory:
            for x, y in trajectory:
                r, c = world_to_cell(x, y, self.origin, self.resolution)
                r_min = max(0, r - 2)
                r_max = min(self.height, r + 3)
                c_min = max(0, c - 2)
                c_max = min(self.width, c + 3)
                inflated[r_min:r_max, c_min:c_max] = False

        # Distance transform on free space (distance to nearest wall)
        free_mask = ~occupancy_grid.grid
        wall_dist = distance_transform_edt(free_mask) * self.resolution  # metres

        # --- Trajectory proximity layer ---
        # Build a binary mask of trajectory cells, then distance transform
        # to get "distance from nearest trajectory point" for every cell.
        traj_mask = np.zeros((self.height, self.width), dtype=bool)
        if trajectory:
            for x, y in trajectory:
                r, c = world_to_cell(x, y, self.origin, self.resolution)
                # Mark a small corridor around each trajectory point
                r_min = max(0, r - 1)
                r_max = min(self.height, r + 2)
                c_min = max(0, c - 1)
                c_max = min(self.width, c + 2)
                traj_mask[r_min:r_max, c_min:c_max] = True

        # Distance from trajectory in metres
        traj_dist = distance_transform_edt(~traj_mask) * self.resolution

        # --- Build combined cost array ---
        self.cost = np.full((self.height, self.width), np.inf, dtype=np.float64)

        free_cells = ~inflated

        # Layer 1: Wall proximity cost (1.0 far from walls, up to 5.0 near walls)
        wall_penalty = np.where(
            wall_dist[free_cells] > 0,
            1.0 + 4.0 * np.exp(-wall_dist[free_cells] / 0.3),
            1.0
        )

        # Layer 2: Trajectory proximity cost
        # On trajectory (dist=0): cost multiplier = 1.0
        # 0.5m away: ~3x cost
        # 1m away: ~10x cost
        # 2m+ away: ~50x cost (strongly discourages leaving mapped corridors)
        traj_penalty = 1.0 + 50.0 * (1.0 - np.exp(-traj_dist[free_cells] / 0.5))

        self.cost[free_cells] = wall_penalty * traj_penalty

        # Store distance fields for junction detection
        self.distance_field = wall_dist
        self.traj_distance = traj_dist

    def is_traversable(self, row, col):
        return (0 <= row < self.height and 0 <= col < self.width
                and not np.isinf(self.cost[row, col]))


# ---------------------------------------------------------------------------
# A* Pathfinding
# ---------------------------------------------------------------------------

# 8-connected neighbors: (drow, dcol, step_distance)
_NEIGHBORS = [
    (-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),       # cardinal
    (-1, -1, 1.414), (-1, 1, 1.414), (1, -1, 1.414), (1, 1, 1.414)  # diagonal
]


def astar(costmap, start, goal, max_iterations=500_000):
    """A* pathfinding on the costmap grid.

    Args:
        costmap: Costmap instance.
        start: (row, col) start cell.
        goal: (row, col) goal cell.
        max_iterations: safety limit to prevent infinite loops.

    Returns:
        List of (row, col) cells from start to goal, or None if no path found.
    """
    sr, sc = start
    gr, gc = goal

    if not costmap.is_traversable(sr, sc):
        # Try to find nearest traversable cell to start
        sr, sc = _find_nearest_free(costmap, sr, sc)
        if sr is None:
            return None

    if not costmap.is_traversable(gr, gc):
        gr, gc = _find_nearest_free(costmap, gr, gc)
        if gr is None:
            return None

    def heuristic(r, c):
        return math.sqrt((r - gr) ** 2 + (c - gc) ** 2)

    # Priority queue: (f_score, counter, row, col)
    counter = 0
    open_set = [(heuristic(sr, sc), counter, sr, sc)]
    came_from = {}
    g_score = {(sr, sc): 0.0}

    iterations = 0
    while open_set and iterations < max_iterations:
        iterations += 1
        _, _, r, c = heapq.heappop(open_set)

        if (r, c) == (gr, gc):
            # Reconstruct path
            path = [(gr, gc)]
            while (r, c) in came_from:
                r, c = came_from[(r, c)]
                path.append((r, c))
            path.reverse()
            return path

        current_g = g_score.get((r, c), np.inf)
        # Skip if we already found a better path to this cell
        if current_g > g_score.get((r, c), np.inf):
            continue

        for dr, dc, step_dist in _NEIGHBORS:
            nr, nc = r + dr, c + dc
            if not costmap.is_traversable(nr, nc):
                continue

            move_cost = costmap.cost[nr, nc] * step_dist
            tentative_g = current_g + move_cost

            if tentative_g < g_score.get((nr, nc), np.inf):
                g_score[(nr, nc)] = tentative_g
                f = tentative_g + heuristic(nr, nc)
                came_from[(nr, nc)] = (r, c)
                counter += 1
                heapq.heappush(open_set, (f, counter, nr, nc))

    return None  # No path found


def _find_nearest_free(costmap, row, col, max_radius=20):
    """Find nearest traversable cell via expanding square search."""
    for r in range(1, max_radius + 1):
        for dr in range(-r, r + 1):
            for dc in range(-r, r + 1):
                if abs(dr) == r or abs(dc) == r:  # Only border cells
                    nr, nc = row + dr, col + dc
                    if costmap.is_traversable(nr, nc):
                        return nr, nc
    return None, None


# ---------------------------------------------------------------------------
# Path smoothing (Theta*-style line-of-sight shortening)
# ---------------------------------------------------------------------------

def smooth_path(path, costmap, min_clearance_cells=1):
    """Simplify path by removing unnecessary intermediate cells.

    Uses line-of-sight checks: if we can draw a straight line between
    two non-adjacent path points without hitting obstacles, skip the
    intermediate points.
    """
    if not path or len(path) <= 2:
        return path

    smoothed = [path[0]]
    i = 0

    while i < len(path) - 1:
        # Try to reach as far ahead as possible with line-of-sight
        best_j = i + 1
        for j in range(len(path) - 1, i + 1, -1):
            if _line_of_sight(costmap, path[i], path[j], min_clearance_cells):
                best_j = j
                break
        smoothed.append(path[best_j])
        i = best_j

    return smoothed


def _line_of_sight(costmap, cell_a, cell_b, min_clearance):
    """Check if straight line between two cells is clear of obstacles."""
    r0, c0 = cell_a
    r1, c1 = cell_b

    # Bresenham-style line traversal
    dr = abs(r1 - r0)
    dc = abs(c1 - c0)
    steps = max(dr, dc)
    if steps == 0:
        return True

    for step in range(steps + 1):
        t = step / steps
        r = int(round(r0 + t * (r1 - r0)))
        c = int(round(c0 + t * (c1 - c0)))
        if not costmap.is_traversable(r, c):
            return False
        # Check clearance from walls
        if min_clearance > 0 and costmap.occ.grid[
            max(0, r - min_clearance):min(costmap.height, r + min_clearance + 1),
            max(0, c - min_clearance):min(costmap.width, c + min_clearance + 1)
        ].any():
            return False

    return True


# ---------------------------------------------------------------------------
# Multi-waypoint routing
# ---------------------------------------------------------------------------

def route_through_waypoints(level_costmaps, waypoints, transitions=None):
    """Compute a full route through ordered waypoints, possibly across levels.

    Args:
        level_costmaps: dict mapping level_index → Costmap.
        waypoints: list of {slam_x, slam_y, level} dicts.
        transitions: list of {from_level, to_level, x, y} dicts (optional).

    Returns:
        {
            'path': [[x, y, level], ...],  # full path in world coords
            'segments': [{start_wp, end_wp, path, distance_m}, ...],
            'total_distance_m': float,
            'levels_used': [int, ...],
        }
        or None if routing fails.
    """
    if len(waypoints) < 2:
        return None

    all_path = []
    segments = []
    total_dist = 0.0
    levels_used = set()

    for i in range(len(waypoints) - 1):
        wp_a = waypoints[i]
        wp_b = waypoints[i + 1]
        level_a = wp_a['level']
        level_b = wp_b['level']

        if level_a == level_b:
            # Same level — direct A*
            segment = _route_same_level(
                level_costmaps[level_a], wp_a, wp_b, level_a
            )
            if segment is None:
                return None
            segments.append(segment)
            all_path.extend(segment['path'] if not all_path else segment['path'][1:])
            total_dist += segment['distance_m']
            levels_used.add(level_a)

        else:
            # Cross-level — route to transition, cross, route from transition
            if not transitions:
                return None

            # Find best transition between these levels
            trans = _find_transition(transitions, level_a, level_b)
            if trans is None:
                return None

            # Route to transition on level A
            trans_wp = {'slam_x': trans['x'], 'slam_y': trans['y'], 'level': level_a}
            seg1 = _route_same_level(level_costmaps[level_a], wp_a, trans_wp, level_a)
            if seg1 is None:
                return None

            # Route from transition on level B
            trans_wp_b = {'slam_x': trans['x'], 'slam_y': trans['y'], 'level': level_b}
            seg2 = _route_same_level(level_costmaps[level_b], trans_wp_b, wp_b, level_b)
            if seg2 is None:
                return None

            # Add transition crossing segment
            trans_seg = {
                'start_wp': i,
                'end_wp': i + 1,
                'path': [
                    [trans['x'], trans['y'], level_a],
                    [trans['x'], trans['y'], level_b],
                ],
                'distance_m': 0.0,
                'is_transition': True,
                'from_level': level_a,
                'to_level': level_b,
            }

            seg1['start_wp'] = i
            seg1['end_wp'] = 'transition'
            seg2['start_wp'] = 'transition'
            seg2['end_wp'] = i + 1

            segments.extend([seg1, trans_seg, seg2])
            all_path.extend(seg1['path'] if not all_path else seg1['path'][1:])
            all_path.extend(trans_seg['path'][1:])
            all_path.extend(seg2['path'][1:])
            total_dist += seg1['distance_m'] + seg2['distance_m']
            levels_used.update([level_a, level_b])

    return {
        'path': all_path,
        'segments': segments,
        'total_distance_m': total_dist,
        'levels_used': sorted(levels_used),
    }


def _route_same_level(costmap, wp_a, wp_b, level):
    """Route between two waypoints on the same level."""
    start = world_to_cell(
        wp_a['slam_x'], wp_a['slam_y'],
        costmap.origin, costmap.resolution
    )
    goal = world_to_cell(
        wp_b['slam_x'], wp_b['slam_y'],
        costmap.origin, costmap.resolution
    )

    path_cells = astar(costmap, start, goal)
    if path_cells is None:
        return None

    smoothed = smooth_path(path_cells, costmap)

    # Convert to world coordinates
    path_world = []
    total_dist = 0.0
    for idx, (r, c) in enumerate(smoothed):
        x, y = cell_to_world(r, c, costmap.origin, costmap.resolution)
        path_world.append([x, y, level])
        if idx > 0:
            px, py, _ = path_world[idx - 1]
            total_dist += math.sqrt((x - px) ** 2 + (y - py) ** 2)

    return {
        'path': path_world,
        'distance_m': total_dist,
    }


def _find_transition(transitions, from_level, to_level):
    """Find the transition point connecting two levels."""
    for t in transitions:
        if ((t['from_level'] == from_level and t['to_level'] == to_level) or
                (t['from_level'] == to_level and t['to_level'] == from_level)):
            return t
    return None


# ---------------------------------------------------------------------------
# Build costmaps from map_data JSON
# ---------------------------------------------------------------------------

def build_costmaps_from_map_data(map_data, inflation_radius_m=0.08,
                                 occupancy_threshold=None):
    """Build per-level costmaps from a cave's heatmap map_data JSON.

    Uses adaptive thresholding: starts at 0.15 and increases until the
    trajectory and transition points are all in the same connected component.
    Cave passages are narrow; low thresholds fragment the free space.

    Args:
        map_data: dict loaded from map_data_heatmap.json.
        inflation_radius_m: obstacle buffer in metres.
        occupancy_threshold: density values > this are walls. If None, auto-detect.

    Returns:
        dict mapping level_index → Costmap.
    """
    transitions = map_data.get('transitions', [])

    # Adaptive threshold: try progressively higher thresholds until connectivity works
    thresholds = [occupancy_threshold] if occupancy_threshold else [0.15, 0.25, 0.35, 0.5]

    for thresh in thresholds:
        costmaps = _build_costmaps_at_threshold(
            map_data, transitions, inflation_radius_m, thresh
        )
        if not costmaps:
            continue

        # Verify connectivity: trajectory endpoints and transitions must be
        # in the same connected component per level
        if _verify_connectivity(costmaps, map_data, transitions):
            return costmaps

    # Fallback: use highest threshold
    return _build_costmaps_at_threshold(
        map_data, transitions, inflation_radius_m, 0.5
    )


def _build_costmaps_at_threshold(map_data, transitions, inflation_radius_m,
                                 occupancy_threshold):
    """Build costmaps at a specific threshold."""
    costmaps = {}

    for level in map_data.get('levels', []):
        level_idx = level['index']
        hm = level.get('heatmap')
        if not hm:
            continue

        occ = OccupancyGrid(
            heatmap_data=hm['data'],
            origin=hm['origin'],
            resolution=hm['resolution'],
            width=hm['width'],
            height=hm['height'],
            threshold=occupancy_threshold,
        )

        # Mark trajectory as definitely free
        trajectory = level.get('trajectory', [])
        if trajectory:
            occ.mark_trajectory_free(trajectory, radius_cells=2)

        # Mark transition points as free on their respective levels
        for trans in transitions:
            if trans['from_level'] == level_idx or trans['to_level'] == level_idx:
                occ.mark_trajectory_free([[trans['x'], trans['y']]], radius_cells=3)

        # Build costmap — trajectory + transitions protected from inflation
        protected_points = list(trajectory)
        for trans in transitions:
            if trans['from_level'] == level_idx or trans['to_level'] == level_idx:
                protected_points.append([trans['x'], trans['y']])

        costmaps[level_idx] = Costmap(
            occ,
            inflation_radius_m=inflation_radius_m,
            trajectory=protected_points,
        )

    return costmaps


def _verify_connectivity(costmaps, map_data, transitions):
    """Check that trajectory endpoints and transitions are in the same component."""
    from scipy.ndimage import label as ndlabel

    for level in map_data.get('levels', []):
        level_idx = level['index']
        cm = costmaps.get(level_idx)
        if cm is None:
            continue

        trajectory = level.get('trajectory', [])
        if not trajectory:
            continue

        traversable = np.isfinite(cm.cost)
        labeled, _ = ndlabel(traversable)

        # Check that first and last trajectory points are in same region
        r0, c0 = world_to_cell(trajectory[0][0], trajectory[0][1],
                                cm.origin, cm.resolution)
        rn, cn = world_to_cell(trajectory[-1][0], trajectory[-1][1],
                                cm.origin, cm.resolution)

        if not (0 <= r0 < cm.height and 0 <= c0 < cm.width):
            continue
        if not (0 <= rn < cm.height and 0 <= cn < cm.width):
            continue

        region_start = labeled[r0, c0]
        region_end = labeled[rn, cn]

        if region_start == 0 or region_end == 0:
            return False
        if region_start != region_end:
            return False

        # Check transitions on this level
        for trans in transitions:
            if trans['from_level'] != level_idx and trans['to_level'] != level_idx:
                continue
            tr, tc = world_to_cell(trans['x'], trans['y'], cm.origin, cm.resolution)
            if 0 <= tr < cm.height and 0 <= tc < cm.width:
                if labeled[tr, tc] != region_start:
                    return False

    return True
