from django.contrib import admin
from .models import (
    Cave, CavePhoto, CaveComment, DescriptionRevision,
    CavePermission, CaveShareLink,
)


@admin.register(Cave)
class CaveAdmin(admin.ModelAdmin):
    list_display = ['name', 'region', 'country', 'visibility', 'source', 'has_map', 'updated_at']
    list_filter = ['visibility', 'source', 'has_map', 'toxic_gas_present', 'water_present']
    search_fields = ['name', 'region', 'country', 'description']
    readonly_fields = ['id', 'created_at', 'updated_at']


@admin.register(CavePhoto)
class CavePhotoAdmin(admin.ModelAdmin):
    list_display = ['cave', 'caption', 'uploaded_at']
    list_filter = ['uploaded_at']
    search_fields = ['caption', 'tags']
    readonly_fields = ['id', 'uploaded_at']


@admin.register(CaveComment)
class CaveCommentAdmin(admin.ModelAdmin):
    list_display = ['cave', 'author_name', 'text', 'created_at']
    list_filter = ['created_at']
    search_fields = ['text', 'author_name']
    readonly_fields = ['id', 'created_at']


@admin.register(DescriptionRevision)
class DescriptionRevisionAdmin(admin.ModelAdmin):
    list_display = ['cave', 'revision_number', 'editor_name', 'edit_summary', 'created_at']
    list_filter = ['created_at']
    search_fields = ['edit_summary', 'editor_name']
    readonly_fields = ['id', 'created_at']


@admin.register(CavePermission)
class CavePermissionAdmin(admin.ModelAdmin):
    list_display = ['cave', 'user', 'role', 'granted_at']
    list_filter = ['role']
    readonly_fields = ['id', 'granted_at']


@admin.register(CaveShareLink)
class CaveShareLinkAdmin(admin.ModelAdmin):
    list_display = ['cave', 'role', 'is_active', 'use_count', 'expires_at', 'created_at']
    list_filter = ['role', 'is_active']
    readonly_fields = ['id', 'created_at']
