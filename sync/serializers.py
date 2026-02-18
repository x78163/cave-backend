from rest_framework import serializers
from .models import SyncSession, SyncLog, DataDelta


class SyncSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyncSession
        fields = [
            'id', 'device', 'status', 'started_at', 'completed_at',
            'device_last_sync', 'records_pushed', 'records_pulled',
            'files_transferred', 'bytes_transferred', 'error_message',
        ]
        read_only_fields = ['id', 'started_at']


class SyncLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyncLog
        fields = [
            'id', 'session', 'level', 'message', 'timestamp',
            'model_name', 'record_id',
        ]
        read_only_fields = ['id', 'timestamp']


class DataDeltaSerializer(serializers.ModelSerializer):
    class Meta:
        model = DataDelta
        fields = [
            'id', 'model_name', 'record_id', 'action', 'timestamp',
            'source_device', 'sync_session', 'data_snapshot',
        ]
        read_only_fields = ['id', 'timestamp']
