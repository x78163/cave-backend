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

import re
from .models import (
    Channel, ChannelMembership, Message, MessageReaction,
    MessageMention, Notification,
)
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
        .select_related('author', 'pinned_by', 'reply_to__author')
        [:limit + 1]
    )
    has_more = len(page) > limit
    page = page[:limit]

    # Return oldest-first for display
    page = list(reversed(page))

    # Batch-load reactions for this page (2 queries, no N+1)
    msg_ids = [m.id for m in page]
    _inject_reaction_summaries(page, msg_ids, request.user.id)
    _inject_reply_counts(page, msg_ids)
    _inject_mentions(page, msg_ids)

    # Cache reply_to for serializer
    for msg in page:
        if msg.reply_to_id and msg.reply_to:
            msg._reply_to_cache = msg.reply_to

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

    # Check allow_dms preference
    if not target.allow_dms:
        return Response(
            {'error': 'This user has disabled direct messages'},
            status=status.HTTP_403_FORBIDDEN,
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

    # Reply-to support
    reply_to_id = request.data.get('reply_to')
    reply_to_msg = None
    if reply_to_id:
        try:
            reply_to_msg = Message.objects.select_related('author').get(
                id=reply_to_id, channel_id=channel_id, is_deleted=False,
            )
            # Enforce flat threading — cannot reply to a reply
            if reply_to_msg.reply_to_id:
                reply_to_msg = None
                reply_to_id = None
        except Message.DoesNotExist:
            reply_to_id = None

    msg = Message.objects.create(
        channel_id=channel_id,
        author=request.user,
        content=content,
        image=image,
        file=file,
        file_name=file.name if file else '',
        file_size=file.size if file else 0,
        video_preview=video_preview,
        reply_to_id=reply_to_id,
    )

    # Parse and save mentions
    mentioned_users = _parse_mentions(content) if content else []
    if mentioned_users:
        _save_mentions(msg, mentioned_users, request.user)

    # Create reply notification
    if reply_to_msg and reply_to_msg.author_id != request.user.id:
        Notification.objects.create(
            user=reply_to_msg.author,
            notification_type='reply',
            message=msg,
            channel_id=channel_id,
            actor=request.user,
        )
        _send_notification_to_user(
            reply_to_msg.author_id, msg, 'reply', request.user, channel_id,
        )

    Channel.objects.filter(id=channel_id).update(updated_at=timezone.now())

    # Build reply_to_preview
    reply_to_preview = None
    if reply_to_msg:
        reply_to_preview = {
            'id': str(reply_to_msg.id),
            'author_username': reply_to_msg.author.username,
            'content': reply_to_msg.content[:120],
        }

    mentions_data = [
        {'user_id': u.id, 'username': u.username}
        for u in mentioned_users
    ]

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
        'edited_at': None,
        'is_deleted': False,
        'reply_to': str(reply_to_id) if reply_to_id else None,
        'reply_to_preview': reply_to_preview,
        'is_pinned': False,
        'pinned_by_username': None,
        'pinned_at': None,
        'mentions': mentions_data,
        'reply_count': 0,
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


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def message_detail(request, channel_id, message_id):
    """Edit (PATCH) or soft-delete (DELETE) a message."""
    membership = ChannelMembership.objects.filter(
        user=request.user, channel_id=channel_id,
    ).first()
    if not membership:
        return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)

    try:
        msg = Message.objects.select_related('author').get(
            id=message_id, channel_id=channel_id,
        )
    except Message.DoesNotExist:
        return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)

    if msg.is_deleted:
        return Response({'error': 'Message already deleted'}, status=status.HTTP_400_BAD_REQUEST)

    if request.method == 'PATCH':
        # Only the author can edit
        if msg.author_id != request.user.id:
            return Response({'error': 'Only the author can edit'}, status=status.HTTP_403_FORBIDDEN)

        content = (request.data.get('content') or '').strip()
        if not content:
            return Response({'error': 'Content required'}, status=status.HTTP_400_BAD_REQUEST)

        msg.content = content
        msg.edited_at = timezone.now()
        msg.video_preview = extract_video_preview(content)
        msg.save(update_fields=['content', 'edited_at', 'video_preview'])

        # Re-parse mentions
        mentioned_users = _parse_mentions(content)
        _save_mentions(msg, mentioned_users, request.user)

        mentions = [
            {'user_id': u.id, 'username': u.username}
            for u in mentioned_users
        ]

        # Broadcast edit
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'chat_{channel_id}',
            {
                'type': 'chat_message_edit',
                'data': {
                    'type': 'message_edit',
                    'channel_id': str(channel_id),
                    'message_id': str(message_id),
                    'content': msg.content,
                    'edited_at': msg.edited_at.isoformat(),
                    'video_preview': msg.video_preview,
                    'mentions': mentions,
                },
            },
        )

        return Response({'status': 'edited'})

    # DELETE — soft delete
    is_owner = membership.role == 'owner'
    if msg.author_id != request.user.id and not is_owner:
        return Response(
            {'error': 'Only the author or channel owner can delete'},
            status=status.HTTP_403_FORBIDDEN,
        )

    msg.is_deleted = True
    msg.deleted_at = timezone.now()
    msg.content = ''
    if msg.image:
        msg.image = None
    if msg.file:
        msg.file = None
        msg.file_name = ''
        msg.file_size = 0
    msg.video_preview = None
    msg.save()

    # Broadcast delete
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f'chat_{channel_id}',
        {
            'type': 'chat_message_delete',
            'data': {
                'type': 'message_delete',
                'channel_id': str(channel_id),
                'message_id': str(message_id),
            },
        },
    )

    return Response({'status': 'deleted'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def message_pin(request, channel_id, message_id):
    """Toggle pin on a message."""
    if not ChannelMembership.objects.filter(
        user=request.user, channel_id=channel_id,
    ).exists():
        return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)

    try:
        msg = Message.objects.get(id=message_id, channel_id=channel_id)
    except Message.DoesNotExist:
        return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)

    if msg.is_deleted:
        return Response({'error': 'Cannot pin deleted message'}, status=status.HTTP_400_BAD_REQUEST)

    # Toggle
    if msg.is_pinned:
        msg.is_pinned = False
        msg.pinned_by = None
        msg.pinned_at = None
    else:
        msg.is_pinned = True
        msg.pinned_by = request.user
        msg.pinned_at = timezone.now()

        # Notify message author (if not self)
        if msg.author_id != request.user.id:
            Notification.objects.create(
                user=msg.author,
                notification_type='pin',
                message=msg,
                channel_id=channel_id,
                actor=request.user,
            )
            _send_notification_to_user(msg.author_id, msg, 'pin', request.user, channel_id)

    msg.save(update_fields=['is_pinned', 'pinned_by', 'pinned_at'])

    # Broadcast pin
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f'chat_{channel_id}',
        {
            'type': 'chat_message_pin',
            'data': {
                'type': 'message_pin',
                'channel_id': str(channel_id),
                'message_id': str(message_id),
                'is_pinned': msg.is_pinned,
                'pinned_by_username': request.user.username if msg.is_pinned else None,
                'pinned_at': msg.pinned_at.isoformat() if msg.pinned_at else None,
            },
        },
    )

    return Response({'status': 'pinned' if msg.is_pinned else 'unpinned'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def pinned_messages(request, channel_id):
    """List pinned messages in a channel."""
    if not ChannelMembership.objects.filter(
        user=request.user, channel_id=channel_id,
    ).exists():
        return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)

    msgs = (
        Message.objects
        .filter(channel_id=channel_id, is_pinned=True, is_deleted=False)
        .select_related('author', 'pinned_by')
        .order_by('-pinned_at')
    )

    msg_ids = [m.id for m in msgs]
    _inject_reaction_summaries(list(msgs), msg_ids, request.user.id)

    return Response(MessageSerializer(msgs, many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def message_replies(request, channel_id, message_id):
    """List replies to a message."""
    if not ChannelMembership.objects.filter(
        user=request.user, channel_id=channel_id,
    ).exists():
        return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)

    replies = (
        Message.objects
        .filter(channel_id=channel_id, reply_to_id=message_id, is_deleted=False)
        .select_related('author')
        .order_by('created_at')[:50]
    )

    reply_list = list(replies)
    msg_ids = [m.id for m in reply_list]
    _inject_reaction_summaries(reply_list, msg_ids, request.user.id)

    return Response(MessageSerializer(reply_list, many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def message_search(request):
    """Search messages across user's channels."""
    q = (request.query_params.get('q') or '').strip()
    if not q or len(q) < 2:
        return Response({'error': 'Query too short'}, status=status.HTTP_400_BAD_REQUEST)

    channel_id = request.query_params.get('channel_id')

    # Get user's channel IDs
    user_channels = set(
        ChannelMembership.objects.filter(user=request.user)
        .values_list('channel_id', flat=True)
    )

    messages = Message.objects.filter(
        channel_id__in=user_channels,
        content__icontains=q,
        is_deleted=False,
    ).select_related('author', 'channel').order_by('-created_at')

    if channel_id:
        messages = messages.filter(channel_id=channel_id)

    messages = list(messages[:50])
    msg_ids = [m.id for m in messages]
    _inject_reaction_summaries(messages, msg_ids, request.user.id)

    results = []
    for msg in messages:
        data = MessageSerializer(msg).data
        data['channel_name'] = msg.channel.name or 'DM'
        data['channel_type'] = msg.channel.channel_type
        results.append(data)

    return Response(results)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def notification_list(request):
    """List user's notifications."""
    unread_only = request.query_params.get('unread_only') == 'true'

    qs = Notification.objects.filter(
        user=request.user,
    ).select_related('message', 'channel', 'actor').order_by('-created_at')

    if unread_only:
        qs = qs.filter(is_read=False)

    notifications = qs[:50]

    return Response([
        {
            'id': str(n.id),
            'notification_type': n.notification_type,
            'message_id': str(n.message_id),
            'channel_id': str(n.channel_id),
            'channel_name': n.channel.name or 'DM',
            'actor_id': n.actor_id,
            'actor_username': n.actor.username,
            'message_content': n.message.content[:100] if not n.message.is_deleted else '[deleted]',
            'is_read': n.is_read,
            'created_at': n.created_at.isoformat(),
        }
        for n in notifications
    ])


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def notification_count(request):
    """Unread notification count for badge."""
    count = Notification.objects.filter(
        user=request.user, is_read=False,
    ).count()
    return Response({'unread_count': count})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def notification_mark_read(request, notification_id):
    """Mark a single notification as read."""
    updated = Notification.objects.filter(
        id=notification_id, user=request.user,
    ).update(is_read=True)
    if not updated:
        return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response({'status': 'ok'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def notification_read_all(request):
    """Mark all notifications as read."""
    Notification.objects.filter(
        user=request.user, is_read=False,
    ).update(is_read=True)
    return Response({'status': 'ok'})


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


def _inject_reply_counts(messages, msg_ids):
    """Batch-load reply counts for a page of messages."""
    if not msg_ids:
        for msg in messages:
            msg._reply_count = 0
        return

    counts = dict(
        Message.objects
        .filter(reply_to_id__in=msg_ids, is_deleted=False)
        .values('reply_to_id')
        .annotate(count=models.Count('id'))
        .values_list('reply_to_id', 'count')
    )

    for msg in messages:
        msg._reply_count = counts.get(msg.id, 0)


def _inject_mentions(messages, msg_ids):
    """Batch-load mentions for a page of messages."""
    from collections import defaultdict

    if not msg_ids:
        for msg in messages:
            msg._mention_data = []
        return

    mention_qs = (
        MessageMention.objects
        .filter(message_id__in=msg_ids)
        .select_related('user')
    )

    mentions_by_msg = defaultdict(list)
    for m in mention_qs:
        mentions_by_msg[m.message_id].append({
            'user_id': m.user_id,
            'username': m.user.username,
        })

    for msg in messages:
        msg._mention_data = mentions_by_msg.get(msg.id, [])


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


def _parse_mentions(content):
    """Extract @username mentions from message content, return matched users."""
    matches = re.findall(r'@(\w+)', content)
    if not matches:
        return []
    return list(User.objects.filter(username__in=matches))


def _save_mentions(message, mentioned_users, actor):
    """Create/update MessageMention rows and Notification entries for mentions."""
    # Clear old mentions and recreate
    message.mentions.all().delete()

    if not mentioned_users:
        return

    # Get channel members for filtering (only notify members)
    channel_member_ids = set(
        ChannelMembership.objects.filter(channel_id=message.channel_id)
        .values_list('user_id', flat=True)
    )

    mentions_to_create = []
    for user in mentioned_users:
        if user.id == actor.id:
            continue  # Don't mention yourself
        mentions_to_create.append(
            MessageMention(message=message, user=user)
        )

    if mentions_to_create:
        MessageMention.objects.bulk_create(mentions_to_create, ignore_conflicts=True)

    # Create notifications for mentioned channel members
    for user in mentioned_users:
        if user.id == actor.id or user.id not in channel_member_ids:
            continue
        Notification.objects.create(
            user=user,
            notification_type='mention',
            message=message,
            channel_id=message.channel_id,
            actor=actor,
        )
        _send_notification_to_user(user.id, message, 'mention', actor, message.channel_id)

        # Send mention email notification
        from notifications.tasks import send_mention_notification_email
        from django.conf import settings as django_settings
        frontend_url = getattr(django_settings, 'FRONTEND_URL', 'http://localhost:5174')
        send_mention_notification_email.delay(
            recipient_user_id=user.id,
            mentioner_username=actor.username,
            message_text=message.content[:500],
            context_label='a chat message',
            content_url=f'{frontend_url}/chat',
        )


def _send_notification_to_user(user_id, message, notification_type, actor, channel_id):
    """Send a real-time notification to a specific user via their personal WS group."""
    try:
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'user_{user_id}',
            {
                'type': 'chat_notification',
                'data': {
                    'type': 'notification',
                    'notification_type': notification_type,
                    'message_id': str(message.id),
                    'channel_id': str(channel_id),
                    'actor_id': actor.id,
                    'actor_username': actor.username,
                    'message_content': message.content[:100],
                },
            },
        )
    except Exception:
        pass  # Non-critical
