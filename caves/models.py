import uuid
from django.conf import settings
from django.db import models


class Cave(models.Model):
    """
    Core cave profile — mirrors cave-server Cave model exactly,
    with additional cloud-specific fields for visibility, permissions,
    and device origin tracking.
    """

    class Source(models.TextChoices):
        LOCAL_CREATED = 'local_created', 'Created on Device'
        LOCAL_MAPPED = 'local_mapped', 'Mapped on Device'
        DOWNLOADED = 'downloaded', 'Downloaded from Server'
        IMPORTED = 'imported', 'Imported'

    class Visibility(models.TextChoices):
        PUBLIC = 'public', 'Public'
        LIMITED_PUBLIC = 'limited_public', 'Limited Public'
        PRIVATE = 'private', 'Private'

    class CollaborationSetting(models.TextChoices):
        READ_ONLY = 'read_only', 'Read Only'
        COLLABORATIVE = 'collaborative', 'Collaborative'

    # === Fields matching cave-server exactly ===
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')

    # Location
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    region = models.CharField(max_length=200, blank=True, default='')
    country = models.CharField(max_length=100, blank=True, default='')

    # Cave statistics
    total_length = models.FloatField(
        null=True, blank=True, help_text='Total passage length in meters'
    )
    largest_chamber = models.FloatField(
        null=True, blank=True, help_text='Largest chamber area in square meters'
    )
    smallest_passage = models.FloatField(
        null=True, blank=True, help_text='Smallest passage width in meters'
    )
    vertical_extent = models.FloatField(
        null=True, blank=True, help_text='Total vertical range in meters'
    )
    number_of_levels = models.IntegerField(null=True, blank=True)

    # Hazard information
    hazard_count = models.IntegerField(default=0)
    toxic_gas_present = models.BooleanField(default=False)
    toxic_gas_types = models.CharField(
        max_length=200, blank=True, default='', help_text='e.g. CO2, H2S, CH4'
    )
    max_particulate = models.FloatField(
        null=True, blank=True, help_text='Highest PM2.5 reading'
    )
    water_present = models.BooleanField(default=False)
    water_description = models.CharField(
        max_length=200, blank=True, default='',
        help_text='e.g. Stream, sump, standing water'
    )
    requires_equipment = models.TextField(
        blank=True, default='', help_text='Special equipment needed'
    )

    # Map data
    has_map = models.BooleanField(default=False)
    point_cloud_path = models.CharField(max_length=500, blank=True, default='')
    keyframe_dir = models.CharField(max_length=500, blank=True, default='')
    slam_heading = models.FloatField(
        null=True, blank=True, default=None,
        help_text='SLAM frame heading in degrees clockwise from north'
    )

    # Metadata
    source = models.CharField(
        max_length=20, choices=Source.choices, default=Source.LOCAL_CREATED
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Cover photo
    cover_photo = models.ImageField(
        upload_to='caves/covers/', null=True, blank=True
    )

    # === Cloud-specific fields ===
    visibility = models.CharField(
        max_length=20, choices=Visibility.choices, default=Visibility.PRIVATE
    )
    collaboration_setting = models.CharField(
        max_length=20, choices=CollaborationSetting.choices,
        default=CollaborationSetting.READ_ONLY
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='owned_caves'
    )
    origin_device = models.ForeignKey(
        'devices.Device', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='caves',
        help_text='Device that originally created/synced this cave'
    )

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return self.name

    @property
    def has_location(self):
        return self.latitude is not None and self.longitude is not None


class CavePhoto(models.Model):
    """Photos associated with a cave — mirrors cave-server exactly + device tracking."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(Cave, on_delete=models.CASCADE, related_name='photos')
    image = models.ImageField(upload_to='caves/photos/')
    caption = models.CharField(max_length=300, blank=True, default='')
    tags = models.CharField(
        max_length=500, blank=True, default='', help_text='Comma-separated tags'
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    # Cloud-specific
    origin_device = models.ForeignKey(
        'devices.Device', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='synced_photos'
    )

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return f"Photo for {self.cave.name}: {self.caption[:50]}"


class DescriptionRevision(models.Model):
    """Wiki-style version tracking for cave descriptions — mirrors cave-server exactly."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(Cave, on_delete=models.CASCADE, related_name='revisions')
    content = models.TextField(help_text='Markdown-formatted description')
    edit_summary = models.CharField(max_length=200, blank=True, default='')
    editor_name = models.CharField(max_length=100, default='Device User')
    revision_number = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    # Cloud-specific
    editor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='description_revisions'
    )
    origin_device = models.ForeignKey(
        'devices.Device', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='synced_revisions'
    )

    class Meta:
        ordering = ['-revision_number']
        unique_together = ['cave', 'revision_number']

    def __str__(self):
        return f"{self.cave.name} rev{self.revision_number}: {self.edit_summary[:50]}"


class CaveComment(models.Model):
    """User comments on a cave profile — mirrors cave-server exactly."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(Cave, on_delete=models.CASCADE, related_name='comments')
    text = models.TextField()
    author_name = models.CharField(max_length=100, default='Device User')
    created_at = models.DateTimeField(auto_now_add=True)

    # Cloud-specific
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='cave_comments'
    )
    origin_device = models.ForeignKey(
        'devices.Device', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='synced_comments'
    )

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Comment on {self.cave.name}: {self.text[:50]}"


class CavePermission(models.Model):
    """Per-user access control for a cave."""

    class Role(models.TextChoices):
        OWNER = 'owner', 'Owner'
        EDITOR = 'editor', 'Editor'
        VIEWER = 'viewer', 'Viewer'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(Cave, on_delete=models.CASCADE, related_name='permissions')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='cave_permissions'
    )
    role = models.CharField(max_length=10, choices=Role.choices)
    granted_at = models.DateTimeField(auto_now_add=True)
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='granted_permissions'
    )

    class Meta:
        unique_together = ['cave', 'user']

    def __str__(self):
        return f"{self.user} -> {self.cave.name} ({self.role})"


class CaveShareLink(models.Model):
    """Temporary share links with optional QR code for cave access."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(Cave, on_delete=models.CASCADE, related_name='share_links')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='created_share_links'
    )
    token = models.CharField(max_length=255, unique=True)
    role = models.CharField(
        max_length=10, choices=CavePermission.Role.choices,
        default=CavePermission.Role.VIEWER,
        help_text='Role granted when link is used'
    )
    expires_at = models.DateTimeField(null=True, blank=True)
    max_uses = models.IntegerField(null=True, blank=True)
    use_count = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Share link for {self.cave.name} ({self.role})"

    @property
    def is_expired(self):
        from django.utils import timezone
        if self.expires_at and timezone.now() > self.expires_at:
            return True
        if self.max_uses and self.use_count >= self.max_uses:
            return True
        return not self.is_active
