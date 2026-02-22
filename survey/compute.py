"""
Survey compute engine — converts polar survey measurements to cartesian coordinates,
performs loop closure, generates passage wall geometry from LRUD data, and detects
survey branches for visualization.
"""
import math
import re
from collections import defaultdict, deque


FEET_TO_METERS = 0.3048


def polar_to_cartesian(distance, azimuth_deg, inclination_deg):
    """Convert a survey shot (distance, azimuth, inclination) to dx, dy, dz in meters.

    Convention:
        x = East   (positive)
        y = North  (positive)
        z = Up     (positive)
    """
    az = math.radians(azimuth_deg)
    inc = math.radians(inclination_deg)
    horiz = distance * math.cos(inc)
    dx = horiz * math.sin(az)
    dy = horiz * math.cos(az)
    dz = distance * math.sin(inc)
    return dx, dy, dz


def build_shot_graph(shots):
    """Build adjacency list from shots. Returns dict: station_name -> [(neighbor, shot_data), ...]"""
    graph = defaultdict(list)
    for shot in shots:
        graph[shot['from_station']].append((shot['to_station'], shot))
        # Add reverse edge for traversal (reverse azimuth + inclination)
        reverse = dict(shot)
        reverse['azimuth'] = (shot['azimuth'] + 180) % 360
        reverse['inclination'] = -shot['inclination']
        graph[shot['to_station']].append((shot['from_station'], reverse))
    return graph


def compute_station_positions(shots, declination=0.0, unit='feet'):
    """Compute station XYZ positions from survey shots using BFS traversal.

    Args:
        shots: list of dicts with keys: from_station, to_station, distance, azimuth, inclination
        declination: magnetic declination correction (degrees, added to azimuth)
        unit: 'feet' or 'meters'

    Returns:
        dict: station_name -> (x, y, z) in meters
    """
    if not shots:
        return {}

    unit_scale = FEET_TO_METERS if unit == 'feet' else 1.0
    graph = build_shot_graph(shots)

    # Find the first station mentioned
    origin = shots[0]['from_station']

    positions = {origin: (0.0, 0.0, 0.0)}
    visited = {origin}
    queue = deque([origin])

    # Track which shots were used in BFS (non-loop shots)
    bfs_parent = {origin: None}

    while queue:
        current = queue.popleft()
        cx, cy, cz = positions[current]

        for neighbor, shot in graph[current]:
            if neighbor in visited:
                continue

            dist = shot['distance'] * unit_scale
            az = shot['azimuth'] + declination
            inc = shot['inclination']

            dx, dy, dz = polar_to_cartesian(dist, az, inc)
            positions[neighbor] = (cx + dx, cy + dy, cz + dz)
            visited.add(neighbor)
            bfs_parent[neighbor] = current
            queue.append(neighbor)

    return positions


def detect_loops(shots, positions, declination=0.0, unit='feet'):
    """Detect survey loops and return closure errors.

    A loop exists when a shot connects two stations that both already have
    computed positions. Returns list of loop info dicts.
    """
    if not shots or not positions:
        return []

    unit_scale = FEET_TO_METERS if unit == 'feet' else 1.0
    graph = build_shot_graph(shots)
    loops = []

    visited = set()
    origin = shots[0]['from_station']
    visited.add(origin)
    queue = deque([origin])

    # BFS again, but this time track loop-closing shots
    bfs_visited_order = [origin]

    while queue:
        current = queue.popleft()

        for neighbor, shot in graph[current]:
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
                bfs_visited_order.append(neighbor)
            elif neighbor in positions and current in positions:
                # This edge closes a loop — compute error
                dist = shot['distance'] * unit_scale
                az = shot['azimuth'] + declination
                inc = shot['inclination']
                dx, dy, dz = polar_to_cartesian(dist, az, inc)

                cx, cy, cz = positions[current]
                expected = (cx + dx, cy + dy, cz + dz)
                actual = positions[neighbor]

                err_x = expected[0] - actual[0]
                err_y = expected[1] - actual[1]
                err_z = expected[2] - actual[2]
                err_total = math.sqrt(err_x**2 + err_y**2 + err_z**2)

                loops.append({
                    'from': current,
                    'to': neighbor,
                    'error_x': round(err_x, 4),
                    'error_y': round(err_y, 4),
                    'error_z': round(err_z, 4),
                    'error_m': round(err_total, 4),
                })

    return loops


def apply_loop_closure(shots, positions, declination=0.0, unit='feet'):
    """Apply basic proportional loop closure.

    For each detected loop, distributes the closure error proportionally
    along the shot path by cumulative distance.
    """
    unit_scale = FEET_TO_METERS if unit == 'feet' else 1.0
    graph = build_shot_graph(shots)
    loops = detect_loops(shots, positions, declination, unit)

    if not loops:
        return positions, loops

    # For each loop, find the path and distribute error
    for loop_info in loops:
        target = loop_info['to']
        source = loop_info['from']

        # BFS to find path from origin to source
        origin = shots[0]['from_station']
        parent = {origin: None}
        q = deque([origin])
        found = False

        while q and not found:
            node = q.popleft()
            for neighbor, shot in graph[node]:
                if neighbor not in parent:
                    parent[neighbor] = (node, shot)
                    q.append(neighbor)
                    if neighbor == source:
                        found = True
                        break

        if not found:
            continue

        # Reconstruct path from origin to source
        path = []
        node = source
        while parent.get(node) is not None:
            prev_node, shot = parent[node]
            path.append((prev_node, node, shot))
            node = prev_node
        path.reverse()

        if not path:
            continue

        # Compute cumulative distances along the path
        cum_dist = []
        total = 0.0
        for prev, curr, shot in path:
            total += shot['distance'] * unit_scale
            cum_dist.append(total)

        if total == 0:
            continue

        # Distribute error proportionally
        err_x = loop_info['error_x']
        err_y = loop_info['error_y']
        err_z = loop_info['error_z']

        for i, (prev, curr, shot) in enumerate(path):
            fraction = cum_dist[i] / total
            x, y, z = positions[curr]
            positions[curr] = (
                x - err_x * fraction,
                y - err_y * fraction,
                z - err_z * fraction,
            )

    return positions, loops


def compute_passage_widths(shots, positions, declination=0.0, unit='feet', branch_info=None):
    """Compute passage width at each station for stroke-based rendering.

    Instead of computing polygon geometry, returns per-shot stroke data:
    each shot gets a from/to coordinate pair with passage widths (L+R) at each endpoint.
    The frontend renders these as thick variable-width strokes on an offscreen canvas,
    composited at low opacity — overlaps at junctions merge naturally.

    Returns list of dicts: {from: [x,y], to: [x,y], from_width: float, to_width: float, branch: int}
    """
    if not shots or not positions:
        return []

    unit_scale = FEET_TO_METERS if unit == 'feet' else 1.0

    # Build station → total passage width (L+R) mapping
    station_width = {}
    for shot in shots:
        name = shot['from_station']
        if name not in station_width:
            left = (shot.get('left') or 0) * unit_scale
            right = (shot.get('right') or 0) * unit_scale
            station_width[name] = left + right

    # Fallback: to_stations inherit from_station's width
    for shot in shots:
        to_name = shot['to_station']
        if to_name not in station_width:
            from_name = shot['from_station']
            if from_name in station_width:
                station_width[to_name] = station_width[from_name]

    # Build branch lookup
    station_branch_map = {}
    if branch_info and branch_info.get('station_branches'):
        station_branch_map = branch_info['station_branches']

    # Emit one stroke per shot
    strokes = []
    for shot in shots:
        fn, tn = shot['from_station'], shot['to_station']
        if fn not in positions or tn not in positions:
            continue

        fx, fy, _ = positions[fn]
        tx, ty, _ = positions[tn]
        fw = station_width.get(fn, 0)
        tw = station_width.get(tn, 0)

        strokes.append({
            'from': [round(fx, 4), round(fy, 4)],
            'to': [round(tx, 4), round(ty, 4)],
            'from_width': round(fw, 4),
            'to_width': round(tw, 4),
            'branch': station_branch_map.get(fn, 0),
        })

    return strokes


def _extract_prefix(name):
    """Extract the letter prefix from a station name (e.g., 'a4' -> 'A', 'B1' -> 'B')."""
    match = re.match(r'^([A-Za-z]+)', name)
    return match.group(1).upper() if match else ''


def detect_branches(shots, positions):
    """Detect survey branches from shot entry order.

    Builds a tree by processing shots in the order they were entered. This
    correctly follows the user's intended survey path and identifies loop
    closures (shots where both endpoints are already in the tree). At junctions,
    uses station name prefixes to determine which child continues the current
    branch vs starts a new one.

    Returns:
        dict with keys: branches, station_branches, junction_stations, loop_closures
    """
    if not shots or not positions:
        return {
            'branches': [], 'station_branches': {},
            'junction_stations': [], 'loop_closures': [],
        }

    origin = shots[0]['from_station']

    # Build tree from shot order (not BFS). This avoids the problem where
    # a loop-closure shot (e.g., b3→a) creates a reverse BFS edge (a→b3)
    # that gets traversed before the forward path (a3→b→b1→b2→b3).
    in_tree = {origin}
    children = defaultdict(list)
    loop_closures = []

    remaining = list(shots)
    for _ in range(len(shots) + 1):
        still_remaining = []
        progress = False

        for shot in remaining:
            fn, tn = shot['from_station'], shot['to_station']
            fn_in = fn in in_tree and fn in positions
            tn_in = tn in in_tree and tn in positions

            if fn_in and tn_in:
                # Both already in tree — loop closure shot
                loop_closures.append({'from': fn, 'to': tn})
                progress = True
            elif fn_in and tn in positions:
                # Forward: add to_station as child of from_station
                children[fn].append(tn)
                in_tree.add(tn)
                progress = True
            elif tn_in and fn in positions:
                # Reverse: add from_station as child of to_station
                children[tn].append(fn)
                in_tree.add(fn)
                progress = True
            else:
                # Neither endpoint in tree yet — defer to next pass
                still_remaining.append(shot)

        remaining = still_remaining
        if not remaining or not progress:
            break

    # Identify junctions (stations with 2+ children)
    junction_stations = [s for s in children if len(children[s]) >= 2]

    # Walk the tree to assign branches
    branches = []
    station_branch_map = {}
    branch_id_counter = [0]

    def walk_branch(start, branch_id, parent_station, parent_branch):
        branch_prefix = _extract_prefix(start)
        branch_stations = [start]
        station_branch_map[start] = branch_id
        current = start

        while True:
            kids = children.get(current, [])
            if not kids:
                break

            # At junctions, prefer child whose prefix matches the branch
            if len(kids) > 1:
                kids = sorted(kids, key=lambda child: (
                    0 if _extract_prefix(child) == branch_prefix else 1,
                ))

            # First child (prefix-matching preferred) continues this branch
            first_child = kids[0]
            branch_stations.append(first_child)
            station_branch_map[first_child] = branch_id

            # Additional children start new branches
            for extra_child in kids[1:]:
                branch_id_counter[0] += 1
                new_id = branch_id_counter[0]
                walk_branch(extra_child, new_id, current, branch_id)

            current = first_child

        # Name sub-branches by their station prefix
        if branch_id == 0:
            name = 'Main'
        else:
            prefix = _extract_prefix(start)
            name = prefix if prefix else (
                chr(64 + branch_id) if branch_id <= 26 else f'Br{branch_id}'
            )

        branches.append({
            'id': branch_id,
            'name': name,
            'stations': branch_stations,
            'parent_station': parent_station,
            'parent_branch': parent_branch,
        })

    walk_branch(origin, 0, None, None)

    # Sort branches by id
    branches.sort(key=lambda b: b['id'])

    return {
        'branches': branches,
        'station_branches': station_branch_map,
        'junction_stations': junction_stations,
        'loop_closures': loop_closures,
    }


def suggest_branch_prefix(station_names):
    """Suggest next unused letter prefix for a new branch station name."""
    used = set()
    for name in station_names:
        match = re.match(r'^([A-Za-z]+)', name)
        if match:
            used.add(match.group(1).upper())
    for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
        if c not in used:
            return c
    return 'AA'


def compute_survey(survey_obj):
    """Full computation pipeline for a CaveSurvey.

    1. Reads shots from DB
    2. Computes station positions
    3. Applies loop closure
    4. Generates LRUD walls
    5. Updates station records + survey summary
    6. Returns render data dict

    Args:
        survey_obj: CaveSurvey model instance

    Returns:
        dict with render data (stations, centerline, walls, bounds, stats)
    """
    from .models import SurveyShot, SurveyStation

    db_shots = SurveyShot.objects.filter(survey=survey_obj).select_related(
        'from_station', 'to_station',
    ).order_by('shot_order')

    shots = []
    for s in db_shots:
        shots.append({
            'from_station': s.from_station.name,
            'to_station': s.to_station.name,
            'distance': s.distance,
            'azimuth': s.azimuth,
            'inclination': s.inclination,
            'left': s.left,
            'right': s.right,
            'up': s.up,
            'down': s.down,
        })

    if not shots:
        return {
            'stations': [],
            'centerline': [],
            'passage_strokes': [],
            'wall_segments': [],
            'bounds': [0, 0, 0, 0],
            'total_length': 0,
            'total_depth': 0,
            'loops_closed': 0,
            'closure_errors': [],
            'branches': [],
            'station_branches': {},
            'junction_stations': [],
            'loop_closures': [],
            'next_branch_prefix': 'A',
        }

    decl = survey_obj.declination
    unit = survey_obj.unit

    # Compute positions
    positions = compute_station_positions(shots, decl, unit)

    # Apply loop closure
    positions, closure_errors = apply_loop_closure(shots, positions, decl, unit)

    # Update station records in DB
    for station in SurveyStation.objects.filter(survey=survey_obj):
        if station.name in positions:
            station.x, station.y, station.z = positions[station.name]
            station.save(update_fields=['x', 'y', 'z'])

    # Detect branches
    branch_info = detect_branches(shots, positions)
    station_branch_map = branch_info['station_branches']
    junction_stations = set(branch_info['junction_stations'])

    # Compute passage width strokes for rendering
    passage_strokes = compute_passage_widths(shots, positions, decl, unit, branch_info)

    # Build centerline segments (with branch_id as third element)
    centerline = []
    for shot in shots:
        fn = shot['from_station']
        tn = shot['to_station']
        if fn in positions and tn in positions:
            fx, fy, _ = positions[fn]
            tx, ty, _ = positions[tn]
            branch_id = station_branch_map.get(fn, 0)
            centerline.append([[round(fx, 4), round(fy, 4)], [round(tx, 4), round(ty, 4)], branch_id])

    # Build station list (with branch and junction info)
    station_list = []
    for name, (x, y, z) in positions.items():
        station_list.append({
            'name': name,
            'x': round(x, 4),
            'y': round(y, 4),
            'z': round(z, 4),
            'branch': station_branch_map.get(name, 0),
            'is_junction': name in junction_stations,
        })

    # Compute bounds (expand by max passage width at each station)
    all_x = [s['x'] for s in station_list]
    all_y = [s['y'] for s in station_list]
    for stroke in passage_strokes:
        max_w = max(stroke['from_width'], stroke['to_width']) / 2
        all_x.extend([stroke['from'][0] - max_w, stroke['from'][0] + max_w,
                       stroke['to'][0] - max_w, stroke['to'][0] + max_w])
        all_y.extend([stroke['from'][1] - max_w, stroke['from'][1] + max_w,
                       stroke['to'][1] - max_w, stroke['to'][1] + max_w])

    bounds = [min(all_x), min(all_y), max(all_x), max(all_y)] if all_x else [0, 0, 0, 0]

    # Compute summary stats
    unit_scale = FEET_TO_METERS if unit == 'feet' else 1.0
    total_length = sum(s['distance'] * unit_scale for s in shots)
    all_z = [s['z'] for s in station_list]
    total_depth = (max(all_z) - min(all_z)) if all_z else 0

    # Update survey summary
    survey_obj.total_length = round(total_length, 2)
    survey_obj.total_depth = round(total_depth, 2)
    survey_obj.station_count = len(positions)
    survey_obj.save(update_fields=['total_length', 'total_depth', 'station_count'])

    return {
        'stations': station_list,
        'centerline': centerline,
        'passage_strokes': passage_strokes,
        'wall_segments': [],  # deprecated — kept for compat
        'bounds': [round(b, 4) for b in bounds],
        'total_length': round(total_length, 2),
        'total_depth': round(total_depth, 2),
        'loops_closed': len(closure_errors),
        'closure_errors': closure_errors,
        'branches': branch_info['branches'],
        'station_branches': branch_info['station_branches'],
        'junction_stations': branch_info['junction_stations'],
        'loop_closures': branch_info['loop_closures'],
        'next_branch_prefix': suggest_branch_prefix(list(positions.keys())),
    }
