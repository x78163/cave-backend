from django.contrib import admin
from .models import SensorAlert


@admin.register(SensorAlert)
class SensorAlertAdmin(admin.ModelAdmin):
    list_display = ['sensor_type', 'level', 'message', 'cave', 'timestamp', 'synced_at']
    list_filter = ['sensor_type', 'level']
    search_fields = ['message']
    readonly_fields = ['id', 'synced_at']
