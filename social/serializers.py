from rest_framework import serializers
from .models import CaveRating, UserFollow, Activity, Expedition, ExpeditionMember


class CaveRatingSerializer(serializers.ModelSerializer):
    cave_name = serializers.CharField(source='cave.name', read_only=True)

    class Meta:
        model = CaveRating
        fields = [
            'id', 'cave', 'cave_name', 'user', 'rating', 'review_text',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'cave_name', 'created_at', 'updated_at']


class UserFollowSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserFollow
        fields = ['id', 'follower', 'following', 'created_at']
        read_only_fields = ['id', 'created_at']


class ActivitySerializer(serializers.ModelSerializer):
    action_display = serializers.CharField(
        source='get_action_type_display', read_only=True
    )

    class Meta:
        model = Activity
        fields = [
            'id', 'actor', 'action_type', 'action_display',
            'target_model', 'target_id', 'cave', 'message',
            'created_at',
        ]
        read_only_fields = fields


class ExpeditionSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()
    confirmed_count = serializers.SerializerMethodField()

    class Meta:
        model = Expedition
        fields = [
            'id', 'name', 'description', 'cave', 'organizer',
            'planned_date', 'status', 'max_members',
            'member_count', 'confirmed_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_member_count(self, obj):
        return obj.members.count()

    def get_confirmed_count(self, obj):
        return obj.members.filter(status='confirmed').count()


class ExpeditionMemberSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpeditionMember
        fields = ['id', 'expedition', 'user', 'status', 'joined_at']
        read_only_fields = ['id', 'joined_at']
