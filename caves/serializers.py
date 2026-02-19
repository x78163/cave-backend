from django.db.models import Avg, Count
from rest_framework import serializers
from .models import (
    Cave, CavePhoto, CaveComment, DescriptionRevision,
    CavePermission, CaveShareLink, LandOwner,
)


class CavePhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = CavePhoto
        fields = ['id', 'image', 'caption', 'tags', 'uploaded_at', 'origin_device']
        read_only_fields = ['id', 'uploaded_at']


class CaveCommentSerializer(serializers.ModelSerializer):
    class Meta:
        model = CaveComment
        fields = ['id', 'text', 'author_name', 'created_at', 'author', 'origin_device']
        read_only_fields = ['id', 'created_at']


class DescriptionRevisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DescriptionRevision
        fields = [
            'id', 'content', 'edit_summary', 'editor_name',
            'revision_number', 'created_at', 'editor', 'origin_device',
        ]
        read_only_fields = ['id', 'revision_number', 'created_at']


class LandOwnerSerializer(serializers.ModelSerializer):
    """Full land owner serializer — all fields including private contact info."""

    class Meta:
        model = LandOwner
        fields = [
            'id', 'owner_name', 'organization',
            'phone', 'email', 'address', 'website',
            'contact_visibility', 'notes',
            'gis_fields_visible',
            'parcel_id', 'parcel_address', 'parcel_acreage',
            'parcel_land_use', 'parcel_appraised_value',
            'gis_county', 'gis_source', 'gis_lookup_at', 'tpad_link',
            'parcel_geometry',
            'property_class', 'property_type', 'last_sale_date', 'gis_map_link',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class LandOwnerPublicSerializer(serializers.ModelSerializer):
    """Public serializer — hides private contact details but shows GIS data."""

    class Meta:
        model = LandOwner
        fields = [
            'id', 'owner_name', 'organization', 'website',
            'contact_visibility', 'gis_fields_visible',
            'parcel_id', 'parcel_address', 'parcel_acreage',
            'parcel_land_use', 'gis_county', 'tpad_link',
            'parcel_geometry',
            'property_class', 'property_type', 'last_sale_date', 'gis_map_link',
        ]
        read_only_fields = ['id']


class LandOwnerMutedSerializer(serializers.ModelSerializer):
    """Muted serializer — GIS details hidden by cave entry creator.

    Only always-visible fields: TPAD link, GIS Map link, polygon boundary.
    """

    class Meta:
        model = LandOwner
        fields = [
            'id', 'gis_fields_visible',
            'tpad_link', 'gis_map_link', 'parcel_geometry',
            'contact_visibility',
        ]
        read_only_fields = ['id']


class CaveListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for cave list view."""
    photo_count = serializers.IntegerField(source='photos.count', read_only=True)
    comment_count = serializers.IntegerField(source='comments.count', read_only=True)
    average_rating = serializers.SerializerMethodField()
    rating_count = serializers.SerializerMethodField()

    class Meta:
        model = Cave
        fields = [
            'id', 'name', 'description', 'latitude', 'longitude',
            'region', 'country', 'has_map', 'has_location',
            'total_length', 'hazard_count', 'source',
            'slam_heading',
            'cover_photo', 'photo_count', 'comment_count',
            'average_rating', 'rating_count',
            'visibility', 'collaboration_setting',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'has_location', 'created_at', 'updated_at']

    def get_average_rating(self, obj):
        result = obj.ratings.aggregate(avg=Avg('rating'))
        return result['avg']

    def get_rating_count(self, obj):
        return obj.ratings.count()


class CaveDetailSerializer(serializers.ModelSerializer):
    """Full serializer for cave detail view."""
    photos = CavePhotoSerializer(many=True, read_only=True)
    comments = CaveCommentSerializer(many=True, read_only=True)
    photo_count = serializers.IntegerField(source='photos.count', read_only=True)
    comment_count = serializers.IntegerField(source='comments.count', read_only=True)
    revision_count = serializers.IntegerField(source='revisions.count', read_only=True)
    latest_revision = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    rating_count = serializers.SerializerMethodField()
    land_owner = serializers.SerializerMethodField()

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
            'has_map', 'has_location', 'slam_heading', 'source',
            'cover_photo',
            'photos', 'photo_count',
            'comments', 'comment_count',
            'average_rating', 'rating_count',
            'revision_count', 'latest_revision',
            'land_owner',
            'visibility', 'collaboration_setting',
            'owner', 'origin_device',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'has_location', 'created_at', 'updated_at']

    def get_average_rating(self, obj):
        result = obj.ratings.aggregate(avg=Avg('rating'))
        return result['avg']

    def get_rating_count(self, obj):
        return obj.ratings.count()

    def get_latest_revision(self, obj):
        rev = obj.revisions.first()
        if rev:
            return DescriptionRevisionSerializer(rev).data
        return None

    def get_land_owner(self, obj):
        try:
            lo = obj.land_owner
        except LandOwner.DoesNotExist:
            return None
        request = self.context.get('request')
        is_cave_owner = (
            request and request.user.is_authenticated
            and obj.owner_id and obj.owner_id == request.user.id
        )
        # Cave entry owner always sees everything
        if is_cave_owner:
            return LandOwnerSerializer(lo).data
        # GIS details muted by entry creator — only show always-visible fields
        if not lo.gis_fields_visible:
            return LandOwnerMutedSerializer(lo).data
        # Public contact info
        if lo.contact_visibility == 'public':
            return LandOwnerSerializer(lo).data
        return LandOwnerPublicSerializer(lo).data


class CavePermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CavePermission
        fields = ['id', 'cave', 'user', 'role', 'granted_at', 'granted_by']
        read_only_fields = ['id', 'granted_at']


class CaveShareLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = CaveShareLink
        fields = [
            'id', 'cave', 'token', 'role', 'expires_at',
            'max_uses', 'use_count', 'is_active', 'is_expired', 'created_at',
        ]
        read_only_fields = ['id', 'token', 'use_count', 'created_at', 'is_expired']
