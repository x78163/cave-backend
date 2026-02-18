from django.contrib import admin
from .models import PointOfInterest


@admin.register(PointOfInterest)
class PointOfInterestAdmin(admin.ModelAdmin):
    list_display = ['label', 'cave', 'poi_type', 'source', 'created_at']
    list_filter = ['poi_type', 'source']
    search_fields = ['label', 'description']
    readonly_fields = ['id', 'created_at']
