from django.contrib import admin
from .models import SyncSession, SyncLog, DataDelta, ChunkedUpload


@admin.register(SyncSession)
class SyncSessionAdmin(admin.ModelAdmin):
    list_display = ['device', 'status', 'records_pushed', 'records_pulled', 'started_at', 'completed_at']
    list_filter = ['status']
    readonly_fields = ['id', 'started_at']


@admin.register(SyncLog)
class SyncLogAdmin(admin.ModelAdmin):
    list_display = ['session', 'level', 'message', 'timestamp']
    list_filter = ['level']
    search_fields = ['message']
    readonly_fields = ['id', 'timestamp']


@admin.register(DataDelta)
class DataDeltaAdmin(admin.ModelAdmin):
    list_display = ['model_name', 'record_id', 'action', 'source_device', 'timestamp']
    list_filter = ['action', 'model_name']
    readonly_fields = ['id', 'timestamp']


@admin.register(ChunkedUpload)
class ChunkedUploadAdmin(admin.ModelAdmin):
    list_display = ['filename', 'model_name', 'record_id', 'bytes_received', 'total_size', 'is_complete', 'created_at']
    list_filter = ['is_complete', 'model_name']
    readonly_fields = ['id', 'created_at']
