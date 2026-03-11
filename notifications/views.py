"""
Views for handling email action tokens (one-click approve/deny/RSVP/unsubscribe).

When a user clicks an action button in an email, the signed token is verified
and the action is executed, then the user is redirected to the appropriate
frontend page.
"""

import logging

from django.conf import settings
from django.core import signing
from django.http import HttpResponseRedirect
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .tokens import verify_action_token

logger = logging.getLogger(__name__)


def _frontend_url(path=''):
    base = getattr(settings, 'FRONTEND_URL', 'http://localhost:5174')
    return f'{base.rstrip("/")}{path}'


@api_view(['GET'])
@permission_classes([AllowAny])
def handle_email_action(request):
    """Process a signed email action token.

    GET /api/notifications/action?token=...

    Actions:
      - cave_access_approve / cave_access_deny
      - event_rsvp (status=going/not_going)
      - unsubscribe (category toggle)
    """
    token = request.query_params.get('token', '')
    if not token:
        return Response({'error': 'Missing token'}, status=400)

    try:
        data = verify_action_token(token)
    except signing.BadSignature:
        return HttpResponseRedirect(
            _frontend_url('/?error=expired_link')
        )

    action = data.get('action')
    logger.info('Email action: %s, data: %s', action, data)

    if action == 'cave_access_approve':
        return _handle_cave_access(data, status='accepted')
    elif action == 'cave_access_deny':
        return _handle_cave_access(data, status='denied')
    elif action == 'event_rsvp':
        return _handle_event_rsvp(data)
    elif action == 'unsubscribe':
        return _handle_unsubscribe(data)
    else:
        return Response({'error': 'Unknown action'}, status=400)


def _handle_cave_access(data, status):
    """Approve or deny a cave access request."""
    from caves.models import CaveRequest
    from users.models import UserProfile
    from .tasks import send_cave_access_resolved_email

    request_id = data.get('request_id')
    user_id = data.get('user_id')

    try:
        cave_req = CaveRequest.objects.select_related('cave').get(id=request_id)
    except CaveRequest.DoesNotExist:
        return HttpResponseRedirect(
            _frontend_url('/?error=request_not_found')
        )

    # Verify the token user is the cave owner
    if cave_req.cave.owner_id != user_id:
        return HttpResponseRedirect(
            _frontend_url('/?error=unauthorized')
        )

    if cave_req.status != 'pending':
        return HttpResponseRedirect(
            _frontend_url(f'/caves/{cave_req.cave.id}?info=already_resolved')
        )

    # Resolve the request
    try:
        resolver = UserProfile.objects.get(id=user_id)
    except UserProfile.DoesNotExist:
        return HttpResponseRedirect(_frontend_url('/?error=user_not_found'))

    from django.utils import timezone
    cave_req.status = status
    cave_req.resolved_by = resolver
    cave_req.resolved_at = timezone.now()
    cave_req.save(update_fields=['status', 'resolved_by', 'resolved_at'])

    # If approved and it's a contact_access request, grant access
    if status == 'accepted' and cave_req.request_type == 'contact_access':
        landowner = getattr(cave_req.cave, 'landowner', None)
        if landowner:
            landowner.contact_access_users.add(cave_req.requester)

    # Notify requester asynchronously
    send_cave_access_resolved_email.delay(str(cave_req.id), status)

    return HttpResponseRedirect(
        _frontend_url(f'/caves/{cave_req.cave.id}?info=access_{status}')
    )


def _handle_event_rsvp(data):
    """RSVP to an event via email action."""
    from events.models import Event, EventRSVP
    from users.models import UserProfile

    event_id = data.get('event_id')
    user_id = data.get('user_id')
    rsvp_status = data.get('status', 'going')

    try:
        event = Event.objects.get(id=event_id)
        user = UserProfile.objects.get(id=user_id)
    except (Event.DoesNotExist, UserProfile.DoesNotExist):
        return HttpResponseRedirect(
            _frontend_url('/?error=not_found')
        )

    if rsvp_status == 'going':
        # Check capacity
        if event.max_participants:
            going_count = EventRSVP.objects.filter(
                event=event, status='going',
            ).count()
            if going_count >= event.max_participants:
                return HttpResponseRedirect(
                    _frontend_url(f'/events/{event.id}?error=event_full')
                )

        EventRSVP.objects.update_or_create(
            event=event, user=user,
            defaults={'status': 'going'},
        )
    elif rsvp_status == 'not_going':
        EventRSVP.objects.filter(event=event, user=user).delete()

    return HttpResponseRedirect(
        _frontend_url(f'/events/{event.id}?info=rsvp_{rsvp_status}')
    )


def _handle_unsubscribe(data):
    """Toggle off a notification preference category."""
    from users.models import UserProfile, NotificationPreference

    user_id = data.get('user_id')
    category = data.get('category')

    try:
        user = UserProfile.objects.get(id=user_id)
    except UserProfile.DoesNotExist:
        return HttpResponseRedirect(_frontend_url('/'))

    if category:
        prefs = NotificationPreference.for_user(user)
        if hasattr(prefs, category):
            field = NotificationPreference._meta.get_field(category)
            if field.get_internal_type() == 'BooleanField':
                setattr(prefs, category, False)
            elif field.get_internal_type() == 'CharField':
                setattr(prefs, category, 'off')
            prefs.save()
            logger.info('User %s unsubscribed from %s', user.username, category)

    return HttpResponseRedirect(
        _frontend_url('/profile?info=unsubscribed')
    )
