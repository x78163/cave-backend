"""Event models for cave-backend: community events, RSVPs, invitations, comments."""

import uuid

from django.conf import settings
from django.db import models


class Event(models.Model):
    """A caving community event — expedition, training, outreach, etc."""

    class EventType(models.TextChoices):
        EXPEDITION = 'expedition', 'Expedition'
        SURVEY = 'survey', 'Survey Trip'
        TRAINING = 'training', 'Training'
        EDUCATION = 'education', 'Education'
        OUTREACH = 'outreach', 'Outreach'
        CONSERVATION = 'conservation', 'Conservation'
        SOCIAL = 'social', 'Social Gathering'
        OTHER = 'other', 'Other'

    class Visibility(models.TextChoices):
        PUBLIC = 'public', 'Public'
        ALL_GROTTO = 'all_grotto', 'All Grotto Members'
        GROTTO_ONLY = 'grotto_only', 'Grotto Only'
        UNLISTED = 'unlisted', 'Unlisted'
        PRIVATE = 'private', 'Private (Invite Only)'

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'
        CANCELLED = 'cancelled', 'Cancelled'
        COMPLETED = 'completed', 'Completed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=300)
    event_type = models.CharField(
        max_length=20, choices=EventType.choices, default=EventType.EXPEDITION
    )
    description = models.TextField(blank=True, default='',
        help_text='Rich text (Markdown) description')

    # Timing
    start_date = models.DateTimeField()
    end_date = models.DateTimeField(null=True, blank=True)
    all_day = models.BooleanField(default=False,
        help_text='If true, times are ignored (date-only display)')

    # Location (all optional — could be a cave, an address, or coordinates)
    cave = models.ForeignKey(
        'caves.Cave', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='events'
    )
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    address = models.TextField(blank=True, default='',
        help_text='Freeform address text')
    google_maps_link = models.URLField(max_length=500, blank=True, default='')

    # Organizer info
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='created_events'
    )
    point_of_contact = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='poc_events',
        help_text='Primary contact person for this event'
    )

    # Grotto ownership (optional)
    grotto = models.ForeignKey(
        'users.Grotto', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='events'
    )

    # Logistics
    required_equipment = models.TextField(blank=True, default='')
    meetup_instructions = models.TextField(blank=True, default='',
        help_text='Parking, meetup point, driving directions, etc.')
    max_participants = models.IntegerField(null=True, blank=True)

    # Visibility and status
    visibility = models.CharField(
        max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PUBLISHED
    )

    # Cover image (optional)
    cover_image = models.ImageField(
        upload_to='events/covers/', null=True, blank=True
    )

    # Auto-created chat channel for event discussion
    chat_channel = models.ForeignKey(
        'chat.Channel', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='events',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['start_date']
        indexes = [
            models.Index(fields=['start_date']),
            models.Index(fields=['created_by', '-created_at']),
            models.Index(fields=['grotto', 'start_date']),
            models.Index(fields=['visibility', 'status', 'start_date']),
        ]

    def __str__(self):
        return f'{self.name} ({self.get_event_type_display()})'


class EventRSVP(models.Model):
    """RSVP to an event."""

    class RSVPStatus(models.TextChoices):
        GOING = 'going', 'Going'
        MAYBE = 'maybe', 'Maybe'
        NOT_GOING = 'not_going', 'Not Going'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name='rsvps'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='event_rsvps'
    )
    status = models.CharField(
        max_length=20, choices=RSVPStatus.choices, default=RSVPStatus.GOING
    )
    rsvped_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ['event', 'user']
        ordering = ['-rsvped_at']

    def __str__(self):
        return f'{self.user.username} -> {self.event.name} ({self.status})'


class EventInvitation(models.Model):
    """Invitation to a private/grotto event — targets a user OR a grotto."""

    class InvitationStatus(models.TextChoices):
        PENDING = 'pending', 'Pending'
        ACCEPTED = 'accepted', 'Accepted'
        DECLINED = 'declined', 'Declined'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name='invitations'
    )
    invited_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        null=True, blank=True, related_name='event_invitations'
    )
    invited_grotto = models.ForeignKey(
        'users.Grotto', on_delete=models.CASCADE,
        null=True, blank=True, related_name='event_invitations'
    )
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='sent_event_invitations'
    )
    status = models.CharField(
        max_length=20, choices=InvitationStatus.choices,
        default=InvitationStatus.PENDING
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(invited_user__isnull=False, invited_grotto__isnull=True) |
                    models.Q(invited_user__isnull=True, invited_grotto__isnull=False)
                ),
                name='event_invitation_target_xor',
            ),
        ]

    def __str__(self):
        target = self.invited_user or self.invited_grotto
        return f'Invite to {self.event.name} -> {target}'


class EventComment(models.Model):
    """Comment on an event."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name='comments'
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='event_comments'
    )
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.author.username} on {self.event.name}: {self.text[:50]}'


# ---------------------------------------------------------------------------
# Expedition Safety & Tracking
# ---------------------------------------------------------------------------

class ExpeditionTracking(models.Model):
    """Safety tracking layer for expedition-type events.

    Created when a leader opts in to tracking for an event.  Manages a state
    machine, timer configuration, emergency contacts, and links to check-ins,
    GPS breadcrumbs, and surrogates.
    """

    class State(models.TextChoices):
        PREPARING = 'preparing', 'Preparing'
        ACTIVE = 'active', 'Active'
        UNDERGROUND = 'underground', 'Underground'
        SURFACED = 'surfaced', 'Surfaced'
        OVERDUE = 'overdue', 'Overdue'
        ALERT_SENT = 'alert_sent', 'Alert Sent'
        EMERGENCY_SENT = 'emergency_sent', 'Emergency Sent'
        COMPLETED = 'completed', 'Completed'
        RESOLVED = 'resolved', 'Resolved'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.OneToOneField(
        Event, on_delete=models.CASCADE, related_name='tracking',
    )

    # State machine
    state = models.CharField(
        max_length=20, choices=State.choices, default=State.PREPARING,
    )
    state_changed_at = models.DateTimeField(auto_now_add=True)

    # Timer configuration
    expected_return = models.DateTimeField(
        null=True, blank=True,
        help_text='Absolute time when party is expected to surface',
    )
    alert_delay_minutes = models.IntegerField(
        default=30,
        help_text='Minutes after expected_return + GPS stale before emergency email',
    )
    gps_stale_minutes = models.IntegerField(
        default=15,
        help_text='Minutes without GPS from ANY participant before assuming underground',
    )

    # Tracking metadata
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    last_gps_at = models.DateTimeField(
        null=True, blank=True,
        help_text='Most recent GPS ping from ANY checked-in participant',
    )

    # Emergency contact info (non-app users: [{name, email, phone}])
    emergency_contacts = models.JSONField(
        default=list, blank=True,
        help_text='List of {name, email, phone} dicts for emergency notification',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['state', 'expected_return']),
        ]

    def __str__(self):
        return f'Tracking for {self.event.name} [{self.state}]'


class ExpeditionCheckIn(models.Model):
    """Records who actually showed up (vs. who RSVPed)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tracking = models.ForeignKey(
        ExpeditionTracking, on_delete=models.CASCADE, related_name='checkins',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='expedition_checkins',
    )
    checked_in_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name='checkins_performed',
        help_text='User who performed the check-in (self or leader)',
    )
    checked_in_at = models.DateTimeField(auto_now_add=True)
    checked_out_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ['tracking', 'user']
        ordering = ['checked_in_at']

    def __str__(self):
        return f'{self.user.username} checked in ({self.tracking.event.name})'


class ExpeditionGPSPoint(models.Model):
    """GPS breadcrumb for a checked-in participant."""

    id = models.BigAutoField(primary_key=True)
    tracking = models.ForeignKey(
        ExpeditionTracking, on_delete=models.CASCADE, related_name='gps_points',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='expedition_gps_points',
    )
    latitude = models.FloatField()
    longitude = models.FloatField()
    accuracy = models.FloatField(null=True, blank=True)
    altitude = models.FloatField(null=True, blank=True)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['tracking', 'recorded_at']),
            models.Index(fields=['tracking', 'user', '-recorded_at']),
        ]
        ordering = ['recorded_at']

    def __str__(self):
        return f'GPS {self.user.username} @ {self.latitude},{self.longitude}'


class ExpeditionSurrogate(models.Model):
    """User or grotto designated as safety surrogate for an expedition."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tracking = models.ForeignKey(
        ExpeditionTracking, on_delete=models.CASCADE, related_name='surrogates',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        null=True, blank=True, related_name='surrogate_for',
    )
    grotto = models.ForeignKey(
        'users.Grotto', on_delete=models.CASCADE,
        null=True, blank=True, related_name='surrogate_for',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(user__isnull=False, grotto__isnull=True)
                    | models.Q(user__isnull=True, grotto__isnull=False)
                ),
                name='surrogate_target_xor',
            ),
        ]

    def __str__(self):
        target = self.user or self.grotto
        return f'Surrogate {target} for {self.tracking.event.name}'


class ExpeditionStateLog(models.Model):
    """Audit log of all state transitions for an expedition."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tracking = models.ForeignKey(
        ExpeditionTracking, on_delete=models.CASCADE, related_name='state_logs',
    )
    from_state = models.CharField(max_length=20)
    to_state = models.CharField(max_length=20)
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
        help_text='Null if triggered by system (timer)',
    )
    note = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'{self.from_state} -> {self.to_state} ({self.tracking.event.name})'
