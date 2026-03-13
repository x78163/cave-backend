"""Serializers for expedition safety tracking."""

from rest_framework import serializers

from .models import (
    ExpeditionTracking, ExpeditionCheckIn, ExpeditionGPSPoint,
    ExpeditionSurrogate, ExpeditionStateLog,
)


class ExpeditionCheckInSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    checked_in_by_username = serializers.CharField(
        source='checked_in_by.username', read_only=True, default=None,
    )
    avatar_preset = serializers.CharField(
        source='user.avatar_preset', read_only=True, default='',
    )

    class Meta:
        model = ExpeditionCheckIn
        fields = [
            'id', 'user', 'username', 'avatar_preset',
            'checked_in_by', 'checked_in_by_username',
            'checked_in_at', 'checked_out_at',
        ]
        read_only_fields = [
            'id', 'username', 'avatar_preset',
            'checked_in_by_username', 'checked_in_at',
        ]


class ExpeditionSurrogateSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True, default=None)
    grotto_name = serializers.CharField(source='grotto.name', read_only=True, default=None)

    class Meta:
        model = ExpeditionSurrogate
        fields = ['id', 'user', 'username', 'grotto', 'grotto_name', 'created_at']
        read_only_fields = ['id', 'username', 'grotto_name', 'created_at']


class ExpeditionGPSPointSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = ExpeditionGPSPoint
        fields = [
            'id', 'user', 'username',
            'latitude', 'longitude', 'accuracy', 'altitude',
            'recorded_at',
        ]
        read_only_fields = ['id', 'username', 'recorded_at']


class ExpeditionStateLogSerializer(serializers.ModelSerializer):
    triggered_by_username = serializers.CharField(
        source='triggered_by.username', read_only=True, default=None,
    )

    class Meta:
        model = ExpeditionStateLog
        fields = [
            'id', 'from_state', 'to_state',
            'triggered_by', 'triggered_by_username',
            'note', 'created_at',
        ]
        read_only_fields = fields


class ExpeditionTrackingSerializer(serializers.ModelSerializer):
    checkins = ExpeditionCheckInSerializer(many=True, read_only=True)
    surrogates = ExpeditionSurrogateSerializer(many=True, read_only=True)
    state_logs = ExpeditionStateLogSerializer(many=True, read_only=True)
    event_name = serializers.CharField(source='event.name', read_only=True)
    cave_name = serializers.CharField(source='event.cave.name', read_only=True, default=None)
    cave_latitude = serializers.FloatField(source='event.cave.latitude', read_only=True, default=None)
    cave_longitude = serializers.FloatField(source='event.cave.longitude', read_only=True, default=None)
    checkin_count = serializers.SerializerMethodField()

    class Meta:
        model = ExpeditionTracking
        fields = [
            'id', 'event', 'event_name',
            'cave_name', 'cave_latitude', 'cave_longitude',
            'state', 'state_changed_at',
            'expected_return', 'alert_delay_minutes', 'gps_stale_minutes',
            'started_at', 'completed_at', 'last_gps_at',
            'emergency_contacts',
            'checkins', 'surrogates', 'state_logs',
            'checkin_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'event', 'event_name',
            'cave_name', 'cave_latitude', 'cave_longitude',
            'state', 'state_changed_at',
            'started_at', 'completed_at', 'last_gps_at',
            'checkins', 'surrogates', 'state_logs',
            'checkin_count',
            'created_at', 'updated_at',
        ]

    def get_checkin_count(self, obj):
        return obj.checkins.count()


class ExpeditionTrackingListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for the Live Expeditions list."""

    event_name = serializers.CharField(source='event.name', read_only=True)
    event_type = serializers.CharField(source='event.event_type', read_only=True)
    event_visibility = serializers.CharField(source='event.visibility', read_only=True)
    cave_name = serializers.CharField(source='event.cave.name', read_only=True, default=None)
    cave_latitude = serializers.FloatField(source='event.cave.latitude', read_only=True, default=None)
    cave_longitude = serializers.FloatField(source='event.cave.longitude', read_only=True, default=None)
    creator_username = serializers.CharField(source='event.created_by.username', read_only=True)
    checkin_count = serializers.SerializerMethodField()
    rsvp_count = serializers.SerializerMethodField()
    last_gps_points = serializers.SerializerMethodField()

    class Meta:
        model = ExpeditionTracking
        fields = [
            'id', 'event', 'event_name', 'event_type', 'event_visibility',
            'cave_name', 'cave_latitude', 'cave_longitude',
            'creator_username',
            'state', 'state_changed_at',
            'expected_return', 'started_at', 'last_gps_at',
            'checkin_count', 'rsvp_count',
            'last_gps_points',
        ]

    def get_checkin_count(self, obj):
        return obj.checkins.count()

    def get_rsvp_count(self, obj):
        return obj.event.rsvps.filter(status='going').count()

    def get_last_gps_points(self, obj):
        """Return the most recent GPS point per checked-in user."""
        from django.db.models import Max
        latest_ids = (
            obj.gps_points
            .values('user')
            .annotate(latest_id=Max('id'))
            .values_list('latest_id', flat=True)
        )
        points = obj.gps_points.filter(id__in=latest_ids).select_related('user')
        return [
            {
                'user': p.user_id,
                'username': p.user.username,
                'latitude': p.latitude,
                'longitude': p.longitude,
                'recorded_at': p.recorded_at.isoformat(),
            }
            for p in points
        ]
