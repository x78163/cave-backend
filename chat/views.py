from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Channel, ChannelMembership, Message
from .serializers import ChannelSerializer, MessageSerializer, MemberSerializer

User = get_user_model()


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def channel_list(request):
    """List user's channels (GET) or create a new channel (POST)."""
    if request.method == 'GET':
        memberships = (
            ChannelMembership.objects
            .filter(user=request.user)
            .select_related('channel')
            .order_by('-channel__updated_at')
        )

        results = []
        for membership in memberships:
            channel = membership.channel

            # Last message
            last_msg = (
                channel.messages
                .order_by('-created_at')
                .values('id', 'content', 'author__username', 'created_at')
                .first()
            )

            # Unread count
            unread = 0
            if membership.last_read_message_id:
                last_read = (
                    Message.objects
                    .filter(id=membership.last_read_message_id)
                    .values('created_at')
                    .first()
                )
                if last_read:
                    unread = (
                        channel.messages
                        .filter(created_at__gt=last_read['created_at'])
                        .exclude(author=request.user)
                        .count()
                    )
            elif last_msg:
                unread = channel.messages.exclude(author=request.user).count()

            # For DMs, include the other user
            other_user = None
            if channel.channel_type == 'dm':
                other = (
                    channel.memberships
                    .exclude(user=request.user)
                    .select_related('user')
                    .first()
                )
                if other:
                    other_user = {
                        'id': other.user.id,
                        'username': other.user.username,
                        'avatar_preset': getattr(other.user, 'avatar_preset', '') or '',
                    }

            results.append({
                'id': str(channel.id),
                'name': channel.name,
                'channel_type': channel.channel_type,
                'description': channel.description,
                'other_user': other_user,
                'last_message': {
                    'id': str(last_msg['id']),
                    'content': last_msg['content'][:100],
                    'author_username': last_msg['author__username'],
                    'created_at': last_msg['created_at'].isoformat(),
                } if last_msg else None,
                'unread_count': unread,
                'updated_at': channel.updated_at.isoformat(),
            })

        return Response(results)

    # POST — create a new channel
    name = (request.data.get('name') or '').strip()
    if not name:
        return Response(
            {'error': 'Channel name is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    channel = Channel.objects.create(
        name=name,
        channel_type='channel',
        description=(request.data.get('description') or '').strip(),
        created_by=request.user,
    )
    ChannelMembership.objects.create(
        channel=channel, user=request.user, role='owner',
    )

    return Response(
        ChannelSerializer(channel).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def channel_detail(request, channel_id):
    """Channel detail with member list."""
    try:
        channel = Channel.objects.get(id=channel_id)
    except Channel.DoesNotExist:
        return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    if not ChannelMembership.objects.filter(
        user=request.user, channel=channel,
    ).exists():
        return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)

    members = []
    for m in channel.memberships.select_related('user').all():
        members.append({
            'id': m.user.id,
            'username': m.user.username,
            'avatar_preset': getattr(m.user, 'avatar_preset', '') or '',
            'role': m.role,
        })

    data = ChannelSerializer(channel).data
    data['members'] = members
    return Response(data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def channel_messages(request, channel_id):
    """Cursor-paginated message history for a channel."""
    if not ChannelMembership.objects.filter(
        user=request.user, channel_id=channel_id,
    ).exists():
        return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)

    messages = Message.objects.filter(channel_id=channel_id).order_by('-created_at')

    # Cursor-based pagination: ?before=<uuid>
    before = request.query_params.get('before')
    if before:
        cursor_msg = Message.objects.filter(id=before).values('created_at').first()
        if cursor_msg:
            messages = messages.filter(created_at__lt=cursor_msg['created_at'])

    limit = min(int(request.query_params.get('limit', 50)), 100)
    page = list(
        messages
        .select_related('author')
        [:limit + 1]
    )
    has_more = len(page) > limit
    page = page[:limit]

    # Return oldest-first for display
    serializer = MessageSerializer(reversed(page), many=True)
    return Response({
        'messages': serializer.data,
        'has_more': has_more,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_read(request, channel_id):
    """Update the read cursor for the current user in a channel."""
    message_id = request.data.get('message_id')
    if not message_id:
        return Response(
            {'error': 'message_id required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    updated = ChannelMembership.objects.filter(
        user=request.user, channel_id=channel_id,
    ).update(last_read_message_id=message_id)

    if not updated:
        return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)

    return Response({'status': 'ok'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def channel_add_member(request, channel_id):
    """Add a member to a channel."""
    try:
        channel = Channel.objects.get(id=channel_id)
    except Channel.DoesNotExist:
        return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    if channel.channel_type == 'dm':
        return Response(
            {'error': 'Cannot add members to DMs'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Only members can add others
    if not ChannelMembership.objects.filter(
        user=request.user, channel=channel,
    ).exists():
        return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)

    user_id = request.data.get('user_id')
    try:
        target = User.objects.get(id=user_id)
    except (User.DoesNotExist, ValueError, TypeError):
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    membership, created = ChannelMembership.objects.get_or_create(
        channel=channel, user=target,
        defaults={'role': 'member'},
    )

    if created:
        return Response({'status': 'added', 'channel_id': str(channel.id)}, status=status.HTTP_201_CREATED)
    return Response({'status': 'already_member'})


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def channel_leave(request, channel_id):
    """Leave a channel."""
    deleted, _ = ChannelMembership.objects.filter(
        user=request.user, channel_id=channel_id,
    ).delete()

    if not deleted:
        return Response({'error': 'Not a member'}, status=status.HTTP_404_NOT_FOUND)

    return Response({'status': 'left'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def dm_get_or_create(request):
    """Get or create a DM channel between the current user and another user."""
    user_id = request.data.get('user_id')
    if not user_id:
        return Response(
            {'error': 'user_id required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        target = User.objects.get(id=user_id)
    except (User.DoesNotExist, ValueError, TypeError):
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    if target.id == request.user.id:
        return Response(
            {'error': 'Cannot DM yourself'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Find existing DM between these two users
    existing = (
        Channel.objects
        .filter(channel_type='dm', memberships__user=request.user)
        .filter(memberships__user=target)
        .first()
    )

    if existing:
        return Response({'channel_id': str(existing.id)})

    # Create new DM
    channel = Channel.objects.create(
        channel_type='dm', created_by=request.user,
    )
    ChannelMembership.objects.create(
        channel=channel, user=request.user, role='owner',
    )
    ChannelMembership.objects.create(
        channel=channel, user=target, role='member',
    )

    return Response(
        {'channel_id': str(channel.id)},
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def unread_count(request):
    """Total unread messages across all channels (for nav badge)."""
    memberships = (
        ChannelMembership.objects
        .filter(user=request.user)
        .select_related('channel')
    )

    total = 0
    for m in memberships:
        if m.last_read_message_id:
            last_read = (
                Message.objects
                .filter(id=m.last_read_message_id)
                .values('created_at')
                .first()
            )
            if last_read:
                total += (
                    m.channel.messages
                    .filter(created_at__gt=last_read['created_at'])
                    .exclude(author=request.user)
                    .count()
                )
        else:
            total += m.channel.messages.exclude(author=request.user).count()

    return Response({'total_unread': total})
