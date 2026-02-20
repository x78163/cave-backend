"""
Shared CSV import utilities for caves.

Contains parsing functions (extracted from import_caves management command),
Haversine distance calculation, and coordinate-based duplicate detection.
Used by both the management command and the REST API import endpoints.
"""

import csv
import io
import math

from caves.coord_parser import parse_coordinates


FT_TO_M = 0.3048

TRUTHY = {'true', 'yes', '1', 'y', 't'}
FALSY = {'false', 'no', '0', 'n', 'f', ''}


def to_bool(value):
    """Convert a string to bool, or None if ambiguous."""
    if value is None:
        return None
    v = str(value).strip().lower()
    if v in TRUTHY:
        return True
    if v in FALSY:
        return False
    return None


def to_float(value):
    """Convert a string to float, or None if empty/invalid."""
    if value is None:
        return None
    v = str(value).strip().replace(',', '')
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def format_description(row):
    """
    Build a markdown-formatted description from CSV columns.

    Combines location_description, quadrangle, geologic_horizon, and
    cave_description into a structured markdown string.
    """
    parts = []

    loc = (row.get('location_description') or '').strip()
    if loc:
        parts.append(f'**Location:** {loc}')

    quad = (row.get('quadrangle') or '').strip()
    if quad:
        parts.append(f'**Quadrangle:** {quad}')

    geo = (row.get('geologic_horizon') or '').strip()
    if geo:
        parts.append(f'**Geologic Horizon:** {geo}')

    desc = (row.get('cave_description') or '').strip()
    if desc:
        if parts:
            parts.append('')  # blank line before main description
        parts.append(desc)

    return '\n\n'.join(parts)


def normalize_csv_rows(file_content):
    """
    Parse CSV content string into normalized rows.
    Returns list of dicts with lowercase/underscored keys.
    """
    reader = csv.DictReader(io.StringIO(file_content))
    rows = []
    for row in reader:
        rows.append({
            k.strip().lower().replace(' ', '_'): (v.strip() if v else '')
            for k, v in row.items()
        })
    return rows


def parse_cave_row(row, defaults=None):
    """
    Parse a single normalized CSV row into a cave data dict.

    Returns dict with keys:
      - 'name': str or None
      - 'data': dict of Cave model fields (ready for create/update)
      - 'latitude': float or None
      - 'longitude': float or None
      - 'error': str or None (parse error message)
    """
    defaults = defaults or {}
    result = {'name': None, 'data': {}, 'latitude': None, 'longitude': None, 'error': None}

    name = (row.get('name') or '').strip()
    if not name:
        result['error'] = 'No name provided'
        return result
    result['name'] = name

    # Parse coordinates
    lat, lon = None, None
    coord_raw = (row.get('coordinates') or '').strip()
    lat_raw = (row.get('latitude') or '').strip()
    lon_raw = (row.get('longitude') or '').strip()

    if coord_raw:
        try:
            lat, lon = parse_coordinates(coord_raw)
        except ValueError as e:
            result['error'] = f'Coordinate error: {e}'
            return result
    elif lat_raw and lon_raw:
        combined = f'{lat_raw}, {lon_raw}'
        try:
            lat, lon = parse_coordinates(combined)
        except ValueError:
            try:
                lat = float(lat_raw.replace('°', '').strip())
                lon = float(lon_raw.replace('°', '').strip())
            except ValueError as e:
                result['error'] = f'Coordinate error: {e}'
                return result
    elif lat_raw or lon_raw:
        result['error'] = 'Only one of lat/lon provided'
        return result

    result['latitude'] = lat
    result['longitude'] = lon

    # Build description
    description = format_description(row)
    if not description and row.get('description'):
        description = row['description'].strip()

    # Parse numeric fields (feet → meters conversion)
    total_length = to_float(row.get('total_length_m'))
    if total_length is None:
        ft = to_float(row.get('total_length_ft'))
        if ft is not None:
            total_length = round(ft * FT_TO_M, 1)

    vertical_extent = to_float(row.get('vertical_extent_m'))
    if vertical_extent is None:
        ft = to_float(row.get('vertical_extent_ft'))
        if ft is not None:
            vertical_extent = round(ft * FT_TO_M, 1)

    largest_chamber = to_float(row.get('largest_chamber'))
    smallest_passage = to_float(row.get('smallest_passage'))
    number_of_levels = to_float(row.get('number_of_levels'))
    if number_of_levels is not None:
        number_of_levels = int(number_of_levels)

    # Parse boolean fields
    water_desc = (row.get('water_description') or '').strip()
    water_present = to_bool(row.get('water_present'))
    if water_present is None and water_desc:
        water_present = True

    toxic_gas = to_bool(row.get('toxic_gas_present'))
    toxic_gas_types = (row.get('toxic_gas_types') or '').strip()
    if toxic_gas is None and toxic_gas_types:
        toxic_gas = True

    hazard_count = to_float(row.get('hazard_count'))
    if hazard_count is not None:
        hazard_count = int(hazard_count)

    max_particulate = to_float(row.get('max_particulate'))
    requires_equipment = (row.get('requires_equipment') or '').strip()

    # Region / country / visibility
    region = (row.get('region') or '').strip() or defaults.get('region', '')
    country = (row.get('country') or '').strip() or defaults.get('country', '')
    visibility = (row.get('visibility') or '').strip() or defaults.get('visibility', 'public')

    cave_data = {
        'description': description,
        'latitude': lat,
        'longitude': lon,
        'region': region,
        'country': country,
        'total_length': total_length,
        'vertical_extent': vertical_extent,
        'largest_chamber': largest_chamber,
        'smallest_passage': smallest_passage,
        'number_of_levels': number_of_levels,
        'hazard_count': hazard_count or 0,
        'toxic_gas_present': toxic_gas or False,
        'toxic_gas_types': toxic_gas_types,
        'max_particulate': max_particulate,
        'water_present': water_present or False,
        'water_description': water_desc,
        'requires_equipment': requires_equipment,
        'visibility': visibility,
        'source': 'imported',
    }

    result['data'] = cave_data
    return result


def haversine_distance_meters(lat1, lon1, lat2, lon2):
    """
    Calculate the great-circle distance between two points
    on Earth using the Haversine formula.
    Returns distance in meters.
    """
    R = 6_371_000  # Earth's mean radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = (math.sin(dphi / 2) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def find_proximity_duplicates(lat, lon, threshold_meters=100):
    """
    Find existing caves within threshold_meters of (lat, lon).

    Returns list of dicts sorted by distance:
      [{'id': uuid_str, 'name': str, 'distance_m': float, 'latitude': float, 'longitude': float}]
    """
    from caves.models import Cave

    if lat is None or lon is None:
        return []

    # Pre-filter with bounding box to reduce DB scan
    # ~0.001 degrees latitude ≈ 111 meters
    degree_margin = (threshold_meters / 111_000) * 1.5  # 1.5x safety factor
    candidates = Cave.objects.filter(
        latitude__isnull=False,
        longitude__isnull=False,
        latitude__gte=lat - degree_margin,
        latitude__lte=lat + degree_margin,
        longitude__gte=lon - degree_margin,
        longitude__lte=lon + degree_margin,
    ).values('id', 'name', 'latitude', 'longitude')

    matches = []
    for cave in candidates:
        dist = haversine_distance_meters(lat, lon, cave['latitude'], cave['longitude'])
        if dist <= threshold_meters:
            matches.append({
                'id': str(cave['id']),
                'name': cave['name'],
                'distance_m': round(dist, 1),
                'latitude': cave['latitude'],
                'longitude': cave['longitude'],
            })

    return sorted(matches, key=lambda m: m['distance_m'])
