"""
SLAM-to-Survey: Convert SLAM map data (2D wall polylines + trajectory) into
traditional cave survey format (stations + shots with LRUD).

Uses keyframe/trajectory positions as stations, raycasts against wall polylines
to derive passage dimensions (L/R), and estimates U/D from level z_range.

Detected side passage openings ("leads") are marked with comment annotations
that trigger the continuation symbol on the survey map.
"""

import math


def select_stations(trajectory, min_spacing=0.5):
    """Select station positions from trajectory points with minimum spacing.

    Filters out near-duplicate keyframes (common at session start) while
    preserving the overall path shape.

    Returns list of (x, y) tuples.
    """
    if not trajectory:
        return []
    stations = [tuple(trajectory[0])]
    for pt in trajectory[1:]:
        dx = pt[0] - stations[-1][0]
        dy = pt[1] - stations[-1][1]
        if math.sqrt(dx * dx + dy * dy) >= min_spacing:
            stations.append(tuple(pt))
    return stations


def _ray_segment_intersect(origin, direction, seg_a, seg_b):
    """2D ray-line segment intersection.

    Args:
        origin: (x, y) ray origin
        direction: (dx, dy) unit direction vector
        seg_a, seg_b: (x, y) segment endpoints

    Returns:
        Distance along ray to intersection, or None if no hit.
    """
    ox, oy = origin
    dx, dy = direction
    ax, ay = seg_a
    bx, by = seg_b

    # Segment direction
    sx = bx - ax
    sy = by - ay

    denom = dx * sy - dy * sx
    if abs(denom) < 1e-10:
        return None  # parallel

    t = ((ax - ox) * sy - (ay - oy) * sx) / denom  # ray parameter
    u = ((ax - ox) * dy - (ay - oy) * dx) / denom  # segment parameter

    if t > 0.01 and 0 <= u <= 1:  # hit ahead of origin, within segment
        return t
    return None


def _extract_wall_segments(walls):
    """Convert wall polylines into list of (point_a, point_b) segment pairs."""
    segments = []
    for polyline in walls:
        for i in range(len(polyline) - 1):
            segments.append((tuple(polyline[i]), tuple(polyline[i + 1])))
    return segments


def cast_ray(origin, bearing_deg, wall_segments, max_dist=50.0):
    """Cast a ray from origin in bearing direction, return distance to nearest wall.

    Bearing convention: 0=North(+Y), 90=East(+X), matching survey azimuth.
    """
    rad = math.radians(bearing_deg)
    dx = math.sin(rad)   # east component
    dy = math.cos(rad)   # north component

    min_dist = max_dist
    for seg_a, seg_b in wall_segments:
        t = _ray_segment_intersect(origin, (dx, dy), seg_a, seg_b)
        if t is not None and t < min_dist:
            min_dist = t
    return min_dist


def compute_travel_bearings(stations):
    """Compute travel bearing at each station from consecutive positions.

    Returns list of bearings in degrees (0=North, 90=East).
    """
    bearings = []
    for i in range(len(stations)):
        if i < len(stations) - 1:
            dx = stations[i + 1][0] - stations[i][0]
            dy = stations[i + 1][1] - stations[i][1]
        else:
            # Last station: use bearing from previous
            dx = stations[i][0] - stations[i - 1][0]
            dy = stations[i][1] - stations[i - 1][1]
        bearing = math.degrees(math.atan2(dx, dy)) % 360
        bearings.append(bearing)
    return bearings


def raycast_lrud(station_pos, travel_bearing, wall_segments, z_range, max_dist=50.0):
    """Cast rays perpendicular to travel direction to get passage dimensions.

    Returns (left, right, up, down) in meters.
    """
    left_bearing = (travel_bearing - 90) % 360
    right_bearing = (travel_bearing + 90) % 360

    left = cast_ray(station_pos, left_bearing, wall_segments, max_dist)
    right = cast_ray(station_pos, right_bearing, wall_segments, max_dist)

    # Clamp to reasonable passage width (raycast may miss walls)
    left = min(left, max_dist)
    right = min(right, max_dist)

    # U/D from level z_range (approximate — no vertical data in 2D walls)
    z_center = (z_range[0] + z_range[1]) / 2
    up = abs(z_range[1] - z_center) or 1.0
    down = abs(z_center - z_range[0]) or 1.0

    return round(left, 3), round(right, 3), round(up, 3), round(down, 3)


def detect_leads(stations_data, wall_segments, travel_bearings):
    """Detect side passage openings at each station using fan raycasting.

    Looks for wall-void-wall patterns perpendicular to the travel direction.
    A "void" is a ray that travels significantly further than the local passage width.

    Returns list of lead dicts with station name, bearing, and width estimate.
    """
    leads = []

    for i, station in enumerate(stations_data):
        avg_width = (station['left'] + station['right']) / 2
        if avg_width < 0.3:
            continue  # skip very narrow sections

        threshold = avg_width * 2.5  # void = ray >> passage width
        bearing = travel_bearings[i]

        for side_offset in [-90, 90]:
            base_angle = (bearing + side_offset) % 360
            hits = []
            for angle_off in range(-30, 31, 10):
                angle = (base_angle + angle_off) % 360
                dist = cast_ray(station['pos'], angle, wall_segments)
                hits.append((angle_off, dist))

            # Find void gap: consecutive rays that exceed threshold
            gap = _find_void_gap(hits, threshold)
            if gap and gap['width_deg'] >= 15:
                leads.append({
                    'station': station['name'],
                    'bearing': round((base_angle + gap['center_offset']) % 360, 1),
                    'width_estimate': round(gap['avg_void_dist'], 2),
                })

    return leads


def _find_void_gap(hits, threshold):
    """Find a contiguous gap of void rays (distance > threshold) in a fan.

    Returns dict with center_offset, width_deg, avg_void_dist, or None.
    """
    void_runs = []
    current_run = []

    for offset, dist in hits:
        if dist > threshold:
            current_run.append((offset, dist))
        else:
            if current_run:
                void_runs.append(current_run)
                current_run = []
    if current_run:
        void_runs.append(current_run)

    if not void_runs:
        return None

    # Find the widest void run
    best = max(void_runs, key=len)
    if len(best) < 2:
        return None  # single ray void is noise

    offsets = [r[0] for r in best]
    dists = [r[1] for r in best]
    return {
        'center_offset': (offsets[0] + offsets[-1]) / 2,
        'width_deg': offsets[-1] - offsets[0],
        'avg_void_dist': sum(dists) / len(dists),
    }


def generate_slam_survey_data(map_data, level_idx=0, min_spacing=0.5):
    """Main entry point: convert map_data.json into survey shots + leads.

    Args:
        map_data: parsed map_data.json dict
        level_idx: which cave level to process
        min_spacing: minimum station spacing in meters

    Returns dict with 'stations', 'shots', 'leads'.
    """
    levels = map_data.get('levels', [])
    if level_idx >= len(levels):
        raise ValueError(f'Level {level_idx} not found (have {len(levels)} levels)')

    level = levels[level_idx]
    trajectory = level.get('trajectory', [])
    walls = level.get('walls', [])
    z_range = (level.get('z_min', 0), level.get('z_max', 1))

    if not trajectory or len(trajectory) < 2:
        raise ValueError('Trajectory too short (need at least 2 points)')

    # 1. Select stations with minimum spacing
    station_positions = select_stations(trajectory, min_spacing)
    if len(station_positions) < 2:
        raise ValueError('Too few stations after spacing filter')

    # 2. Extract wall segments for raycasting
    wall_segments = _extract_wall_segments(walls)

    # 3. Compute travel bearings at each station
    bearings = compute_travel_bearings(station_positions)

    # 4. Raycast LRUD at each station
    stations_data = []
    for i, pos in enumerate(station_positions):
        left, right, up, down = raycast_lrud(
            pos, bearings[i], wall_segments, z_range,
        )
        stations_data.append({
            'name': f'S{i + 1}',
            'pos': pos,
            'left': left,
            'right': right,
            'up': up,
            'down': down,
        })

    # 5. Generate shots from consecutive stations
    shots = []
    for i in range(1, len(stations_data)):
        from_st = stations_data[i - 1]
        to_st = stations_data[i]
        dx = to_st['pos'][0] - from_st['pos'][0]
        dy = to_st['pos'][1] - from_st['pos'][1]
        distance = math.sqrt(dx * dx + dy * dy)
        azimuth = math.degrees(math.atan2(dx, dy)) % 360

        shots.append({
            'from_station': from_st['name'],
            'to_station': to_st['name'],
            'distance': round(distance, 4),
            'azimuth': round(azimuth, 2),
            'inclination': 0,
            'left': from_st['left'],
            'right': from_st['right'],
            'up': from_st['up'],
            'down': from_st['down'],
            'comment': '',
        })

    # 6. Detect side passage leads
    leads = detect_leads(stations_data, wall_segments, bearings)

    # Add leads as short stub shots with "lead" comment
    for lead in leads:
        # Find the station this lead branches from
        station_name = lead['station']
        lead_bearing = lead['bearing']

        # Create a stub shot pointing toward the lead
        stub_name = f"{station_name}L{leads.index(lead) + 1}"
        shots.append({
            'from_station': station_name,
            'to_station': stub_name,
            'distance': 0.1,  # very short stub
            'azimuth': lead_bearing,
            'inclination': 0,
            'left': None,
            'right': None,
            'up': None,
            'down': None,
            'comment': 'lead',
        })

    return {
        'stations': stations_data,
        'shots': shots,
        'leads': leads,
    }


def _nearest_station(stations, x, y):
    """Find the station closest to (x, y). Returns (index, distance)."""
    best_i = 0
    best_dist = float('inf')
    for i, st in enumerate(stations):
        dx = st['pos'][0] - x
        dy = st['pos'][1] - y
        d = math.sqrt(dx * dx + dy * dy)
        if d < best_dist:
            best_dist = d
            best_i = i
    return best_i, best_dist


def generate_merged_slam_survey(map_data, min_spacing=0.5):
    """Generate a single merged survey from all levels, connected via transitions.

    Each level gets its own station prefix (L1-S1, L2-S1, ...).
    Transitions from map_data create connecting shots between levels.

    Returns dict with 'stations', 'shots', 'leads' spanning all levels.
    """
    levels = map_data.get('levels', [])
    transitions = map_data.get('transitions', [])

    if not levels:
        raise ValueError('No levels in map data')

    all_stations = []
    all_shots = []
    all_leads = []
    level_stations = {}  # level_idx -> list of station dicts

    for level_idx, level in enumerate(levels):
        trajectory = level.get('trajectory', [])
        walls = level.get('walls', [])
        z_range = (level.get('z_min', 0), level.get('z_max', 1))

        if not trajectory or len(trajectory) < 2:
            continue

        station_positions = select_stations(trajectory, min_spacing)
        if len(station_positions) < 2:
            continue

        wall_segments = _extract_wall_segments(walls)
        bearings = compute_travel_bearings(station_positions)

        # Prefix stations with level number
        prefix = f'L{level_idx + 1}-'
        stations_data = []
        for i, pos in enumerate(station_positions):
            left, right, up, down = raycast_lrud(
                pos, bearings[i], wall_segments, z_range,
            )
            stations_data.append({
                'name': f'{prefix}S{i + 1}',
                'pos': pos,
                'left': left,
                'right': right,
                'up': up,
                'down': down,
            })

        level_stations[level_idx] = stations_data
        all_stations.extend(stations_data)

        # Shots within this level
        for i in range(1, len(stations_data)):
            from_st = stations_data[i - 1]
            to_st = stations_data[i]
            dx = to_st['pos'][0] - from_st['pos'][0]
            dy = to_st['pos'][1] - from_st['pos'][1]
            distance = math.sqrt(dx * dx + dy * dy)
            azimuth = math.degrees(math.atan2(dx, dy)) % 360

            all_shots.append({
                'from_station': from_st['name'],
                'to_station': to_st['name'],
                'distance': round(distance, 4),
                'azimuth': round(azimuth, 2),
                'inclination': 0,
                'left': from_st['left'],
                'right': from_st['right'],
                'up': from_st['up'],
                'down': from_st['down'],
                'comment': '',
            })

        # Leads within this level
        leads = detect_leads(stations_data, wall_segments, bearings)
        for lead in leads:
            stub_name = f"{lead['station']}L{leads.index(lead) + 1}"
            all_shots.append({
                'from_station': lead['station'],
                'to_station': stub_name,
                'distance': 0.1,
                'azimuth': lead['bearing'],
                'inclination': 0,
                'left': None, 'right': None, 'up': None, 'down': None,
                'comment': 'lead',
            })
        all_leads.extend(leads)

    # Connect levels via transitions
    for tr in transitions:
        from_lvl = tr.get('from_level')
        to_lvl = tr.get('to_level')
        if from_lvl not in level_stations or to_lvl not in level_stations:
            continue

        tx, ty = tr['x'], tr['y']
        from_z = map_data['levels'][from_lvl].get('z_center', 0)
        to_z = map_data['levels'][to_lvl].get('z_center', 0)

        # Find nearest station to transition point on each level
        from_idx, _ = _nearest_station(level_stations[from_lvl], tx, ty)
        to_idx, _ = _nearest_station(level_stations[to_lvl], tx, ty)

        from_st = level_stations[from_lvl][from_idx]
        to_st = level_stations[to_lvl][to_idx]

        dx = to_st['pos'][0] - from_st['pos'][0]
        dy = to_st['pos'][1] - from_st['pos'][1]
        dz = to_z - from_z
        horiz_dist = math.sqrt(dx * dx + dy * dy)
        dist_3d = math.sqrt(dx * dx + dy * dy + dz * dz)
        azimuth = math.degrees(math.atan2(dx, dy)) % 360
        inclination = math.degrees(math.atan2(dz, horiz_dist)) if horiz_dist > 0.001 else (-90 if dz < 0 else 90)

        all_shots.append({
            'from_station': from_st['name'],
            'to_station': to_st['name'],
            'distance': round(dist_3d, 4),
            'azimuth': round(azimuth, 2),
            'inclination': round(inclination, 2),
            'left': from_st['left'],
            'right': from_st['right'],
            'up': from_st['up'],
            'down': from_st['down'],
            'comment': 'transition',
        })

    if not all_stations:
        raise ValueError('No valid levels with sufficient trajectory data')

    return {
        'stations': all_stations,
        'shots': all_shots,
        'leads': all_leads,
    }
