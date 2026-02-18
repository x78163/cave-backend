import uuid
from django.conf import settings
from django.db import models


class Device(models.Model):
    """A registered Orange Pi cave-mapper device."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(
        max_length=200, blank=True, default='',
        help_text='User-assigned device name'
    )
    serial_number = models.CharField(max_length=100, unique=True)
    mac_address = models.CharField(
        max_length=17, blank=True, default='',
        help_text='WiFi MAC address (XX:XX:XX:XX:XX:XX)'
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='devices'
    )
    grotto = models.ForeignKey(
        'users.Grotto', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='devices',
        help_text='Grotto this device belongs to'
    )

    # Registration
    registration_token = models.CharField(
        max_length=255, blank=True, default='',
        help_text='Token for QR code registration flow'
    )
    is_registered = models.BooleanField(default=False)
    registered_at = models.DateTimeField(null=True, blank=True)

    # Auth
    auth_token = models.CharField(
        max_length=255, blank=True, default='',
        help_text='Authentication token for sync API'
    )

    # Sync tracking
    last_sync_at = models.DateTimeField(null=True, blank=True)
    firmware_version = models.CharField(max_length=50, blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Device: {self.name or self.serial_number}"
