"""Social models for cave-backend: ratings, follows, activity feed, expeditions."""

import uuid

from django.conf import settings
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models


class CaveRating(models.Model):
    """User rating for a cave (1-5 stars with optional review)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(
        'caves.Cave', on_delete=models.CASCADE, related_name='ratings'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='cave_ratings'
    )
    rating = models.IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    review_text = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ['cave', 'user']
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.user} rated {self.cave} {self.rating}/5'


class UserFollow(models.Model):
    """Follow relationship between users."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    follower = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='following'
    )
    following = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='followers'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['follower', 'following']
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.follower} follows {self.following}'

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.follower == self.following:
            raise ValidationError('Users cannot follow themselves.')


class Activity(models.Model):
    """Auto-generated activity feed entries."""

    class ActionType(models.TextChoices):
        CAVE_CREATED = 'cave_created', 'Created a cave'
        PHOTO_UPLOADED = 'photo_uploaded', 'Uploaded a photo'
        COMMENT_ADDED = 'comment_added', 'Added a comment'
        RATING_POSTED = 'rating_posted', 'Rated a cave'
        DESCRIPTION_EDITED = 'description_edited', 'Edited a description'
        EXPEDITION_CREATED = 'expedition_created', 'Created an expedition'
        EXPEDITION_JOINED = 'expedition_joined', 'Joined an expedition'
        USER_FOLLOWED = 'user_followed', 'Followed a user'
        RECONSTRUCTION_COMPLETED = 'reconstruction_completed', 'Reconstruction completed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='activities'
    )
    action_type = models.CharField(max_length=30, choices=ActionType.choices)
    target_model = models.CharField(max_length=100, blank=True, default='')
    target_id = models.UUIDField(null=True, blank=True)
    cave = models.ForeignKey(
        'caves.Cave', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='activities'
    )
    message = models.CharField(max_length=500, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name_plural = 'activities'
        indexes = [
            models.Index(fields=['actor', '-created_at']),
            models.Index(fields=['cave', '-created_at']),
        ]

    def __str__(self):
        return f'{self.actor}: {self.get_action_type_display()}'


class Expedition(models.Model):
    """Planned group caving trip."""

    class Status(models.TextChoices):
        PLANNING = 'planning', 'Planning'
        CONFIRMED = 'confirmed', 'Confirmed'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    cave = models.ForeignKey(
        'caves.Cave', on_delete=models.CASCADE, related_name='expeditions'
    )
    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='organized_expeditions'
    )
    planned_date = models.DateTimeField()
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PLANNING
    )
    max_members = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-planned_date']

    def __str__(self):
        return f'{self.name} — {self.cave.name}'


class ExpeditionMember(models.Model):
    """Membership in an expedition."""

    class MemberStatus(models.TextChoices):
        INVITED = 'invited', 'Invited'
        CONFIRMED = 'confirmed', 'Confirmed'
        DECLINED = 'declined', 'Declined'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    expedition = models.ForeignKey(
        Expedition, on_delete=models.CASCADE, related_name='members'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='expedition_memberships'
    )
    status = models.CharField(
        max_length=20, choices=MemberStatus.choices,
        default=MemberStatus.INVITED
    )
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['expedition', 'user']

    def __str__(self):
        return f'{self.user} in {self.expedition.name} ({self.status})'
