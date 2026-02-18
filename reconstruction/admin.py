from django.contrib import admin
from .models import ReconstructionJob


@admin.register(ReconstructionJob)
class ReconstructionJobAdmin(admin.ModelAdmin):
    list_display = [
        'cave', 'status', 'quality', 'vertex_count', 'triangle_count',
        'texture_coverage', 'processing_time_seconds', 'created_at',
    ]
    list_filter = ['status', 'quality']
    readonly_fields = [
        'id', 'created_at', 'started_at', 'completed_at',
        'point_count', 'vertex_count', 'triangle_count',
        'texture_coverage', 'file_size_bytes', 'processing_time_seconds',
    ]
