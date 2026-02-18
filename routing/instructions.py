"""Turn-by-turn instruction generation for cave routes.

Generates human-readable navigation instructions with:
- Relative directions (turn left, bear right, continue straight)
- Absolute compass headings (Head NNW 338 deg)
- Distance and time estimates
- POI callouts along the route
"""

import math

# Compass direction names (16-point)
_COMPASS_POINTS = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
]


def _compass_name(degrees):
    """Convert degrees (0=N, 90=E, CW) to compass point name."""
    idx = int(round(degrees / 22.5)) % 16
    return _COMPASS_POINTS[idx]


def _normalize_angle(angle_rad):
    """Normalize angle to [-pi, pi]."""
    while angle_rad > math.pi:
        angle_rad -= 2 * math.pi
    while angle_rad < -math.pi:
        angle_rad += 2 * math.pi
    return angle_rad


def _relative_direction(heading_change_rad):
    """Convert heading change (radians, positive = right/CW) to relative direction."""
    deg = math.degrees(heading_change_rad)

    if abs(deg) < 20:
        return 'continue_straight', 'Continue straight'
    elif 20 <= deg < 45:
        return 'bear_right', 'Bear right'
    elif 45 <= deg < 135:
        return 'turn_right', 'Turn right'
    elif deg >= 135:
        return 'turn_around_right', 'Turn around (right)'
    elif -45 < deg <= -20:
        return 'bear_left', 'Bear left'
    elif -135 < deg <= -45:
        return 'turn_left', 'Turn left'
    else:
        return 'turn_around_left', 'Turn around (left)'


def _heading_between(p1, p2):
    """Compute heading in radians from p1 to p2 (0 = +X axis, CCW positive)."""
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    return math.atan2(dy, dx)


def _slam_heading_to_compass(slam_heading_rad, heading_offset_deg):
    """Convert SLAM heading to compass degrees.

    SLAM: 0 = +X axis, CCW positive
    Compass: 0 = North, CW positive

    heading_offset_deg = initial_heading_deg from map_data + cave.slam_heading
    """
    # SLAM heading in degrees
    slam_deg = math.degrees(slam_heading_rad)
    # Convert: compass = offset - slam (because SLAM +Y ≈ North, +X ≈ East
    # but actual mapping depends on heading_offset)
    compass = (heading_offset_deg - slam_deg) % 360
    return compass


def generate_instructions(route_result, junctions, pois, heading_offset_deg,
                          transitions=None, speed_kmh=1.0):
    """Generate turn-by-turn navigation instructions for a computed route.

    Args:
        route_result: dict from route_through_waypoints() with 'path' and 'segments'.
        junctions: list of junction dicts from detect_junctions().
        pois: list of POI dicts with slam_x, slam_y, slam_z, poi_type, label.
        heading_offset_deg: compass offset for SLAM→compass conversion.
        transitions: list of {from_level, to_level, x, y} dicts.
        speed_kmh: walking speed for time estimation.

    Returns:
        {
            'instructions': [instruction_dict, ...],
            'total_distance_m': float,
            'total_time_s': float,
            'summary': str,
        }
    """
    path = route_result['path']
    if len(path) < 2:
        return {'instructions': [], 'total_distance_m': 0, 'total_time_s': 0,
                'summary': 'Route too short'}

    instructions = []
    cumulative_dist = 0.0
    cumulative_time = 0.0

    # Pre-index junctions and POIs for fast lookup
    junction_index = _build_spatial_index(
        [{'x': j['slam_x'], 'y': j['slam_y'], **j} for j in junctions],
        snap_radius=0.5
    )
    poi_index = _build_spatial_index(
        [{'x': p.get('slam_x', 0), 'y': p.get('slam_y', 0), **p} for p in pois],
        snap_radius=1.0
    )

    # Identify transition points in the path
    transition_indices = set()
    for i in range(1, len(path)):
        if path[i][2] != path[i - 1][2]:  # level changed
            transition_indices.add(i)

    # Start instruction
    start_heading = _heading_between(path[0], path[1])
    compass_deg = _slam_heading_to_compass(start_heading, heading_offset_deg)
    instructions.append({
        'index': 0,
        'type': 'start',
        'slam_x': round(path[0][0], 3),
        'slam_y': round(path[0][1], 3),
        'level': path[0][2],
        'heading_deg': round(math.degrees(start_heading), 1),
        'compass_heading': round(compass_deg, 1),
        'compass_name': _compass_name(compass_deg),
        'relative_direction': 'start',
        'relative_text': 'Start',
        'text': f'Start heading {_compass_name(compass_deg)} ({int(compass_deg)}°)',
        'distance_from_prev_m': 0.0,
        'cumulative_distance_m': 0.0,
        'estimated_time_s': 0.0,
        'cumulative_time_s': 0.0,
    })

    # Walk the path
    prev_heading = start_heading
    prev_instruction_idx = 0
    pois_mentioned = set()

    for i in range(1, len(path)):
        p_prev = path[i - 1]
        p_curr = path[i]

        # Distance from previous point
        seg_dist = math.sqrt(
            (p_curr[0] - p_prev[0]) ** 2 + (p_curr[1] - p_prev[1]) ** 2
        )
        cumulative_dist += seg_dist

        # Time for this segment
        seg_time = _segment_time(seg_dist, speed_kmh, p_curr, pois, poi_index)
        cumulative_time += seg_time

        # Check: is this a transition point?
        if i in transition_indices:
            from_level = p_prev[2]
            to_level = p_curr[2]
            direction = 'Descend' if to_level > from_level else 'Ascend'
            instructions.append({
                'index': len(instructions),
                'type': 'transition',
                'slam_x': round(p_curr[0], 3),
                'slam_y': round(p_curr[1], 3),
                'level': to_level,
                'heading_deg': round(math.degrees(prev_heading), 1),
                'compass_heading': round(
                    _slam_heading_to_compass(prev_heading, heading_offset_deg), 1),
                'compass_name': _compass_name(
                    _slam_heading_to_compass(prev_heading, heading_offset_deg)),
                'relative_direction': 'transition',
                'relative_text': f'{direction} to Level {to_level + 1}',
                'text': f'{direction} to Level {to_level + 1}',
                'distance_from_prev_m': round(cumulative_dist - instructions[-1]['cumulative_distance_m'], 1),
                'cumulative_distance_m': round(cumulative_dist, 1),
                'estimated_time_s': round(cumulative_time - instructions[-1]['cumulative_time_s'], 1),
                'cumulative_time_s': round(cumulative_time, 1),
                'from_level': from_level,
                'to_level': to_level,
            })
            continue

        # Only generate instructions at meaningful points
        if i >= len(path) - 1:
            continue  # End instruction handled separately

        # Heading at this point
        if i < len(path) - 1:
            outgoing_heading = _heading_between(p_curr, path[i + 1])
        else:
            outgoing_heading = prev_heading

        heading_change = _normalize_angle(outgoing_heading - prev_heading)

        # Check: is this near a junction?
        key = _grid_key(p_curr[0], p_curr[1], 0.5)
        nearby_junction = junction_index.get(key)

        if nearby_junction and abs(heading_change) > math.radians(15):
            compass_deg = _slam_heading_to_compass(outgoing_heading, heading_offset_deg)
            rel_dir, rel_text = _relative_direction(heading_change)

            junction = nearby_junction
            jtype = junction.get('junction_type', 'junction')
            jtype_text = jtype.replace('_', '-')

            if abs(heading_change) < math.radians(20):
                text = f'Continue straight past {jtype_text}'
            else:
                text = f'{rel_text} at {jtype_text}, head {_compass_name(compass_deg)} ({int(compass_deg)}°)'

            instructions.append({
                'index': len(instructions),
                'type': 'junction',
                'slam_x': round(p_curr[0], 3),
                'slam_y': round(p_curr[1], 3),
                'level': p_curr[2],
                'heading_deg': round(math.degrees(outgoing_heading), 1),
                'compass_heading': round(compass_deg, 1),
                'compass_name': _compass_name(compass_deg),
                'relative_direction': rel_dir,
                'relative_text': rel_text,
                'text': text,
                'distance_from_prev_m': round(
                    cumulative_dist - instructions[-1]['cumulative_distance_m'], 1),
                'cumulative_distance_m': round(cumulative_dist, 1),
                'estimated_time_s': round(
                    cumulative_time - instructions[-1]['cumulative_time_s'], 1),
                'cumulative_time_s': round(cumulative_time, 1),
                'junction_type': jtype,
            })

        # Check: is this near a POI we haven't mentioned?
        poi_key = _grid_key(p_curr[0], p_curr[1], 1.0)
        nearby_poi = poi_index.get(poi_key)
        if nearby_poi and nearby_poi.get('id') not in pois_mentioned:
            poi_id = nearby_poi.get('id')
            pois_mentioned.add(poi_id)

            # Determine left/right
            side = _point_side(p_prev, p_curr, nearby_poi)
            poi_label = nearby_poi.get('label', nearby_poi.get('poi_type', 'point'))
            poi_type = nearby_poi.get('poi_type', '')

            text = f'Pass {poi_label}'
            if poi_type:
                text += f' ({poi_type})'
            text += f' on your {side}'

            instructions.append({
                'index': len(instructions),
                'type': 'poi',
                'slam_x': round(p_curr[0], 3),
                'slam_y': round(p_curr[1], 3),
                'level': p_curr[2],
                'heading_deg': round(math.degrees(prev_heading), 1),
                'compass_heading': round(
                    _slam_heading_to_compass(prev_heading, heading_offset_deg), 1),
                'compass_name': _compass_name(
                    _slam_heading_to_compass(prev_heading, heading_offset_deg)),
                'relative_direction': 'poi',
                'relative_text': f'Pass {poi_label}',
                'text': text,
                'distance_from_prev_m': round(
                    cumulative_dist - instructions[-1]['cumulative_distance_m'], 1),
                'cumulative_distance_m': round(cumulative_dist, 1),
                'estimated_time_s': round(
                    cumulative_time - instructions[-1]['cumulative_time_s'], 1),
                'cumulative_time_s': round(cumulative_time, 1),
                'poi_id': str(poi_id) if poi_id else None,
                'poi_type': poi_type,
            })

        prev_heading = outgoing_heading if i < len(path) - 1 else prev_heading

    # End instruction
    end_point = path[-1]
    instructions.append({
        'index': len(instructions),
        'type': 'end',
        'slam_x': round(end_point[0], 3),
        'slam_y': round(end_point[1], 3),
        'level': end_point[2],
        'heading_deg': round(math.degrees(prev_heading), 1),
        'compass_heading': round(
            _slam_heading_to_compass(prev_heading, heading_offset_deg), 1),
        'compass_name': _compass_name(
            _slam_heading_to_compass(prev_heading, heading_offset_deg)),
        'relative_direction': 'end',
        'relative_text': 'Arrive at destination',
        'text': 'Arrive at destination',
        'distance_from_prev_m': round(
            cumulative_dist - instructions[-1]['cumulative_distance_m'], 1),
        'cumulative_distance_m': round(cumulative_dist, 1),
        'estimated_time_s': round(
            cumulative_time - instructions[-1]['cumulative_time_s'], 1),
        'cumulative_time_s': round(cumulative_time, 1),
    })

    # Summary
    total_time_min = cumulative_time / 60
    levels_used = set(p[2] for p in path)
    summary = (
        f'{round(cumulative_dist, 1)}m, '
        f'~{int(total_time_min)} min, '
        f'{len(levels_used)} level{"s" if len(levels_used) > 1 else ""}'
    )

    return {
        'instructions': instructions,
        'total_distance_m': round(cumulative_dist, 1),
        'total_time_s': round(cumulative_time, 1),
        'summary': summary,
    }


# ---------------------------------------------------------------------------
# Time estimation
# ---------------------------------------------------------------------------

# POI type speed multipliers (1.0 = normal, <1.0 = slower)
_POI_SPEED_MULTIPLIERS = {
    'squeeze': 0.5,
    'water': 0.3,
}

# POI type flat time penalties in seconds
_POI_TIME_PENALTIES = {
    'transition': 300,  # 5 min
    'hazard': 120,      # 2 min
}


def _segment_time(distance_m, speed_kmh, point, pois, poi_index):
    """Estimate traversal time for a path segment in seconds."""
    base_speed_ms = speed_kmh * 1000 / 3600  # m/s

    # Check for nearby POIs that affect speed
    key = _grid_key(point[0], point[1], 1.0)
    nearby = poi_index.get(key)

    multiplier = 1.0
    penalty = 0.0

    if nearby:
        poi_type = nearby.get('poi_type', '')
        multiplier = _POI_SPEED_MULTIPLIERS.get(poi_type, 1.0)
        penalty = _POI_TIME_PENALTIES.get(poi_type, 0.0)

    effective_speed = base_speed_ms * multiplier
    if effective_speed <= 0:
        effective_speed = 0.01

    return (distance_m / effective_speed) + penalty


# ---------------------------------------------------------------------------
# Spatial index helpers
# ---------------------------------------------------------------------------

def _build_spatial_index(items, snap_radius=0.5):
    """Build a simple grid-based spatial index for fast nearest-neighbor lookup."""
    index = {}
    for item in items:
        x = item.get('x', item.get('slam_x', 0))
        y = item.get('y', item.get('slam_y', 0))
        key = _grid_key(x, y, snap_radius)
        # Store closest to grid center
        if key not in index:
            index[key] = item
    return index


def _grid_key(x, y, cell_size):
    """Grid cell key for spatial indexing."""
    return (int(round(x / cell_size)), int(round(y / cell_size)))


def _point_side(p_prev, p_curr, poi):
    """Determine if a POI is to the left or right of the travel direction."""
    # Cross product of (direction vector) x (point-to-poi vector)
    dx = p_curr[0] - p_prev[0]
    dy = p_curr[1] - p_prev[1]
    px = poi.get('x', poi.get('slam_x', 0)) - p_curr[0]
    py = poi.get('y', poi.get('slam_y', 0)) - p_curr[1]
    cross = dx * py - dy * px
    return 'left' if cross > 0 else 'right'
