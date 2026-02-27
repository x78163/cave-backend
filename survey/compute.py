"""
Survey compute engine — converts polar survey measurements to cartesian coordinates,
performs loop closure, generates passage wall geometry from LRUD data, and detects
survey branches for visualization.
"""
import math
import re
from collections import defaultdict, deque


FEET_TO_METERS = 0.3048

# Bezier curve subdivision for smooth passage walls
BEZIER_SUBDIVISIONS = 6  # segments per Catmull-Rom span


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


def compute_passage_widths(shots, positions, declination=0.0, unit='feet', branch_info=None, level_info=None):
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

        stroke = {
            'from': [round(fx, 4), round(fy, 4)],
            'to': [round(tx, 4), round(ty, 4)],
            'from_width': round(fw, 4),
            'to_width': round(tw, 4),
            'branch': station_branch_map.get(fn, 0),
        }
        if level_info:
            stroke['is_lower'] = level_info.get(fn, False)
        strokes.append(stroke)

    return strokes


def _catmull_rom_to_bezier(points, subdivisions=BEZIER_SUBDIVISIONS):
    """Convert a polyline to Catmull-Rom cubic Bezier curves.

    Returns two lists:
      smooth_pts: densified polyline for polygon fills (list of [x,y])
      bezier_segs: list of [p0, cp1, cp2, p1] for Canvas/SVG bezierCurveTo

    Uses the standard Catmull-Rom → cubic Bezier conversion:
      For points P0,P1,P2,P3, the Bezier control points for segment P1→P2 are:
        CP1 = P1 + (P2 - P0) / 6
        CP2 = P2 - (P3 - P1) / 6
    """
    n = len(points)
    if n < 2:
        return points[:], []
    if n == 2:
        return points[:], []

    bezier_segs = []
    smooth_pts = [points[0]]

    for i in range(n - 1):
        p0 = points[max(i - 1, 0)]
        p1 = points[i]
        p2 = points[i + 1]
        p3 = points[min(i + 2, n - 1)]

        # Segment length — used to clamp tangents at sharp turns
        seg_len = math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2)
        max_tangent = seg_len * 0.33  # control points stay within 1/3 of segment

        # Raw tangent vectors (standard Catmull-Rom)
        t1x = (p2[0] - p0[0]) / 6
        t1y = (p2[1] - p0[1]) / 6
        t2x = (p3[0] - p1[0]) / 6
        t2y = (p3[1] - p1[1]) / 6

        # Clamp tangent magnitude to prevent overshoot at sharp bends
        t1_len = math.sqrt(t1x * t1x + t1y * t1y)
        if t1_len > max_tangent and t1_len > 1e-6:
            s = max_tangent / t1_len
            t1x *= s
            t1y *= s
        t2_len = math.sqrt(t2x * t2x + t2y * t2y)
        if t2_len > max_tangent and t2_len > 1e-6:
            s = max_tangent / t2_len
            t2x *= s
            t2y *= s

        cp1 = [round(p1[0] + t1x, 4), round(p1[1] + t1y, 4)]
        cp2 = [round(p2[0] - t2x, 4), round(p2[1] - t2y, 4)]

        bezier_segs.append([p1, cp1, cp2, p2])

        # Subdivide for polygon fill (de Casteljau)
        for s in range(1, subdivisions + 1):
            t = s / subdivisions
            t2 = t * t
            t3 = t2 * t
            mt = 1 - t
            mt2 = mt * mt
            mt3 = mt2 * mt
            x = mt3 * p1[0] + 3 * mt2 * t * cp1[0] + 3 * mt * t2 * cp2[0] + t3 * p2[0]
            y = mt3 * p1[1] + 3 * mt2 * t * cp1[1] + 3 * mt * t2 * cp2[1] + t3 * p2[1]
            smooth_pts.append([round(x, 4), round(y, 4)])

    return smooth_pts, bezier_segs


def compute_passage_outlines(shots, positions, unit='feet', branch_info=None, level_info=None):
    """Compute passage outline polygons using a hybrid strategy.

    1. Per-branch continuous polygons: walks each branch in station order,
       computes smoothed wall points at each station, creates a connected
       polygon with continuous left/right wall polylines. This gives smooth
       corners at bends.

    2. Per-shot quads for loop closure shots: loop closures aren't part of
       any branch, so they get individual quadrilaterals.

    Returns list of dicts:
        {polygon: [[x,y], ...], left: [[x,y], ...], right: [[x,y], ...],
         caps: [[from,to], ...], branch: int, is_lower: bool}
    """
    if not shots or not positions or not branch_info:
        return []

    unit_scale = FEET_TO_METERS if unit == 'feet' else 1.0

    # Build per-shot left/right lookup (direction-aware for junction stations)
    # shot_lr[(fn, tn)] stores the LRUD measured at fn looking toward tn
    shot_lr = {}
    for shot in shots:
        fn = shot['from_station']
        tn = shot['to_station']
        lr = {
            'left': (shot.get('left') or 0) * unit_scale,
            'right': (shot.get('right') or 0) * unit_scale,
        }
        shot_lr[(fn, tn)] = lr
        # Also store reverse so to_station inherits from_station LRUD
        if (tn, fn) not in shot_lr:
            shot_lr[(tn, fn)] = lr

    # Fallback per-station lookup (first occurrence) for stations without
    # a matching shot pair (e.g., loop closures, orphaned stations)
    station_lr = {}
    for shot in shots:
        fn = shot['from_station']
        if fn not in station_lr:
            station_lr[fn] = {
                'left': (shot.get('left') or 0) * unit_scale,
                'right': (shot.get('right') or 0) * unit_scale,
            }
    for shot in shots:
        tn = shot['to_station']
        if tn not in station_lr:
            fn = shot['from_station']
            if fn in station_lr:
                station_lr[tn] = dict(station_lr[fn])

    # Count shots per station to detect terminals
    station_shot_count = defaultdict(int)
    for shot in shots:
        fn, tn = shot['from_station'], shot['to_station']
        if fn in positions and tn in positions:
            station_shot_count[fn] += 1
            station_shot_count[tn] += 1

    outlines = []

    # --- Strategy 1: Per-branch continuous polygons ---
    for branch in branch_info.get('branches', []):
        stations = list(branch['stations'])
        # Prepend the parent (junction) station so the connecting segment
        # between the junction and the branch start gets wall geometry.
        parent = branch.get('parent_station')
        if parent and parent in positions and (not stations or stations[0] != parent):
            stations.insert(0, parent)
        valid = [s for s in stations if s in positions]
        if len(valid) < 2:
            continue

        # Split into level-consistent segments (for dashed underpass)
        if level_info:
            segments = []
            seg_stations = [valid[0]]
            seg_lower = level_info.get(valid[0], False)
            for s in valid[1:]:
                s_lower = level_info.get(s, False)
                if s_lower != seg_lower:
                    segments.append((seg_stations, seg_lower))
                    seg_stations = [seg_stations[-1], s]
                    seg_lower = s_lower
                else:
                    seg_stations.append(s)
            segments.append((seg_stations, seg_lower))
        else:
            segments = [(valid, False)]

        for seg_stations, seg_lower in segments:
            if len(seg_stations) < 2:
                continue

            left_pts = []
            right_pts = []

            for i, name in enumerate(seg_stations):
                x, y, _z = positions[name]

                bearings = []
                if i > 0:
                    px, py, _ = positions[seg_stations[i - 1]]
                    dx, dy = x - px, y - py
                    if dx * dx + dy * dy > 1e-6:
                        bearings.append(math.atan2(dx, dy))
                if i < len(seg_stations) - 1:
                    nx, ny, _ = positions[seg_stations[i + 1]]
                    dx, dy = nx - x, ny - y
                    if dx * dx + dy * dy > 1e-6:
                        bearings.append(math.atan2(dx, dy))

                if not bearings:
                    continue

                if len(bearings) == 2:
                    az = math.atan2(
                        sum(math.sin(b) for b in bearings),
                        sum(math.cos(b) for b in bearings),
                    )
                else:
                    az = bearings[0]

                lx, ly = -math.cos(az), math.sin(az)
                # Direction-aware LRUD: prefer shot connecting this station
                # to its neighbor in this branch segment
                lr = None
                if i < len(seg_stations) - 1:
                    key = (name, seg_stations[i + 1])
                    lr = shot_lr.get(key)
                if lr is None and i > 0:
                    key = (name, seg_stations[i - 1])
                    lr = shot_lr.get(key)
                if lr is None:
                    lr = station_lr.get(name, {'left': 0, 'right': 0})
                left_pts.append([round(x + lx * lr['left'], 4), round(y + ly * lr['left'], 4)])
                right_pts.append([round(x - lx * lr['right'], 4), round(y - ly * lr['right'], 4)])

            if len(left_pts) < 2:
                continue

            # Compute Catmull-Rom splines for smooth walls
            left_smooth, left_bezier = _catmull_rom_to_bezier(left_pts)
            right_smooth, right_bezier = _catmull_rom_to_bezier(right_pts)

            # Smooth polygon for fills (densified left + reversed densified right)
            polygon = left_smooth + list(reversed(right_smooth))

            outline = {
                'polygon': polygon,
                'left': left_pts,
                'right': right_pts,
                'left_smooth': left_smooth,
                'right_smooth': right_smooth,
                'left_bezier': left_bezier,
                'right_bezier': right_bezier,
                'branch': branch['id'],
                'is_lower': seg_lower,
            }

            # Flat caps at terminal (dead-end) endpoints
            caps = []
            first_name = seg_stations[0]
            last_name = seg_stations[-1]
            if station_shot_count.get(first_name, 0) == 1:
                caps.append([left_pts[0], right_pts[0]])
            if station_shot_count.get(last_name, 0) == 1:
                caps.append([left_pts[-1], right_pts[-1]])
            if caps:
                outline['caps'] = caps

            outlines.append(outline)

    # --- Strategy 2: Individual quads for loop closure shots ---
    station_branch_map = branch_info.get('station_branches', {})
    for lc in branch_info.get('loop_closures', []):
        fn, tn = lc['from'], lc['to']
        if fn not in positions or tn not in positions:
            continue

        fx, fy, _fz = positions[fn]
        tx, ty, _tz = positions[tn]
        dx, dy = tx - fx, ty - fy
        if dx * dx + dy * dy < 1e-6:
            continue

        az = math.atan2(dx, dy)
        lx, ly = -math.cos(az), math.sin(az)

        fn_lr = station_lr.get(fn, {'left': 0, 'right': 0})
        tn_lr = station_lr.get(tn, {'left': 0, 'right': 0})

        fl = [round(fx + lx * fn_lr['left'], 4), round(fy + ly * fn_lr['left'], 4)]
        fr = [round(fx - lx * fn_lr['right'], 4), round(fy - ly * fn_lr['right'], 4)]
        tl = [round(tx + lx * tn_lr['left'], 4), round(ty + ly * tn_lr['left'], 4)]
        tr = [round(tx - lx * tn_lr['right'], 4), round(ty - ly * tn_lr['right'], 4)]

        is_lower = level_info.get(fn, False) if level_info else False

        outlines.append({
            'polygon': [fl, tl, tr, fr],
            'left': [fl, tl],
            'right': [fr, tr],
            'branch': station_branch_map.get(fn, 0),
            'is_lower': is_lower,
        })

    return outlines


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


def detect_vertical_levels(positions, min_gap=1.5):
    """Detect vertical level separation from station z values.

    Finds the largest gap in z values across all stations. If the gap exceeds
    min_gap (meters), stations below the gap are classified as 'lower' for
    dashed underpass rendering (standard NSS convention).

    Returns:
        dict mapping station_name -> bool (True if lower level), or empty dict
        if no significant vertical separation exists.
    """
    if not positions or len(positions) < 2:
        return {}

    z_values = [(name, pos[2]) for name, pos in positions.items()]
    z_values.sort(key=lambda x: x[1])

    # Find largest gap in sorted z values
    max_gap = 0
    max_gap_idx = -1
    for i in range(1, len(z_values)):
        gap = z_values[i][1] - z_values[i - 1][1]
        if gap > max_gap:
            max_gap = gap
            max_gap_idx = i

    if max_gap < min_gap:
        return {}  # No significant vertical separation

    # Stations below the gap are "lower"
    lower_set = {z_values[j][0] for j in range(max_gap_idx)}
    return {name: name in lower_set for name, _ in z_values}


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
            'comment': s.comment or '',
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
            'shot_annotations': [],
            'passage_outlines': [],
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

    # Detect vertical levels for underpass rendering (dashed lower level)
    level_info = detect_vertical_levels(positions)

    # Compute passage width strokes for rendering (legacy per-shot trapezoids)
    passage_strokes = compute_passage_widths(shots, positions, decl, unit, branch_info, level_info)

    # Compute continuous passage outline polygons (preferred rendering)
    passage_outlines = compute_passage_outlines(shots, positions, unit, branch_info, level_info)

    # Build centerline segments (with branch_id as third element, is_lower as fourth)
    centerline = []
    for shot in shots:
        fn = shot['from_station']
        tn = shot['to_station']
        if fn in positions and tn in positions:
            fx, fy, _ = positions[fn]
            tx, ty, _ = positions[tn]
            branch_id = station_branch_map.get(fn, 0)
            lower = level_info.get(fn, False) if level_info else False
            centerline.append([[round(fx, 4), round(fy, 4)], [round(tx, 4), round(ty, 4)], branch_id, lower])

    # Build shot annotations (midpoints + comments for symbol rendering)
    shot_annotations = []
    for shot in shots:
        fn = shot['from_station']
        tn = shot['to_station']
        comment = shot.get('comment', '')
        if comment and fn in positions and tn in positions:
            fx, fy, _ = positions[fn]
            tx, ty, _ = positions[tn]
            shot_annotations.append({
                'from': fn,
                'to': tn,
                'mid': [round((fx + tx) / 2, 4), round((fy + ty) / 2, 4)],
                'comment': comment,
            })

    # Build station list (with branch, junction, and level info)
    station_list = []
    for name, (x, y, z) in positions.items():
        st = {
            'name': name,
            'x': round(x, 4),
            'y': round(y, 4),
            'z': round(z, 4),
            'branch': station_branch_map.get(name, 0),
            'is_junction': name in junction_stations,
        }
        if level_info:
            st['is_lower'] = level_info.get(name, False)
        station_list.append(st)

    # Compute bounds from passage outline polygons (or strokes as fallback)
    all_x = [s['x'] for s in station_list]
    all_y = [s['y'] for s in station_list]
    if passage_outlines:
        for outline in passage_outlines:
            for pt in outline['polygon']:
                all_x.append(pt[0])
                all_y.append(pt[1])
    else:
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
        'shot_annotations': shot_annotations,
        'has_vertical_levels': bool(level_info),
        'passage_outlines': passage_outlines,
    }
