from rest_framework import serializers
from .models import Request


class RequestSerializer(serializers.ModelSerializer):
    requester_username = serializers.CharField(source='requester.username', read_only=True)
    requester_id = serializers.IntegerField(source='requester.id', read_only=True)
    target_user_username = serializers.CharField(
        source='target_user.username', read_only=True, default=None,
    )
    resolved_by_username = serializers.CharField(
        source='resolved_by.username', read_only=True, default=None,
    )
    cave_name = serializers.CharField(source='cave.name', read_only=True, default=None)
    cave_id = serializers.UUIDField(source='cave.id', read_only=True, default=None)
    event_name = serializers.CharField(source='event.name', read_only=True, default=None)
    event_id = serializers.UUIDField(source='event.id', read_only=True, default=None)
    grotto_name = serializers.CharField(source='grotto.name', read_only=True, default=None)
    grotto_id = serializers.UUIDField(source='grotto.id', read_only=True, default=None)

    class Meta:
        model = Request
        fields = [
            'id', 'request_type', 'status',
            'requester', 'requester_id', 'requester_username',
            'target_user', 'target_user_username',
            'cave', 'cave_id', 'cave_name',
            'event', 'event_id', 'event_name',
            'grotto', 'grotto_id', 'grotto_name',
            'message', 'response_message', 'payload',
            'resolved_by', 'resolved_by_username', 'resolved_at',
            'created_at',
        ]
        read_only_fields = [
            'id', 'requester', 'requester_id', 'requester_username',
            'target_user_username', 'resolved_by', 'resolved_by_username',
            'resolved_at', 'created_at',
            'cave_name', 'cave_id', 'event_name', 'event_id',
            'grotto_name', 'grotto_id',
        ]
