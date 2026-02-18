from django.contrib import admin
from .models import UserProfile, Grotto, GrottoMembership


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'location', 'caves_explored', 'expeditions_count', 'created_at']
    search_fields = ['user__username', 'bio', 'location']
    readonly_fields = ['id', 'created_at', 'updated_at']


@admin.register(Grotto)
class GrottoAdmin(admin.ModelAdmin):
    list_display = ['name', 'created_by', 'created_at']
    search_fields = ['name', 'description']
    readonly_fields = ['id', 'created_at', 'updated_at']


@admin.register(GrottoMembership)
class GrottoMembershipAdmin(admin.ModelAdmin):
    list_display = ['user', 'grotto', 'role', 'joined_at']
    list_filter = ['role']
    readonly_fields = ['id', 'joined_at']
