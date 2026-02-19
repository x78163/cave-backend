"""
Tennessee GIS parcel lookup service.

Three data sources:
  1. Statewide COMPTROLLER_OLG_LANDUSE (86 of 95 counties) — parcel data + geometry
  2. County-specific ArcGIS services (Nashville, Shelby, etc.) — parcel data + owner name
  3. TPAD API (assessment.cot.tn.gov) — owner name from GISLINK

All services are free public endpoints — no API key required.
"""

import json
import logging
from urllib.parse import quote

import requests

logger = logging.getLogger(__name__)

TIMEOUT = 10  # seconds

# --- County-specific endpoints with owner name ---

COUNTY_SERVICES = {
    'Davidson': {
        'url': 'https://maps.nashville.gov/arcgis/rest/services/Cadastral/Parcels/MapServer/0/query',
        'owner_field': 'Owner',
        'parcel_field': 'APN',
        'address_field': 'PropAddr',
        'acres_field': 'Acres',
        'appraisal_field': 'TotlAppr',
        'out_fields': '*',
        'land_use_field': 'LUDesc',
    },
}

# Statewide service
STATEWIDE_URL = (
    'https://tnmap.tn.gov/arcgis/rest/services/'
    'ENVIRONMENTAL/COMPTROLLER_OLG_LANDUSE/MapServer/2/query'
)

# Counties NOT covered by the statewide service
EXCLUDED_COUNTIES = {
    'Chester', 'Davidson', 'Hamilton', 'Hickman',
    'Knox', 'Montgomery', 'Rutherford', 'Shelby', 'Williamson',
}

# TPAD API for owner/property lookup
TPAD_SEARCH_URL = 'https://assessment.cot.tn.gov/TPAD/Search/GetSearchResults'

# TN property type codes → human-readable descriptions
PROPERTY_TYPE_CODES = {
    '00': 'Residential',
    '01': 'County',
    '02': 'City',
    '03': 'State',
    '04': 'Federal',
    '05': 'Religious',
    '06': 'Educational / Scientific / Charitable',
    '07': 'Other Exempt',
    '08': 'Commercial',
    '09': 'Industrial',
    '10': 'Farm',
    '11': 'Agricultural',
    '12': 'Forest',
    '99': 'State Assessed',
}


def _query_arcgis(url, lat, lon, out_fields='*', return_geometry=False):
    """Generic ArcGIS REST point-in-polygon query."""
    params = {
        'geometry': f'{lon},{lat}',
        'geometryType': 'esriGeometryPoint',
        'inSR': '4326',
        'outSR': '4326',
        'spatialRel': 'esriSpatialRelIntersects',
        'outFields': out_fields,
        'returnGeometry': 'true' if return_geometry else 'false',
        'f': 'json',
    }
    try:
        resp = requests.get(url, params=params, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        features = data.get('features', [])
        if features:
            return features[0]
    except Exception:
        logger.exception('ArcGIS query failed: %s', url)
    return None


def _extract_geometry(feature):
    """Extract polygon rings from an ArcGIS feature as [[lon, lat], ...] arrays."""
    if not feature:
        return None
    geom = feature.get('geometry')
    if not geom:
        return None
    rings = geom.get('rings')
    if not rings:
        return None
    # Convert to [lat, lon] for Leaflet (ArcGIS returns [lon, lat])
    return [[[pt[1], pt[0]] for pt in ring] for ring in rings]


def _fetch_tpad_data(gislink, county_code=None):
    """
    Query the TPAD API for owner name, property class, sale date, etc.
    Returns dict with extracted fields, or empty dict on failure.
    """
    if not gislink:
        return {}
    jur = county_code or gislink[:3]
    try:
        resp = requests.post(
            TPAD_SEARCH_URL,
            data={'Jur': jur, 'GISLink': gislink},
            headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0',
            },
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        results = resp.json()
        if not isinstance(results, list) or not results:
            return {}
        rec = results[0]
        prop_type_code = (rec.get('propertyType') or '').strip()
        return {
            'owner_name': (rec.get('owner') or '').strip(),
            'property_class': (rec.get('class') or '').strip(),
            'property_type': PROPERTY_TYPE_CODES.get(prop_type_code, prop_type_code),
            'last_sale_date': (rec.get('dateOfSaleShort') or '').strip(),
            'property_address': (rec.get('searchPropertyAddress') or '').strip(),
            'gis_map_link': (rec.get('gisMap') or '').strip(),
        }
    except Exception:
        logger.exception('TPAD lookup failed for GISLINK: %s', gislink)
    return {}


def _build_tpad_link(gislink):
    """Build a TPAD Search URL from a GISLINK."""
    if not gislink:
        return ''
    jur = gislink[:3]
    control_map = gislink[3:6] if len(gislink) >= 6 else ''
    parcel_num = gislink.split()[-1] if gislink.strip() else ''
    search_params = json.dumps({
        'Jur': jur,
        'ControlMap': control_map,
        'ParcelNumber': parcel_num,
        'GISLink': gislink,
    }, separators=(',', ':'))
    return (
        f'https://assessment.cot.tn.gov/TPAD/Search'
        f'?serializedParameters={quote(search_params)}'
    )


def _try_county_service(lat, lon):
    """Try county-specific services that return owner name + geometry."""
    for county, cfg in COUNTY_SERVICES.items():
        feature = _query_arcgis(
            cfg['url'], lat, lon, cfg['out_fields'], return_geometry=True,
        )
        if feature:
            attrs = feature.get('attributes', {})
            owner_name = attrs.get(cfg['owner_field'], '') or ''
            return {
                'found': True,
                'source': f'county_{county.lower()}',
                'county': county,
                'owner_name': owner_name,
                'parcel_id': str(attrs.get(cfg['parcel_field'], '') or ''),
                'parcel_address': attrs.get(cfg['address_field'], '') or '',
                'parcel_acreage': attrs.get(cfg['acres_field']),
                'parcel_land_use': attrs.get(cfg.get('land_use_field', ''), '') or '',
                'parcel_appraised_value': attrs.get(cfg['appraisal_field']),
                'tpad_link': '',
                'parcel_geometry': _extract_geometry(feature),
            }
    return None


def _build_full_address(street, county, state='TN'):
    """Combine street, county, and state into a full address string."""
    parts = []
    if street:
        parts.append(street.strip().title())
    if county:
        parts.append(f'{county.strip().title()} County')
    if state:
        parts.append(state)
    return ', '.join(parts) if parts else ''


def _try_statewide(lat, lon):
    """
    Query the statewide COMPTROLLER_OLG_LANDUSE service.
    Returns parcel data + boundary geometry + TPAD enrichment (owner, class, etc.).
    """
    feature = _query_arcgis(
        STATEWIDE_URL, lat, lon, out_fields='*', return_geometry=True,
    )
    if not feature:
        return None

    attrs = feature.get('attributes', {})
    county = attrs.get('COUNTY', '') or ''
    gislink = attrs.get('GISLINK', '') or ''
    parcel = attrs.get('PARCEL', '') or ''

    # Enrich with TPAD data (owner name, class, sale date, etc.)
    tpad = _fetch_tpad_data(gislink)

    # Best address: prefer ArcGIS (standard format like "205 MCCOY ST"),
    # fall back to TPAD (reversed format like "MCCOY ST  205")
    street = (attrs.get('ADDRESS') or '').strip() or tpad.get('property_address', '')

    return {
        'found': True,
        'source': 'tn_statewide',
        'county': county,
        'owner_name': tpad.get('owner_name', ''),
        'parcel_id': str(parcel or gislink),
        'parcel_address': _build_full_address(street, county),
        'parcel_acreage': attrs.get('LU_ACRES'),
        'parcel_land_use': attrs.get('LU_CLASSIFICATION', '') or '',
        'parcel_appraised_value': attrs.get('APPRAISAL'),
        'tpad_link': _build_tpad_link(gislink),
        'parcel_geometry': _extract_geometry(feature),
        'property_class': tpad.get('property_class', ''),
        'property_type': tpad.get('property_type', ''),
        'last_sale_date': tpad.get('last_sale_date', ''),
        'gis_map_link': tpad.get('gis_map_link', ''),
    }


def lookup_parcel(lat, lon):
    """
    Look up parcel information from TN GIS services.

    Tries county-specific services first (which return owner name),
    then falls back to the statewide service.

    Returns dict with keys: found, source, county, owner_name,
    parcel_id, parcel_address, parcel_acreage, parcel_land_use,
    parcel_appraised_value, tpad_link, parcel_geometry,
    property_class, property_type, last_sale_date, gis_map_link.
    """
    # County-specific (has owner name natively)
    result = _try_county_service(lat, lon)
    if result:
        return result

    # Statewide (parcel data + geometry + TPAD owner lookup)
    result = _try_statewide(lat, lon)
    if result:
        return result

    return {'found': False, 'source': '', 'error': 'No parcel data found'}
