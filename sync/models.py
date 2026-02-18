import uuid
from django.db import models


class SyncSession(models.Model):
    """Tracks a sync session between a device and the backend."""

    class Status(models.TextChoices):
        STARTED = 'started', 'Started'
        PUSHING = 'pushing', 'Pushing Data'
        PULLING = 'pulling', 'Pulling Data'
        COMPLETED = 'completed', 'Completed'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device = models.ForeignKey(
        'devices.Device', on_delete=models.CASCADE, related_name='sync_sessions'
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.STARTED
    )
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    device_last_sync = models.DateTimeField(
        null=True, blank=True,
        help_text='Timestamp of the last successful sync on the device side'
    )

    # Counters
    records_pushed = models.IntegerField(default=0)
    records_pulled = models.IntegerField(default=0)
    files_transferred = models.IntegerField(default=0)
    bytes_transferred = models.BigIntegerField(default=0)

    error_message = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-started_at']

    def __str__(self):
        return f"Sync {self.id} - {self.device} ({self.status})"


class SyncLog(models.Model):
    """Detailed log entries for a sync session."""

    class Level(models.TextChoices):
        DEBUG = 'debug', 'Debug'
        INFO = 'info', 'Info'
        WARNING = 'warning', 'Warning'
        ERROR = 'error', 'Error'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        SyncSession, on_delete=models.CASCADE, related_name='logs'
    )
    level = models.CharField(
        max_length=10, choices=Level.choices, default=Level.INFO
    )
    message = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    # What model/record was affected
    model_name = models.CharField(max_length=100, blank=True, default='')
    record_id = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ['timestamp']

    def __str__(self):
        return f"[{self.level}] {self.message[:80]}"


class DataDelta(models.Model):
    """
    Tracks changed records for sync.
    When a record is created or modified, a DataDelta is created
    so the sync mechanism knows what to push/pull.
    """

    class Action(models.TextChoices):
        CREATE = 'create', 'Create'
        UPDATE = 'update', 'Update'
        DELETE = 'delete', 'Delete'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    model_name = models.CharField(
        max_length=100, help_text='e.g. caves.Cave, mapping.PointOfInterest'
    )
    record_id = models.UUIDField(help_text='UUID of the changed record')
    action = models.CharField(max_length=10, choices=Action.choices)
    timestamp = models.DateTimeField(auto_now_add=True)

    # Which device this change came from (null = originated on backend)
    source_device = models.ForeignKey(
        'devices.Device', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='deltas'
    )
    # Which sync session processed this delta (null = not yet synced)
    sync_session = models.ForeignKey(
        SyncSession, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='deltas'
    )

    # Snapshot of the data at the time of the change
    data_snapshot = models.JSONField(
        null=True, blank=True,
        help_text='Serialized record data at time of change'
    )

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['model_name', 'record_id']),
            models.Index(fields=['timestamp']),
        ]

    def __str__(self):
        return f"{self.action} {self.model_name} {self.record_id}"


class ChunkedUpload(models.Model):
    """
    Tracks a resumable chunked file upload (for large PCD files, 2GB+).
    Chunks are written to a temp directory and assembled on completion.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        SyncSession, on_delete=models.CASCADE, related_name='chunked_uploads'
    )
    model_name = models.CharField(max_length=100, help_text='e.g. Cave')
    record_id = models.UUIDField(help_text='UUID of the target record')
    field_name = models.CharField(max_length=100, help_text='e.g. point_cloud_path')
    filename = models.CharField(max_length=500)
    total_size = models.BigIntegerField(help_text='Expected total file size in bytes')
    bytes_received = models.BigIntegerField(default=0)
    chunk_dir = models.CharField(
        max_length=500, help_text='Temp directory storing chunk files'
    )
    is_complete = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        pct = (self.bytes_received / self.total_size * 100) if self.total_size else 0
        return f"ChunkedUpload {self.filename} ({pct:.0f}%)"
