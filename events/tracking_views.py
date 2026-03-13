"""REST views for expedition safety tracking."""

import logging
from datetime import timedelta

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from users.models import GrottoMembership

from .expedition_state import extend_time, handle_gps_ping, transition
from .models import (
    Event,
    ExpeditionCheckIn,
    ExpeditionGPSPoint,
    ExpeditionSurrogate,
    ExpeditionTracking,
)
from .tracking_serializers import (
    ExpeditionCheckInSerializer,
    ExpeditionGPSPointSerializer,
    ExpeditionSurrogateSerializer,
    ExpeditionTrackingListSerializer,
    ExpeditionTrackingSerializer,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_event(event_id):
    return get_object_or_404(Event, id=event_id)


def _is_event_leader(event, user):
    return event.created_by_id == user.id or user.is_staff


def _is_surrogate(tracking, user):
    """Check if user is a designated surrogate (directly or via grotto)."""
    if tracking.surrogates.filter(user=user).exists():
        return True
    grotto_ids = tracking.surrogates.filter(
        grotto__isnull=False
    ).values_list('grotto_id', flat=True)
    if grotto_ids:
        return GrottoMembership.objects.filter(
            user=user, grotto_id__in=grotto_ids, status='active',
        ).exists()
    return False


def _can_view_tracking(tracking, user):
    """Check if user can view this expedition's tracking data."""
    event = tracking.event
    # Public events are visible to all authenticated users
    if event.visibility == 'public':
        return True
    # Event creator / staff
    if _is_event_leader(event, user):
        return True
    # Surrogates
    if _is_surrogate(tracking, user):
        return True
    # Checked-in participants
    if tracking.checkins.filter(user=user).exists():
        return True
    # Grotto members (if event belongs to a grotto)
    if event.grotto_id:
        return GrottoMembership.objects.filter(
            user=user, grotto=event.grotto, status='active',
        ).exists()
    return False


# ---------------------------------------------------------------------------
# Enable / Get / Update tracking
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def tracking_enable(request, event_id):
    """Create an ExpeditionTracking for an event.  Leader only."""
    event = _get_event(event_id)
    if not _is_event_leader(event, request.user):
        return Response({'error': 'Only the event creator can enable tracking.'},
                        status=status.HTTP_403_FORBIDDEN)
    if hasattr(event, 'tracking'):
        return Response(ExpeditionTrackingSerializer(event.tracking).data)

    tracking = ExpeditionTracking.objects.create(event=event)
    return Response(
        ExpeditionTrackingSerializer(tracking).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def tracking_detail(request, event_id):
    """Get or update tracking configuration."""
    event = _get_event(event_id)
    tracking = get_object_or_404(ExpeditionTracking, event=event)

    if request.method == 'GET':
        if not _can_view_tracking(tracking, request.user):
            return Response({'error': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)
        return Response(ExpeditionTrackingSerializer(tracking).data)

    # PATCH — leader only
    if not _is_event_leader(event, request.user):
        return Response({'error': 'Only the event creator can update tracking.'},
                        status=status.HTTP_403_FORBIDDEN)

    allowed_fields = {
        'expected_return', 'alert_delay_minutes', 'gps_stale_minutes',
        'emergency_contacts',
    }
    for key, value in request.data.items():
        if key in allowed_fields:
            setattr(tracking, key, value)
    tracking.save()
    return Response(ExpeditionTrackingSerializer(tracking).data)


# ---------------------------------------------------------------------------
# State transitions
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def tracking_start(request, event_id):
    """Start the expedition: preparing -> active."""
    event = _get_event(event_id)
    tracking = get_object_or_404(ExpeditionTracking, event=event)
    if not _is_event_leader(event, request.user):
        return Response({'error': 'Only the event creator can start the expedition.'},
                        status=status.HTTP_403_FORBIDDEN)

    # Validate required safety config before starting
    errors = []
    if not tracking.expected_return:
        errors.append('Expected return time must be set.')
    if not tracking.emergency_contacts:
        errors.append('At least one emergency contact is required.')
    if not tracking.surrogates.exists():
        errors.append('At least one safety surrogate is required.')
    if errors:
        return Response({'error': ' '.join(errors)}, status=status.HTTP_400_BAD_REQUEST)

    if not transition(tracking, 'active', user=request.user, note='Expedition started'):
        return Response(
            {'error': f'Cannot start from state "{tracking.state}".'},
            status=status.HTTP_409_CONFLICT,
        )
    return Response(ExpeditionTrackingSerializer(tracking).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def tracking_complete(request, event_id):
    """Complete the expedition from any active state."""
    event = _get_event(event_id)
    tracking = get_object_or_404(ExpeditionTracking, event=event)
    if not _is_event_leader(event, request.user):
        return Response({'error': 'Only the event creator can complete the expedition.'},
                        status=status.HTTP_403_FORBIDDEN)

    if not transition(tracking, 'completed', user=request.user, note='Expedition completed'):
        return Response(
            {'error': f'Cannot complete from state "{tracking.state}".'},
            status=status.HTTP_409_CONFLICT,
        )
    return Response(ExpeditionTrackingSerializer(tracking).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def tracking_extend(request, event_id):
    """Extend the expected return time."""
    event = _get_event(event_id)
    tracking = get_object_or_404(ExpeditionTracking, event=event)
    if not _is_event_leader(event, request.user):
        return Response({'error': 'Only the event creator can extend time.'},
                        status=status.HTTP_403_FORBIDDEN)

    # Accept either {minutes: N} or {expected_return: ISO datetime}
    minutes = request.data.get('minutes')
    new_return = request.data.get('expected_return')

    if minutes:
        new_return = (tracking.expected_return or timezone.now()) + timedelta(minutes=int(minutes))
    elif new_return:
        from django.utils.dateparse import parse_datetime
        parsed = parse_datetime(str(new_return))
        if not parsed:
            return Response({'error': 'Invalid datetime format.'}, status=status.HTTP_400_BAD_REQUEST)
        new_return = parsed
    else:
        return Response(
            {'error': 'Provide "minutes" or "expected_return".'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    extend_time(tracking, new_return, user=request.user)
    return Response(ExpeditionTrackingSerializer(tracking).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def tracking_resolve(request, event_id):
    """Surrogate resolves an emergency."""
    event = _get_event(event_id)
    tracking = get_object_or_404(ExpeditionTracking, event=event)

    if not (_is_event_leader(event, request.user) or _is_surrogate(tracking, request.user)):
        return Response({'error': 'Only surrogates or the leader can resolve.'},
                        status=status.HTTP_403_FORBIDDEN)

    if not transition(tracking, 'resolved', user=request.user,
                      note=request.data.get('note', 'Resolved by surrogate')):
        return Response(
            {'error': f'Cannot resolve from state "{tracking.state}".'},
            status=status.HTTP_409_CONFLICT,
        )
    return Response(ExpeditionTrackingSerializer(tracking).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def tracking_trigger_emergency(request, event_id):
    """Surrogate triggers early emergency email."""
    event = _get_event(event_id)
    tracking = get_object_or_404(ExpeditionTracking, event=event)

    if not (_is_event_leader(event, request.user) or _is_surrogate(tracking, request.user)):
        return Response({'error': 'Only surrogates or the leader can trigger emergency.'},
                        status=status.HTTP_403_FORBIDDEN)

    # Force transition to emergency_sent regardless of current state
    # (as long as expedition is in an active state)
    active_states = ('active', 'underground', 'surfaced', 'overdue', 'alert_sent')
    if tracking.state not in active_states:
        return Response(
            {'error': f'Cannot trigger emergency from state "{tracking.state}".'},
            status=status.HTTP_409_CONFLICT,
        )

    # Walk to emergency_sent through valid transitions
    if tracking.state in ('active', 'underground', 'surfaced'):
        transition(tracking, 'overdue', user=request.user, note='Early escalation')
        tracking.refresh_from_db()
    if tracking.state == 'overdue':
        transition(tracking, 'alert_sent', user=request.user, note='Early escalation')
        tracking.refresh_from_db()
    if tracking.state == 'alert_sent':
        transition(tracking, 'emergency_sent', user=request.user,
                   note=f'Emergency triggered by {request.user.username}')

    # Dispatch emergency email task
    try:
        from .tasks import send_emergency_email
        send_emergency_email.delay(str(tracking.id))
    except Exception:
        logger.exception('Failed to dispatch emergency email task')

    return Response(ExpeditionTrackingSerializer(tracking).data)


# ---------------------------------------------------------------------------
# Check-in / Check-out
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def tracking_checkin(request, event_id):
    """Check in a user.  Self-service or by leader."""
    event = _get_event(event_id)
    tracking = get_object_or_404(ExpeditionTracking, event=event)

    target_user_id = request.data.get('user_id', request.user.id)
    is_leader = _is_event_leader(event, request.user)

    # Only the leader can check in other users
    if int(target_user_id) != request.user.id and not is_leader:
        return Response({'error': 'Only the leader can check in other users.'},
                        status=status.HTTP_403_FORBIDDEN)

    from django.contrib.auth import get_user_model
    User = get_user_model()
    target_user = get_object_or_404(User, id=target_user_id)

    checkin, created = ExpeditionCheckIn.objects.get_or_create(
        tracking=tracking,
        user=target_user,
        defaults={'checked_in_by': request.user},
    )
    if not created:
        return Response({'detail': 'User already checked in.'},
                        status=status.HTTP_200_OK)

    return Response(
        ExpeditionCheckInSerializer(checkin).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def tracking_checkout(request, event_id):
    """Check out a user."""
    event = _get_event(event_id)
    tracking = get_object_or_404(ExpeditionTracking, event=event)

    target_user_id = request.data.get('user_id', request.user.id)
    is_leader = _is_event_leader(event, request.user)

    if int(target_user_id) != request.user.id and not is_leader:
        return Response({'error': 'Only the leader can check out other users.'},
                        status=status.HTTP_403_FORBIDDEN)

    checkin = tracking.checkins.filter(user_id=target_user_id).first()
    if not checkin:
        return Response({'error': 'User is not checked in.'},
                        status=status.HTTP_404_NOT_FOUND)

    checkin.checked_out_at = timezone.now()
    checkin.save(update_fields=['checked_out_at'])
    return Response(ExpeditionCheckInSerializer(checkin).data)


# ---------------------------------------------------------------------------
# GPS
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def tracking_gps_submit(request, event_id):
    """Submit a GPS position.  Must be a checked-in participant."""
    event = _get_event(event_id)
    tracking = get_object_or_404(ExpeditionTracking, event=event)

    # Must be checked in
    if not tracking.checkins.filter(user=request.user, checked_out_at__isnull=True).exists():
        return Response({'error': 'You must be checked in to submit GPS.'},
                        status=status.HTTP_403_FORBIDDEN)

    # Rate limit: skip if last GPS from this user was < 2 minutes ago
    two_min_ago = timezone.now() - timedelta(minutes=2)
    recent = tracking.gps_points.filter(
        user=request.user, recorded_at__gte=two_min_ago,
    ).exists()
    if recent:
        return Response({'ok': True, 'state': tracking.state, 'throttled': True})

    lat = request.data.get('latitude')
    lon = request.data.get('longitude')
    if lat is None or lon is None:
        return Response({'error': 'latitude and longitude required.'},
                        status=status.HTTP_400_BAD_REQUEST)

    ExpeditionGPSPoint.objects.create(
        tracking=tracking,
        user=request.user,
        latitude=float(lat),
        longitude=float(lon),
        accuracy=request.data.get('accuracy'),
        altitude=request.data.get('altitude'),
    )

    # Handle state transitions on GPS ping
    handle_gps_ping(tracking)

    return Response({'ok': True, 'state': tracking.state})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def tracking_gps_trail(request, event_id):
    """Get GPS breadcrumb trail for all participants."""
    event = _get_event(event_id)
    tracking = get_object_or_404(ExpeditionTracking, event=event)

    if not _can_view_tracking(tracking, request.user):
        return Response({'error': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

    # Optional: filter by user
    user_id = request.query_params.get('user_id')
    qs = tracking.gps_points.select_related('user')
    if user_id:
        qs = qs.filter(user_id=user_id)

    # Limit to last 500 points to prevent huge responses
    points = qs.order_by('-recorded_at')[:500]
    return Response(ExpeditionGPSPointSerializer(reversed(list(points)), many=True).data)


# ---------------------------------------------------------------------------
# Surrogates
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def tracking_surrogate_add(request, event_id):
    """Add a surrogate user or grotto."""
    event = _get_event(event_id)
    tracking = get_object_or_404(ExpeditionTracking, event=event)

    if not _is_event_leader(event, request.user):
        return Response({'error': 'Only the event creator can add surrogates.'},
                        status=status.HTTP_403_FORBIDDEN)

    user_id = request.data.get('user_id')
    grotto_id = request.data.get('grotto_id')

    if not user_id and not grotto_id:
        return Response({'error': 'Provide user_id or grotto_id.'},
                        status=status.HTTP_400_BAD_REQUEST)

    if user_id and grotto_id:
        return Response({'error': 'Provide user_id OR grotto_id, not both.'},
                        status=status.HTTP_400_BAD_REQUEST)

    surrogate = ExpeditionSurrogate.objects.create(
        tracking=tracking,
        user_id=user_id,
        grotto_id=grotto_id,
    )

    # Notify the surrogate(s) that they've been designated
    try:
        from .tasks import notify_surrogate_added
        if user_id:
            notify_surrogate_added.delay(str(tracking.id), int(user_id))
        elif grotto_id:
            # Notify all active grotto members
            from users.models import GrottoMembership
            member_ids = GrottoMembership.objects.filter(
                grotto_id=grotto_id, status='active',
            ).values_list('user_id', flat=True)
            for mid in member_ids:
                notify_surrogate_added.delay(str(tracking.id), mid)
    except Exception:
        logger.exception('Failed to dispatch surrogate notification')

    return Response(
        ExpeditionSurrogateSerializer(surrogate).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def tracking_surrogate_remove(request, event_id, surrogate_id):
    """Remove a surrogate."""
    event = _get_event(event_id)
    tracking = get_object_or_404(ExpeditionTracking, event=event)

    if not _is_event_leader(event, request.user):
        return Response({'error': 'Only the event creator can remove surrogates.'},
                        status=status.HTTP_403_FORBIDDEN)

    surrogate = get_object_or_404(ExpeditionSurrogate, id=surrogate_id, tracking=tracking)
    surrogate.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Live Expeditions
# ---------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def live_expeditions(request):
    """List all currently active expeditions (visibility-filtered)."""
    active_states = [
        'active', 'underground', 'surfaced',
        'overdue', 'alert_sent', 'emergency_sent',
    ]
    trackings = (
        ExpeditionTracking.objects
        .filter(state__in=active_states)
        .select_related('event', 'event__cave', 'event__created_by', 'event__grotto')
    )

    # Visibility filtering
    visible = []
    for t in trackings:
        if _can_view_tracking(t, request.user):
            visible.append(t)

    return Response(ExpeditionTrackingListSerializer(visible, many=True).data)
