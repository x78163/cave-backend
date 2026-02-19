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
    CavePermission, CaveShareLink, LandOwner,
)
from .serializers import (
    CaveListSerializer, CaveDetailSerializer,
    CavePhotoSerializer, CaveCommentSerializer,
    DescriptionRevisionSerializer,
    CavePermissionSerializer, CaveShareLinkSerializer,
    LandOwnerSerializer,
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
                CaveDetailSerializer(cave).data,
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

    if request.method == 'GET':
        serializer = CaveDetailSerializer(cave)
        return Response(serializer.data)

    elif request.method in ('PUT', 'PATCH'):
        old_lat, old_lon = cave.latitude, cave.longitude
        serializer = CaveDetailSerializer(cave, data=request.data, partial=True)
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
