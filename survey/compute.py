"""
Survey compute engine — converts polar survey measurements to cartesian coordinates,
performs loop closure, and generates passage wall geometry from LRUD data.
"""
import math
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


def compute_lrud_walls(shots, positions, declination=0.0, unit='feet'):
    """Generate passage wall polylines from LRUD data.

    At each station, computes wall points perpendicular to the shot direction.
    Returns left_wall and right_wall as lists of (x, y) points.
    """
    if not shots or not positions:
        return [], []

    unit_scale = FEET_TO_METERS if unit == 'feet' else 1.0

    # Build station → LRUD mapping (use first shot's LRUD for each station)
    station_lrud = {}
    station_bearing = {}

    for shot in shots:
        name = shot['from_station']
        if name not in station_lrud:
            lrud = {
                'left': (shot.get('left') or 0) * unit_scale,
                'right': (shot.get('right') or 0) * unit_scale,
                'up': (shot.get('up') or 0) * unit_scale,
                'down': (shot.get('down') or 0) * unit_scale,
            }
            station_lrud[name] = lrud
            station_bearing[name] = math.radians(shot['azimuth'] + declination)

    left_wall = []
    right_wall = []

    for shot in shots:
        name = shot['from_station']
        if name not in positions or name not in station_lrud:
            continue

        x, y, _z = positions[name]
        lrud = station_lrud[name]
        bearing = station_bearing[name]

        # Perpendicular directions (left = bearing - 90, right = bearing + 90)
        perp_left = bearing - math.pi / 2
        perp_right = bearing + math.pi / 2

        if lrud['left'] > 0:
            lx = x + lrud['left'] * math.sin(perp_left)
            ly = y + lrud['left'] * math.cos(perp_left)
            left_wall.append([round(lx, 4), round(ly, 4)])

        if lrud['right'] > 0:
            rx = x + lrud['right'] * math.sin(perp_right)
            ry = y + lrud['right'] * math.cos(perp_right)
            right_wall.append([round(rx, 4), round(ry, 4)])

    return left_wall, right_wall


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
            'walls_left': [],
            'walls_right': [],
            'bounds': [0, 0, 0, 0],
            'total_length': 0,
            'total_depth': 0,
            'loops_closed': 0,
            'closure_errors': [],
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

    # Compute LRUD walls
    left_wall, right_wall = compute_lrud_walls(shots, positions, decl, unit)

    # Build centerline segments
    centerline = []
    for shot in shots:
        fn = shot['from_station']
        tn = shot['to_station']
        if fn in positions and tn in positions:
            fx, fy, _ = positions[fn]
            tx, ty, _ = positions[tn]
            centerline.append([[round(fx, 4), round(fy, 4)], [round(tx, 4), round(ty, 4)]])

    # Build station list
    station_list = []
    for name, (x, y, z) in positions.items():
        station_list.append({
            'name': name,
            'x': round(x, 4),
            'y': round(y, 4),
            'z': round(z, 4),
        })

    # Compute bounds
    all_x = [s['x'] for s in station_list]
    all_y = [s['y'] for s in station_list]
    # Include wall points in bounds
    for pt in left_wall + right_wall:
        all_x.append(pt[0])
        all_y.append(pt[1])

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
        'walls_left': left_wall,
        'walls_right': right_wall,
        'bounds': [round(b, 4) for b in bounds],
        'total_length': round(total_length, 2),
        'total_depth': round(total_depth, 2),
        'loops_closed': len(closure_errors),
        'closure_errors': closure_errors,
    }
