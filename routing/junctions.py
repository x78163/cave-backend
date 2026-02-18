"""Medial axis junction detection for cave maps.

Uses distance transform + ridge detection to find the skeleton (medial axis)
of cave passages, then identifies branch points as junctions.

This mirrors ROS topology extraction from occupancy grids.
"""

import math

import numpy as np
from scipy.ndimage import distance_transform_edt, label, maximum_filter

from .engine import cell_to_world


def detect_junctions(occupancy_grid, costmap=None, min_passage_width_m=0.2):
    """Detect passage junctions from cave occupancy grid.

    Algorithm:
    1. Distance transform on free space → distance-to-nearest-wall per cell
    2. Ridge detection: cells that are local maxima of the distance field
       (these form the medial axis / skeleton of passages)
    3. Branch points: skeleton cells with 3+ skeleton neighbors
    4. Cluster nearby branch points into junction locations
    5. Compute passage angles at each junction

    Args:
        occupancy_grid: OccupancyGrid instance.
        costmap: Optional Costmap (used for pre-computed distance field).
        min_passage_width_m: minimum passage width to consider (filters noise).

    Returns:
        List of junction dicts:
        {
            'slam_x': float, 'slam_y': float,
            'num_passages': int,
            'passage_angles': [float, ...],  # radians, 0 = +X axis
            'junction_type': str,  # 'fork', 't_junction', 'crossroads'
            'cell': (row, col),
        }
    """
    grid = occupancy_grid.grid  # True = occupied
    res = occupancy_grid.resolution
    origin = occupancy_grid.origin

    # Step 1: distance transform
    free_mask = ~grid
    if costmap is not None and hasattr(costmap, 'distance_field'):
        dist = costmap.distance_field / res  # convert back to cells
    else:
        dist = distance_transform_edt(free_mask)  # in cells

    min_width_cells = min_passage_width_m / res

    # Step 2: ridge detection — find medial axis via local maxima
    # A cell is on the medial axis if it's a local maximum in at least one
    # direction (not necessarily all directions — ridges are 1D maxima in 2D)
    skeleton = _extract_skeleton(free_mask, dist, min_width_cells)

    if not skeleton.any():
        return []

    # Step 3: find branch points (3+ skeleton neighbors)
    branch_points = _find_branch_points(skeleton)

    if not branch_points:
        return []

    # Step 4: cluster nearby branch points
    clusters = _cluster_points(branch_points, radius_cells=4)

    # Step 5: compute passage angles at each cluster center
    junctions = []
    for center_r, center_c in clusters:
        if not free_mask[center_r, center_c]:
            continue

        angles = _compute_passage_angles(skeleton, center_r, center_c,
                                         search_radius=8)
        if len(angles) < 2:
            continue

        x, y = cell_to_world(center_r, center_c, origin, res)

        jtype = _classify_junction(len(angles), angles)

        junctions.append({
            'slam_x': round(x, 3),
            'slam_y': round(y, 3),
            'num_passages': len(angles),
            'passage_angles': [round(a, 3) for a in angles],
            'junction_type': jtype,
            'cell': (int(center_r), int(center_c)),
        })

    return junctions


def _extract_skeleton(free_mask, dist, min_width_cells):
    """Extract medial axis skeleton via ridge detection on distance field.

    A cell is a ridge point if it's a local maximum of the distance field
    compared to neighbors in at least one perpendicular direction.
    """
    h, w = free_mask.shape
    skeleton = np.zeros_like(free_mask, dtype=bool)

    # Only consider cells that are free and have meaningful passage width
    candidates = free_mask & (dist >= max(1.0, min_width_cells * 0.5))

    # Check 4 perpendicular direction pairs
    # If a cell is a local max in any perpendicular pair, it's on the ridge
    pairs = [
        ((-1, 0), (1, 0)),   # vertical pair
        ((0, -1), (0, 1)),   # horizontal pair
        ((-1, -1), (1, 1)),  # diagonal pair 1
        ((-1, 1), (1, -1)),  # diagonal pair 2
    ]

    for (dr1, dc1), (dr2, dc2) in pairs:
        # Shift distance field in both directions
        d_center = dist[1:-1, 1:-1]
        d_a = dist[1 + dr1:h - 1 + dr1, 1 + dc1:w - 1 + dc1]
        d_b = dist[1 + dr2:h - 1 + dr2, 1 + dc2:w - 1 + dc2]

        # Ridge: center >= both neighbors in this direction
        ridge = (d_center >= d_a) & (d_center >= d_b)
        skeleton[1:-1, 1:-1] |= ridge & candidates[1:-1, 1:-1]

    # Thin the skeleton: iterative removal of cells that don't break topology
    skeleton = _thin_skeleton(skeleton, max_iterations=5)

    return skeleton


def _thin_skeleton(skeleton, max_iterations=5):
    """Simple skeleton thinning — remove cells whose removal doesn't
    disconnect the skeleton.
    """
    for _ in range(max_iterations):
        changed = False
        border = skeleton.copy()

        for r in range(1, skeleton.shape[0] - 1):
            for c in range(1, skeleton.shape[1] - 1):
                if not skeleton[r, c]:
                    continue

                # Count skeleton neighbors
                neighbors = skeleton[r-1:r+2, c-1:c+2].copy()
                neighbors[1, 1] = False
                n_count = neighbors.sum()

                # Keep endpoints (1 neighbor) and junctions (3+ neighbors)
                if n_count <= 1 or n_count >= 3:
                    continue

                # For 2-neighbor cells, check if removal disconnects
                # Simple check: if both neighbors are also neighbors of
                # each other, we can safely remove this cell
                # (but this is conservative — just keep most 2-neighbor cells)
                if n_count == 2:
                    # Only remove if this is a "corner" cell (neighbors are
                    # perpendicular, not collinear)
                    nb_positions = []
                    for dr in range(-1, 2):
                        for dc in range(-1, 2):
                            if (dr, dc) != (0, 0) and skeleton[r + dr, c + dc]:
                                nb_positions.append((dr, dc))
                    if len(nb_positions) == 2:
                        (dr1, dc1), (dr2, dc2) = nb_positions
                        # Collinear check
                        if dr1 + dr2 == 0 and dc1 + dc2 == 0:
                            continue  # Collinear — keep
                    # Mark for removal
                    border[r, c] = False
                    changed = True

        skeleton = border
        if not changed:
            break

    return skeleton


def _find_branch_points(skeleton):
    """Find cells with 3+ skeleton neighbors (junction candidates)."""
    points = []
    h, w = skeleton.shape

    for r in range(1, h - 1):
        for c in range(1, w - 1):
            if not skeleton[r, c]:
                continue

            count = 0
            for dr in range(-1, 2):
                for dc in range(-1, 2):
                    if (dr, dc) != (0, 0) and skeleton[r + dr, c + dc]:
                        count += 1

            if count >= 3:
                points.append((r, c))

    return points


def _cluster_points(points, radius_cells=4):
    """Cluster nearby points into single junction locations."""
    if not points:
        return []

    used = [False] * len(points)
    clusters = []

    for i, (r, c) in enumerate(points):
        if used[i]:
            continue

        cluster = [(r, c)]
        used[i] = True

        for j in range(i + 1, len(points)):
            if used[j]:
                continue
            r2, c2 = points[j]
            if abs(r2 - r) <= radius_cells and abs(c2 - c) <= radius_cells:
                cluster.append((r2, c2))
                used[j] = True

        # Cluster center = mean position
        mean_r = int(round(sum(p[0] for p in cluster) / len(cluster)))
        mean_c = int(round(sum(p[1] for p in cluster) / len(cluster)))
        clusters.append((mean_r, mean_c))

    return clusters


def _compute_passage_angles(skeleton, center_r, center_c, search_radius=8):
    """Compute the angles of passages radiating from a junction point.

    Walk outward from the junction along skeleton branches and measure
    the angle of each branch.
    """
    h, w = skeleton.shape

    # Collect skeleton cells in a ring around the center
    ring_cells = []
    for r in range(max(0, center_r - search_radius),
                   min(h, center_r + search_radius + 1)):
        for c in range(max(0, center_c - search_radius),
                       min(w, center_c + search_radius + 1)):
            if not skeleton[r, c]:
                continue
            dist = math.sqrt((r - center_r) ** 2 + (c - center_c) ** 2)
            if search_radius * 0.5 <= dist <= search_radius:
                angle = math.atan2(r - center_r, c - center_c)
                ring_cells.append(angle)

    if not ring_cells:
        return []

    # Cluster angles into passage groups (passages separated by >45 deg gaps)
    ring_cells.sort()
    passages = []
    current_group = [ring_cells[0]]

    for i in range(1, len(ring_cells)):
        gap = ring_cells[i] - ring_cells[i - 1]
        if gap > math.pi / 4:  # >45 deg gap = new passage
            passages.append(current_group)
            current_group = [ring_cells[i]]
        else:
            current_group.append(ring_cells[i])

    # Check wrap-around gap
    if len(passages) > 0:
        wrap_gap = (2 * math.pi) - (ring_cells[-1] - ring_cells[0])
        if wrap_gap > math.pi / 4:
            passages.append(current_group)
        else:
            # Merge last group with first
            passages[0] = current_group + passages[0]
    else:
        passages.append(current_group)

    # Average angle per passage
    passage_angles = []
    for group in passages:
        avg = sum(group) / len(group)
        passage_angles.append(avg)

    return passage_angles


def _classify_junction(num_passages, angles):
    """Classify junction type based on passage count and angles."""
    if num_passages == 2:
        # Check if it's a sharp fork vs gentle curve
        diff = abs(angles[1] - angles[0])
        if diff < math.pi / 3:
            return 'fork'
        return 'bend'
    elif num_passages == 3:
        return 't_junction'
    elif num_passages == 4:
        return 'crossroads'
    else:
        return f'junction_{num_passages}'
