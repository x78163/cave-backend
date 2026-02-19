from django.contrib import admin
from .models import (
    CaveRating, UserFollow, Activity, Expedition, ExpeditionMember,
    Post, PostReaction, PostComment,
)


@admin.register(CaveRating)
class CaveRatingAdmin(admin.ModelAdmin):
    list_display = ['user', 'cave', 'rating', 'created_at']
    list_filter = ['rating', 'created_at']
    readonly_fields = ['id', 'created_at', 'updated_at']
    search_fields = ['cave__name', 'review_text']


@admin.register(UserFollow)
class UserFollowAdmin(admin.ModelAdmin):
    list_display = ['follower', 'following', 'created_at']
    list_filter = ['created_at']
    readonly_fields = ['id', 'created_at']


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display = ['actor', 'action_type', 'cave', 'created_at']
    list_filter = ['action_type', 'created_at']
    readonly_fields = ['id', 'created_at']
    search_fields = ['message', 'actor__username']


@admin.register(Expedition)
class ExpeditionAdmin(admin.ModelAdmin):
    list_display = ['name', 'cave', 'organizer', 'planned_date', 'status']
    list_filter = ['status', 'planned_date']
    readonly_fields = ['id', 'created_at', 'updated_at']
    search_fields = ['name', 'description']


@admin.register(ExpeditionMember)
class ExpeditionMemberAdmin(admin.ModelAdmin):
    list_display = ['user', 'expedition', 'status', 'joined_at']
    list_filter = ['status']
    readonly_fields = ['id', 'joined_at']


@admin.register(Post)
class PostAdmin(admin.ModelAdmin):
    list_display = ['author', 'text', 'visibility', 'cave', 'grotto', 'created_at']
    list_filter = ['visibility', 'created_at']
    readonly_fields = ['id', 'created_at', 'updated_at']
    search_fields = ['text', 'author__username']


@admin.register(PostReaction)
class PostReactionAdmin(admin.ModelAdmin):
    list_display = ['user', 'post', 'reaction_type', 'created_at']
    list_filter = ['reaction_type']
    readonly_fields = ['id', 'created_at']


@admin.register(PostComment)
class PostCommentAdmin(admin.ModelAdmin):
    list_display = ['author', 'post', 'text', 'created_at']
    readonly_fields = ['id', 'created_at']
    search_fields = ['text', 'author__username']
