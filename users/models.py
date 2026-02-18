import uuid
from django.conf import settings
from django.db import models


class UserProfile(models.Model):
    """Extended user profile with exploration stats and avatar."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='profile'
    )
    bio = models.TextField(blank=True, default='')
    avatar = models.ImageField(upload_to='users/avatars/', null=True, blank=True)
    location = models.CharField(max_length=200, blank=True, default='')

    # Exploration stats (computed/cached)
    caves_explored = models.IntegerField(default=0)
    total_mapping_distance = models.FloatField(
        default=0, help_text='Total cave passage length mapped in meters'
    )
    expeditions_count = models.IntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profile: {self.user.username}"


class Grotto(models.Model):
    """A caving organization or group."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    website = models.URLField(blank=True, default='')
    logo = models.ImageField(upload_to='grottos/logos/', null=True, blank=True)
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
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['user', 'grotto']

    def __str__(self):
        return f"{self.user.username} in {self.grotto.name} ({self.role})"
