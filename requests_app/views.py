from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Request
from .serializers import RequestSerializer


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def request_inbox(request):
    """Requests where the current user is the approver (incoming)."""
    qs = Request.objects.filter(target_user=request.user).select_related(
        'requester', 'target_user', 'cave', 'event', 'grotto', 'resolved_by',
    )
    status_filter = request.query_params.get('status')
    if status_filter:
        qs = qs.filter(status=status_filter)
    return Response(RequestSerializer(qs[:100], many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def request_outgoing(request):
    """Requests the current user has sent (outgoing)."""
    qs = Request.objects.filter(requester=request.user).select_related(
        'requester', 'target_user', 'cave', 'event', 'grotto', 'resolved_by',
    )
    status_filter = request.query_params.get('status')
    if status_filter:
        qs = qs.filter(status=status_filter)
    return Response(RequestSerializer(qs[:100], many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def request_counts(request):
    """Unresolved request counts for badge display."""
    inbox_pending = Request.objects.filter(
        target_user=request.user, status='pending',
    ).count()
    outgoing_pending = Request.objects.filter(
        requester=request.user, status='pending',
    ).count()
    return Response({
        'inbox_pending': inbox_pending,
        'outgoing_pending': outgoing_pending,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def request_create(request):
    """
    Create a new request. Automatically determines target_user from context.
    Required: request_type. Optional: cave, event, grotto, message, payload.
    """
    request_type = request.data.get('request_type')
    if not request_type or request_type not in Request.RequestType.values:
        return Response(
            {'error': f'Invalid request_type. Must be one of: {", ".join(Request.RequestType.values)}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = request.user
    cave_id = request.data.get('cave')
    event_id = request.data.get('event')
    grotto_id = request.data.get('grotto')
    message_text = request.data.get('message', '')

    target_user = None
    cave = None
    event = None
    grotto = None

    # Determine target and validate based on request type
    if request_type in ('cave_access', 'cave_edit', 'contact_access', 'contact_submission', 'map_upload'):
        if not cave_id:
            return Response({'error': 'cave is required for this request type'}, status=status.HTTP_400_BAD_REQUEST)
        from caves.models import Cave
        try:
            cave = Cave.objects.get(id=cave_id)
        except Cave.DoesNotExist:
            return Response({'error': 'Cave not found'}, status=status.HTTP_404_NOT_FOUND)
        if cave.owner_id == user.id:
            return Response({'error': 'You are the cave owner'}, status=status.HTTP_400_BAD_REQUEST)
        target_user = cave.owner

        # Check existing access for cave_access
        if request_type == 'cave_access':
            from caves.models import CavePermission
            if CavePermission.objects.filter(cave=cave, user=user).exists():
                return Response({'error': 'You already have access to this cave'}, status=status.HTTP_400_BAD_REQUEST)

    elif request_type == 'event_access':
        if not event_id:
            return Response({'error': 'event is required for this request type'}, status=status.HTTP_400_BAD_REQUEST)
        from events.models import Event
        try:
            event = Event.objects.get(id=event_id)
        except Event.DoesNotExist:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        target_user = event.created_by

    elif request_type == 'grotto_membership':
        if not grotto_id:
            return Response({'error': 'grotto is required for this request type'}, status=status.HTTP_400_BAD_REQUEST)
        from users.models import Grotto, GrottoMembership
        try:
            grotto = Grotto.objects.get(id=grotto_id)
        except Grotto.DoesNotExist:
            return Response({'error': 'Grotto not found'}, status=status.HTTP_404_NOT_FOUND)
        # Already a member?
        if GrottoMembership.objects.filter(grotto=grotto, user=user, status='active').exists():
            return Response({'error': 'You are already a member'}, status=status.HTTP_400_BAD_REQUEST)
        target_user = grotto.created_by

    elif request_type == 'admin_escalation':
        # Target the first staff user (or None — admins will see via inbox)
        from django.contrib.auth import get_user_model
        User = get_user_model()
        target_user = User.objects.filter(is_staff=True).first()

    # Validate contact_submission payload
    if request_type == 'contact_submission':
        payload = request.data.get('payload')
        if not payload or not isinstance(payload, dict):
            return Response({'error': 'payload with contact fields required'}, status=status.HTTP_400_BAD_REQUEST)
        if not any(payload.get(k) for k in ('phone', 'email', 'address')):
            return Response({'error': 'Payload must include phone, email, or address'}, status=status.HTTP_400_BAD_REQUEST)
    else:
        payload = None

    # Check for duplicate pending
    dup_filter = Q(requester=user, request_type=request_type, status='pending')
    if cave:
        dup_filter &= Q(cave=cave)
    if event:
        dup_filter &= Q(event=event)
    if grotto:
        dup_filter &= Q(grotto=grotto)
    if Request.objects.filter(dup_filter).exists():
        return Response({'error': 'You already have a pending request of this type'}, status=status.HTTP_409_CONFLICT)

    req = Request.objects.create(
        request_type=request_type,
        requester=user,
        target_user=target_user,
        cave=cave,
        event=event,
        grotto=grotto,
        message=message_text,
        payload=payload,
    )

    # Send email notification to approver
    _notify_new_request(req)

    # Create in-app notification for approver
    _create_in_app_notification(req, is_new=True)

    return Response(RequestSerializer(req).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def request_resolve(request, request_id):
    """
    Approve or deny a request. Only target_user or admin can resolve.
    Accepts: status (accepted/denied), response_message (optional).
    """
    try:
        req = Request.objects.select_related(
            'requester', 'target_user', 'cave', 'event', 'grotto',
        ).get(id=request_id)
    except Request.DoesNotExist:
        return Response({'error': 'Request not found'}, status=status.HTTP_404_NOT_FOUND)

    user = request.user
    is_target = req.target_user_id == user.id
    if not is_target and not user.is_staff:
        return Response({'error': 'Only the approver can resolve this request'}, status=status.HTTP_403_FORBIDDEN)

    if req.status != 'pending':
        return Response({'error': f'Request is already {req.status}'}, status=status.HTTP_400_BAD_REQUEST)

    new_status = request.data.get('status')
    if new_status not in ('accepted', 'denied'):
        return Response({'error': 'status must be "accepted" or "denied"'}, status=status.HTTP_400_BAD_REQUEST)

    req.status = new_status
    req.response_message = request.data.get('response_message', '')
    req.resolved_by = user
    req.resolved_at = timezone.now()
    req.save(update_fields=['status', 'response_message', 'resolved_by', 'resolved_at'])

    if new_status == 'accepted':
        _apply_side_effects(req)

    # Notify requester of resolution
    _notify_resolved(req)
    _create_in_app_notification(req, is_new=False)

    return Response(RequestSerializer(req).data)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def request_cancel(request, request_id):
    """
    Delete/dismiss a request.
    - Requester can cancel their own (pending → delete, resolved → delete).
    - Target user can dismiss (pending → auto-deny then delete, resolved → delete).
    - Staff can delete any.
    """
    try:
        req = Request.objects.get(id=request_id)
    except Request.DoesNotExist:
        return Response({'error': 'Request not found'}, status=status.HTTP_404_NOT_FOUND)

    user = request.user
    is_requester = req.requester_id == user.id
    is_target = req.target_user_id == user.id

    if not is_requester and not is_target and not user.is_staff:
        return Response({'error': 'Not authorized'}, status=status.HTTP_403_FORBIDDEN)

    # If target user dismisses a pending request, auto-deny first
    if req.status == 'pending' and is_target and not is_requester:
        req.status = 'denied'
        req.resolved_by = user
        req.resolved_at = timezone.now()
        req.save(update_fields=['status', 'resolved_by', 'resolved_at'])

    req.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ── Side effects on acceptance ────────────────────────────────

def _apply_side_effects(req):
    """Execute the appropriate action when a request is accepted."""
    if req.request_type == 'cave_access':
        from caves.models import CavePermission
        CavePermission.objects.get_or_create(
            cave=req.cave, user=req.requester,
            defaults={'role': 'viewer', 'granted_by': req.resolved_by},
        )

    elif req.request_type == 'cave_edit':
        from caves.models import CavePermission
        perm, created = CavePermission.objects.get_or_create(
            cave=req.cave, user=req.requester,
            defaults={'role': 'editor', 'granted_by': req.resolved_by},
        )
        if not created and perm.role != 'editor':
            perm.role = 'editor'
            perm.save(update_fields=['role'])

    elif req.request_type == 'contact_access':
        from caves.models import LandOwner
        lo, _ = LandOwner.objects.get_or_create(cave=req.cave)
        lo.contact_access_users.add(req.requester)

    elif req.request_type == 'contact_submission':
        from caves.models import LandOwner
        lo, _ = LandOwner.objects.get_or_create(cave=req.cave)
        payload = req.payload or {}
        if payload.get('phone'):
            lo.phone = payload['phone']
        if payload.get('email'):
            lo.email = payload['email']
        if payload.get('address'):
            lo.address = payload['address']
        if payload.get('notes'):
            if lo.notes:
                lo.notes += f'\n\n--- Submitted by {req.requester.username} ---\n{payload["notes"]}'
            else:
                lo.notes = payload['notes']
        lo.save()

    elif req.request_type == 'event_access':
        from events.models import EventInvitation
        EventInvitation.objects.get_or_create(
            event=req.event, invited_user=req.requester,
            defaults={'invited_by': req.resolved_by, 'status': 'accepted'},
        )

    elif req.request_type == 'grotto_membership':
        from users.models import GrottoMembership
        mem, created = GrottoMembership.objects.get_or_create(
            grotto=req.grotto, user=req.requester,
            defaults={'role': 'member', 'status': 'active'},
        )
        if not created and mem.status != 'active':
            mem.status = 'active'
            mem.save(update_fields=['status'])

    elif req.request_type == 'grotto_invitation':
        # Invitee (target_user) accepted — add them as member
        from users.models import GrottoMembership
        mem, created = GrottoMembership.objects.get_or_create(
            grotto=req.grotto, user=req.target_user,
            defaults={'role': 'member', 'status': 'active'},
        )
        if not created and mem.status != 'active':
            mem.status = 'active'
            mem.save(update_fields=['status'])


# ── Notifications ─────────────────────────────────────────────

def _notify_new_request(req):
    """Send email to the approver about a new request."""
    if not req.target_user:
        return
    try:
        from notifications.tasks import send_cave_access_request_email
        # Reuse the existing task for cave-related requests
        if req.cave:
            send_cave_access_request_email.delay(str(req.id))
    except Exception:
        pass


def _notify_resolved(req):
    """Send email to the requester about the resolution."""
    try:
        from notifications.tasks import send_cave_access_resolved_email
        if req.cave:
            send_cave_access_resolved_email.delay(str(req.id), req.status)
    except Exception:
        pass


def _create_in_app_notification(req, is_new=True):
    """Create a chat Notification for in-app display."""
    try:
        from chat.models import Notification
        if is_new and req.target_user:
            Notification.objects.create(
                user=req.target_user,
                notification_type='request',
                actor=req.requester,
                # message and channel are nullable for request type
                message=None,
                channel=None,
            )
        elif not is_new and req.requester:
            Notification.objects.create(
                user=req.requester,
                notification_type='request',
                actor=req.resolved_by or req.target_user,
                message=None,
                channel=None,
            )
    except Exception:
        pass
