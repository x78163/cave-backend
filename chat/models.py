import uuid
from django.conf import settings
from django.db import models


class Channel(models.Model):
    class ChannelType(models.TextChoices):
        DM = 'dm', 'Direct Message'
        CHANNEL = 'channel', 'Channel'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, blank=True, default='')
    channel_type = models.CharField(
        max_length=10, choices=ChannelType.choices,
    )
    description = models.TextField(blank=True, default='')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='created_channels',
    )
    grotto = models.ForeignKey(
        'users.Grotto', on_delete=models.CASCADE,
        null=True, blank=True, related_name='channels',
    )
    is_private = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['channel_type', '-updated_at']),
        ]

    def __str__(self):
        if self.channel_type == 'dm':
            return f'DM {self.id}'
        return self.name or f'Channel {self.id}'


class ChannelMembership(models.Model):
    class Role(models.TextChoices):
        OWNER = 'owner', 'Owner'
        MEMBER = 'member', 'Member'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    channel = models.ForeignKey(
        Channel, on_delete=models.CASCADE, related_name='memberships',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='channel_memberships',
    )
    role = models.CharField(
        max_length=10, choices=Role.choices, default=Role.MEMBER,
    )
    last_read_message_id = models.UUIDField(null=True, blank=True)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['channel', 'user']
        indexes = [
            models.Index(fields=['user', 'channel']),
        ]

    def __str__(self):
        return f'{self.user} in {self.channel}'


class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    channel = models.ForeignKey(
        Channel, on_delete=models.CASCADE, related_name='messages',
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='chat_messages',
    )
    content = models.TextField(blank=True, default='')
    image = models.ImageField(upload_to='chat/images/', null=True, blank=True)
    file = models.FileField(upload_to='chat/files/', null=True, blank=True)
    file_name = models.CharField(max_length=255, blank=True, default='')
    file_size = models.IntegerField(default=0)
    video_preview = models.JSONField(null=True, blank=True, default=None)
    created_at = models.DateTimeField(auto_now_add=True)

    # Edit / Delete
    edited_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)

    # Flat reply threading (one level)
    reply_to = models.ForeignKey(
        'self', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='replies',
    )

    # Pinned messages
    is_pinned = models.BooleanField(default=False)
    pinned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='+',
    )
    pinned_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['channel', 'created_at']),
            models.Index(fields=['author', '-created_at']),
            models.Index(fields=['channel', 'is_pinned']),
            models.Index(fields=['reply_to']),
        ]

    def __str__(self):
        return f'{self.author}: {self.content[:50]}'


class MessageMention(models.Model):
    """Tracks @mentions in messages for notification dispatch."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.ForeignKey(
        Message, on_delete=models.CASCADE, related_name='mentions',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='chat_mentions',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['message', 'user']
        indexes = [
            models.Index(fields=['user', '-created_at']),
        ]

    def __str__(self):
        return f'@{self.user} in {self.message_id}'


class Notification(models.Model):
    class NotificationType(models.TextChoices):
        MENTION = 'mention', 'Mention'
        REPLY = 'reply', 'Reply'
        PIN = 'pin', 'Pin'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='chat_notifications',
    )
    notification_type = models.CharField(
        max_length=20, choices=NotificationType.choices,
    )
    message = models.ForeignKey(
        Message, on_delete=models.CASCADE, related_name='notifications',
    )
    channel = models.ForeignKey(
        Channel, on_delete=models.CASCADE, related_name='notifications',
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='+',
    )
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'is_read', '-created_at']),
        ]

    def __str__(self):
        return f'{self.notification_type} for {self.user} in {self.channel_id}'


class MessageReaction(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.ForeignKey(
        Message, on_delete=models.CASCADE, related_name='reactions',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='chat_reactions',
    )
    emoji = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['message', 'user', 'emoji']
        indexes = [
            models.Index(fields=['message', 'emoji']),
        ]

    def __str__(self):
        return f'{self.user} reacted {self.emoji} on {self.message_id}'
