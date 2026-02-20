"""
Views for caves app — full CRUD for cave profiles.
Mirrors cave-server patterns with cloud-specific additions.
"""

import json
import secrets
from pathlib import Path

from django.conf import settings as django_settings
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from .models import (
    Cave, CavePhoto, CaveComment, DescriptionRevision,
    CavePermission, CaveShareLink, LandOwner, CaveRequest,
    SurveyMap, CaveDocument, CaveVideoLink,
)
from .serializers import (
    CaveListSerializer, CaveDetailSerializer,
    CavePhotoSerializer, CaveCommentSerializer,
    DescriptionRevisionSerializer,
    CavePermissionSerializer, CaveShareLinkSerializer,
    LandOwnerSerializer, CaveRequestSerializer,
    SurveyMapSerializer, CaveDocumentSerializer, CaveVideoLinkSerializer,
)


@api_view(['POST'])
def resolve_map_url(request):
    """
    Resolve a shortened map URL (e.g. maps.app.goo.gl/...) by following
    redirects, then extract coordinates from the final URL.
    """
    import re
    import requests as http_requests

    url = (request.data.get('url') or '').strip()
    if not url:
        return Response(
            {'error': 'No URL provided'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Only allow map-related domains
    allowed = ('maps.app.goo.gl', 'goo.gl', 'maps.google', 'google.com/maps',
               'earth.google', 'maps.apple.com')
    if not any(domain in url for domain in allowed):
        return Response(
            {'error': 'URL does not appear to be a map link'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        # Use GET (not HEAD) — Google returns fuller redirect URLs for GET
        resp = http_requests.get(
            url, allow_redirects=True, timeout=10, stream=True,
            headers={'User-Agent': 'Mozilla/5.0'},
        )
        resp.close()
        final_url = resp.url
    except Exception:
        return Response(
            {'error': 'Could not resolve URL'},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    # Extract coordinates from the resolved URL
    # Order matters: !3d!4d is the exact pin, @ is the viewport center
    patterns = [
        r'!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)',       # !3d<lat>!4d<lon> (pin)
        r'place/(-?\d+\.?\d*),(-?\d+\.?\d*)',       # place/lat,lon
        r'[?&](?:ll|q|sll)=(-?\d+\.?\d*),(-?\d+\.?\d*)',  # ?ll=lat,lon
        r'@(-?\d+\.?\d*),(-?\d+\.?\d*)',            # /@lat,lon (viewport)
    ]
    for pattern in patterns:
        m = re.search(pattern, final_url)
        if m:
            lat, lon = float(m.group(1)), float(m.group(2))
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return Response({
                    'lat': round(lat, 6),
                    'lon': round(lon, 6),
                    'resolved_url': final_url,
                })

    return Response(
        {'error': 'Resolved URL does not contain coordinates', 'resolved_url': final_url},
        status=status.HTTP_422_UNPROCESSABLE_ENTITY,
    )


@api_view(['GET', 'POST'])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def cave_list(request):
    """List all caves or create a new cave."""
    if request.method == 'GET':
        caves = Cave.objects.all()
        serializer = CaveListSerializer(caves, many=True)
        return Response({'caves': serializer.data, 'count': caves.count()})

    elif request.method == 'POST':
        serializer = CaveDetailSerializer(data=request.data)
        if serializer.is_valid():
            kwargs = {}
            if request.user.is_authenticated:
                kwargs['owner'] = request.user
            cave = serializer.save(**kwargs)
            if cave.description:
                DescriptionRevision.objects.create(
                    cave=cave,
                    content=cave.description,
                    edit_summary='Initial description',
                    revision_number=1,
                )
            return Response(
                CaveDetailSerializer(cave, context={'request': request}).data,
                status=status.HTTP_201_CREATED,
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def cave_detail(request, cave_id):
    """Get, update, or delete a cave profile."""
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    ctx = {'request': request}

    if request.method == 'GET':
        serializer = CaveDetailSerializer(cave, context=ctx)
        return Response(serializer.data)

    elif request.method in ('PUT', 'PATCH'):
        old_lat, old_lon = cave.latitude, cave.longitude
        serializer = CaveDetailSerializer(cave, data=request.data, partial=True, context=ctx)
        if serializer.is_valid():
            cave = serializer.save()
            # If coordinates changed, clear stale GIS parcel data
            coords_changed = (cave.latitude != old_lat or cave.longitude != old_lon)
            if coords_changed:
                try:
                    lo = cave.land_owner
                    lo.parcel_id = ''
                    lo.parcel_address = ''
                    lo.parcel_acreage = None
                    lo.parcel_land_use = ''
                    lo.parcel_appraised_value = None
                    lo.gis_county = ''
                    lo.gis_source = ''
                    lo.gis_lookup_at = None
                    lo.tpad_link = ''
                    lo.owner_name = ''
                    lo.parcel_geometry = None
                    lo.property_class = ''
                    lo.property_type = ''
                    lo.last_sale_date = ''
                    lo.gis_map_link = ''
                    lo.save()
                except LandOwner.DoesNotExist:
                    pass
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == 'DELETE':
        cave.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def cave_photo_upload(request, cave_id):
    """Upload a photo to a cave."""
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    serializer = CavePhotoSerializer(data=request.data)
    if serializer.is_valid():
        serializer.save(cave=cave)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['PATCH', 'DELETE'])
@parser_classes([JSONParser])
def cave_photo_detail(request, cave_id, photo_id):
    """Update or delete a photo."""
    try:
        photo = CavePhoto.objects.get(id=photo_id, cave_id=cave_id)
    except CavePhoto.DoesNotExist:
        return Response({'error': 'Photo not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'PATCH':
        serializer = CavePhotoSerializer(photo, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == 'DELETE':
        photo.image.delete()
        photo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST'])
def cave_comment_add(request, cave_id):
    """List or add comments to a cave."""
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        comments = cave.comments.all()
        serializer = CaveCommentSerializer(comments, many=True)
        return Response({'comments': serializer.data, 'count': comments.count()})

    elif request.method == 'POST':
        serializer = CaveCommentSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(cave=cave)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'POST'])
def cave_description(request, cave_id):
    """
    GET: List all description revisions (wiki history).
    POST: Create a new revision (edit description).
    """
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        revisions = cave.revisions.all()
        serializer = DescriptionRevisionSerializer(revisions, many=True)
        return Response({
            'revisions': serializer.data,
            'count': revisions.count(),
            'current_description': cave.description,
        })

    elif request.method == 'POST':
        content = request.data.get('content', '')
        edit_summary = request.data.get('edit_summary', '')
        editor_name = request.data.get('editor_name', 'Device User')

        last_rev = cave.revisions.first()
        next_num = (last_rev.revision_number + 1) if last_rev else 1

        revision = DescriptionRevision.objects.create(
            cave=cave,
            content=content,
            edit_summary=edit_summary,
            editor_name=editor_name,
            revision_number=next_num,
        )

        cave.description = content
        cave.save(update_fields=['description', 'updated_at'])

        serializer = DescriptionRevisionSerializer(revision)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'POST'])
def cave_permissions(request, cave_id):
    """List or add permissions for a cave."""
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        perms = cave.permissions.all()
        serializer = CavePermissionSerializer(perms, many=True)
        return Response({'permissions': serializer.data, 'count': perms.count()})

    elif request.method == 'POST':
        serializer = CavePermissionSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(cave=cave)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
def cave_share(request, cave_id):
    """Generate a share link for a cave."""
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    role = request.data.get('role', CavePermission.Role.VIEWER)
    expires_at = request.data.get('expires_at')
    max_uses = request.data.get('max_uses')

    share_link = CaveShareLink.objects.create(
        cave=cave,
        created_by=request.user if request.user.is_authenticated else None,
        token=secrets.token_urlsafe(32),
        role=role,
        expires_at=expires_at,
        max_uses=max_uses,
    )

    serializer = CaveShareLinkSerializer(share_link)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
def cave_map_data(request, cave_id):
    """
    Serve 2D cave map data (walls, trajectory, levels) for the CaveMapCanvas.
    Map data is stored as a JSON file in media/caves/<cave_id>/map_data.json.
    Supports ?mode=<mode> query param to select render mode variant.
    """
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if not cave.has_map:
        return Response({'error': 'No map data available'}, status=status.HTTP_404_NOT_FOUND)

    mode = request.query_params.get('mode', None)
    map_dir = Path(django_settings.MEDIA_ROOT) / 'caves' / str(cave_id)

    # Try mode-specific file first, then default
    candidates = []
    if mode:
        candidates.append(map_dir / f'map_data_{mode}.json')
    candidates.append(map_dir / 'map_data.json')

    for path in candidates:
        if path.exists():
            with open(path) as f:
                data = json.load(f)
            # Inject available modes from directory
            available_modes = []
            for p in map_dir.glob('map_data_*.json'):
                m = p.stem.replace('map_data_', '')
                available_modes.append(m)
            if not available_modes and (map_dir / 'map_data.json').exists():
                available_modes = ['standard']
            data['available_modes'] = sorted(available_modes) if available_modes else ['standard']
            data['mode'] = mode or data.get('mode', 'standard')
            return Response(data)

    return Response({'error': 'Map data file not found'}, status=status.HTTP_404_NOT_FOUND)


@api_view(['GET', 'PUT', 'PATCH'])
def cave_land_owner(request, cave_id):
    """Get or update land owner info for a cave."""
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        try:
            lo = cave.land_owner
        except LandOwner.DoesNotExist:
            return Response(None, status=status.HTTP_200_OK)
        serializer = LandOwnerSerializer(lo)
        return Response(serializer.data)

    # PUT/PATCH — create or update (cave owner only)
    lo, _created = LandOwner.objects.get_or_create(cave=cave)
    serializer = LandOwnerSerializer(lo, data=request.data, partial=(request.method == 'PATCH'))
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
def cave_land_owner_gis_lookup(request, cave_id):
    """Look up parcel/owner info from TN GIS using the cave's coordinates."""
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if not cave.has_location:
        return Response(
            {'error': 'Cave has no coordinates set'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    from .gis_lookup import lookup_parcel

    result = lookup_parcel(cave.latitude, cave.longitude)
    if not result.get('found'):
        return Response(
            {'error': 'No parcel data found for these coordinates', 'detail': result},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Auto-save to LandOwner if requested
    if request.data.get('save', True):
        from django.utils import timezone

        lo, _created = LandOwner.objects.get_or_create(cave=cave)
        lo.parcel_id = result.get('parcel_id', '')
        lo.parcel_address = result.get('parcel_address', '')
        lo.parcel_acreage = result.get('parcel_acreage')
        lo.parcel_land_use = result.get('parcel_land_use', '')
        lo.parcel_appraised_value = result.get('parcel_appraised_value')
        lo.gis_county = result.get('county', '')
        lo.gis_source = result.get('source', '')
        lo.gis_lookup_at = timezone.now()
        lo.tpad_link = result.get('tpad_link', '')
        lo.parcel_geometry = result.get('parcel_geometry')
        lo.property_class = result.get('property_class', '')
        lo.property_type = result.get('property_type', '')
        lo.last_sale_date = result.get('last_sale_date', '')
        lo.gis_map_link = result.get('gis_map_link', '')
        if result.get('owner_name'):
            lo.owner_name = result['owner_name']
        lo.save()
        result['saved'] = True
        result['land_owner'] = LandOwnerSerializer(lo).data

    return Response(result)


# ── Cave Requests ─────────────────────────────────────────────


@api_view(['GET', 'POST'])
def cave_requests(request, cave_id):
    """
    GET: List requests for a cave. Owner sees all; others see only their own.
    POST: Create a contact_access or contact_submission request.
    """
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        is_owner = (
            request.user.is_authenticated
            and cave.owner_id
            and cave.owner_id == request.user.id
        )
        if is_owner:
            qs = cave.requests.select_related('requester', 'resolved_by')
            req_status = request.query_params.get('status')
            if req_status:
                qs = qs.filter(status=req_status)
        elif request.user.is_authenticated:
            qs = cave.requests.filter(requester=request.user)
        else:
            qs = CaveRequest.objects.none()

        serializer = CaveRequestSerializer(qs, many=True)
        return Response({'requests': serializer.data, 'count': qs.count()})

    # POST
    if not request.user.is_authenticated:
        return Response(
            {'error': 'Authentication required'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    request_type = request.data.get('request_type')
    if request_type not in ('contact_access', 'contact_submission'):
        return Response(
            {'error': 'request_type must be "contact_access" or "contact_submission"'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if cave.owner_id == request.user.id:
        return Response(
            {'error': 'Cave owner does not need to request access'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    existing = CaveRequest.objects.filter(
        cave=cave, requester=request.user,
        request_type=request_type, status='pending',
    ).exists()
    if existing:
        return Response(
            {'error': 'You already have a pending request of this type'},
            status=status.HTTP_409_CONFLICT,
        )

    payload = None
    if request_type == 'contact_submission':
        payload = request.data.get('payload')
        if not payload or not isinstance(payload, dict):
            return Response(
                {'error': 'Contact submission requires a payload with contact fields'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not any(payload.get(k) for k in ('phone', 'email', 'address')):
            return Response(
                {'error': 'Payload must include at least phone, email, or address'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    cave_request = CaveRequest.objects.create(
        cave=cave,
        requester=request.user,
        request_type=request_type,
        message=request.data.get('message', ''),
        payload=payload,
    )
    serializer = CaveRequestSerializer(cave_request)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH'])
def cave_request_resolve(request, cave_id, request_id):
    """Accept or deny a cave request. Only the cave owner can resolve."""
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_authenticated or cave.owner_id != request.user.id:
        return Response(
            {'error': 'Only the cave owner can resolve requests'},
            status=status.HTTP_403_FORBIDDEN,
        )

    try:
        cave_request = CaveRequest.objects.get(id=request_id, cave=cave)
    except CaveRequest.DoesNotExist:
        return Response({'error': 'Request not found'}, status=status.HTTP_404_NOT_FOUND)

    if cave_request.status != 'pending':
        return Response(
            {'error': f'Request is already {cave_request.status}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    new_status = request.data.get('status')
    if new_status not in ('accepted', 'denied'):
        return Response(
            {'error': 'status must be "accepted" or "denied"'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    from django.utils import timezone

    cave_request.status = new_status
    cave_request.resolved_by = request.user
    cave_request.resolved_at = timezone.now()
    cave_request.save(update_fields=['status', 'resolved_by', 'resolved_at'])

    if new_status == 'accepted':
        if cave_request.request_type == 'contact_access':
            lo, _ = LandOwner.objects.get_or_create(cave=cave)
            lo.contact_access_users.add(cave_request.requester)

        elif cave_request.request_type == 'contact_submission':
            lo, _ = LandOwner.objects.get_or_create(cave=cave)
            payload = cave_request.payload or {}
            if payload.get('phone'):
                lo.phone = payload['phone']
            if payload.get('email'):
                lo.email = payload['email']
            if payload.get('address'):
                lo.address = payload['address']
            if payload.get('notes'):
                if lo.notes:
                    lo.notes += f'\n\n--- Submitted by {cave_request.requester.username} ---\n{payload["notes"]}'
                else:
                    lo.notes = payload['notes']
            if payload.get('owner_name'):
                lo.owner_name = payload['owner_name']
            lo.save()

    serializer = CaveRequestSerializer(cave_request)
    return Response(serializer.data)


@api_view(['DELETE'])
def cave_request_delete(request, cave_id, request_id):
    """Delete/cancel a request. Requester or cave owner can delete."""
    try:
        cave_request = CaveRequest.objects.get(id=request_id, cave_id=cave_id)
    except CaveRequest.DoesNotExist:
        return Response({'error': 'Request not found'}, status=status.HTTP_404_NOT_FOUND)

    is_requester = request.user.is_authenticated and cave_request.requester_id == request.user.id
    is_owner = request.user.is_authenticated and cave_request.cave.owner_id == request.user.id
    if not is_requester and not is_owner:
        return Response(
            {'error': 'Not authorized to delete this request'},
            status=status.HTTP_403_FORBIDDEN,
        )

    cave_request.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ── CSV Bulk Import ──────────────────────────────────────────


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def cave_import_preview(request):
    """
    Phase 1 of CSV import: parse the file and detect coordinate-proximity duplicates.
    Admin-only (is_staff or is_superuser).
    """
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)
    if not (request.user.is_staff or request.user.is_superuser):
        return Response({'error': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)

    csv_file = request.FILES.get('csv_file')
    if not csv_file:
        return Response({'error': 'No CSV file provided'}, status=status.HTTP_400_BAD_REQUEST)

    if csv_file.size > 5 * 1024 * 1024:
        return Response({'error': 'CSV file too large (max 5MB)'}, status=status.HTTP_400_BAD_REQUEST)

    from .csv_import import normalize_csv_rows, parse_cave_row, find_proximity_duplicates

    threshold = float(request.data.get('threshold_meters', 100))
    defaults = {
        'region': request.data.get('region', ''),
        'country': request.data.get('country', ''),
        'visibility': request.data.get('visibility', 'public'),
    }

    content = csv_file.read().decode('utf-8-sig')
    rows = normalize_csv_rows(content)

    parsed = []
    summary = {'valid': 0, 'errors': 0, 'with_duplicates': 0, 'without_coordinates': 0}

    for i, row in enumerate(rows):
        result = parse_cave_row(row, defaults)
        entry = {
            'row_number': i + 2,  # 1-indexed, skip header
            'name': result['name'],
            'latitude': result['latitude'],
            'longitude': result['longitude'],
            'error': result['error'],
            'duplicates': [],
            'region': result['data'].get('region', ''),
            'country': result['data'].get('country', ''),
            'total_length': result['data'].get('total_length'),
            'vertical_extent': result['data'].get('vertical_extent'),
            'description_preview': (result['data'].get('description') or '')[:200],
            'cave_data': result['data'],
        }

        if result['error']:
            summary['errors'] += 1
        else:
            summary['valid'] += 1
            if result['latitude'] is None:
                summary['without_coordinates'] += 1
            else:
                dupes = find_proximity_duplicates(
                    result['latitude'], result['longitude'], threshold
                )
                entry['duplicates'] = dupes
                if dupes:
                    summary['with_duplicates'] += 1

        parsed.append(entry)

    return Response({
        'total_rows': len(rows),
        'parsed_rows': parsed,
        'summary': summary,
    })


@api_view(['POST'])
@parser_classes([JSONParser])
def cave_import_apply(request):
    """
    Phase 2 of CSV import: create/update caves based on user resolutions.
    Admin-only (is_staff or is_superuser).
    """
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)
    if not (request.user.is_staff or request.user.is_superuser):
        return Response({'error': 'Admin access required'}, status=status.HTTP_403_FORBIDDEN)

    rows = request.data.get('rows', [])
    if not rows:
        return Response({'error': 'No rows provided'}, status=status.HTTP_400_BAD_REQUEST)

    created_count = 0
    updated_count = 0
    skipped_count = 0
    errors = []

    for row in rows:
        name = row.get('new_name') or row.get('name')
        cave_data = row.get('cave_data', {})
        resolution = row.get('resolution', 'create')
        existing_id = row.get('existing_cave_id')

        if resolution == 'skip':
            skipped_count += 1
            continue

        # Strip fields that shouldn't come from CSV
        cave_data.pop('owner', None)

        if resolution == 'update' and existing_id:
            try:
                existing = Cave.objects.get(id=existing_id)
                for field, value in cave_data.items():
                    if value is not None and value != '' and value != 0:
                        setattr(existing, field, value)
                existing.save()
                updated_count += 1
            except Cave.DoesNotExist:
                errors.append({'row_name': name, 'error': f'Cave {existing_id} not found'})
            except Exception as e:
                errors.append({'row_name': name, 'error': str(e)})
            continue

        # resolution == 'create'
        try:
            Cave.objects.create(
                name=name,
                owner=request.user,
                **cave_data,
            )
            created_count += 1
        except Exception as e:
            errors.append({'row_name': name, 'error': str(e)})

    return Response({
        'created': created_count,
        'updated': updated_count,
        'skipped': skipped_count,
        'errors': errors,
        'total_in_database': Cave.objects.count(),
    })


# ── Survey map overlays ─────────────────────────────────────────────────

@api_view(['GET', 'POST'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def survey_map_list_create(request, cave_id):
    """List or create survey maps for a cave.

    GET:  Return all survey maps for this cave.
    POST: Upload image, process (strip bg + recolor), create SurveyMap record.
    """
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        surveys = cave.survey_maps.all()
        serializer = SurveyMapSerializer(surveys, many=True, context={'request': request})
        return Response(serializer.data)

    # POST — upload + process
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)

    image_file = request.FILES.get('image')
    if not image_file:
        return Response({'error': 'No image file provided'}, status=status.HTTP_400_BAD_REQUEST)

    name = request.data.get('name', '')
    color_hex = request.data.get('color', '#ffa726')
    try:
        r, g, b = int(color_hex[1:3], 16), int(color_hex[3:5], 16), int(color_hex[5:7], 16)
        color = (r, g, b)
    except (ValueError, IndexError):
        color = (0, 229, 255)

    from io import BytesIO
    from PIL import Image
    from django.core.files.base import ContentFile
    from .hand_drawn_map import process_hand_drawn_map

    # Process the image
    processed_bytes = process_hand_drawn_map(image_file, color=color)
    processed_img = Image.open(BytesIO(processed_bytes))
    img_width, img_height = processed_img.size

    # Save original as PNG
    image_file.seek(0)
    orig_img = Image.open(image_file).convert('RGB')
    orig_buf = BytesIO()
    orig_img.save(orig_buf, format='PNG')

    import uuid as uuid_mod
    file_id = uuid_mod.uuid4().hex[:12]

    survey = SurveyMap(
        cave=cave,
        name=name,
        image_width=img_width,
        image_height=img_height,
        uploaded_by=request.user,
    )
    survey.overlay_image.save(f'{file_id}_overlay.png', ContentFile(processed_bytes), save=False)
    survey.original_image.save(f'{file_id}_original.png', ContentFile(orig_buf.getvalue()), save=False)
    survey.save()

    serializer = SurveyMapSerializer(survey, context={'request': request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
@parser_classes([JSONParser])
def survey_map_detail(request, cave_id, survey_id):
    """Get, update calibration, or delete a single survey map.

    GET:    Return survey map detail.
    PATCH:  Update calibration fields (anchor, scale, heading, opacity, name, is_locked).
    DELETE: Remove survey map and its images.
    """
    try:
        survey = SurveyMap.objects.select_related('cave').get(id=survey_id, cave_id=cave_id)
    except SurveyMap.DoesNotExist:
        return Response({'error': 'Survey map not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        serializer = SurveyMapSerializer(survey, context={'request': request})
        return Response(serializer.data)

    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)

    if request.method == 'PATCH':
        serializer = SurveyMapSerializer(survey, data=request.data, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    if request.method == 'DELETE':
        survey.overlay_image.delete(save=False)
        survey.original_image.delete(save=False)
        survey.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── Documents ────────────────────────────────────────────────────────────

@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def cave_document_upload(request, cave_id):
    """Upload a PDF document to a cave."""
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)

    pdf_file = request.FILES.get('file')
    if not pdf_file:
        return Response({'error': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)

    if not pdf_file.name.lower().endswith('.pdf'):
        return Response({'error': 'Only PDF files are accepted'}, status=status.HTTP_400_BAD_REQUEST)

    if pdf_file.size > 50 * 1024 * 1024:
        return Response({'error': 'File too large (max 50MB)'}, status=status.HTTP_400_BAD_REQUEST)

    title = request.data.get('title', '') or pdf_file.name.rsplit('.', 1)[0]
    description = request.data.get('description', '')

    page_count = None
    try:
        import io
        from PyPDF2 import PdfReader
        reader = PdfReader(io.BytesIO(pdf_file.read()))
        page_count = len(reader.pages)
        pdf_file.seek(0)
    except Exception:
        pdf_file.seek(0)

    doc = CaveDocument.objects.create(
        cave=cave,
        file=pdf_file,
        title=title,
        description=description,
        file_size=pdf_file.size,
        page_count=page_count,
        uploaded_by=request.user,
    )
    serializer = CaveDocumentSerializer(doc, context={'request': request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@parser_classes([JSONParser])
def cave_document_detail(request, cave_id, document_id):
    """Update title/description or delete a document."""
    try:
        doc = CaveDocument.objects.get(id=document_id, cave_id=cave_id)
    except CaveDocument.DoesNotExist:
        return Response({'error': 'Document not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'PATCH':
        serializer = CaveDocumentSerializer(doc, data=request.data, partial=True, context={'request': request})
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    if request.method == 'DELETE':
        doc.file.delete()
        doc.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── Video Links ──────────────────────────────────────────────────────────

@api_view(['POST'])
def cave_video_link_add(request, cave_id):
    """Add a video link to a cave. Auto-detects platform and generates embed URL."""
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)

    url = (request.data.get('url') or '').strip()
    if not url:
        return Response({'error': 'URL is required'}, status=status.HTTP_400_BAD_REQUEST)

    from .video_utils import parse_video_url
    parsed = parse_video_url(url)

    video_link = CaveVideoLink.objects.create(
        cave=cave,
        url=url,
        title=request.data.get('title', ''),
        description=request.data.get('description', ''),
        platform=parsed['platform'],
        video_id=parsed['video_id'],
        embed_url=parsed['embed_url'],
        thumbnail_url=parsed['thumbnail_url'],
        added_by=request.user,
    )
    serializer = CaveVideoLinkSerializer(video_link)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@parser_classes([JSONParser])
def cave_video_link_detail(request, cave_id, video_id):
    """Update title/description or delete a video link."""
    try:
        vl = CaveVideoLink.objects.get(id=video_id, cave_id=cave_id)
    except CaveVideoLink.DoesNotExist:
        return Response({'error': 'Video link not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'PATCH':
        new_url = request.data.get('url')
        if new_url and new_url != vl.url:
            from .video_utils import parse_video_url
            parsed = parse_video_url(new_url)
            vl.url = new_url
            vl.platform = parsed['platform']
            vl.video_id = parsed['video_id']
            vl.embed_url = parsed['embed_url']
            vl.thumbnail_url = parsed['thumbnail_url']
        if 'title' in request.data:
            vl.title = request.data['title']
        if 'description' in request.data:
            vl.description = request.data['description']
        vl.save()
        serializer = CaveVideoLinkSerializer(vl)
        return Response(serializer.data)

    if request.method == 'DELETE':
        vl.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
