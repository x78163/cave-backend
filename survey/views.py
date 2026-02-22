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

    created_shots = []
    for i, item in enumerate(serializer.validated_data):
        # Get or create stations
        from_station, _ = SurveyStation.objects.get_or_create(
            survey=survey, name=item['from_station'],
        )
        to_station, _ = SurveyStation.objects.get_or_create(
            survey=survey, name=item['to_station'],
        )

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
        created_shots.append(shot)

    return Response(
        SurveyShotSerializer(created_shots, many=True).data,
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
    return Response(render_data)


@api_view(['GET'])
def survey_render(request, cave_id, survey_id):
    """Get computed render data for a survey (centerlines, walls, stations)."""
    survey = _get_survey_or_404(cave_id, survey_id)
    if not survey:
        return Response({'error': 'Survey not found'}, status=status.HTTP_404_NOT_FOUND)

    render_data = compute_survey(survey)
    return Response(render_data)
