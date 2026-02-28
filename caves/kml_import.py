"""KML/KMZ import utilities for caves."""

import io
import re
import zipfile
import xml.etree.ElementTree as ET

KML_NS = '{http://www.opengis.net/kml/2.2}'


def _strip_html(text):
    """Remove HTML tags from a string."""
    if not text:
        return ''
    clean = re.sub(r'<[^>]+>', ' ', text)
    clean = re.sub(r'\s+', ' ', clean)
    return clean.strip()


def parse_kml_content(content_str):
    """Parse KML XML string into list of {name, latitude, longitude, description} dicts.

    Recursively finds all <Placemark> elements regardless of Document/Folder nesting.
    Only Point placemarks are included (LineString, Polygon are skipped).
    KML coordinate order is lon,lat,alt — this function swaps to lat,lon.
    """
    root = ET.fromstring(content_str)
    results = []

    # Search with namespace first, then fall back to bare tags
    placemarks = list(root.iter(f'{KML_NS}Placemark'))
    if not placemarks:
        placemarks = list(root.iter('Placemark'))

    ns = KML_NS if placemarks and placemarks[0].tag.startswith('{') else ''

    for pm in placemarks:
        name_el = pm.find(f'{ns}name')
        desc_el = pm.find(f'{ns}description')
        point_el = pm.find(f'.//{ns}Point/{ns}coordinates')

        if point_el is None:
            continue  # Skip non-point features

        name = (name_el.text or '').strip() if name_el is not None else ''
        description = _strip_html(desc_el.text or '') if desc_el is not None else ''

        coord_text = point_el.text.strip()
        parts = coord_text.split(',')
        if len(parts) < 2:
            continue

        try:
            lon = float(parts[0].strip())
            lat = float(parts[1].strip())
        except ValueError:
            continue

        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue

        results.append({
            'name': name,
            'latitude': lat,
            'longitude': lon,
            'description': description,
        })

    return results


def parse_kmz_file(file_bytes):
    """Extract KML from a KMZ (ZIP) archive and parse it."""
    with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
        kml_names = [n for n in zf.namelist() if n.lower().endswith('.kml')]
        if not kml_names:
            raise ValueError('No .kml file found in KMZ archive')
        kml_content = zf.read(kml_names[0]).decode('utf-8')
    return parse_kml_content(kml_content)


def kml_to_normalized_rows(placemarks):
    """Convert KML placemarks to normalized row dicts for parse_cave_row()."""
    rows = []
    for pm in placemarks:
        rows.append({
            'name': pm.get('name', ''),
            'latitude': str(pm['latitude']),
            'longitude': str(pm['longitude']),
            'cave_description': pm.get('description', ''),
        })
    return rows


def fetch_google_maps_list(url):
    """Fetch places from a Google Maps saved list URL.

    Supports shortened (maps.app.goo.gl/...) and full Google Maps list URLs.
    Returns list of {name, latitude, longitude, description} dicts.
    """
    import json
    import requests as http_requests

    # Resolve shortened URLs
    resp = http_requests.get(
        url, allow_redirects=True, timeout=15, stream=True,
        headers={'User-Agent': 'Mozilla/5.0'},
    )
    resp.close()
    final_url = resp.url

    # Extract the list ID from the resolved URL
    # Format: ...!2sLIST_ID!... in the data parameter
    match = re.search(r'!2s([A-Za-z0-9_-]+)', final_url)
    if not match:
        # Also try /placelists/list/LIST_ID pattern
        match = re.search(r'/placelists/list/([A-Za-z0-9_-]+)', final_url)
    if not match:
        raise ValueError(
            'Could not extract list ID from URL. '
            'Make sure this is a shared Google Maps list link.'
        )

    list_id = match.group(1)

    # Fetch the list data from Google Maps internal API
    api_url = (
        f'https://www.google.com/maps/preview/entitylist/getlist'
        f'?authuser=0&hl=en&gl=us'
        f'&pb=!1m1!1s{list_id}!2e2!3e2!4i500!16b1'
    )
    resp = http_requests.get(
        api_url, timeout=15,
        headers={'User-Agent': 'Mozilla/5.0'},
    )
    if resp.status_code != 200:
        raise ValueError(f'Failed to fetch list (HTTP {resp.status_code}). Is the list publicly shared?')

    text = resp.text
    # Strip the XSS prevention prefix
    if text.startswith(")]}'"):
        text = text[text.index('\n') + 1:]

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise ValueError('Could not parse Google Maps response')

    list_meta = data[0]
    list_name = list_meta[4] if len(list_meta) > 4 and list_meta[4] else 'Google Maps List'
    entries = list_meta[8] if len(list_meta) > 8 and list_meta[8] else []

    results = []
    for entry in entries:
        if not entry:
            continue

        loc = entry[1] if len(entry) > 1 and entry[1] else None
        if not loc:
            continue

        # Coordinates: loc[5] = [null, null, lat, lon]
        coords = loc[5] if len(loc) > 5 and loc[5] else None
        if not coords or len(coords) < 4:
            continue
        lat = coords[2]
        lon = coords[3]
        if lat is None or lon is None:
            continue

        # Name: entry[2] is the display name
        name = entry[2] if len(entry) > 2 and entry[2] else ''

        # Address/description: loc[4] or loc[2]
        description = ''
        if len(loc) > 4 and loc[4]:
            description = loc[4]
        elif len(loc) > 2 and loc[2]:
            description = loc[2]

        results.append({
            'name': name,
            'latitude': lat,
            'longitude': lon,
            'description': description,
        })

    return results, list_name
