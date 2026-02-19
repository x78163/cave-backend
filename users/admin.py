from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import UserProfile, Grotto, GrottoMembership


@admin.register(UserProfile)
class UserProfileAdmin(UserAdmin):
    list_display = ['username', 'email', 'location', 'caves_explored', 'is_staff', 'date_joined']
    search_fields = ['username', 'email', 'bio', 'location']
    readonly_fields = ['date_joined', 'updated_at']
    fieldsets = UserAdmin.fieldsets + (
        ('Profile', {'fields': ('bio', 'avatar', 'avatar_preset', 'location', 'specialties', 'onboarding_complete')}),
        ('Exploration Stats', {'fields': ('caves_explored', 'total_mapping_distance', 'expeditions_count')}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ('Profile', {'fields': ('bio', 'location')}),
    )


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
