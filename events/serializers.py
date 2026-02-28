"""Serializers for the events app."""

from rest_framework import serializers

from .models import Event, EventRSVP, EventInvitation, EventComment


class EventSerializer(serializers.ModelSerializer):
    """Full event serializer with computed fields."""

    creator_username = serializers.CharField(source='created_by.username', read_only=True)
    creator_avatar = serializers.SerializerMethodField()
    poc_username = serializers.CharField(
        source='point_of_contact.username', read_only=True, default=None
    )
    poc_id = serializers.IntegerField(
        source='point_of_contact.id', read_only=True, default=None
    )
    cave_name = serializers.CharField(source='cave.name', read_only=True, default=None)
    grotto_name = serializers.CharField(source='grotto.name', read_only=True, default=None)
    going_count = serializers.SerializerMethodField()
    maybe_count = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    user_rsvp = serializers.SerializerMethodField()
    is_full = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            'id', 'name', 'event_type', 'description',
            'start_date', 'end_date', 'all_day',
            'cave', 'cave_name', 'latitude', 'longitude',
            'address', 'google_maps_link',
            'created_by', 'creator_username', 'creator_avatar',
            'point_of_contact', 'poc_username', 'poc_id',
            'grotto', 'grotto_name',
            'required_equipment', 'meetup_instructions', 'max_participants',
            'visibility', 'status', 'cover_image',
            'chat_channel',
            'going_count', 'maybe_count', 'comment_count',
            'user_rsvp', 'is_full',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'created_by', 'creator_username', 'creator_avatar',
            'point_of_contact', 'poc_username', 'poc_id',
            'cave_name', 'grotto_name',
            'going_count', 'maybe_count', 'comment_count',
            'user_rsvp', 'is_full',
            'created_at', 'updated_at',
        ]

    def get_creator_avatar(self, obj):
        if obj.created_by.avatar:
            return obj.created_by.avatar.url
        return None

    def _get_rsvp_counts(self, obj):
        if not hasattr(obj, '_rsvp_counts'):
            from django.db.models import Count, Q
            counts = obj.rsvps.aggregate(
                going=Count('id', filter=Q(status='going')),
                maybe=Count('id', filter=Q(status='maybe')),
            )
            obj._rsvp_counts = counts
        return obj._rsvp_counts

    def get_going_count(self, obj):
        return self._get_rsvp_counts(obj)['going']

    def get_maybe_count(self, obj):
        return self._get_rsvp_counts(obj)['maybe']

    def get_comment_count(self, obj):
        return obj.comments.count()

    def get_user_rsvp(self, obj):
        user = self.context.get('request')
        if user and hasattr(user, 'user') and user.user.is_authenticated:
            rsvp = obj.rsvps.filter(user=user.user).first()
            return rsvp.status if rsvp else None
        return None

    def get_is_full(self, obj):
        if not obj.max_participants:
            return False
        return self._get_rsvp_counts(obj)['going'] >= obj.max_participants


class EventCalendarSerializer(serializers.ModelSerializer):
    """Lightweight serializer for calendar view."""

    class Meta:
        model = Event
        fields = [
            'id', 'name', 'event_type', 'start_date', 'end_date',
            'all_day', 'status', 'cave', 'grotto',
        ]


class EventRSVPSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    avatar = serializers.SerializerMethodField()
    avatar_preset = serializers.CharField(source='user.avatar_preset', read_only=True, default='')

    class Meta:
        model = EventRSVP
        fields = ['id', 'event', 'user', 'username', 'avatar', 'avatar_preset', 'status', 'rsvped_at', 'updated_at']
        read_only_fields = ['id', 'username', 'avatar', 'avatar_preset', 'rsvped_at', 'updated_at']

    def get_avatar(self, obj):
        if obj.user.avatar:
            return obj.user.avatar.url
        return None


class EventInvitationSerializer(serializers.ModelSerializer):
    invited_username = serializers.CharField(
        source='invited_user.username', read_only=True, default=None
    )
    invited_grotto_name = serializers.CharField(
        source='invited_grotto.name', read_only=True, default=None
    )
    invited_by_username = serializers.CharField(
        source='invited_by.username', read_only=True
    )

    class Meta:
        model = EventInvitation
        fields = [
            'id', 'event', 'invited_user', 'invited_username',
            'invited_grotto', 'invited_grotto_name',
            'invited_by', 'invited_by_username',
            'status', 'created_at',
        ]
        read_only_fields = ['id', 'invited_username', 'invited_grotto_name',
                            'invited_by_username', 'created_at']


class EventCommentSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source='author.username', read_only=True)
    author_avatar = serializers.SerializerMethodField()

    class Meta:
        model = EventComment
        fields = ['id', 'event', 'author', 'author_username', 'author_avatar',
                  'text', 'created_at']
        read_only_fields = ['id', 'author_username', 'author_avatar', 'created_at']

    def get_author_avatar(self, obj):
        if obj.author.avatar:
            return obj.author.avatar.url
        return None
