from django.db.models import Count, Q
from rest_framework import serializers
from .models import (
    CaveRating, UserFollow, Activity, Expedition, ExpeditionMember,
    Post, PostReaction, PostComment,
)


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


class PostCommentSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source='author.username', read_only=True)

    class Meta:
        model = PostComment
        fields = ['id', 'post', 'author', 'author_username', 'text', 'created_at']
        read_only_fields = ['id', 'author_username', 'created_at']


class PostReactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PostReaction
        fields = ['id', 'post', 'user', 'reaction_type', 'created_at']
        read_only_fields = ['id', 'created_at']


class PostSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source='author.username', read_only=True)
    cave_name = serializers.CharField(source='cave.name', read_only=True, default=None)
    grotto_name = serializers.CharField(source='grotto.name', read_only=True, default=None)
    like_count = serializers.SerializerMethodField()
    dislike_count = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    user_reaction = serializers.SerializerMethodField()
    cave_status = serializers.SerializerMethodField()

    class Meta:
        model = Post
        fields = [
            'id', 'author', 'author_username', 'text', 'image',
            'cave', 'cave_name', 'cave_name_cache', 'cave_status',
            'grotto', 'grotto_name', 'visibility',
            'is_deleted', 'deleted_at',
            'like_count', 'dislike_count', 'comment_count', 'user_reaction',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'author_username', 'cave_name', 'cave_name_cache', 'cave_status',
            'grotto_name',
            'is_deleted', 'deleted_at',
            'like_count', 'dislike_count', 'comment_count', 'user_reaction',
            'created_at', 'updated_at',
        ]

    def _get_counts(self, obj):
        """Cache reaction counts per-instance to avoid duplicate queries."""
        if not hasattr(obj, '_reaction_counts'):
            counts = obj.reactions.aggregate(
                likes=Count('id', filter=Q(reaction_type='like')),
                dislikes=Count('id', filter=Q(reaction_type='dislike')),
            )
            obj._reaction_counts = counts
        return obj._reaction_counts

    def get_like_count(self, obj):
        return self._get_counts(obj)['likes']

    def get_dislike_count(self, obj):
        return self._get_counts(obj)['dislikes']

    def get_comment_count(self, obj):
        return obj.comments.count()

    def get_user_reaction(self, obj):
        current_user = self.context.get('current_user')
        if not current_user:
            return None
        reaction = obj.reactions.filter(user_id=current_user).first()
        return reaction.reaction_type if reaction else None

    def get_cave_status(self, obj):
        return None  # Computed in to_representation

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Soft-deleted posts: hide content
        if instance.is_deleted:
            data['text'] = '[Deleted by author]'
            data['image'] = None
        # Cave status display
        if instance.cave:
            if instance.cave.visibility in ('public', 'limited_public'):
                data['cave_status'] = 'active'
            else:
                data['cave_status'] = 'unlisted'
                data['cave_name'] = None  # hide name for privacy
        elif instance.cave_name_cache:
            data['cave_status'] = 'deleted'
            data['cave_name'] = instance.cave_name_cache
        else:
            data['cave_status'] = None
        return data
