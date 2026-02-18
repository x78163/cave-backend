"""
Flat, writable serializers for sync operations.
Unlike the app serializers (designed for API consumers with nested/read-only fields),
these accept raw UUID foreign keys and writable IDs so device data syncs with
UUIDs preserved. File/image fields are excluded — handled via separate upload endpoint.
"""

from rest_framework import serializers

from caves.models import Cave, CavePhoto, CaveComment, DescriptionRevision
from mapping.models import PointOfInterest
from sensors.models import SensorAlert


class SyncCaveSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)

    class Meta:
        model = Cave
        fields = [
            'id', 'name', 'description',
            'latitude', 'longitude', 'region', 'country',
            'total_length', 'largest_chamber', 'smallest_passage',
            'vertical_extent', 'number_of_levels',
            'hazard_count', 'toxic_gas_present', 'toxic_gas_types',
            'max_particulate', 'water_present', 'water_description',
            'requires_equipment',
            'has_map', 'point_cloud_path', 'keyframe_dir', 'slam_heading',
            'source', 'created_at', 'updated_at',
            # Cloud fields (optional from device)
            'visibility', 'collaboration_setting', 'owner', 'origin_device',
        ]
        read_only_fields = ['created_at', 'updated_at']
        # cover_photo excluded — uploaded separately


class SyncCavePhotoSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    cave = serializers.UUIDField(source='cave_id')

    class Meta:
        model = CavePhoto
        fields = [
            'id', 'cave', 'caption', 'tags', 'uploaded_at', 'origin_device',
        ]
        read_only_fields = ['uploaded_at']
        # image excluded — uploaded separately


class SyncCaveCommentSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    cave = serializers.UUIDField(source='cave_id')

    class Meta:
        model = CaveComment
        fields = [
            'id', 'cave', 'text', 'author_name', 'created_at',
            'author', 'origin_device',
        ]
        read_only_fields = ['created_at']


class SyncDescriptionRevisionSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    cave = serializers.UUIDField(source='cave_id')

    class Meta:
        model = DescriptionRevision
        fields = [
            'id', 'cave', 'content', 'edit_summary', 'editor_name',
            'revision_number', 'created_at', 'editor', 'origin_device',
        ]
        read_only_fields = ['created_at']


class SyncPointOfInterestSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    cave = serializers.UUIDField(source='cave_id')
    cave_photo = serializers.UUIDField(source='cave_photo_id', required=False, allow_null=True)

    class Meta:
        model = PointOfInterest
        fields = [
            'id', 'cave', 'label', 'description', 'poi_type',
            'photo_source', 'cave_photo',
            'latitude', 'longitude',
            'slam_x', 'slam_y', 'slam_z',
            'source', 'created_at', 'origin_device',
        ]
        read_only_fields = ['created_at']
        # photo excluded — uploaded separately


class SyncSensorAlertSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    cave = serializers.UUIDField(source='cave_id', required=False, allow_null=True)

    class Meta:
        model = SensorAlert
        fields = [
            'id', 'timestamp', 'sensor_type', 'level', 'value', 'message',
            'cave', 'origin_device', 'synced_at',
        ]
        read_only_fields = ['synced_at']
