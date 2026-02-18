"""
Views for devices app — device registration and management.
"""

import secrets

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Device
from .serializers import DeviceSerializer, DeviceRegistrationSerializer


@api_view(['GET'])
def device_list(request):
    """List all registered devices."""
    devices = Device.objects.all()
    serializer = DeviceSerializer(devices, many=True)
    return Response({'devices': serializer.data, 'count': devices.count()})


@api_view(['POST'])
def device_register(request):
    """
    Register a new device.
    Expects serial_number and registration_token.
    Returns a device auth token for sync API.
    """
    reg_serializer = DeviceRegistrationSerializer(data=request.data)
    if not reg_serializer.is_valid():
        return Response(reg_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    serial_number = reg_serializer.validated_data['serial_number']
    mac_address = reg_serializer.validated_data.get('mac_address', '')

    try:
        device = Device.objects.get(serial_number=serial_number)
        if device.is_registered:
            return Response(
                {'error': 'Device already registered'},
                status=status.HTTP_409_CONFLICT,
            )
    except Device.DoesNotExist:
        device = Device(serial_number=serial_number)

    device.mac_address = mac_address
    device.is_registered = True
    device.registered_at = timezone.now()
    device.auth_token = secrets.token_urlsafe(48)
    device.save()

    return Response({
        'device': DeviceSerializer(device).data,
        'auth_token': device.auth_token,
    }, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
def device_detail(request, device_id):
    """Get, update, or delete a device."""
    try:
        device = Device.objects.get(id=device_id)
    except Device.DoesNotExist:
        return Response({'error': 'Device not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        serializer = DeviceSerializer(device)
        return Response(serializer.data)

    elif request.method == 'PATCH':
        serializer = DeviceSerializer(device, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == 'DELETE':
        device.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
