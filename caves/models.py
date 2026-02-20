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


class LandOwner(models.Model):
    """
    Physical land owner / contact information for a cave property.
    Contact details can be public (commercial caves) or private (private land).
    """

    class ContactVisibility(models.TextChoices):
        PUBLIC = 'public', 'Public'
        PRIVATE = 'private', 'Private (on request)'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.OneToOneField(Cave, on_delete=models.CASCADE, related_name='land_owner')

    # Owner identity
    owner_name = models.CharField(max_length=300, blank=True, default='')
    organization = models.CharField(
        max_length=300, blank=True, default='',
        help_text='Business name for commercial caves',
    )

    # Contact info (controlled by visibility)
    phone = models.CharField(max_length=50, blank=True, default='')
    email = models.EmailField(blank=True, default='')
    address = models.TextField(blank=True, default='')
    website = models.URLField(blank=True, default='')

    # Privacy
    contact_visibility = models.CharField(
        max_length=10, choices=ContactVisibility.choices,
        default=ContactVisibility.PRIVATE,
    )
    notes = models.TextField(
        blank=True, default='',
        help_text='Internal notes about contacting the owner',
    )

    # GIS visibility toggle — cave entry creator can mute tier-2 fields
    # (owner name, address, acreage, appraised value, class, type, sale date)
    # TPAD link, GIS Map link, and polygon boundary always remain visible.
    gis_fields_visible = models.BooleanField(
        default=True,
        help_text='Show GIS parcel details (owner, address, acreage, etc.). '
                  'TPAD link and polygon boundary always visible.',
    )

    # GIS parcel data (auto-filled from TN GIS)
    parcel_id = models.CharField(max_length=100, blank=True, default='')
    parcel_address = models.CharField(max_length=500, blank=True, default='')
    parcel_acreage = models.FloatField(null=True, blank=True)
    parcel_land_use = models.CharField(max_length=200, blank=True, default='')
    parcel_appraised_value = models.FloatField(null=True, blank=True)
    gis_county = models.CharField(max_length=100, blank=True, default='')
    gis_source = models.CharField(
        max_length=50, blank=True, default='',
        help_text='Which GIS service provided this data',
    )
    gis_lookup_at = models.DateTimeField(null=True, blank=True)
    tpad_link = models.URLField(blank=True, default='', help_text='Link to TN Property Assessment Data')
    parcel_geometry = models.JSONField(
        null=True, blank=True, default=None,
        help_text='Parcel boundary polygon rings as [[lat, lon], ...] arrays',
    )

    # TPAD-enriched fields
    property_class = models.CharField(
        max_length=100, blank=True, default='',
        help_text='Property classification (Farm, Residential, Commercial, etc.)',
    )
    property_type = models.CharField(
        max_length=100, blank=True, default='',
        help_text='Interpreted property type description',
    )
    last_sale_date = models.CharField(
        max_length=20, blank=True, default='',
        help_text='Date of last sale (from TPAD)',
    )
    gis_map_link = models.URLField(
        blank=True, default='',
        help_text='Link to TN GIS assessment map',
    )

    # Users granted access to see private contact info
    contact_access_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True,
        related_name='contact_access_caves',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Land Owner'
        verbose_name_plural = 'Land Owners'

    def __str__(self):
        name = self.owner_name or self.organization or 'Unknown'
        return f"Land owner for {self.cave.name}: {name}"


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


class CaveRequest(models.Model):
    """
    Actionable request tied to a cave — contact access requests and
    contact info submissions. Accept/deny lifecycle with side effects.
    """

    class RequestType(models.TextChoices):
        CONTACT_ACCESS = 'contact_access', 'Contact Access Request'
        CONTACT_SUBMISSION = 'contact_submission', 'Contact Info Submission'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        ACCEPTED = 'accepted', 'Accepted'
        DENIED = 'denied', 'Denied'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(Cave, on_delete=models.CASCADE, related_name='requests')
    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='cave_requests',
    )
    request_type = models.CharField(max_length=20, choices=RequestType.choices)
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING,
    )
    message = models.TextField(blank=True, default='')
    payload = models.JSONField(
        null=True, blank=True, default=None,
        help_text='Submitted contact data for contact_submission type',
    )
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='resolved_cave_requests',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['cave', 'requester', 'request_type'],
                condition=models.Q(status='pending'),
                name='unique_pending_request_per_type',
            )
        ]

    def __str__(self):
        return f'{self.requester} -> {self.cave.name} ({self.get_request_type_display()}: {self.status})'


class SurveyMap(models.Model):
    """
    A calibrated survey map image overlaid on a cave's surface map.
    Each cave can have multiple survey maps with independent calibration.

    Lifecycle:
      1. User uploads image -> backend processes (strip bg, recolor) -> saves both
      2. User pins entrance on image -> anchor_x, anchor_y
      3. User measures scale bar -> scale (m/px)
      4. User adjusts rotation -> heading
      5. User clicks Confirm -> is_locked = True
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(Cave, on_delete=models.CASCADE, related_name='survey_maps')

    # Images
    original_image = models.ImageField(upload_to='survey_maps/originals/')
    overlay_image = models.ImageField(upload_to='survey_maps/overlays/')
    image_width = models.IntegerField()
    image_height = models.IntegerField()

    # Calibration
    anchor_x = models.FloatField(default=0.5, help_text='Fractional X (0=left, 1=right)')
    anchor_y = models.FloatField(default=0.5, help_text='Fractional Y (0=top, 1=bottom)')
    scale = models.FloatField(default=0.1, help_text='Meters per pixel')
    heading = models.FloatField(default=0.0, help_text='Rotation degrees CW from north')
    opacity = models.FloatField(default=0.75)

    # Metadata
    name = models.CharField(max_length=200, blank=True, default='')
    is_locked = models.BooleanField(default=False)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='uploaded_survey_maps',
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        label = self.name or f'Survey {str(self.id)[:8]}'
        return f'{label} — {self.cave.name}'


class CaveDocument(models.Model):
    """PDF documents associated with a cave — survey reports, permits, research papers."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(Cave, on_delete=models.CASCADE, related_name='documents')
    file = models.FileField(upload_to='caves/documents/')
    title = models.CharField(max_length=300, blank=True, default='')
    description = models.TextField(blank=True, default='')
    file_size = models.IntegerField(default=0, help_text='File size in bytes')
    page_count = models.IntegerField(null=True, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='uploaded_documents',
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return f'{self.title or self.file.name} — {self.cave.name}'


class CaveVideoLink(models.Model):
    """Video link embeds associated with a cave — YouTube, Vimeo, TikTok, etc."""
    class Platform(models.TextChoices):
        YOUTUBE = 'youtube', 'YouTube'
        VIMEO = 'vimeo', 'Vimeo'
        TIKTOK = 'tiktok', 'TikTok'
        FACEBOOK = 'facebook', 'Facebook'
        OTHER = 'other', 'Other'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(Cave, on_delete=models.CASCADE, related_name='video_links')
    url = models.URLField(max_length=500)
    title = models.CharField(max_length=300, blank=True, default='')
    description = models.TextField(blank=True, default='')
    platform = models.CharField(max_length=20, choices=Platform.choices, default=Platform.OTHER)
    video_id = models.CharField(max_length=200, blank=True, default='')
    embed_url = models.URLField(max_length=500, blank=True, default='')
    thumbnail_url = models.URLField(max_length=500, blank=True, default='')
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='added_video_links',
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-added_at']

    def __str__(self):
        return f'{self.title or self.url} — {self.cave.name}'
