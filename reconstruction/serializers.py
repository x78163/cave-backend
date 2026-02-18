from rest_framework import serializers
from .models import ReconstructionJob


class ReconstructionJobSerializer(serializers.ModelSerializer):
    mesh_url = serializers.SerializerMethodField()

    class Meta:
        model = ReconstructionJob
        fields = [
            'id', 'cave', 'status', 'quality',
            'pcd_file', 'keyframe_archive', 'mesh_file', 'mesh_url',
            'point_count', 'vertex_count', 'triangle_count',
            'texture_coverage', 'file_size_bytes',
            'poisson_depth', 'voxel_size', 'camera_hfov',
            'created_at', 'started_at', 'completed_at',
            'processing_time_seconds', 'error_message',
        ]
        read_only_fields = [
            'id', 'status', 'mesh_file', 'mesh_url',
            'point_count', 'vertex_count', 'triangle_count',
            'texture_coverage', 'file_size_bytes',
            'created_at', 'started_at', 'completed_at',
            'processing_time_seconds', 'error_message',
        ]

    def get_mesh_url(self, obj):
        if obj.mesh_file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.mesh_file.url)
            return obj.mesh_file.url
        return None
