import uuid
from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


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
