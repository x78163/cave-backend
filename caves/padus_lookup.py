"""
PAD-US 4.1 public land lookup service.

Queries the USGS Protected Areas Database of the United States (PAD-US)
ArcGIS Feature Service to determine if a coordinate falls on public land.

Free, no authentication required.
"""

import logging
import time

import requests

logger = logging.getLogger(__name__)

TIMEOUT = 10  # seconds

PADUS_URL = (
    'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services'
    '/Manager_Name_PADUS/FeatureServer/0/query'
)

PADUS_OUT_FIELDS = (
    'Unit_Nm,Own_Type,Mang_Name,Des_Tp,Pub_Access,GIS_Acres,GAP_Sts,Category'
)

# Des_Tp code → human-readable designation
DESIGNATION_TYPES = {
    'NP': 'National Park',
    'NM': 'National Monument',
    'NF': 'National Forest',
    'NG': 'National Grassland',
    'NWR': 'National Wildlife Refuge',
    'NRA': 'National Recreation Area',
    'NLS': 'National Lakeshore or Seashore',
    'NCA': 'National Conservation Area',
    'NT': 'National Trail',
    'WSR': 'Wild and Scenic River',
    'WA': 'Wilderness Area',
    'WSA': 'Wilderness Study Area',
    'RNA': 'Research Natural Area',
    'IRA': 'Inventoried Roadless Area',
    'ACEC': 'Area of Critical Environmental Concern',
    'MPA': 'Marine Protected Area',
    'PUB': 'National Public Lands',
    'MIL': 'Military Land',
    'TRIBL': 'Native American Land',
    'SP': 'State Park',
    'SW': 'State Wilderness',
    'SCA': 'State Conservation Area',
    'SREC': 'State Recreation Area',
    'SHCA': 'State Historic/Cultural Area',
    'LP': 'Local Park',
    'LCA': 'Local Conservation Area',
    'LREC': 'Local Recreation Area',
    'CONE': 'Conservation Easement',
    'PROC': 'Proclamation Boundary',
    'PCON': 'Private Conservation',
    'FOTH': 'Federal Other',
    'SOTH': 'State Other',
    'LOTH': 'Local Other',
    'UNK': 'Unknown',
}

# Mang_Name code → display name
AGENCY_NAMES = {
    'NPS': 'National Park Service',
    'USFS': 'US Forest Service',
    'FWS': 'US Fish & Wildlife Service',
    'BLM': 'Bureau of Land Management',
    'DOD': 'Dept. of Defense',
    'USBR': 'Bureau of Reclamation',
    'USACE': 'US Army Corps of Engineers',
    'TVA': 'Tennessee Valley Authority',
    'DOE': 'Dept. of Energy',
    'NOAA': 'NOAA',
    'NRCS': 'Natural Resources Conservation Service',
    'ARS': 'Agricultural Research Service',
    'BIA': 'Bureau of Indian Affairs',
    'OTHF': 'Other Federal',
    'SPR': 'State Park & Recreation',
    'SDNR': 'State Dept. of Natural Resources',
    'SDC': 'State Dept. of Conservation',
    'SFW': 'State Fish & Wildlife',
    'SLB': 'State Land Board',
    'SDOL': 'State Dept. of Land',
    'OTHS': 'Other State',
    'CITY': 'City/Municipal',
    'CNTY': 'County',
    'REG': 'Regional Agency',
    'UNKL': 'Unknown Local',
    'NGO': 'Non-Governmental Organization',
    'PVT': 'Private',
    'JNT': 'Joint',
    'TRIB': 'Tribal',
    'UNK': 'Unknown',
}

# Pub_Access code → readable text
ACCESS_LEVELS = {
    'OA': 'Open Access',
    'RA': 'Restricted Access',
    'XA': 'Closed',
    'UK': 'Unknown',
}

# Owner type priority (lower = preferred)
_OWN_PRIORITY = {
    'FED': 1, 'STAT': 2, 'LOC': 3, 'JNT': 4,
    'TRIB': 5, 'DIST': 6, 'NGO': 7, 'PVT': 8, 'UNK': 9,
}


def _query_padus(lat, lon, retries=3):
    """Point-in-polygon query against PAD-US. Returns list of all features."""
    params = {
        'where': '1=1',
        'geometry': f'{lon},{lat}',
        'geometryType': 'esriGeometryPoint',
        'inSR': '4326',
        'spatialRel': 'esriSpatialRelIntersects',
        'outFields': PADUS_OUT_FIELDS,
        'returnGeometry': 'false',
        'f': 'json',
    }
    for attempt in range(retries):
        try:
            resp = requests.get(PADUS_URL, params=params, timeout=TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            return data.get('features', [])
        except requests.exceptions.HTTPError as e:
            if resp.status_code in (429, 503) and attempt < retries - 1:
                wait = 2 ** (attempt + 1)  # 2s, 4s
                logger.warning('PAD-US %s, retrying in %ss...', resp.status_code, wait)
                time.sleep(wait)
                continue
            logger.exception('PAD-US query failed for (%s, %s)', lat, lon)
        except Exception:
            logger.exception('PAD-US query failed for (%s, %s)', lat, lon)
            break
    return []


def _select_best_feature(features):
    """Pick the most specific/informative feature from overlapping results."""
    if not features:
        return None
    if len(features) == 1:
        return features[0]

    def score(f):
        attrs = f.get('attributes', {})
        unit_nm = (attrs.get('Unit_Nm') or '').strip()
        cat = attrs.get('Category', '')
        own = attrs.get('Own_Type', 'UNK')
        gap = attrs.get('GAP_Sts', '4')
        acres = attrs.get('GIS_Acres') or 999999999
        des_tp = attrs.get('Des_Tp', '')

        # Penalize generic/empty names
        name_penalty = 0 if unit_nm and 'proclamation' not in unit_nm.lower() else 100
        cat_score = 0 if cat == 'Fee' else 1
        own_score = _OWN_PRIORITY.get(own, 9)
        gap_score = int(gap) if isinstance(gap, str) and gap.isdigit() else 4
        des_known = 0 if des_tp in DESIGNATION_TYPES else 1

        return (name_penalty, cat_score, own_score, gap_score, des_known, acres)

    return min(features, key=score)


def lookup_public_land(lat, lon):
    """
    Query PAD-US to determine if coordinates fall on public land.

    Returns dict:
      found: bool
      public_land_name: str   (e.g. "Great Smoky Mountains National Park")
      public_land_type: str   (e.g. "National Park")
      public_land_owner: str  (e.g. "NPS")
      public_land_access: str (e.g. "Open Access")
    """
    features = _query_padus(lat, lon)
    if not features:
        return {'found': False}

    best = _select_best_feature(features)
    if not best:
        return {'found': False}

    attrs = best.get('attributes', {})
    des_tp = attrs.get('Des_Tp', '')
    mang_name = attrs.get('Mang_Name', '')
    pub_access = attrs.get('Pub_Access', '')

    return {
        'found': True,
        'public_land_name': (attrs.get('Unit_Nm') or '').strip(),
        'public_land_type': DESIGNATION_TYPES.get(des_tp, des_tp),
        'public_land_owner': mang_name,
        'public_land_owner_display': AGENCY_NAMES.get(mang_name, mang_name),
        'public_land_access': ACCESS_LEVELS.get(pub_access, pub_access),
    }
