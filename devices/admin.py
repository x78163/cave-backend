from django.contrib import admin
from .models import Device


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ['name', 'serial_number', 'owner', 'is_registered', 'last_sync_at']
    list_filter = ['is_registered']
    search_fields = ['name', 'serial_number', 'mac_address']
    readonly_fields = ['id', 'created_at', 'updated_at']
