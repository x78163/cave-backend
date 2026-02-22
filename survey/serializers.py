from rest_framework import serializers
from .models import CaveSurvey, SurveyStation, SurveyShot


class SurveyStationSerializer(serializers.ModelSerializer):
    class Meta:
        model = SurveyStation
        fields = ['id', 'name', 'x', 'y', 'z', 'is_fixed', 'fixed_lat', 'fixed_lon', 'fixed_elev']
        read_only_fields = ['id', 'x', 'y', 'z']


class SurveyShotSerializer(serializers.ModelSerializer):
    from_station_name = serializers.CharField(source='from_station.name', read_only=True)
    to_station_name = serializers.CharField(source='to_station.name', read_only=True)

    class Meta:
        model = SurveyShot
        fields = [
            'id', 'from_station', 'to_station',
            'from_station_name', 'to_station_name',
            'distance', 'azimuth', 'inclination',
            'left', 'right', 'up', 'down',
            'shot_order', 'comment',
        ]
        read_only_fields = ['id']


class CaveSurveyListSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(
        source='created_by.username', read_only=True, default=None,
    )

    class Meta:
        model = CaveSurvey
        fields = [
            'id', 'name', 'date_surveyed', 'surveyors', 'unit', 'declination',
            'total_length', 'total_depth', 'station_count', 'render_data',
            'created_by', 'created_by_username', 'created_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'total_length', 'total_depth', 'station_count', 'render_data']


class CaveSurveyDetailSerializer(serializers.ModelSerializer):
    stations = SurveyStationSerializer(many=True, read_only=True)
    shots = SurveyShotSerializer(many=True, read_only=True)
    created_by_username = serializers.CharField(
        source='created_by.username', read_only=True, default=None,
    )

    class Meta:
        model = CaveSurvey
        fields = [
            'id', 'name', 'date_surveyed', 'surveyors', 'unit', 'declination',
            'total_length', 'total_depth', 'station_count', 'render_data',
            'created_by', 'created_by_username', 'created_at', 'updated_at',
            'stations', 'shots',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at',
                            'total_length', 'total_depth', 'station_count', 'render_data']


class SurveyShotBulkItemSerializer(serializers.Serializer):
    """Serializer for a single shot in bulk create — accepts station names as strings."""
    from_station = serializers.CharField(max_length=50)
    to_station = serializers.CharField(max_length=50)
    distance = serializers.FloatField(min_value=0.001)
    azimuth = serializers.FloatField(min_value=0, max_value=360)
    inclination = serializers.FloatField(min_value=-90, max_value=90, default=0)
    left = serializers.FloatField(required=False, allow_null=True, default=None)
    right = serializers.FloatField(required=False, allow_null=True, default=None)
    up = serializers.FloatField(required=False, allow_null=True, default=None)
    down = serializers.FloatField(required=False, allow_null=True, default=None)
    comment = serializers.CharField(required=False, allow_blank=True, default='')
