"""Event views — CRUD, RSVP, invitations, comments, calendar."""

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status as http_status

from users.models import GrottoMembership
from .models import Event, EventRSVP, EventInvitation, EventComment
from .serializers import (
    EventSerializer, EventCalendarSerializer,
    EventRSVPSerializer, EventInvitationSerializer, EventCommentSerializer,
)


# ── Helpers ──────────────────────────────────────────────────


def _get_visible_events(user):
    """Return events visible to the given user."""
    base = Event.objects.filter(status__in=['published', 'completed'])

    if not user or not user.is_authenticated:
        return base.filter(visibility='public')

    if user.is_staff:
        return base

    user_grottos = list(
        GrottoMembership.objects.filter(user=user, status='active')
        .values_list('grotto_id', flat=True)
    )
    has_any_grotto = len(user_grottos) > 0

    q = Q(visibility='public')
    q |= Q(created_by=user)  # creator always sees own events

    if has_any_grotto:
        q |= Q(visibility='all_grotto')
        q |= Q(visibility='grotto_only', grotto_id__in=user_grottos)

    # Invited (user or grotto)
    q |= Q(invitations__invited_user=user,
           invitations__status__in=['pending', 'accepted'])
    if has_any_grotto:
        q |= Q(invitations__invited_grotto_id__in=user_grottos,
               invitations__status__in=['pending', 'accepted'])

    return base.filter(q).distinct()


# ── Event CRUD ───────────────────────────────────────────────


@api_view(['GET', 'POST'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def event_list(request):
    """List visible events or create a new event."""
    if request.method == 'GET':
        user = request.user if request.user.is_authenticated else None
        qs = _get_visible_events(user).select_related(
            'created_by', 'point_of_contact', 'cave', 'grotto'
        )

        # Filters
        event_type = request.query_params.get('type')
        if event_type:
            types = [t.strip() for t in event_type.split(',')]
            qs = qs.filter(event_type__in=types)

        start = request.query_params.get('start')
        end = request.query_params.get('end')
        if start:
            qs = qs.filter(start_date__gte=start)
        if end:
            qs = qs.filter(start_date__lte=end)

        grotto = request.query_params.get('grotto')
        if grotto:
            qs = qs.filter(grotto_id=grotto)

        cave = request.query_params.get('cave')
        if cave:
            qs = qs.filter(cave_id=cave)

        mine = request.query_params.get('mine')
        if mine == 'true' and request.user.is_authenticated:
            qs = qs.filter(
                Q(created_by=request.user) |
                Q(rsvps__user=request.user)
            ).distinct()

        serializer = EventSerializer(qs, many=True, context={'request': request})
        return Response(serializer.data)

    # POST — create
    if not request.user.is_authenticated:
        return Response({'detail': 'Authentication required.'}, status=http_status.HTTP_401_UNAUTHORIZED)

    serializer = EventSerializer(data=request.data, context={'request': request})
    serializer.is_valid(raise_exception=True)
    event = serializer.save(
        created_by=request.user,
        point_of_contact=serializer.validated_data.get('point_of_contact') or request.user,
    )
    return Response(EventSerializer(event, context={'request': request}).data,
                    status=http_status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def event_detail(request, event_id):
    """Get, update, or delete an event."""
    event = get_object_or_404(
        Event.objects.select_related('created_by', 'point_of_contact', 'cave', 'grotto'),
        pk=event_id,
    )

    if request.method == 'GET':
        serializer = EventSerializer(event, context={'request': request})
        return Response(serializer.data)

    # PATCH / DELETE — creator or admin only
    if event.created_by != request.user and not request.user.is_staff:
        return Response({'detail': 'Permission denied.'}, status=http_status.HTTP_403_FORBIDDEN)

    if request.method == 'DELETE':
        # Capture attendee data before deletion (task runs async after event is gone)
        from notifications.tasks import send_event_update_email
        attendee_ids = list(
            event.rsvps.filter(status='going').values_list('user_id', flat=True)
        )
        event_name = event.name

        # Delete associated chat channel
        if event.chat_channel_id:
            event.chat_channel.delete()
        event.delete()

        # Dispatch after deletion — passes pre-captured data so task doesn't need DB
        if attendee_ids:
            send_event_update_email.delay(
                str(event.id), 'cancelled',
                event_name=event_name,
                attendee_user_ids=attendee_ids,
            )
        return Response(status=http_status.HTTP_204_NO_CONTENT)

    # PATCH
    serializer = EventSerializer(event, data=request.data, partial=True, context={'request': request})
    serializer.is_valid(raise_exception=True)
    serializer.save()

    # Notify attendees of update
    from notifications.tasks import send_event_update_email
    send_event_update_email.delay(str(event.id), 'updated')

    return Response(serializer.data)


# ── Calendar endpoint ────────────────────────────────────────


@api_view(['GET'])
def event_calendar(request):
    """Lightweight calendar data for a date range."""
    user = request.user if request.user.is_authenticated else None
    qs = _get_visible_events(user)

    start = request.query_params.get('start')
    end = request.query_params.get('end')
    if start:
        qs = qs.filter(
            Q(start_date__gte=start) | Q(end_date__gte=start)
        )
    if end:
        qs = qs.filter(start_date__lte=end)

    serializer = EventCalendarSerializer(qs, many=True)
    return Response(serializer.data)


# ── My events ────────────────────────────────────────────────


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_events(request):
    """Events the user created or RSVPed to."""
    qs = Event.objects.filter(
        Q(created_by=request.user) |
        Q(rsvps__user=request.user, rsvps__status__in=['going', 'maybe'])
    ).distinct().select_related('created_by', 'point_of_contact', 'cave', 'grotto')

    serializer = EventSerializer(qs, many=True, context={'request': request})
    return Response(serializer.data)


@api_view(['GET'])
def user_events(request, user_id):
    """Events a specific user is attending, invited to, or created."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    target_user = get_object_or_404(User, pk=user_id)

    qs = Event.objects.filter(
        Q(created_by=target_user) |
        Q(rsvps__user=target_user, rsvps__status__in=['going', 'maybe']) |
        Q(invitations__invited_user=target_user, invitations__status__in=['pending', 'accepted'])
    ).distinct().select_related('created_by', 'point_of_contact', 'cave', 'grotto')

    # Only show visible events to the requesting user
    if request.user.is_authenticated and request.user.is_staff:
        pass  # admin sees all
    elif request.user.is_authenticated:
        visible_ids = set(_get_visible_events(request.user).values_list('id', flat=True))
        qs = qs.filter(id__in=visible_ids)
    else:
        qs = qs.filter(visibility='public')

    serializer = EventSerializer(qs, many=True, context={'request': request})
    return Response(serializer.data)


# ── RSVP ─────────────────────────────────────────────────────


@api_view(['POST', 'DELETE'])
@permission_classes([IsAuthenticated])
def event_rsvp(request, event_id):
    """RSVP to an event or cancel RSVP."""
    event = get_object_or_404(Event, pk=event_id)

    if request.method == 'DELETE':
        EventRSVP.objects.filter(event=event, user=request.user).delete()
        return Response(status=http_status.HTTP_204_NO_CONTENT)

    rsvp_status = request.data.get('status', 'going')
    if rsvp_status not in ('going', 'maybe', 'not_going'):
        return Response({'detail': 'Invalid status.'}, status=http_status.HTTP_400_BAD_REQUEST)

    # Capacity check for 'going'
    if rsvp_status == 'going' and event.max_participants:
        going_count = event.rsvps.filter(status='going').exclude(
            user=request.user
        ).count()
        if going_count >= event.max_participants:
            return Response(
                {'detail': 'Event is at capacity.'},
                status=http_status.HTTP_409_CONFLICT,
            )

    rsvp, created = EventRSVP.objects.update_or_create(
        event=event, user=request.user,
        defaults={'status': rsvp_status},
    )
    serializer = EventRSVPSerializer(rsvp)
    return Response(
        serializer.data,
        status=http_status.HTTP_201_CREATED if created else http_status.HTTP_200_OK,
    )


@api_view(['GET'])
def event_rsvps(request, event_id):
    """List RSVPs for an event."""
    event = get_object_or_404(Event, pk=event_id)
    rsvps = event.rsvps.select_related('user').exclude(status='not_going')
    serializer = EventRSVPSerializer(rsvps, many=True)
    return Response(serializer.data)


# ── Invitations ──────────────────────────────────────────────


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def event_invite(request, event_id):
    """Send an invitation to a user or grotto."""
    event = get_object_or_404(Event, pk=event_id)

    # Only creator or admin can invite
    if event.created_by != request.user and not request.user.is_staff:
        return Response({'detail': 'Permission denied.'}, status=http_status.HTTP_403_FORBIDDEN)

    user_id = request.data.get('user_id')
    grotto_id = request.data.get('grotto_id')

    if not user_id and not grotto_id:
        return Response({'detail': 'Provide user_id or grotto_id.'},
                        status=http_status.HTTP_400_BAD_REQUEST)

    data = {
        'event': event.id,
        'invited_by': request.user.id,
    }
    if user_id:
        data['invited_user'] = user_id
    else:
        data['invited_grotto'] = grotto_id

    serializer = EventInvitationSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    invitation = serializer.save()

    # Send invitation email (only for user invitations, not grotto)
    if user_id:
        from notifications.tasks import send_event_invitation_email
        send_event_invitation_email.delay(str(invitation.id))

    return Response(serializer.data, status=http_status.HTTP_201_CREATED)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def invitation_respond(request, invitation_id):
    """Accept or decline an invitation."""
    invitation = get_object_or_404(EventInvitation, pk=invitation_id)

    # Only the invited user can respond (or a member of the invited grotto)
    if invitation.invited_user and invitation.invited_user != request.user:
        return Response({'detail': 'Permission denied.'}, status=http_status.HTTP_403_FORBIDDEN)

    new_status = request.data.get('status')
    if new_status not in ('accepted', 'declined'):
        return Response({'detail': 'Status must be accepted or declined.'},
                        status=http_status.HTTP_400_BAD_REQUEST)

    invitation.status = new_status
    invitation.save(update_fields=['status'])
    serializer = EventInvitationSerializer(invitation)
    return Response(serializer.data)


# ── Comments ─────────────────────────────────────────────────


@api_view(['GET', 'POST'])
def event_comments(request, event_id):
    """List or add comments on an event."""
    event = get_object_or_404(Event, pk=event_id)

    if request.method == 'GET':
        comments = event.comments.select_related('author')
        serializer = EventCommentSerializer(comments, many=True)
        return Response(serializer.data)

    # POST
    if not request.user.is_authenticated:
        return Response({'detail': 'Authentication required.'},
                        status=http_status.HTTP_401_UNAUTHORIZED)

    serializer = EventCommentSerializer(data={
        'event': event.id,
        'author': request.user.id,
        'text': request.data.get('text', ''),
    })
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=http_status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def event_comment_delete(request, event_id, comment_id):
    """Delete a comment (author or admin only)."""
    comment = get_object_or_404(EventComment, pk=comment_id, event_id=event_id)

    if comment.author != request.user and not request.user.is_staff:
        return Response({'detail': 'Permission denied.'}, status=http_status.HTTP_403_FORBIDDEN)

    comment.delete()
    return Response(status=http_status.HTTP_204_NO_CONTENT)
