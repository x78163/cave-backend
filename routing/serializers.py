from rest_framework import serializers
from .models import CaveRoute


class CaveRouteSerializer(serializers.ModelSerializer):
    class Meta:
        model = CaveRoute
        fields = [
            'id', 'cave', 'name', 'created_by', 'waypoints',
            'computed_route', 'speed_kmh', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
