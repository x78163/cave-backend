from rest_framework import serializers
from .models import SensorAlert


class SensorAlertSerializer(serializers.ModelSerializer):
    class Meta:
        model = SensorAlert
        fields = [
            'id', 'timestamp', 'sensor_type', 'level', 'value',
            'message', 'cave', 'origin_device', 'synced_at',
        ]
        read_only_fields = ['id', 'synced_at']
