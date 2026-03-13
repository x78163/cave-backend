"""
Views for handling email action tokens (one-click approve/deny/RSVP/unsubscribe).

When a user clicks an action button in an email, the signed token is verified
and the action is executed, then a standalone confirmation page is shown.
"""

import logging

from django.conf import settings
from django.core import signing
from django.http import HttpResponse, HttpResponseRedirect
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .tokens import verify_action_token

logger = logging.getLogger(__name__)


def _frontend_url(path=''):
    base = getattr(settings, 'FRONTEND_URL', 'http://localhost:5174')
    return f'{base.rstrip("/")}{path}'


def _action_result_page(title, message, link_url=None, link_text='Open Cave Dragon'):
    """Return a standalone HTML confirmation page for email actions."""
    link_html = ''
    if link_url:
        link_html = f'''
        <a href="{link_url}"
           style="display:inline-block;margin-top:24px;padding:12px 32px;
                  background:linear-gradient(135deg,#00b8d4,#00e5ff);
                  color:#0a0a12;text-decoration:none;border-radius:9999px;
                  font-weight:600;font-size:14px;">{link_text}</a>
        '''
    html = f'''<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} — Cave Dragon</title></head>
<body style="margin:0;padding:0;background:#0a0a12;color:#e0e0f0;font-family:system-ui,sans-serif;
             min-height:100vh;display:flex;align-items:center;justify-content:center;">
<div style="text-align:center;padding:40px 24px;max-width:420px;">
  <img src="{_frontend_url('/cave-dragon-logo.png')}" alt="Cave Dragon" width="80" height="80"
       style="margin-bottom:16px;">
  <h1 style="color:#00e5ff;font-size:20px;margin:0 0 12px;">{title}</h1>
  <p style="color:#8888aa;font-size:14px;line-height:1.5;margin:0;">{message}</p>
  {link_html}
</div>
</body></html>'''
    return HttpResponse(html, content_type='text/html')


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
        return _action_result_page(
            'Link Expired',
            'This action link has expired or is invalid. '
            'Please log in to Cave Dragon to manage this request.',
            link_url=_frontend_url('/login'),
            link_text='Go to Cave Dragon',
        )

    action = data.get('action')
    logger.info('Email action: %s, data: %s', action, data)

    if action == 'cave_access_approve':
        return _handle_cave_access(data, status='accepted')
    elif action == 'cave_access_deny':
        return _handle_cave_access(data, status='denied')
    elif action == 'event_rsvp':
        return _handle_event_rsvp(data)
    elif action == 'expedition_trigger_emergency':
        return _handle_expedition_trigger_emergency(data)
    elif action == 'unsubscribe':
        return _handle_unsubscribe(data)
    else:
        return Response({'error': 'Unknown action'}, status=400)


def _handle_cave_access(data, status):
    """Approve or deny a cave access request."""
    from requests_app.models import Request
    from caves.models import LandOwner
    from users.models import UserProfile
    from .tasks import send_cave_access_resolved_email

    request_id = data.get('request_id')
    user_id = data.get('user_id')

    try:
        cave_req = Request.objects.select_related('cave').get(id=request_id)
    except Request.DoesNotExist:
        return _action_result_page(
            'Request Not Found',
            'This access request no longer exists.',
            link_url=_frontend_url('/'),
            link_text='Go to Cave Dragon',
        )

    # Verify the token user is the cave owner
    if cave_req.cave.owner_id != user_id:
        return _action_result_page(
            'Unauthorized',
            'Only the cave owner can approve or deny access requests.',
        )

    if cave_req.status != 'pending':
        cave_url = _frontend_url(f'/caves/{cave_req.cave.id}')
        return _action_result_page(
            'Already Resolved',
            f'This request has already been {cave_req.status}.',
            link_url=cave_url,
            link_text=f'View {cave_req.cave.name}',
        )

    # Resolve the request
    try:
        resolver = UserProfile.objects.get(id=user_id)
    except UserProfile.DoesNotExist:
        return _action_result_page('Error', 'User account not found.')

    from django.utils import timezone
    cave_req.status = status
    cave_req.resolved_by = resolver
    cave_req.resolved_at = timezone.now()
    cave_req.save(update_fields=['status', 'resolved_by', 'resolved_at'])

    # If approved, grant the appropriate access
    if status == 'accepted':
        if cave_req.request_type == 'cave_access':
            from caves.models import CavePermission
            CavePermission.objects.get_or_create(
                cave=cave_req.cave, user=cave_req.requester,
                defaults={'role': 'viewer', 'granted_by': resolver},
            )
        elif cave_req.request_type == 'contact_access':
            try:
                lo = cave_req.cave.land_owner
                lo.contact_access_users.add(cave_req.requester)
            except LandOwner.DoesNotExist:
                pass  # No land owner record to grant access to

    # Notify requester asynchronously
    send_cave_access_resolved_email.delay(str(cave_req.id), status)

    cave_url = _frontend_url(f'/caves/{cave_req.cave.id}')
    action_word = 'approved' if status == 'accepted' else 'denied'
    return _action_result_page(
        f'Request {action_word.title()}',
        f'You have {action_word} {cave_req.requester.username}\'s access request '
        f'for {cave_req.cave.name}. They will be notified by email.',
        link_url=cave_url,
        link_text=f'View {cave_req.cave.name}',
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
        return _action_result_page(
            'Not Found',
            'This event or user account no longer exists.',
            link_url=_frontend_url('/events'),
            link_text='View Events',
        )

    if rsvp_status == 'going':
        # Check capacity
        if event.max_participants:
            going_count = EventRSVP.objects.filter(
                event=event, status='going',
            ).count()
            if going_count >= event.max_participants:
                event_url = _frontend_url(f'/events/{event.id}')
                return _action_result_page(
                    'Event Full',
                    f'{event.name} has reached its maximum capacity.',
                    link_url=event_url,
                    link_text='View Event',
                )

        EventRSVP.objects.update_or_create(
            event=event, user=user,
            defaults={'status': 'going'},
        )
        event_url = _frontend_url(f'/events/{event.id}')
        return _action_result_page(
            'RSVP Confirmed',
            f'You\'re going to {event.name}!',
            link_url=event_url,
            link_text='View Event',
        )

    elif rsvp_status == 'not_going':
        EventRSVP.objects.filter(event=event, user=user).delete()
        event_url = _frontend_url(f'/events/{event.id}')
        return _action_result_page(
            'RSVP Updated',
            f'You\'ve declined {event.name}.',
            link_url=event_url,
            link_text='View Event',
        )

    return HttpResponseRedirect(_frontend_url(f'/events/{event.id}'))


def _handle_expedition_trigger_emergency(data):
    """Trigger emergency email for an overdue expedition via email action link."""
    from events.models import ExpeditionTracking
    from events.expedition_state import transition
    from events.tasks import send_emergency_email

    tracking_id = data.get('tracking_id')
    try:
        tracking = ExpeditionTracking.objects.select_related('event').get(id=tracking_id)
    except ExpeditionTracking.DoesNotExist:
        return _action_result_page(
            'Not Found',
            'This expedition tracking record no longer exists.',
            link_url=_frontend_url('/events'),
            link_text='View Events',
        )

    active_states = ('active', 'underground', 'surfaced', 'overdue', 'alert_sent')
    if tracking.state not in active_states:
        return _action_result_page(
            'Expedition Inactive',
            f'This expedition is currently "{tracking.get_state_display()}" and '
            f'does not require emergency escalation.',
            link_url=_frontend_url(f'/events/{tracking.event_id}'),
            link_text='View Expedition',
        )

    # Walk through valid transitions to emergency_sent
    if tracking.state in ('active', 'underground', 'surfaced'):
        transition(tracking, 'overdue', note='Emergency triggered via email')
        tracking.refresh_from_db()
    if tracking.state == 'overdue':
        transition(tracking, 'alert_sent', note='Emergency triggered via email')
        tracking.refresh_from_db()
    if tracking.state == 'alert_sent':
        transition(tracking, 'emergency_sent', note='Emergency triggered via email by surrogate')

    send_emergency_email.delay(str(tracking.id))

    return _action_result_page(
        'Emergency Alert Sent',
        f'Emergency contacts for "{tracking.event.name}" have been notified. '
        f'If you believe a rescue is needed, also contact local emergency '
        f'services (911) and mention "cave rescue".',
        link_url=_frontend_url(f'/events/{tracking.event_id}'),
        link_text='View Expedition',
    )


def _handle_unsubscribe(data):
    """Toggle off a notification preference category."""
    from users.models import UserProfile, NotificationPreference

    user_id = data.get('user_id')
    category = data.get('category')

    try:
        user = UserProfile.objects.get(id=user_id)
    except UserProfile.DoesNotExist:
        return _action_result_page(
            'Error',
            'User account not found.',
            link_url=_frontend_url('/'),
            link_text='Go to Cave Dragon',
        )

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

    category_label = (category or '').replace('_', ' ')
    return _action_result_page(
        'Unsubscribed',
        f'You have been unsubscribed from {category_label} emails. '
        'You can manage your notification preferences in your profile settings.',
        link_url=_frontend_url('/profile'),
        link_text='Manage Preferences',
    )
