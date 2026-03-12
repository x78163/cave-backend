import uuid
from django.conf import settings
from django.db import models


class Request(models.Model):
    """
    Universal request/approval model. Covers all approval workflows:
    cave access, cave edit, contact access, contact submission,
    event access, grotto membership, map upload, admin escalation.
    """

    class RequestType(models.TextChoices):
        CAVE_ACCESS = 'cave_access', 'Cave Access'
        CAVE_EDIT = 'cave_edit', 'Cave Edit Permission'
        CONTACT_ACCESS = 'contact_access', 'Landowner Contact Access'
        CONTACT_SUBMISSION = 'contact_submission', 'Contact Info Submission'
        EVENT_ACCESS = 'event_access', 'Private Event Access'
        GROTTO_MEMBERSHIP = 'grotto_membership', 'Grotto Membership'
        GROTTO_INVITATION = 'grotto_invitation', 'Grotto Invitation'
        MAP_UPLOAD = 'map_upload', 'Map Upload Permission'
        ADMIN_ESCALATION = 'admin_escalation', 'Admin Role Request'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        ACCEPTED = 'accepted', 'Accepted'
        DENIED = 'denied', 'Denied'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    request_type = models.CharField(max_length=24, choices=RequestType.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)

    # Who is requesting
    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='sent_requests',
    )
    # Who should approve (cave owner, grotto admin, site admin, etc.)
    target_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='received_requests',
        null=True, blank=True,
        help_text='The user who should act on this request',
    )

    # Optional foreign keys — whichever is relevant for the request type
    cave = models.ForeignKey(
        'caves.Cave', on_delete=models.CASCADE,
        null=True, blank=True, related_name='access_requests',
    )
    event = models.ForeignKey(
        'events.Event', on_delete=models.CASCADE,
        null=True, blank=True, related_name='access_requests',
    )
    grotto = models.ForeignKey(
        'users.Grotto', on_delete=models.CASCADE,
        null=True, blank=True, related_name='membership_requests',
    )

    # Messages
    message = models.TextField(blank=True, default='', help_text='Requester note')
    response_message = models.TextField(blank=True, default='', help_text='Approver note')

    # Contact submission payload (for contact_submission type)
    payload = models.JSONField(
        null=True, blank=True, default=None,
        help_text='Submitted contact data for contact_submission type',
    )

    # Resolution
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='resolved_requests',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['requester', 'request_type', 'cave'],
                condition=models.Q(status='pending', cave__isnull=False),
                name='unique_pending_cave_request',
            ),
            models.UniqueConstraint(
                fields=['requester', 'request_type', 'event'],
                condition=models.Q(status='pending', event__isnull=False),
                name='unique_pending_event_request',
            ),
            models.UniqueConstraint(
                fields=['requester', 'request_type', 'grotto'],
                condition=models.Q(status='pending', grotto__isnull=False),
                name='unique_pending_grotto_request',
            ),
        ]
        indexes = [
            models.Index(fields=['target_user', 'status', '-created_at']),
            models.Index(fields=['requester', '-created_at']),
        ]

    def __str__(self):
        target = self.cave or self.event or self.grotto or 'system'
        return f'{self.requester} → {target} ({self.get_request_type_display()}: {self.status})'
