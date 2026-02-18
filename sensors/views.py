"""
Views for sensors app — historical sensor alert storage.
No live sensor data (that's device-only via cave-server).
"""

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import SensorAlert
from .serializers import SensorAlertSerializer


@api_view(['GET', 'POST'])
def sensor_alerts(request):
    """
    GET: List sensor alerts. Query params: ?sensor_type=gas_voc&level=danger&limit=50
    POST: Create a new sensor alert (from sync or manual entry).
    """
    if request.method == 'POST':
        serializer = SensorAlertSerializer(data=request.data)
        if serializer.is_valid():
            if 'timestamp' not in request.data:
                serializer.save(timestamp=timezone.now())
            else:
                serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # GET
    qs = SensorAlert.objects.all()
    sensor_type = request.query_params.get('sensor_type')
    if sensor_type:
        qs = qs.filter(sensor_type=sensor_type)
    level = request.query_params.get('level')
    if level:
        qs = qs.filter(level=level)
    device = request.query_params.get('device')
    if device:
        qs = qs.filter(origin_device_id=device)
    limit = min(int(request.query_params.get('limit', 50)), 200)
    alerts = qs[:limit]

    serializer = SensorAlertSerializer(alerts, many=True)
    return Response({'alerts': serializer.data, 'count': len(serializer.data)})


@api_view(['GET'])
def cave_sensor_alerts(request, cave_id):
    """List sensor alerts for a specific cave."""
    qs = SensorAlert.objects.filter(cave_id=cave_id)
    sensor_type = request.query_params.get('sensor_type')
    if sensor_type:
        qs = qs.filter(sensor_type=sensor_type)
    level = request.query_params.get('level')
    if level:
        qs = qs.filter(level=level)
    limit = min(int(request.query_params.get('limit', 50)), 200)
    alerts = qs[:limit]

    serializer = SensorAlertSerializer(alerts, many=True)
    return Response({'alerts': serializer.data, 'count': len(serializer.data)})
