import json
from pathlib import Path

from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from caves.models import Cave
from .models import CaveSurvey, SurveyStation, SurveyShot
from .serializers import (
    CaveSurveyListSerializer,
    CaveSurveyDetailSerializer,
    SurveyShotSerializer,
    SurveyShotBulkItemSerializer,
)
from .compute import compute_survey
from .slam_survey import generate_slam_survey_data, generate_merged_slam_survey

try:
    from .ocr import extract_shots_from_image
except ImportError:
    extract_shots_from_image = None


def _get_cave_or_404(cave_id):
    try:
        return Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return None


def _get_survey_or_404(cave_id, survey_id):
    try:
        return CaveSurvey.objects.get(id=survey_id, cave_id=cave_id)
    except CaveSurvey.DoesNotExist:
        return None


# ── Survey CRUD ──────────────────────────────────────────────

@api_view(['GET', 'POST'])
def survey_list(request, cave_id):
    """List surveys for a cave or create a new one."""
    cave = _get_cave_or_404(cave_id)
    if not cave:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        surveys = CaveSurvey.objects.filter(cave=cave)
        return Response(CaveSurveyListSerializer(surveys, many=True).data)

    # POST — create new survey
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)

    serializer = CaveSurveyListSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save(cave=cave, created_by=request.user)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
def survey_detail(request, cave_id, survey_id):
    """Get, update, or delete a survey."""
    survey = _get_survey_or_404(cave_id, survey_id)
    if not survey:
        return Response({'error': 'Survey not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(CaveSurveyDetailSerializer(survey).data)

    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)

    if request.method == 'PATCH':
        serializer = CaveSurveyListSerializer(survey, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    if request.method == 'DELETE':
        survey.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── Shot CRUD ────────────────────────────────────────────────

@api_view(['POST'])
def shot_bulk_create(request, cave_id, survey_id):
    """Bulk create shots for a survey. Accepts array of shots with station names.

    Auto-creates SurveyStation records as needed.
    """
    survey = _get_survey_or_404(cave_id, survey_id)
    if not survey:
        return Response({'error': 'Survey not found'}, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)

    # Accept both a single shot and an array
    data = request.data if isinstance(request.data, list) else [request.data]

    serializer = SurveyShotBulkItemSerializer(data=data, many=True)
    serializer.is_valid(raise_exception=True)

    # Get current max shot_order
    max_order = SurveyShot.objects.filter(survey=survey).order_by('-shot_order').values_list(
        'shot_order', flat=True,
    ).first() or 0

    result_shots = []
    for i, item in enumerate(serializer.validated_data):
        # Get or create stations
        from_station, _ = SurveyStation.objects.get_or_create(
            survey=survey, name=item['from_station'],
        )
        to_station, _ = SurveyStation.objects.get_or_create(
            survey=survey, name=item['to_station'],
        )

        # Update existing shot if one matches from→to, otherwise create
        existing = SurveyShot.objects.filter(
            survey=survey, from_station=from_station, to_station=to_station,
        ).first()

        if existing:
            existing.distance = item['distance']
            existing.azimuth = item['azimuth']
            existing.inclination = item.get('inclination', 0)
            existing.left = item.get('left')
            existing.right = item.get('right')
            existing.up = item.get('up')
            existing.down = item.get('down')
            existing.comment = item.get('comment', '')
            existing.save()
            result_shots.append(existing)
        else:
            shot = SurveyShot.objects.create(
                survey=survey,
                from_station=from_station,
                to_station=to_station,
                distance=item['distance'],
                azimuth=item['azimuth'],
                inclination=item.get('inclination', 0),
                left=item.get('left'),
                right=item.get('right'),
                up=item.get('up'),
                down=item.get('down'),
                shot_order=max_order + i + 1,
                comment=item.get('comment', ''),
            )
            result_shots.append(shot)

    return Response(
        SurveyShotSerializer(result_shots, many=True).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['PATCH', 'DELETE'])
def shot_detail(request, cave_id, survey_id, shot_id):
    """Update or delete a single shot."""
    survey = _get_survey_or_404(cave_id, survey_id)
    if not survey:
        return Response({'error': 'Survey not found'}, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)

    try:
        shot = SurveyShot.objects.get(id=shot_id, survey=survey)
    except SurveyShot.DoesNotExist:
        return Response({'error': 'Shot not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        shot.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # PATCH — update shot fields
    updatable = ['distance', 'azimuth', 'inclination', 'left', 'right', 'up', 'down', 'comment']
    update_fields = []
    for field in updatable:
        if field in request.data:
            setattr(shot, field, request.data[field])
            update_fields.append(field)

    # Handle station name changes
    if 'from_station' in request.data:
        station, _ = SurveyStation.objects.get_or_create(
            survey=survey, name=request.data['from_station'],
        )
        shot.from_station = station
        update_fields.append('from_station')

    if 'to_station' in request.data:
        station, _ = SurveyStation.objects.get_or_create(
            survey=survey, name=request.data['to_station'],
        )
        shot.to_station = station
        update_fields.append('to_station')

    if update_fields:
        shot.save(update_fields=update_fields)

    return Response(SurveyShotSerializer(shot).data)


# ── Compute + Render ─────────────────────────────────────────

@api_view(['POST'])
def survey_compute(request, cave_id, survey_id):
    """Recompute station positions, loop closure, and render data."""
    survey = _get_survey_or_404(cave_id, survey_id)
    if not survey:
        return Response({'error': 'Survey not found'}, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)

    render_data = compute_survey(survey)

    # Persist render data for instant reload
    survey.render_data = render_data
    survey.save(update_fields=['render_data'])

    return Response(render_data)


@api_view(['POST'])
def survey_ocr(request, cave_id, survey_id):
    """Extract survey shots from a photographed/scanned survey sheet using OCR."""
    survey = _get_survey_or_404(cave_id, survey_id)
    if not survey:
        return Response({'error': 'Survey not found'}, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)

    image = request.FILES.get('image')
    if not image:
        return Response({'error': 'No image file provided'}, status=status.HTTP_400_BAD_REQUEST)

    # Validate file type
    allowed = {'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'}
    if image.content_type not in allowed:
        return Response(
            {'error': f'Unsupported image type: {image.content_type}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Optional row count hint from user
    expected_rows = request.data.get('expected_rows')
    if expected_rows is not None:
        try:
            expected_rows = int(expected_rows)
        except (ValueError, TypeError):
            expected_rows = None

    if extract_shots_from_image is None:
        return Response(
            {'error': 'OCR not available on this server (torch not installed)'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    try:
        result = extract_shots_from_image(image, expected_rows=expected_rows)
        return Response(result)
    except Exception as e:
        return Response(
            {'error': f'OCR processing failed: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['GET'])
def survey_render(request, cave_id, survey_id):
    """Get computed render data for a survey (centerlines, walls, stations).
    Returns cached render_data if available, otherwise recomputes."""
    survey = _get_survey_or_404(cave_id, survey_id)
    if not survey:
        return Response({'error': 'Survey not found'}, status=status.HTTP_404_NOT_FOUND)

    if survey.render_data:
        return Response(survey.render_data)

    render_data = compute_survey(survey)
    survey.render_data = render_data
    survey.save(update_fields=['render_data'])
    return Response(render_data)


# ── SLAM Survey Generation ──────────────────────────────────

def _create_slam_survey_for_level(cave, user, map_data, level_idx, min_spacing):
    """Create a single SLAM survey for one level. Returns summary dict or None on error."""
    try:
        result = generate_slam_survey_data(map_data, level_idx, min_spacing)
    except ValueError:
        return None

    level_name = map_data.get('levels', [{}])[level_idx].get('name', f'Level {level_idx + 1}')
    survey = CaveSurvey.objects.create(
        cave=cave,
        name=f'SLAM Survey - {level_name}',
        source='slam',
        unit='meters',
        declination=0,
        created_by=user,
    )

    for i, shot_data in enumerate(result['shots']):
        from_st, _ = SurveyStation.objects.get_or_create(
            survey=survey, name=shot_data['from_station'],
        )
        to_st, _ = SurveyStation.objects.get_or_create(
            survey=survey, name=shot_data['to_station'],
        )
        SurveyShot.objects.create(
            survey=survey,
            from_station=from_st,
            to_station=to_st,
            distance=shot_data['distance'],
            azimuth=shot_data['azimuth'],
            inclination=shot_data['inclination'],
            left=shot_data['left'],
            right=shot_data['right'],
            up=shot_data['up'],
            down=shot_data['down'],
            comment=shot_data.get('comment', ''),
            shot_order=i,
        )

    render_data = compute_survey(survey)
    survey.render_data = render_data
    survey.save(update_fields=['render_data'])

    return {
        'survey_id': str(survey.id),
        'level': level_idx,
        'level_name': level_name,
        'stations': len(result['stations']),
        'shots': len(result['shots']),
        'leads': len(result.get('leads', [])),
    }


@api_view(['POST'])
def generate_slam_survey(request, cave_id):
    """Generate traditional surveys from SLAM map data (wall polylines + trajectory).

    Reads map_data.json for the cave, raycasts against 2D walls to derive LRUD,
    creates CaveSurvey records with synthetic shots, and auto-computes render data.

    Pass level='all' (default) to generate for all levels, or level=0/1/... for a single level.
    """
    cave = _get_cave_or_404(cave_id)
    if not cave:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)

    # Load map data
    from django.core.files.storage import default_storage
    storage_path = f'caves/{cave_id}/map_data.json'
    if not default_storage.exists(storage_path):
        # Try auto-generating from mesh
        mesh_path = f'caves/{cave_id}/cave_mesh.glb'
        traj_path = f'caves/{cave_id}/trajectory.json'
        if default_storage.exists(mesh_path) and default_storage.exists(traj_path):
            try:
                from reconstruction.map_from_mesh import generate_map_data as gen_map
                gen_map(str(cave_id))
            except Exception:
                pass
        if not default_storage.exists(storage_path):
            return Response({'error': 'No map data available for this cave'}, status=status.HTTP_400_BAD_REQUEST)

    with default_storage.open(storage_path, 'r') as f:
        map_data = json.load(f)
    min_spacing = float(request.data.get('min_spacing', 0.5))
    level_param = request.data.get('level', 'all')

    num_levels = len(map_data.get('levels', []))
    if num_levels == 0:
        return Response({'error': 'No levels in map data'}, status=status.HTTP_400_BAD_REQUEST)

    if level_param == 'all':
        # Merged: all levels in one survey, connected via transitions
        try:
            result = generate_merged_slam_survey(map_data, min_spacing)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        survey_name = 'SLAM Survey'
        if num_levels > 1:
            survey_name += f' ({num_levels} levels)'

        survey = CaveSurvey.objects.create(
            cave=cave, name=survey_name, source='slam',
            unit='meters', declination=0, created_by=request.user,
        )

        for i, shot_data in enumerate(result['shots']):
            from_st, _ = SurveyStation.objects.get_or_create(
                survey=survey, name=shot_data['from_station'],
            )
            to_st, _ = SurveyStation.objects.get_or_create(
                survey=survey, name=shot_data['to_station'],
            )
            SurveyShot.objects.create(
                survey=survey, from_station=from_st, to_station=to_st,
                distance=shot_data['distance'], azimuth=shot_data['azimuth'],
                inclination=shot_data['inclination'],
                left=shot_data['left'], right=shot_data['right'],
                up=shot_data['up'], down=shot_data['down'],
                comment=shot_data.get('comment', ''),
                shot_order=i,
            )

        render_data = compute_survey(survey)
        survey.render_data = render_data
        survey.save(update_fields=['render_data'])

        return Response({
            'survey_id': str(survey.id),
            'stations': len(result['stations']),
            'shots': len(result['shots']),
            'leads': len(result.get('leads', [])),
        }, status=status.HTTP_201_CREATED)
    else:
        # Single level
        summary = _create_slam_survey_for_level(
            cave, request.user, map_data, int(level_param), min_spacing,
        )
        if not summary:
            return Response({'error': 'Failed to generate survey for this level'}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'survey_id': summary['survey_id'],
            'stations': summary['stations'],
            'shots': summary['shots'],
            'leads': summary['leads'],
        }, status=status.HTTP_201_CREATED)
