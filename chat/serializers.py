from rest_framework import serializers
from .models import Channel, ChannelMembership, Message


class MessageSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(
        source='author.username', read_only=True,
    )
    author_avatar_preset = serializers.CharField(
        source='author.avatar_preset', read_only=True, default='',
    )

    class Meta:
        model = Message
        fields = [
            'id', 'channel', 'author', 'author_username',
            'author_avatar_preset', 'content', 'created_at',
        ]
        read_only_fields = fields


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
            'member_count', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_member_count(self, obj):
        return obj.memberships.count()
