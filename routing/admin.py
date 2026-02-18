from django.contrib import admin

from .models import CaveRoute


@admin.register(CaveRoute)
class CaveRouteAdmin(admin.ModelAdmin):
    list_display = ['name', 'cave', 'created_by', 'speed_kmh', 'created_at']
    list_filter = ['cave', 'created_at']
    readonly_fields = ['id', 'created_at', 'updated_at']
