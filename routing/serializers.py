from rest_framework import serializers

from caves.models import Cave
from .models import CaveRoute


class CaveStubSerializer(serializers.ModelSerializer):
    """Minimal cave representation for nested use in route listings."""
    class Meta:
        model = Cave
        fields = ['id', 'name']


class CaveRouteSerializer(serializers.ModelSerializer):
    class Meta:
        model = CaveRoute
        fields = [
            'id', 'cave', 'name', 'created_by', 'waypoints',
            'computed_route', 'speed_kmh', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']


class UserCaveRouteSerializer(serializers.ModelSerializer):
    """Route serializer with nested cave info for cross-cave listings."""
    cave_detail = CaveStubSerializer(source='cave', read_only=True)

    class Meta:
        model = CaveRoute
        fields = [
            'id', 'cave', 'cave_detail', 'name', 'created_by',
            'waypoints', 'computed_route', 'speed_kmh',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']
