"""Celery tasks for expedition safety tracking."""

import logging
from datetime import timedelta

from celery import shared_task
from django.core.mail import send_mail
from django.conf import settings
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.html import strip_tags

from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Periodic timer check (runs every 60 seconds via Celery Beat)
# ---------------------------------------------------------------------------

@shared_task
def check_expedition_timers():
    """Scan all active expeditions and handle state transitions.

    State logic:
    - active + GPS stale → underground
    - underground + past expected_return → overdue
    - overdue → alert_sent (immediate surrogate notification)
    - alert_sent + past alert_delay → emergency_sent
    - surfaced + GPS stale again → underground
    """
    from .models import ExpeditionTracking
    from .expedition_state import transition

    now = timezone.now()
    active_states = ['active', 'underground', 'surfaced', 'overdue', 'alert_sent']
    trackings = ExpeditionTracking.objects.filter(
        state__in=active_states,
    ).select_related('event')

    for tracking in trackings:
        try:
            _check_single_expedition(tracking, now)
        except Exception:
            logger.exception('Error checking expedition %s', tracking.id)


def _check_single_expedition(tracking, now):
    """Check a single expedition for timer-based state transitions."""
    from .expedition_state import transition

    state = tracking.state
    stale_threshold = now - timedelta(minutes=tracking.gps_stale_minutes)

    # GPS staleness → underground
    if state in ('active', 'surfaced'):
        gps_is_stale = (
            tracking.last_gps_at is None
            or tracking.last_gps_at < stale_threshold
        )
        if gps_is_stale:
            transition(tracking, 'underground', note='GPS signal lost (stale)')
            _notify_state_change(tracking, state, 'underground')
            state = 'underground'

    # Underground + past expected return → overdue
    if state == 'underground' and tracking.expected_return:
        if now > tracking.expected_return:
            transition(tracking, 'overdue', note='Past expected return time')
            _notify_state_change(tracking, 'underground', 'overdue')
            state = 'overdue'

    # Overdue → alert_sent (immediate surrogate notification)
    if state == 'overdue':
        transition(tracking, 'alert_sent', note='Surrogate alert triggered')
        send_surrogate_alert.delay(str(tracking.id))
        _notify_state_change(tracking, 'overdue', 'alert_sent')
        state = 'alert_sent'

    # Alert_sent + past delay → emergency_sent
    if state == 'alert_sent' and tracking.state_changed_at:
        emergency_deadline = tracking.state_changed_at + timedelta(
            minutes=tracking.alert_delay_minutes,
        )
        if now > emergency_deadline:
            transition(tracking, 'emergency_sent', note='Emergency email triggered by timer')
            send_emergency_email.delay(str(tracking.id))
            _notify_state_change(tracking, 'alert_sent', 'emergency_sent')


# ---------------------------------------------------------------------------
# Notification helpers
# ---------------------------------------------------------------------------

def _get_surrogate_user_ids(tracking):
    """Get all user IDs who are surrogates (direct or via grotto)."""
    from users.models import GrottoMembership

    user_ids = set(
        tracking.surrogates
        .filter(user__isnull=False)
        .values_list('user_id', flat=True)
    )
    grotto_ids = list(
        tracking.surrogates
        .filter(grotto__isnull=False)
        .values_list('grotto_id', flat=True)
    )
    if grotto_ids:
        grotto_user_ids = GrottoMembership.objects.filter(
            grotto_id__in=grotto_ids, status='active',
        ).values_list('user_id', flat=True)
        user_ids.update(grotto_user_ids)

    return list(user_ids)


def _notify_state_change(tracking, from_state, to_state):
    """Send WebSocket notification to surrogates + leader + chat channel message."""
    channel_layer = get_channel_layer()
    if not channel_layer:
        return

    surrogate_user_ids = _get_surrogate_user_ids(tracking)

    # Also notify the expedition leader
    leader_id = tracking.event.created_by_id
    all_notify_ids = set(surrogate_user_ids)
    all_notify_ids.add(leader_id)

    for user_id in all_notify_ids:
        data = {
            'type': 'expedition_state_change',
            'tracking_id': str(tracking.id),
            'event_id': str(tracking.event_id),
            'event_name': tracking.event.name,
            'state': to_state,
            'previous_state': from_state,
            'role': 'leader' if user_id == leader_id else 'surrogate',
        }
        try:
            async_to_sync(channel_layer.group_send)(
                f'user_{user_id}',
                {'type': 'chat_notification', 'data': data},
            )
        except Exception:
            logger.exception('Failed to send WS notification to user %s', user_id)

    # Post system message to event chat channel
    _post_system_chat_message(
        tracking,
        f'[System] Expedition status: {from_state} → {to_state}',
    )


def _post_system_chat_message(tracking, content):
    """Post a system message to the event's chat channel."""
    if not tracking.event.chat_channel_id:
        return
    try:
        from chat.models import Message
        Message.objects.create(
            channel_id=tracking.event.chat_channel_id,
            author=tracking.event.created_by,
            content=content,
        )
    except Exception:
        logger.exception('Failed to post system chat message')


# ---------------------------------------------------------------------------
# Alert tasks
# ---------------------------------------------------------------------------

@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_surrogate_alert(self, tracking_id):
    """Send surrogate alerts: email + WS notification."""
    try:
        from .models import ExpeditionTracking
        tracking = (
            ExpeditionTracking.objects
            .select_related('event', 'event__cave', 'event__created_by')
            .get(id=tracking_id)
        )
    except Exception:
        logger.warning('ExpeditionTracking %s not found', tracking_id)
        return

    from notifications.sender import send_notification_email
    from notifications.tokens import make_action_url

    surrogate_user_ids = _get_surrogate_user_ids(tracking)
    if not surrogate_user_ids:
        logger.warning('No surrogates for expedition %s', tracking_id)
        return

    from django.contrib.auth import get_user_model
    User = get_user_model()
    users = User.objects.filter(id__in=surrogate_user_ids)

    # Build participant list
    checkins = tracking.checkins.select_related('user').filter(checked_out_at__isnull=True)
    participants = [c.user.username for c in checkins]

    # Last known GPS positions
    last_gps = _get_last_gps_per_user(tracking)

    frontend_url = getattr(settings, 'FRONTEND_URL', 'https://cavedragon.llc')
    context = {
        'event_name': tracking.event.name,
        'cave_name': tracking.event.cave.name if tracking.event.cave else 'Unknown',
        'expected_return': tracking.expected_return,
        'started_at': tracking.started_at,
        'participants': participants,
        'last_gps': last_gps,
        'event_url': f'{frontend_url}/events/{tracking.event_id}',
        'trigger_emergency_url': make_action_url(
            'expedition_trigger_emergency',
            tracking_id=str(tracking.id),
        ),
    }

    for user in users:
        try:
            send_notification_email(
                user=user,
                subject=f'⚠ Expedition Alert: {tracking.event.name}',
                template_name='emails/expedition_alert.html',
                context=context,
                preference_key='expedition_alert',
            )
        except Exception:
            logger.exception('Failed to send surrogate alert email to %s', user.username)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_emergency_email(self, tracking_id):
    """Send emergency email to non-app emergency contacts."""
    try:
        from .models import ExpeditionTracking
        tracking = (
            ExpeditionTracking.objects
            .select_related('event', 'event__cave', 'event__created_by')
            .get(id=tracking_id)
        )
    except Exception:
        logger.warning('ExpeditionTracking %s not found', tracking_id)
        return

    contacts = tracking.emergency_contacts or []
    if not contacts:
        logger.warning('No emergency contacts for expedition %s', tracking_id)
        return

    checkins = tracking.checkins.select_related('user').filter(checked_out_at__isnull=True)
    participants = [c.user.username for c in checkins]
    last_gps = _get_last_gps_per_user(tracking)

    cave = tracking.event.cave
    frontend_url = getattr(settings, 'FRONTEND_URL', 'https://cavedragon.llc')

    context = {
        'event_name': tracking.event.name,
        'cave_name': cave.name if cave else 'Unknown',
        'cave_latitude': cave.latitude if cave else None,
        'cave_longitude': cave.longitude if cave else None,
        'expected_return': tracking.expected_return,
        'started_at': tracking.started_at,
        'participants': participants,
        'last_gps': last_gps,
        'leader_name': tracking.event.created_by.username,
        'event_url': f'{frontend_url}/events/{tracking.event_id}',
        'frontend_url': frontend_url,
        'unsubscribe_url': '',
    }

    html_body = render_to_string('emails/expedition_emergency.html', context)
    text_body = strip_tags(html_body)

    for contact in contacts:
        email = contact.get('email')
        if not email:
            continue
        try:
            send_mail(
                subject=f'🚨 EMERGENCY: Overdue Caving Expedition — {tracking.event.name}',
                message=text_body,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email],
                html_message=html_body,
                fail_silently=False,
            )
            logger.info('Emergency email sent to %s for expedition %s', email, tracking_id)
        except Exception as exc:
            logger.exception('Failed to send emergency email to %s', email)
            raise self.retry(exc=exc)


@shared_task
def notify_expedition_started(tracking_id):
    """Notify surrogates (email + WS) and emergency contacts (email) that expedition started."""
    try:
        from .models import ExpeditionTracking
        tracking = (
            ExpeditionTracking.objects
            .select_related('event', 'event__cave', 'event__created_by')
            .get(id=tracking_id)
        )
    except Exception:
        logger.warning('ExpeditionTracking %s not found', tracking_id)
        return

    from notifications.sender import send_notification_email

    checkins = tracking.checkins.select_related('user').filter(checked_out_at__isnull=True)
    participants = [c.user.username for c in checkins]
    cave = tracking.event.cave
    frontend_url = getattr(settings, 'FRONTEND_URL', 'https://cavedragon.llc')

    context = {
        'event_name': tracking.event.name,
        'cave_name': cave.name if cave else 'Unknown',
        'cave_latitude': cave.latitude if cave else None,
        'cave_longitude': cave.longitude if cave else None,
        'expected_return': tracking.expected_return,
        'leader_name': tracking.event.created_by.username,
        'participants': participants,
        'event_url': f'{frontend_url}/events/{tracking.event_id}',
    }

    # Email surrogates
    from django.contrib.auth import get_user_model
    User = get_user_model()
    surrogate_user_ids = _get_surrogate_user_ids(tracking)
    for user in User.objects.filter(id__in=surrogate_user_ids):
        try:
            send_notification_email(
                user=user,
                subject=f'Expedition Started: {tracking.event.name}',
                template_name='emails/expedition_started.html',
                context=context,
                preference_key='expedition_alert',
            )
        except Exception:
            logger.exception('Failed to send start email to surrogate %s', user.username)

    # Email emergency contacts directly (non-app users)
    ec_context = {**context, 'frontend_url': frontend_url, 'unsubscribe_url': '', 'username': 'Emergency Contact'}
    html_body = render_to_string('emails/expedition_started.html', ec_context)
    text_body = strip_tags(html_body)

    for contact in (tracking.emergency_contacts or []):
        email = contact.get('email')
        if not email:
            continue
        try:
            send_mail(
                subject=f'Expedition Started: {tracking.event.name}',
                message=text_body,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email],
                html_message=html_body,
                fail_silently=False,
            )
            logger.info('Start email sent to emergency contact %s for expedition %s', email, tracking_id)
        except Exception:
            logger.exception('Failed to send start email to emergency contact %s', email)

    # WS notification to surrogates + leader
    _notify_state_change(tracking, 'preparing', 'active')


@shared_task
def notify_surrogate_added(tracking_id, surrogate_user_id):
    """Notify a user that they've been designated as a safety surrogate."""
    try:
        from .models import ExpeditionTracking
        tracking = (
            ExpeditionTracking.objects
            .select_related('event', 'event__cave', 'event__created_by')
            .get(id=tracking_id)
        )
    except Exception:
        logger.warning('ExpeditionTracking %s not found', tracking_id)
        return

    from django.contrib.auth import get_user_model
    User = get_user_model()
    try:
        surrogate_user = User.objects.get(id=surrogate_user_id)
    except User.DoesNotExist:
        return

    from notifications.sender import send_notification_email

    frontend_url = getattr(settings, 'FRONTEND_URL', 'https://cavedragon.llc')
    context = {
        'event_name': tracking.event.name,
        'cave_name': tracking.event.cave.name if tracking.event.cave else 'Unknown',
        'expected_return': tracking.expected_return,
        'leader_name': tracking.event.created_by.username,
        'event_url': f'{frontend_url}/events/{tracking.event_id}',
    }

    send_notification_email(
        user=surrogate_user,
        subject=f'Safety Surrogate: {tracking.event.name}',
        template_name='emails/expedition_surrogate_added.html',
        context=context,
        preference_key='expedition_alert',
    )

    # Also send a WS notification so they see it immediately
    channel_layer = get_channel_layer()
    if channel_layer:
        try:
            async_to_sync(channel_layer.group_send)(
                f'user_{surrogate_user_id}',
                {
                    'type': 'chat_notification',
                    'data': {
                        'type': 'expedition_surrogate_added',
                        'tracking_id': str(tracking.id),
                        'event_id': str(tracking.event_id),
                        'event_name': tracking.event.name,
                        'leader_name': tracking.event.created_by.username,
                    },
                },
            )
        except Exception:
            logger.exception('Failed to send WS surrogate added notification to user %s', surrogate_user_id)


def _get_last_gps_per_user(tracking):
    """Get the most recent GPS point for each checked-in user."""
    from django.db.models import Max
    latest_ids = (
        tracking.gps_points
        .values('user')
        .annotate(latest_id=Max('id'))
        .values_list('latest_id', flat=True)
    )
    points = tracking.gps_points.filter(id__in=latest_ids).select_related('user')
    return [
        {
            'username': p.user.username,
            'latitude': p.latitude,
            'longitude': p.longitude,
            'recorded_at': p.recorded_at.isoformat(),
        }
        for p in points
    ]
