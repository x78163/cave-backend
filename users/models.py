import secrets
import string
import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


def generate_invite_code():
    """Generate an 8-character alphanumeric invite code."""
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(8))


class UserProfile(AbstractUser):
    """Custom user model with exploration stats and avatar.

    Extends Django's AbstractUser. This IS the auth user model.
    Inherits: username, email, password, first_name, last_name,
    is_staff, is_superuser, is_active, date_joined, last_login.
    Uses integer PK (from AbstractUser).
    """
    bio = models.TextField(blank=True, default='')
    avatar = models.ImageField(upload_to='users/avatars/', null=True, blank=True)
    avatar_preset = models.CharField(max_length=50, blank=True, default='')
    location = models.CharField(max_length=200, blank=True, default='')
    specialties = models.JSONField(default=list, blank=True)
    onboarding_complete = models.BooleanField(default=False)
    allow_dms = models.BooleanField(
        default=True, help_text='Allow direct messages from other users',
    )
    is_wiki_editor = models.BooleanField(
        default=False, help_text='Can publish wiki edits directly without review',
    )
    email_verified = models.BooleanField(
        default=False, help_text='Whether email address has been verified',
    )
    google_id = models.CharField(
        max_length=255, blank=True, default='',
        help_text='Google account ID for OAuth users',
    )

    invited_by = models.ForeignKey(
        'self', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='invited_users',
        help_text='User who generated the invite code used at registration',
    )

    # Exploration stats (computed/cached)
    caves_explored = models.IntegerField(default=0)
    total_mapping_distance = models.FloatField(
        default=0, help_text='Total cave passage length mapped in meters'
    )
    expeditions_count = models.IntegerField(default=0)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'user'
        verbose_name_plural = 'users'

    def __str__(self):
        return self.username


class Grotto(models.Model):
    """A caving organization or group."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    website = models.URLField(blank=True, default='')
    logo = models.ImageField(upload_to='grottos/logos/', null=True, blank=True)
    cover_image = models.ImageField(upload_to='grottos/covers/', null=True, blank=True)
    privacy = models.CharField(
        max_length=10,
        choices=[('public', 'Public'), ('private', 'Private')],
        default='public',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='created_grottos'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'grottos'

    def __str__(self):
        return self.name


class GrottoMembership(models.Model):
    """Membership linking users to grottos with roles."""

    class Role(models.TextChoices):
        ADMIN = 'admin', 'Admin'
        MEMBER = 'member', 'Member'

    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        PENDING_APPLICATION = 'pending_application', 'Pending Application'
        PENDING_INVITATION = 'pending_invitation', 'Pending Invitation'
        REJECTED = 'rejected', 'Rejected'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='grotto_memberships'
    )
    grotto = models.ForeignKey(
        Grotto, on_delete=models.CASCADE, related_name='memberships'
    )
    role = models.CharField(
        max_length=20, choices=Role.choices, default=Role.MEMBER
    )
    status = models.CharField(
        max_length=25, choices=Status.choices, default=Status.ACTIVE
    )
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['user', 'grotto']

    def __str__(self):
        return f"{self.user.username} in {self.grotto.name} ({self.role})"


class InviteCode(models.Model):
    """Invite codes for gated registration."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(
        max_length=8, unique=True, default=generate_invite_code,
        help_text='8-char alphanumeric code',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='invite_codes',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    max_uses = models.IntegerField(
        default=1, help_text='Max times this code can be used (0 = unlimited)',
    )
    use_count = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.code} by {self.created_by.username} ({self.use_count}/{self.max_uses})"

    @property
    def is_usable(self):
        return self.is_active and (self.max_uses == 0 or self.use_count < self.max_uses)


class NotificationPreference(models.Model):
    """Per-user email notification preferences.

    Each boolean controls whether an email is sent for that category.
    Defaults are all True (opt-out model). Users can toggle in profile settings.
    """

    class DigestFrequency(models.TextChoices):
        IMMEDIATE = 'immediate', 'Immediate'
        DAILY = 'daily', 'Daily digest'
        WEEKLY = 'weekly', 'Weekly digest'
        OFF = 'off', 'Off'

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='notification_prefs',
    )

    # Cave access & permissions
    cave_access_request = models.BooleanField(
        default=True, help_text='Someone requests access to your cave',
    )
    cave_access_granted = models.BooleanField(
        default=True, help_text='Your cave access request is approved/denied',
    )
    landowner_contact_request = models.BooleanField(
        default=True, help_text='Someone requests landowner contact info',
    )

    # Events
    event_invitation = models.BooleanField(
        default=True, help_text='You are invited to an event',
    )
    event_update = models.BooleanField(
        default=True, help_text='An event you RSVPed to is updated/cancelled',
    )
    event_reminder = models.BooleanField(
        default=True, help_text='Reminder 24h before an event',
    )

    # Social
    comment_on_post = models.BooleanField(
        default=True, help_text='Someone comments on your post',
    )
    comment_reply = models.BooleanField(
        default=True, help_text='Someone replies to your comment',
    )
    mention = models.BooleanField(
        default=True, help_text='Someone @mentions you',
    )
    new_follower = models.BooleanField(
        default=True, help_text='Someone follows you',
    )

    # Chat digest
    chat_digest = models.CharField(
        max_length=10, choices=DigestFrequency.choices,
        default=DigestFrequency.DAILY,
        help_text='Unread chat message digest frequency',
    )

    # Wiki
    wiki_cave_edit = models.BooleanField(
        default=True, help_text='Wiki article edited for a cave you own',
    )

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'notification preference'
        verbose_name_plural = 'notification preferences'

    def __str__(self):
        return f'NotificationPreference for {self.user.username}'

    @classmethod
    def for_user(cls, user):
        """Get or create preferences for a user (lazy creation)."""
        obj, _ = cls.objects.get_or_create(user=user)
        return obj


class SiteSettings(models.Model):
    """Singleton site-wide settings (always exactly one row)."""

    require_invite_code = models.BooleanField(
        default=True, help_text='Require invite code for registration',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'site settings'
        verbose_name_plural = 'site settings'

    def __str__(self):
        return 'Site Settings'

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
