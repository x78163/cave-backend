from rest_framework import serializers
from .models import Device


class DeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Device
        fields = [
            'id', 'name', 'serial_number', 'mac_address', 'owner',
            'grotto', 'is_registered', 'registered_at',
            'last_sync_at', 'firmware_version',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'is_registered', 'registered_at',
            'last_sync_at', 'created_at', 'updated_at',
        ]


class DeviceRegistrationSerializer(serializers.Serializer):
    serial_number = serializers.CharField(max_length=100)
    mac_address = serializers.CharField(max_length=17, required=False, default='')
    registration_token = serializers.CharField(max_length=255)
