from rest_framework import serializers
from .models import Channel, ChannelMembership, Message


class MessageSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(
        source='author.username', read_only=True,
    )
    author_avatar_preset = serializers.CharField(
        source='author.avatar_preset', read_only=True, default='',
    )
    author_avatar = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    reactions = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            'id', 'channel', 'author', 'author_username',
            'author_avatar_preset', 'author_avatar', 'content',
            'image_url', 'file_url', 'file_name', 'file_size',
            'video_preview', 'reactions',
            'created_at',
        ]
        read_only_fields = fields

    def get_author_avatar(self, obj):
        return obj.author.avatar.url if obj.author and obj.author.avatar else None

    def get_image_url(self, obj):
        return obj.image.url if obj.image else None

    def get_file_url(self, obj):
        return obj.file.url if obj.file else None

    def get_reactions(self, obj):
        # Injected by view — avoids N+1
        return getattr(obj, '_reaction_summary', [])


class MemberSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    avatar_preset = serializers.CharField(allow_blank=True, default='')
    role = serializers.CharField()


class ChannelSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = Channel
        fields = [
            'id', 'name', 'channel_type', 'description',
            'is_private', 'member_count', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_member_count(self, obj):
        return obj.memberships.count()
