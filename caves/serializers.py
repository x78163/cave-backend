from django.db.models import Avg, Count
from rest_framework import serializers
from .models import (
    Cave, CavePhoto, CaveComment, DescriptionRevision,
    CavePermission, CaveShareLink, LandOwner, CaveRequest,
    SurveyMap, CaveDocument, CaveVideoLink,
)


class CavePhotoSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.CharField(
        source='uploaded_by.username', read_only=True, default=None,
    )

    class Meta:
        model = CavePhoto
        fields = [
            'id', 'image', 'caption', 'tags', 'uploaded_at', 'origin_device',
            'uploaded_by', 'uploaded_by_username',
            'cave', 'cave_name_cache', 'visibility',
        ]
        read_only_fields = ['id', 'uploaded_at', 'uploaded_by', 'uploaded_by_username', 'cave_name_cache']


class SurveyMapSerializer(serializers.ModelSerializer):
    overlay_url = serializers.SerializerMethodField()
    original_url = serializers.SerializerMethodField()
    uploaded_by_username = serializers.CharField(
        source='uploaded_by.username', read_only=True, default=None,
    )

    class Meta:
        model = SurveyMap
        fields = [
            'id', 'cave', 'name',
            'overlay_url', 'original_url',
            'image_width', 'image_height',
            'anchor_x', 'anchor_y',
            'scale', 'heading', 'opacity',
            'is_locked',
            'uploaded_by', 'uploaded_by_username',
            'uploaded_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'cave', 'image_width', 'image_height',
            'uploaded_by', 'uploaded_by_username',
            'uploaded_at', 'updated_at',
        ]

    def get_overlay_url(self, obj):
        if not obj.overlay_image:
            return None
        request = self.context.get('request')
        url = obj.overlay_image.url
        return request.build_absolute_uri(url) if request else url

    def get_original_url(self, obj):
        if not obj.original_image:
            return None
        request = self.context.get('request')
        url = obj.original_image.url
        return request.build_absolute_uri(url) if request else url


class CaveDocumentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    uploaded_by_username = serializers.CharField(
        source='uploaded_by.username', read_only=True, default=None,
    )

    class Meta:
        model = CaveDocument
        fields = [
            'id', 'file_url', 'title', 'description',
            'file_size', 'page_count',
            'uploaded_by', 'uploaded_by_username', 'uploaded_at',
            'cave', 'cave_name_cache', 'visibility',
        ]
        read_only_fields = [
            'id', 'file_size', 'page_count',
            'uploaded_by', 'uploaded_by_username', 'uploaded_at',
            'cave_name_cache',
        ]

    def get_file_url(self, obj):
        if not obj.file:
            return None
        return obj.file.url


class CaveVideoLinkSerializer(serializers.ModelSerializer):
    added_by_username = serializers.CharField(
        source='added_by.username', read_only=True, default=None,
    )

    class Meta:
        model = CaveVideoLink
        fields = [
            'id', 'url', 'title', 'description',
            'platform', 'video_id', 'embed_url', 'thumbnail_url',
            'added_by', 'added_by_username', 'added_at',
            'cave', 'cave_name_cache', 'visibility',
        ]
        read_only_fields = [
            'id', 'platform', 'video_id', 'embed_url', 'thumbnail_url',
            'added_by', 'added_by_username', 'added_at',
            'cave_name_cache',
        ]


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
    has_private_contact = serializers.SerializerMethodField()

    class Meta:
        model = LandOwner
        fields = [
            'id', 'owner_name', 'organization', 'website',
            'contact_visibility', 'gis_fields_visible',
            'parcel_id', 'parcel_address', 'parcel_acreage',
            'parcel_land_use', 'gis_county', 'tpad_link',
            'parcel_geometry',
            'property_class', 'property_type', 'last_sale_date', 'gis_map_link',
            'has_private_contact',
        ]
        read_only_fields = ['id']

    def get_has_private_contact(self, obj):
        return bool(obj.phone or obj.email or obj.address)


class LandOwnerMutedSerializer(serializers.ModelSerializer):
    """Muted serializer — GIS details hidden by cave entry creator.

    Only always-visible fields: TPAD link, GIS Map link, polygon boundary.
    """
    has_private_contact = serializers.SerializerMethodField()

    class Meta:
        model = LandOwner
        fields = [
            'id', 'gis_fields_visible',
            'tpad_link', 'gis_map_link', 'parcel_geometry',
            'contact_visibility', 'has_private_contact',
        ]
        read_only_fields = ['id']

    def get_has_private_contact(self, obj):
        return bool(obj.phone or obj.email or obj.address)


class CaveListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for cave list view."""
    photo_count = serializers.IntegerField(source='photos.count', read_only=True)
    comment_count = serializers.IntegerField(source='comments.count', read_only=True)
    average_rating = serializers.SerializerMethodField()
    rating_count = serializers.SerializerMethodField()

    class Meta:
        model = Cave
        fields = [
            'id', 'name', 'aliases', 'description', 'latitude', 'longitude',
            'region', 'country', 'city', 'zip_code', 'has_map', 'has_location',
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
    survey_maps = SurveyMapSerializer(many=True, read_only=True)
    documents = CaveDocumentSerializer(many=True, read_only=True)
    video_links = CaveVideoLinkSerializer(many=True, read_only=True)
    photo_count = serializers.IntegerField(source='photos.count', read_only=True)
    comment_count = serializers.IntegerField(source='comments.count', read_only=True)
    document_count = serializers.IntegerField(source='documents.count', read_only=True)
    video_link_count = serializers.IntegerField(source='video_links.count', read_only=True)
    revision_count = serializers.IntegerField(source='revisions.count', read_only=True)
    latest_revision = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    rating_count = serializers.SerializerMethodField()
    land_owner = serializers.SerializerMethodField()
    pending_request_count = serializers.SerializerMethodField()
    user_pending_request = serializers.SerializerMethodField()
    user_has_contact_access = serializers.SerializerMethodField()

    class Meta:
        model = Cave
        fields = [
            'id', 'name', 'aliases', 'description',
            'latitude', 'longitude', 'region', 'country', 'city', 'zip_code',
            'total_length', 'largest_chamber', 'smallest_passage',
            'vertical_extent', 'number_of_levels',
            'hazard_count', 'toxic_gas_present', 'toxic_gas_types',
            'max_particulate', 'water_present', 'water_description',
            'requires_equipment',
            'has_map', 'has_location', 'slam_heading', 'source',
            'cover_photo',
            'photos', 'photo_count',
            'comments', 'comment_count',
            'survey_maps',
            'documents', 'document_count',
            'video_links', 'video_link_count',
            'average_rating', 'rating_count',
            'revision_count', 'latest_revision',
            'land_owner',
            'pending_request_count', 'user_pending_request',
            'user_has_contact_access',
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

    def get_pending_request_count(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return 0
        if obj.owner_id != request.user.id:
            return 0
        return obj.requests.filter(status='pending').count()

    def get_user_pending_request(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return []
        pending = list(
            obj.requests.filter(requester=request.user, status='pending')
            .values_list('request_type', flat=True)
        )
        return pending

    def get_user_has_contact_access(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        if obj.owner_id == request.user.id:
            return True
        try:
            lo = obj.land_owner
            if lo.contact_visibility == 'public':
                return True
            return lo.contact_access_users.filter(id=request.user.id).exists()
        except LandOwner.DoesNotExist:
            return False

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
        # User granted contact access via M2M
        if (request and request.user.is_authenticated
                and lo.contact_access_users.filter(id=request.user.id).exists()):
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


class CaveRequestSerializer(serializers.ModelSerializer):
    requester_username = serializers.CharField(source='requester.username', read_only=True)
    cave_name = serializers.CharField(source='cave.name', read_only=True)
    resolved_by_username = serializers.CharField(
        source='resolved_by.username', read_only=True, default=None,
    )

    class Meta:
        model = CaveRequest
        fields = [
            'id', 'cave', 'cave_name',
            'requester', 'requester_username',
            'request_type', 'status',
            'message', 'payload',
            'resolved_by', 'resolved_by_username', 'resolved_at',
            'created_at',
        ]
        read_only_fields = [
            'id', 'cave_name', 'requester_username',
            'resolved_by', 'resolved_by_username', 'resolved_at',
            'created_at',
        ]
