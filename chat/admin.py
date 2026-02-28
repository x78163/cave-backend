from django.contrib import admin
from .models import Channel, ChannelMembership, Message


@admin.register(Channel)
class ChannelAdmin(admin.ModelAdmin):
    list_display = ['name', 'channel_type', 'created_by', 'created_at']
    list_filter = ['channel_type']


@admin.register(ChannelMembership)
class ChannelMembershipAdmin(admin.ModelAdmin):
    list_display = ['channel', 'user', 'role', 'joined_at']


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ['author', 'channel', 'content_preview', 'created_at']
    list_filter = ['channel']

    def content_preview(self, obj):
        return obj.content[:80]
