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
    CavePermission, CaveShareLink,
)
from .serializers import (
    CaveListSerializer, CaveDetailSerializer,
    CavePhotoSerializer, CaveCommentSerializer,
    DescriptionRevisionSerializer,
    CavePermissionSerializer, CaveShareLinkSerializer,
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
            cave = serializer.save()
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
        serializer = CaveDetailSerializer(cave, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
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
        created_by_id=request.data.get('created_by'),
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
