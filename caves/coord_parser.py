"""
Server-side coordinate parser — mirrors the frontend parseCoordinates.js logic.

Accepts DMS, DDM, decimal degrees, UTM (basic), and map URLs.
Used by the CSV import command and anywhere else Python needs to parse
human-entered coordinates.
"""

import re
import math


def parse_coordinates(raw):
    """
    Parse a coordinate string into (lat, lon) decimal degrees.

    Accepts:
      - Decimal degrees:  35.5556, -86.5883
      - DMS:              35°33'20" N, 86°35'18" W
      - DDM:              35°39.483' N, 85°35.283' W
      - Mixed symbols:    35d33m20s N  86d35m18s W
      - Google Maps URL:  https://maps.google.com/.../@35.5,-86.5,...

    Returns (lat, lon) as floats.
    Raises ValueError on failure.
    """
    if not raw or not isinstance(raw, str):
        raise ValueError('No coordinate input provided')

    trimmed = raw.strip()
    if not trimmed:
        raise ValueError('No coordinate input provided')

    # 1. Try URL extraction (including shortened URLs with redirect resolution)
    result = _try_url(trimmed)
    if result:
        return _validate(result)

    # 2. Try DMS / DDM / decimal
    result = _try_dms(trimmed)
    if result:
        return _validate(result)

    raise ValueError(
        f'Could not parse coordinates: {trimmed!r}. '
        'Try decimal degrees (e.g. 35.658, -85.588) or '
        'DMS (e.g. 35°33\'20" N, 86°35\'18" W)'
    )


def _validate(pair):
    lat, lon = pair
    if not (-90 <= lat <= 90):
        raise ValueError(f'Latitude {lat} out of range [-90, 90]')
    if not (-180 <= lon <= 180):
        raise ValueError(f'Longitude {lon} out of range [-180, 180]')
    return (round(lat, 6), round(lon, 6))


# ── URL parsing ──────────────────────────────────────────────

def _try_url(s):
    if 'http' not in s and 'maps' not in s and 'earth' not in s:
        return None

    result = _extract_coords_from_url(s)
    if result:
        return result

    # If it's a shortened map URL, try to resolve via redirect
    short_domains = ('maps.app.goo.gl', 'goo.gl/maps')
    if any(d in s for d in short_domains):
        resolved = _resolve_short_url(s)
        if resolved:
            return _extract_coords_from_url(resolved)

    return None


def _extract_coords_from_url(s):
    """Extract coordinates from a full (non-shortened) map URL."""
    # Google Maps: !3d<lat>!4d<lon> — exact pin location (highest priority)
    m = re.search(r'!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)', s)
    if m:
        return (float(m.group(1)), float(m.group(2)))

    # Google Maps: place/lat,lon
    m = re.search(r'place/(-?\d+\.?\d*),(-?\d+\.?\d*)', s)
    if m:
        return (float(m.group(1)), float(m.group(2)))

    # Apple Maps: ll=lat,lon or q=lat,lon
    m = re.search(r'[?&](?:ll|q|sll)=(-?\d+\.?\d*),(-?\d+\.?\d*)', s)
    if m:
        return (float(m.group(1)), float(m.group(2)))

    # Google Maps/Earth: /@lat,lon — viewport center (lowest priority, less precise)
    m = re.search(r'@(-?\d+\.?\d*),(-?\d+\.?\d*)', s)
    if m:
        return (float(m.group(1)), float(m.group(2)))

    return None


def _resolve_short_url(url):
    """Follow redirects on a shortened URL and return the final URL."""
    try:
        import requests
        # Use GET (not HEAD) — Google returns fuller redirect URLs for GET
        resp = requests.get(
            url, allow_redirects=True, timeout=10, stream=True,
            headers={'User-Agent': 'Mozilla/5.0'},
        )
        resp.close()
        return resp.url
    except Exception:
        return None


# ── DMS / DDM / Decimal ─────────────────────────────────────

def _try_dms(s):
    # Normalize symbols → spaces
    s = re.sub(r'[°ºᵒ]', ' ', s)
    s = re.sub(r"[′'ʹ]", ' ', s)
    s = re.sub(r'[″"ʺ]', ' ', s)
    s = re.sub(r'[dD](?=\d|\s)', ' ', s)     # 35d33m20s
    s = re.sub(r'[mM](?=\d|\s)', ' ', s)
    s = re.sub(r'[sS](?=\s|$|[NSEW])', ' ', s)
    s = s.replace(',', ' ').replace(';', ' ')
    s = re.sub(r'\s+', ' ', s).strip()

    # Extract cardinal directions
    cardinals = re.findall(r'[NSEW]', s, re.IGNORECASE)
    s = re.sub(r'[NSEW]\.?', ' ', s, flags=re.IGNORECASE)
    s = re.sub(r'\s+', ' ', s).strip()

    # Extract all numbers
    nums = re.findall(r'-?\d+\.?\d*', s)
    if not nums or len(nums) < 2:
        return None

    values = [float(n) for n in nums]

    if len(values) == 2:
        # Decimal degrees
        lat, lon = values
    elif len(values) == 4:
        # Degrees + decimal minutes
        lat = _dms_to_decimal(values[0], values[1], 0)
        lon = _dms_to_decimal(values[2], values[3], 0)
    elif len(values) == 6:
        # Full DMS
        lat = _dms_to_decimal(values[0], values[1], values[2])
        lon = _dms_to_decimal(values[3], values[4], values[5])
    else:
        return None

    # Apply cardinal signs
    if len(cardinals) >= 1:
        c0 = cardinals[0].upper()
        if c0 == 'S':
            lat = -abs(lat)
        elif c0 == 'N':
            lat = abs(lat)
        elif c0 == 'W':
            lon = -abs(lon)
        elif c0 == 'E':
            lon = abs(lon)

    if len(cardinals) >= 2:
        c1 = cardinals[1].upper()
        if c1 == 'S':
            lat = -abs(lat)
        elif c1 == 'N':
            lat = abs(lat)
        elif c1 == 'W':
            lon = -abs(lon)
        elif c1 == 'E':
            lon = abs(lon)

    # Swap if lat > 90 but lon <= 90
    if abs(lat) > 90 and abs(lon) <= 90:
        lat, lon = lon, lat

    return (lat, lon)


def _dms_to_decimal(degrees, minutes, seconds):
    sign = -1 if degrees < 0 else 1
    return sign * (abs(degrees) + abs(minutes) / 60 + abs(seconds) / 3600)
