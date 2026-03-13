"""
Celery tasks for sending notification emails asynchronously.

All email sending goes through these tasks so the web process never blocks
on SMTP connections. Tasks check user preferences before sending.
"""

import logging

from celery import shared_task
from django.conf import settings

logger = logging.getLogger(__name__)


def _get_user(user_id):
    from users.models import UserProfile
    try:
        return UserProfile.objects.get(id=user_id)
    except UserProfile.DoesNotExist:
        logger.warning('User %s not found, skipping email', user_id)
        return None


# ── Verification Email ──────────────────────────────────────


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_verification_email(self, user_id):
    """Send email verification link."""
    from django.core import signing
    from .sender import send_notification_email

    user = _get_user(user_id)
    if not user:
        return

    token = signing.dumps(
        {'user_id': user.id, 'email': user.email}, salt='email-verify',
    )
    frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5174')
    verify_url = f'{frontend_url}/verify-email?token={token}'

    try:
        send_notification_email(
            user=user,
            subject='Verify your email — Cave Dragon',
            template_name='emails/verify_email.html',
            context={'verify_url': verify_url},
            preference_key=None,  # Always send — critical email
        )
    except Exception as exc:
        raise self.retry(exc=exc)


# ── Cave Access ─────────────────────────────────────────────


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_cave_access_request_email(self, request_id):
    """Notify cave owner of a new access request."""
    from requests_app.models import Request
    from .sender import send_notification_email
    from .tokens import make_action_url

    try:
        cave_req = Request.objects.select_related(
            'cave', 'requester', 'cave__owner',
        ).get(id=request_id)
    except Request.DoesNotExist:
        logger.warning('Request %s not found', request_id)
        return

    owner = cave_req.cave.owner
    if not owner:
        return

    frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5174')
    try:
        send_notification_email(
            user=owner,
            subject=f'{cave_req.requester.username} requested access to {cave_req.cave.name}',
            template_name='emails/cave_access_request.html',
            context={
                'owner_username': owner.username,
                'requester_username': cave_req.requester.username,
                'cave_name': cave_req.cave.name,
                'message': cave_req.message,
                'approve_url': make_action_url(
                    'cave_access_approve',
                    request_id=str(cave_req.id),
                    user_id=owner.id,
                ),
                'deny_url': make_action_url(
                    'cave_access_deny',
                    request_id=str(cave_req.id),
                    user_id=owner.id,
                ),
                'cave_url': f'{frontend_url}/caves/{cave_req.cave.id}',
            },
            preference_key='cave_access_request',
        )
    except Exception as exc:
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_cave_access_resolved_email(self, request_id, status):
    """Notify requester that their cave access request was resolved."""
    from requests_app.models import Request
    from .sender import send_notification_email

    try:
        cave_req = Request.objects.select_related(
            'cave', 'requester',
        ).get(id=request_id)
    except Request.DoesNotExist:
        return

    frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5174')
    send_notification_email(
        user=cave_req.requester,
        subject=f'Cave access {status} — {cave_req.cave.name}',
        template_name='emails/cave_access_resolved.html',
        context={
            'requester_username': cave_req.requester.username,
            'cave_name': cave_req.cave.name,
            'status': status,
            'cave_url': f'{frontend_url}/caves/{cave_req.cave.id}',
        },
        preference_key='cave_access_granted',
    )


# ── Events ──────────────────────────────────────────────────


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_event_invitation_email(self, invitation_id):
    """Notify user of an event invitation with JSON-LD + action buttons."""
    from events.models import EventInvitation
    from .sender import send_notification_email
    from .tokens import make_action_url

    try:
        inv = EventInvitation.objects.select_related(
            'event', 'invited_user', 'invited_by',
        ).get(id=invitation_id)
    except EventInvitation.DoesNotExist:
        return

    if not inv.invited_user:
        return  # Grotto invitation — no individual email

    event = inv.event
    frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5174')

    # Format date for display
    if event.all_day:
        event_date = event.start_date.strftime('%B %d, %Y')
    else:
        event_date = event.start_date.strftime('%B %d, %Y at %I:%M %p')

    # Build location string
    event_location = event.address or ''
    if event.cave:
        event_location = event.cave.name + (f' — {event_location}' if event_location else '')

    try:
        send_notification_email(
            user=inv.invited_user,
            subject=f'You\'re invited: {event.name}',
            template_name='emails/event_invitation.html',
            context={
                'invitee_username': inv.invited_user.username,
                'inviter_username': inv.invited_by.username if inv.invited_by else 'Someone',
                'event_name': event.name,
                'event_date': event_date,
                'event_location': event_location,
                'event_description': (event.description or '')[:300],
                'event_url': f'{frontend_url}/events/{event.id}',
                'event_start_iso': event.start_date.isoformat(),
                'event_end_iso': event.end_date.isoformat() if event.end_date else '',
                'rsvp_going_url': make_action_url(
                    'event_rsvp',
                    event_id=str(event.id),
                    user_id=inv.invited_user.id,
                    status='going',
                ),
                'rsvp_not_going_url': make_action_url(
                    'event_rsvp',
                    event_id=str(event.id),
                    user_id=inv.invited_user.id,
                    status='not_going',
                ),
            },
            preference_key='event_invitation',
        )
    except Exception as exc:
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_event_update_email(self, event_id, update_type, changes='',
                            event_name=None, attendee_user_ids=None):
    """Notify RSVPed users of event update/cancellation.

    For cancellations, event_name and attendee_user_ids should be passed
    directly since the event may be deleted before this task runs.
    """
    from events.models import Event, EventRSVP
    from users.models import UserProfile
    from .sender import send_notification_email

    frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5174')

    # If pre-captured data was provided (cancellation), use it directly
    if event_name and attendee_user_ids is not None:
        users = UserProfile.objects.filter(id__in=attendee_user_ids)
        for user in users:
            send_notification_email(
                user=user,
                subject=f'Event {update_type}: {event_name}',
                template_name='emails/event_update.html',
                context={
                    'event_name': event_name,
                    'update_type': update_type,
                    'changes': changes,
                    'event_url': f'{frontend_url}/events/{event_id}',
                },
                preference_key='event_update',
            )
        return

    # For updates, fetch from DB (event still exists)
    try:
        event = Event.objects.get(id=event_id)
    except Event.DoesNotExist:
        return

    rsvps = EventRSVP.objects.filter(
        event=event, status='going',
    ).select_related('user')

    for rsvp in rsvps:
        send_notification_email(
            user=rsvp.user,
            subject=f'Event {update_type}: {event.name}',
            template_name='emails/event_update.html',
            context={
                'event_name': event.name,
                'update_type': update_type,
                'changes': changes,
                'event_url': f'{frontend_url}/events/{event.id}',
            },
            preference_key='event_update',
        )


# ── Social ──────────────────────────────────────────────────


@shared_task
def send_new_follower_email(follower_user_id, followed_user_id):
    """Notify a user that someone followed them."""
    from .sender import send_notification_email

    follower = _get_user(follower_user_id)
    followed = _get_user(followed_user_id)
    if not follower or not followed:
        return

    frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5174')
    send_notification_email(
        user=followed,
        subject=f'{follower.username} started following you',
        template_name='emails/new_follower.html',
        context={
            'follower_username': follower.username,
            'follower_bio': (follower.bio or '')[:200],
            'profile_url': f'{frontend_url}/users/{follower.id}',
        },
        preference_key='new_follower',
    )


@shared_task
def send_comment_notification_email(
    recipient_user_id, commenter_username, comment_text,
    content_type, content_url, action_text='commented on your post',
):
    """Notify user of a comment or reply."""
    from .sender import send_notification_email

    user = _get_user(recipient_user_id)
    if not user:
        return

    # Determine preference key
    pref_key = 'comment_reply' if 'replied' in action_text else 'comment_on_post'

    send_notification_email(
        user=user,
        subject=f'{commenter_username} {action_text}',
        template_name='emails/comment_notification.html',
        context={
            'commenter_username': commenter_username,
            'comment_text': comment_text[:500],
            'comment_type': 'reply' if 'replied' in action_text else 'comment',
            'action_text': action_text,
            'content_type': content_type,
            'content_url': content_url,
        },
        preference_key=pref_key,
    )


@shared_task
def send_mention_notification_email(
    recipient_user_id, mentioner_username, message_text, context_label, content_url,
):
    """Notify user of an @mention."""
    from .sender import send_notification_email

    user = _get_user(recipient_user_id)
    if not user:
        return

    send_notification_email(
        user=user,
        subject=f'{mentioner_username} mentioned you',
        template_name='emails/mention_notification.html',
        context={
            'mentioner_username': mentioner_username,
            'message_text': message_text[:500],
            'context': context_label,
            'content_url': content_url,
        },
        preference_key='mention',
    )


# ── Chat Digest ─────────────────────────────────────────────


@shared_task
def send_chat_digest():
    """Send unread chat digests to users who have it enabled.

    Called by Celery Beat on a schedule (daily/weekly).
    Only sends to users whose chat_digest preference matches the current run.
    """
    from django.db.models import Count, F, Max, Q
    from users.models import UserProfile, NotificationPreference
    from chat.models import ChannelMembership, Message
    from .sender import send_notification_email

    frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5174')

    # Find users with chat digest enabled (daily — called by daily cron)
    prefs = NotificationPreference.objects.filter(
        chat_digest='daily',
    ).select_related('user')

    for pref in prefs:
        user = pref.user
        if not user.email or not user.is_active:
            continue

        # Find channels with unread messages
        memberships = ChannelMembership.objects.filter(
            user=user,
        ).select_related('channel')

        channels_with_unread = []
        for membership in memberships:
            # Only count messages after the user's read cursor
            if not membership.last_read_message_id:
                # User has never opened this channel — don't count as unread
                continue

            last_read_msg = Message.objects.filter(
                id=membership.last_read_message_id,
            ).values_list('created_at', flat=True).first()
            if not last_read_msg:
                continue

            # Count messages after read cursor, excluding user's own messages
            unread_count = Message.objects.filter(
                channel=membership.channel,
                created_at__gt=last_read_msg,
                is_deleted=False,
            ).exclude(author=user).count()
            if unread_count > 0:
                # Get last message preview
                last_msg = Message.objects.filter(
                    channel=membership.channel, is_deleted=False,
                ).order_by('-created_at').first()

                channel_name = membership.channel.name or 'Direct Message'
                channels_with_unread.append({
                    'name': channel_name,
                    'unread_count': unread_count,
                    'preview': (last_msg.content[:100] if last_msg else ''),
                    'last_author': (last_msg.author.username if last_msg and last_msg.author else ''),
                })

        if not channels_with_unread:
            continue

        send_notification_email(
            user=user,
            subject=f'You have unread messages — Cave Dragon',
            template_name='emails/chat_digest.html',
            context={
                'channels': channels_with_unread,
                'chat_url': f'{frontend_url}/chat',
            },
            preference_key='chat_digest',
        )


# ── Weekly Activity Summary ─────────────────────────────────


@shared_task
def send_weekly_activity_summary():
    """Send a weekly activity summary to all active users.

    Includes: new caves, events, followers gained, posts in feed.
    Called by Celery Beat every Monday at 9 AM.
    """
    from datetime import timedelta

    from django.db.models import Count, Q
    from django.utils import timezone

    from caves.models import Cave
    from events.models import Event
    from social.models import Activity, UserFollow
    from users.models import UserProfile
    from .sender import send_notification_email

    frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5174')
    one_week_ago = timezone.now() - timedelta(days=7)

    # Global stats for the week
    new_caves_count = Cave.objects.filter(created_at__gte=one_week_ago).count()
    upcoming_events = Event.objects.filter(
        start_date__gte=timezone.now(),
        status='published',
    ).order_by('start_date')[:5]

    users = UserProfile.objects.filter(is_active=True).exclude(email='')
    for user in users:
        # Per-user stats
        new_followers = UserFollow.objects.filter(
            following=user, created_at__gte=one_week_ago,
        ).count()
        user_activities = Activity.objects.filter(
            actor=user, created_at__gte=one_week_ago,
        ).count()

        # Skip if nothing happened this week for this user and no global news
        if not new_followers and not user_activities and not new_caves_count and not upcoming_events:
            continue

        event_list = []
        for ev in upcoming_events:
            event_list.append({
                'name': ev.name,
                'date': ev.start_date.strftime('%b %d'),
                'url': f'{frontend_url}/events/{ev.id}',
            })

        send_notification_email(
            user=user,
            subject='Your weekly Cave Dragon summary',
            template_name='emails/weekly_summary.html',
            context={
                'new_caves_count': new_caves_count,
                'new_followers': new_followers,
                'user_activities': user_activities,
                'upcoming_events': event_list,
                'explore_url': f'{frontend_url}/explore',
                'events_url': f'{frontend_url}/events',
            },
            preference_key=None,  # Always send (users can unsubscribe via link)
        )
