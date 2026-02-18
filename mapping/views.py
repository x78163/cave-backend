"""
Views for mapping app — POI CRUD.
Mirrors cave-server patterns.
"""

from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from caves.models import Cave
from .models import PointOfInterest
from .serializers import PointOfInterestSerializer


@api_view(['GET', 'POST'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def poi_list(request, cave_id):
    """List POIs for a cave, or create a new one."""
    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        pois = PointOfInterest.objects.filter(cave=cave)
        serializer = PointOfInterestSerializer(
            pois, many=True, context={'request': request}
        )
        return Response({'pois': serializer.data, 'count': pois.count()})

    elif request.method == 'POST':
        serializer = PointOfInterestSerializer(
            data=request.data, context={'request': request}
        )
        if serializer.is_valid():
            serializer.save(cave=cave)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PATCH', 'DELETE'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def poi_detail(request, cave_id, poi_id):
    """Get, update, or delete a single POI."""
    try:
        poi = PointOfInterest.objects.get(id=poi_id, cave_id=cave_id)
    except PointOfInterest.DoesNotExist:
        return Response({'error': 'POI not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(
            PointOfInterestSerializer(poi, context={'request': request}).data
        )

    elif request.method == 'PATCH':
        serializer = PointOfInterestSerializer(
            poi, data=request.data, partial=True, context={'request': request}
        )
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == 'DELETE':
        poi.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
