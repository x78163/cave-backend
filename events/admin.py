from django.contrib import admin

from .models import Event, EventRSVP, EventInvitation, EventComment


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ['name', 'event_type', 'start_date', 'visibility', 'status', 'created_by']
    list_filter = ['event_type', 'visibility', 'status']
    search_fields = ['name', 'description']
    date_hierarchy = 'start_date'


@admin.register(EventRSVP)
class EventRSVPAdmin(admin.ModelAdmin):
    list_display = ['event', 'user', 'status', 'rsvped_at']
    list_filter = ['status']


@admin.register(EventInvitation)
class EventInvitationAdmin(admin.ModelAdmin):
    list_display = ['event', 'invited_user', 'invited_grotto', 'status', 'created_at']
    list_filter = ['status']


@admin.register(EventComment)
class EventCommentAdmin(admin.ModelAdmin):
    list_display = ['event', 'author', 'text', 'created_at']
