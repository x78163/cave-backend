from rest_framework import serializers
from .models import PointOfInterest


class PointOfInterestSerializer(serializers.ModelSerializer):
    cave_photo_url = serializers.SerializerMethodField()

    class Meta:
        model = PointOfInterest
        fields = [
            'id', 'label', 'description', 'poi_type', 'photo', 'photo_source',
            'cave_photo', 'cave_photo_url',
            'latitude', 'longitude', 'slam_x', 'slam_y', 'slam_z',
            'source', 'created_at', 'origin_device',
        ]
        read_only_fields = ['id', 'created_at']

    def get_cave_photo_url(self, obj):
        if obj.cave_photo and obj.cave_photo.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.cave_photo.image.url)
            return obj.cave_photo.image.url
        return None
