"""Views for cave route computation, saving, and PDF export."""

import json
import logging
from pathlib import Path

from django.conf import settings as django_settings
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from caves.models import Cave
from mapping.models import PointOfInterest

from .models import CaveRoute
from .serializers import CaveRouteSerializer
from .engine import build_costmaps_from_map_data, route_through_waypoints
from .junctions import detect_junctions
from .instructions import generate_instructions

logger = logging.getLogger(__name__)


def _load_map_data(cave, mode='heatmap'):
    """Load map_data JSON for a cave."""
    map_path = (
        Path(django_settings.MEDIA_ROOT) / 'caves' / str(cave.id)
        / f'map_data_{mode}.json'
    )
    if not map_path.exists():
        return None
    with open(map_path) as f:
        return json.load(f)


def _load_spawn_data(cave):
    """Load spawn.json for a cave (3D keyframe poses)."""
    spawn_path = (
        Path(django_settings.MEDIA_ROOT) / 'caves' / str(cave.id)
        / 'spawn.json'
    )
    if not spawn_path.exists():
        return None
    with open(spawn_path) as f:
        return json.load(f)


@api_view(['POST'])
def compute_route(request, cave_id):
    """Compute a route through a cave without saving it.

    POST body:
    {
        "waypoints": [
            {"slam_x": 0.1, "slam_y": 0.2, "level": 0, "label": "Start"},
            {"slam_x": 1.5, "slam_y": 5.3, "level": 0, "label": "End"}
        ],
        "speed_kmh": 1.0,
        "inflation_radius": 0.24
    }
    """
    try:
        cave = Cave.objects.get(pk=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    waypoints = request.data.get('waypoints', [])
    if len(waypoints) < 2:
        return Response(
            {'error': 'At least 2 waypoints required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    speed_kmh = float(request.data.get('speed_kmh', 1.0))
    inflation = float(request.data.get('inflation_radius', 0.08))

    # Load heatmap data (used for occupancy grid)
    map_data = _load_map_data(cave, mode='heatmap')
    if not map_data:
        return Response(
            {'error': 'No heatmap data available for this cave. '
                      'Generate map data with heatmap mode first.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Build costmaps per level
    try:
        costmaps = build_costmaps_from_map_data(
            map_data,
            inflation_radius_m=inflation,
        )
    except Exception as e:
        logger.exception('Failed to build costmaps')
        return Response(
            {'error': f'Failed to build costmap: {e}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    if not costmaps:
        return Response(
            {'error': 'No valid costmaps could be built from map data'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Get transitions for multi-level routing
    transitions = map_data.get('transitions', [])

    # Compute route
    try:
        route_result = route_through_waypoints(costmaps, waypoints, transitions)
    except Exception as e:
        logger.exception('Route computation failed')
        return Response(
            {'error': f'Route computation failed: {e}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    if route_result is None:
        return Response(
            {'error': 'No valid path found between waypoints. '
                      'Check that waypoints are in passable areas.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Detect junctions for turn instructions
    all_junctions = []
    for level_idx, costmap in costmaps.items():
        level_junctions = detect_junctions(costmap.occ, costmap)
        for j in level_junctions:
            j['level'] = level_idx
        all_junctions.extend(level_junctions)

    # Load POIs for the cave
    pois = list(
        PointOfInterest.objects.filter(cave=cave)
        .values('id', 'label', 'poi_type', 'slam_x', 'slam_y', 'slam_z')
    )

    # Compute heading offset for compass directions
    heading_offset = map_data.get('initial_heading_deg', 0)
    if cave.slam_heading:
        heading_offset = cave.slam_heading

    # Generate turn-by-turn instructions
    try:
        instruction_result = generate_instructions(
            route_result,
            all_junctions,
            pois,
            heading_offset,
            transitions=transitions,
            speed_kmh=speed_kmh,
        )
    except Exception as e:
        logger.exception('Instruction generation failed')
        return Response(
            {'error': f'Instruction generation failed: {e}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    # Combine results
    computed = {
        'path': route_result['path'],
        'segments': route_result['segments'],
        'total_distance_m': route_result['total_distance_m'],
        'levels_used': route_result['levels_used'],
        'junctions': all_junctions,
        'instructions': instruction_result['instructions'],
        'total_time_s': instruction_result['total_time_s'],
        'summary': instruction_result['summary'],
    }

    return Response({
        'cave_id': str(cave.id),
        'cave_name': cave.name,
        'waypoints': waypoints,
        'speed_kmh': speed_kmh,
        'computed_route': computed,
    })


@api_view(['GET', 'POST'])
def route_list(request, cave_id):
    """List saved routes or save a new route."""
    try:
        cave = Cave.objects.get(pk=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        routes = CaveRoute.objects.filter(cave=cave)
        serializer = CaveRouteSerializer(routes, many=True)
        return Response({'routes': serializer.data, 'count': routes.count()})

    elif request.method == 'POST':
        data = request.data.copy()
        data['cave'] = str(cave.id)
        serializer = CaveRouteSerializer(data=data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'DELETE'])
def route_detail(request, cave_id, route_id):
    """Get or delete a saved route."""
    try:
        route = CaveRoute.objects.get(pk=route_id, cave_id=cave_id)
    except CaveRoute.DoesNotExist:
        return Response({'error': 'Route not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        serializer = CaveRouteSerializer(route)
        return Response(serializer.data)

    elif request.method == 'DELETE':
        route.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
def route_export_pdf(request, cave_id, route_id):
    """Generate and stream PDF for a saved route."""
    try:
        route = CaveRoute.objects.get(pk=route_id, cave_id=cave_id)
    except CaveRoute.DoesNotExist:
        return Response({'error': 'Route not found'}, status=status.HTTP_404_NOT_FOUND)

    try:
        from .pdf import generate_route_pdf

        cave = route.cave
        map_mode = request.query_params.get('map_mode', 'heatmap')
        map_data = _load_map_data(cave, mode=map_mode)
        # Fall back to heatmap if requested mode not available
        if not map_data and map_mode != 'heatmap':
            map_data = _load_map_data(cave, mode='heatmap')
            map_mode = 'heatmap'

        # Always load heatmap data for density background rendering
        # (density grid only exists in heatmap mode JSON)
        heatmap_data = None
        if map_mode != 'heatmap':
            heatmap_data = _load_map_data(cave, mode='heatmap')

        # Load spawn data for 3D snapshots
        spawn_data = _load_spawn_data(cave)
        cave_media_dir = (
            Path(django_settings.MEDIA_ROOT) / 'caves' / str(cave.id)
        )

        pdf_bytes = generate_route_pdf(
            route, cave, map_data,
            map_mode=map_mode,
            spawn_data=spawn_data,
            cave_media_dir=str(cave_media_dir),
            heatmap_data=heatmap_data,
        )

        from django.http import HttpResponse
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        safe_name = route.name.replace(' ', '_')[:50]
        response['Content-Disposition'] = (
            f'attachment; filename="route_{safe_name}.pdf"'
        )
        return response

    except ImportError:
        return Response(
            {'error': 'PDF generation not available. Install reportlab.'},
            status=status.HTTP_501_NOT_IMPLEMENTED,
        )
    except Exception as e:
        logger.exception('PDF generation failed')
        return Response(
            {'error': f'PDF generation failed: {e}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
