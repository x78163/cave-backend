from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth import get_user_model
from django.db import models
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Channel, ChannelMembership, Message, MessageReaction
from .serializers import ChannelSerializer, MessageSerializer, MemberSerializer
from .utils import extract_video_preview

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
                'is_private': channel.is_private,
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
        is_private=request.data.get('is_private', True),
        created_by=request.user,
    )
    ChannelMembership.objects.create(
        channel=channel, user=request.user, role='owner',
    )

    return Response(
        ChannelSerializer(channel).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def channel_detail(request, channel_id):
    """Channel detail (GET), edit (PATCH), or delete (DELETE)."""
    try:
        channel = Channel.objects.get(id=channel_id)
    except Channel.DoesNotExist:
        return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    membership = ChannelMembership.objects.filter(
        user=request.user, channel=channel,
    ).first()

    if not membership:
        return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)

    is_owner = membership.role == 'owner'

    if request.method == 'GET':
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
        data['is_owner'] = is_owner
        return Response(data)

    if request.method == 'PATCH':
        if not is_owner:
            return Response({'error': 'Only the channel owner can edit'}, status=status.HTTP_403_FORBIDDEN)
        if channel.channel_type == 'dm':
            return Response({'error': 'Cannot edit DMs'}, status=status.HTTP_400_BAD_REQUEST)

        name = request.data.get('name')
        description = request.data.get('description')
        is_private = request.data.get('is_private')
        if name is not None:
            channel.name = name.strip()
        if description is not None:
            channel.description = description.strip()
        if is_private is not None:
            channel.is_private = is_private
        channel.save()
        return Response(ChannelSerializer(channel).data)

    # DELETE
    if not is_owner:
        return Response({'error': 'Only the channel owner can delete'}, status=status.HTTP_403_FORBIDDEN)
    if channel.channel_type == 'dm':
        return Response({'error': 'Cannot delete DMs'}, status=status.HTTP_400_BAD_REQUEST)

    channel.delete()
    return Response({'status': 'deleted'})


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
    page = list(reversed(page))

    # Batch-load reactions for this page (2 queries, no N+1)
    msg_ids = [m.id for m in page]
    _inject_reaction_summaries(page, msg_ids, request.user.id)

    serializer = MessageSerializer(page, many=True)
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
        # Broadcast member update
        _broadcast_member_update(channel_id, target, 'added')
        return Response({'status': 'added', 'channel_id': str(channel.id)}, status=status.HTTP_201_CREATED)
    return Response({'status': 'already_member'})


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def channel_remove_member(request, channel_id, user_id):
    """Remove a member from a channel (owner only)."""
    try:
        channel = Channel.objects.get(id=channel_id)
    except Channel.DoesNotExist:
        return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    if channel.channel_type == 'dm':
        return Response({'error': 'Cannot remove members from DMs'}, status=status.HTTP_400_BAD_REQUEST)

    if not ChannelMembership.objects.filter(
        user=request.user, channel=channel, role='owner',
    ).exists():
        return Response({'error': 'Only the channel owner can remove members'}, status=status.HTTP_403_FORBIDDEN)

    if user_id == request.user.id:
        return Response({'error': 'Use leave endpoint to remove yourself'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        target = User.objects.get(id=user_id)
    except (User.DoesNotExist, ValueError, TypeError):
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    deleted, _ = ChannelMembership.objects.filter(
        channel=channel, user_id=user_id,
    ).delete()

    if not deleted:
        return Response({'error': 'User is not a member'}, status=status.HTTP_404_NOT_FOUND)

    _broadcast_member_update(channel_id, target, 'removed')
    return Response({'status': 'removed'})


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


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def browse_channels(request):
    """List public channels that the user can join."""
    q = request.query_params.get('q', '').strip()

    channels = Channel.objects.filter(
        channel_type='channel',
        is_private=False,
    )

    if q:
        channels = channels.filter(
            models.Q(name__icontains=q) | models.Q(description__icontains=q)
        )

    channels = channels.order_by('-updated_at')[:50]

    user_channel_ids = set(
        ChannelMembership.objects.filter(user=request.user)
        .values_list('channel_id', flat=True)
    )

    results = []
    for ch in channels:
        results.append({
            'id': str(ch.id),
            'name': ch.name,
            'description': ch.description,
            'member_count': ch.memberships.count(),
            'is_member': ch.id in user_channel_ids,
            'updated_at': ch.updated_at.isoformat(),
        })

    return Response(results)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def join_public_channel(request, channel_id):
    """Join a public channel (self-service)."""
    try:
        channel = Channel.objects.get(id=channel_id)
    except Channel.DoesNotExist:
        return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    if channel.is_private:
        return Response({'error': 'This channel is private'}, status=status.HTTP_403_FORBIDDEN)

    if channel.channel_type != 'channel':
        return Response({'error': 'Not a channel'}, status=status.HTTP_400_BAD_REQUEST)

    membership, created = ChannelMembership.objects.get_or_create(
        channel=channel, user=request.user,
        defaults={'role': 'member'},
    )

    if created:
        _broadcast_member_update(channel_id, request.user, 'added')
        return Response({'status': 'joined', 'channel_id': str(channel.id)}, status=status.HTTP_201_CREATED)
    return Response({'status': 'already_member'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def send_message_with_attachment(request, channel_id):
    """Send a message with optional image/file attachment via REST."""
    if not ChannelMembership.objects.filter(
        user=request.user, channel_id=channel_id,
    ).exists():
        return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)

    content = (request.data.get('content') or '').strip()
    image = request.FILES.get('image')
    file = request.FILES.get('file')

    if not content and not image and not file:
        return Response({'error': 'Message content, image, or file required'}, status=status.HTTP_400_BAD_REQUEST)

    # 15MB limit
    for f in [image, file]:
        if f and f.size > 15 * 1024 * 1024:
            return Response({'error': 'File too large (max 15MB)'}, status=status.HTTP_400_BAD_REQUEST)

    video_preview = extract_video_preview(content) if content else None

    msg = Message.objects.create(
        channel_id=channel_id,
        author=request.user,
        content=content,
        image=image,
        file=file,
        file_name=file.name if file else '',
        file_size=file.size if file else 0,
        video_preview=video_preview,
    )

    Channel.objects.filter(id=channel_id).update(updated_at=timezone.now())

    message_data = {
        'id': str(msg.id),
        'channel_id': str(channel_id),
        'author': request.user.id,
        'author_username': request.user.username,
        'author_avatar_preset': getattr(request.user, 'avatar_preset', '') or '',
        'author_avatar': request.user.avatar.url if request.user.avatar else None,
        'content': msg.content,
        'image_url': msg.image.url if msg.image else None,
        'file_url': msg.file.url if msg.file else None,
        'file_name': msg.file_name,
        'file_size': msg.file_size,
        'video_preview': video_preview,
        'reactions': [],
        'created_at': msg.created_at.isoformat(),
    }

    # Broadcast via WebSocket
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f'chat_{channel_id}',
        {'type': 'chat_message', 'message': message_data},
    )

    return Response(message_data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def message_react(request, channel_id, message_id):
    """Toggle an emoji reaction on a message."""
    if not ChannelMembership.objects.filter(
        user=request.user, channel_id=channel_id,
    ).exists():
        return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)

    emoji = (request.data.get('emoji') or '').strip()
    if not emoji or len(emoji) > 32:
        return Response({'error': 'Invalid emoji'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        msg = Message.objects.get(id=message_id, channel_id=channel_id)
    except Message.DoesNotExist:
        return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)

    # Toggle: remove if exists, create if not
    existing = MessageReaction.objects.filter(
        message=msg, user=request.user, emoji=emoji,
    )
    if existing.exists():
        existing.delete()
        action = 'removed'
    else:
        MessageReaction.objects.create(
            message=msg, user=request.user, emoji=emoji,
        )
        action = 'added'

    # Build reaction summary
    reactions = _get_reaction_summary(message_id, request.user.id)

    # Broadcast via WebSocket
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f'chat_{channel_id}',
        {
            'type': 'chat_reaction',
            'data': {
                'type': 'reaction_update',
                'channel_id': str(channel_id),
                'message_id': str(message_id),
                'reactions': reactions,
                'actor_id': request.user.id,
                'actor_username': request.user.username,
                'emoji': emoji,
                'action': action,
            },
        },
    )

    return Response({'reactions': reactions})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def message_reaction_users(request, channel_id, message_id):
    """List users who reacted with a specific emoji."""
    if not ChannelMembership.objects.filter(
        user=request.user, channel_id=channel_id,
    ).exists():
        return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)

    emoji = request.query_params.get('emoji', '').strip()
    if not emoji:
        return Response({'error': 'emoji query param required'}, status=status.HTTP_400_BAD_REQUEST)

    users = (
        MessageReaction.objects
        .filter(message_id=message_id, emoji=emoji)
        .select_related('user')
        .order_by('created_at')[:20]
    )

    return Response({
        'users': [
            {'id': r.user.id, 'username': r.user.username}
            for r in users
        ],
    })


def _get_reaction_summary(message_id, current_user_id):
    """Build reaction summary for a message: [{emoji, count, reacted}]."""
    from django.db.models import Count

    counts = (
        MessageReaction.objects
        .filter(message_id=message_id)
        .values('emoji')
        .annotate(count=Count('id'))
        .order_by('emoji')
    )

    user_emojis = set(
        MessageReaction.objects
        .filter(message_id=message_id, user_id=current_user_id)
        .values_list('emoji', flat=True)
    )

    return [
        {
            'emoji': r['emoji'],
            'count': r['count'],
            'reacted': r['emoji'] in user_emojis,
        }
        for r in counts
    ]


def _inject_reaction_summaries(messages, msg_ids, current_user_id):
    """Batch-load reactions for a page of messages (2 queries, no N+1)."""
    from django.db.models import Count
    from collections import defaultdict

    if not msg_ids:
        for msg in messages:
            msg._reaction_summary = []
        return

    # Query 1: aggregate counts per message+emoji
    counts = (
        MessageReaction.objects
        .filter(message_id__in=msg_ids)
        .values('message_id', 'emoji')
        .annotate(count=Count('id'))
        .order_by('message_id', 'emoji')
    )

    counts_by_msg = defaultdict(list)
    for r in counts:
        counts_by_msg[r['message_id']].append({
            'emoji': r['emoji'],
            'count': r['count'],
        })

    # Query 2: current user's reactions
    user_reactions = set(
        MessageReaction.objects
        .filter(message_id__in=msg_ids, user_id=current_user_id)
        .values_list('message_id', 'emoji')
    )

    for msg in messages:
        summary = []
        for r in counts_by_msg.get(msg.id, []):
            summary.append({
                'emoji': r['emoji'],
                'count': r['count'],
                'reacted': (msg.id, r['emoji']) in user_reactions,
            })
        msg._reaction_summary = summary


def _broadcast_member_update(channel_id, user, action):
    """Broadcast member add/remove event to channel via WebSocket."""
    try:
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'chat_{channel_id}',
            {
                'type': 'chat_member_update',
                'data': {
                    'type': 'member_update',
                    'channel_id': str(channel_id),
                    'action': action,
                    'user_id': user.id,
                    'username': user.username,
                },
            },
        )
    except Exception:
        pass  # Non-critical — frontend will refresh on next fetch
