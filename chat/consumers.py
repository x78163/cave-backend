from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone


class ChatConsumer(AsyncJsonWebsocketConsumer):
    """Single WebSocket per user, multiplexed across all their channels."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = None
        self.channel_groups = set()

    async def connect(self):
        self.user = self.scope.get('user')
        if not self.user or self.user.is_anonymous:
            await self.close(code=4001)
            return

        # Join all channel groups the user belongs to
        memberships = await self._get_user_channel_ids()
        for channel_id in memberships:
            group_name = f'chat_{channel_id}'
            await self.channel_layer.group_add(group_name, self.channel_name)
            self.channel_groups.add(group_name)

        await self.accept()

    async def disconnect(self, close_code):
        for group_name in self.channel_groups:
            await self.channel_layer.group_discard(group_name, self.channel_name)

    async def receive_json(self, content):
        msg_type = content.get('type')

        if msg_type == 'chat.message':
            channel_id = content.get('channel_id')
            text = (content.get('content') or '').strip()
            if not text or not channel_id:
                return

            if not await self._is_member(channel_id):
                await self.send_json({'type': 'error', 'message': 'Not a member'})
                return

            message = await self._save_message(channel_id, text)
            await self._touch_channel(channel_id)

            await self.channel_layer.group_send(
                f'chat_{channel_id}',
                {
                    'type': 'chat_message',
                    'message': message,
                },
            )

        elif msg_type == 'chat.mark_read':
            channel_id = content.get('channel_id')
            message_id = content.get('message_id')
            if channel_id and message_id:
                await self._mark_read(channel_id, message_id)

        elif msg_type == 'chat.join_channel':
            channel_id = content.get('channel_id')
            if channel_id and await self._is_member(channel_id):
                group_name = f'chat_{channel_id}'
                await self.channel_layer.group_add(group_name, self.channel_name)
                self.channel_groups.add(group_name)

        elif msg_type == 'chat.react':
            channel_id = content.get('channel_id')
            message_id = content.get('message_id')
            emoji = (content.get('emoji') or '').strip()
            if channel_id and message_id and emoji and await self._is_member(channel_id):
                result = await self._toggle_reaction(channel_id, message_id, emoji)
                if result:
                    await self.channel_layer.group_send(
                        f'chat_{channel_id}',
                        {
                            'type': 'chat_reaction',
                            'data': result,
                        },
                    )

        elif msg_type == 'chat.typing':
            channel_id = content.get('channel_id')
            if channel_id and await self._is_member(channel_id):
                await self.channel_layer.group_send(
                    f'chat_{channel_id}',
                    {
                        'type': 'chat_typing',
                        'data': {
                            'type': 'typing',
                            'channel_id': str(channel_id),
                            'user_id': self.user.id,
                            'username': self.user.username,
                        },
                    },
                )

    async def chat_message(self, event):
        """Handler for group_send broadcasts — forward to this connection."""
        await self.send_json(event['message'])

    async def chat_typing(self, event):
        """Forward typing indicator — skip sender."""
        if event['data']['user_id'] != self.user.id:
            await self.send_json(event['data'])

    async def chat_member_update(self, event):
        """Forward member add/remove events."""
        await self.send_json(event['data'])

    async def chat_reaction(self, event):
        """Forward reaction update events."""
        await self.send_json(event['data'])

    # ── Database helpers ──

    @database_sync_to_async
    def _get_user_channel_ids(self):
        from .models import ChannelMembership
        return list(
            ChannelMembership.objects.filter(user=self.user)
            .values_list('channel_id', flat=True)
        )

    @database_sync_to_async
    def _is_member(self, channel_id):
        from .models import ChannelMembership
        return ChannelMembership.objects.filter(
            user=self.user, channel_id=channel_id,
        ).exists()

    @database_sync_to_async
    def _save_message(self, channel_id, content):
        from .models import Message
        from .utils import extract_video_preview

        video_preview = extract_video_preview(content)

        msg = Message.objects.create(
            channel_id=channel_id,
            author=self.user,
            content=content,
            video_preview=video_preview,
        )
        return {
            'id': str(msg.id),
            'channel_id': str(channel_id),
            'author': self.user.id,
            'author_username': self.user.username,
            'author_avatar_preset': getattr(self.user, 'avatar_preset', '') or '',
            'author_avatar': self.user.avatar.url if self.user.avatar else None,
            'content': msg.content,
            'image_url': None,
            'file_url': None,
            'file_name': '',
            'file_size': 0,
            'video_preview': video_preview,
            'reactions': [],
            'created_at': msg.created_at.isoformat(),
        }

    @database_sync_to_async
    def _touch_channel(self, channel_id):
        from .models import Channel
        Channel.objects.filter(id=channel_id).update(updated_at=timezone.now())

    @database_sync_to_async
    def _toggle_reaction(self, channel_id, message_id, emoji):
        from .models import Message, MessageReaction
        from django.db.models import Count

        try:
            msg = Message.objects.get(id=message_id, channel_id=channel_id)
        except Message.DoesNotExist:
            return None

        existing = MessageReaction.objects.filter(
            message=msg, user=self.user, emoji=emoji,
        )
        if existing.exists():
            existing.delete()
            action = 'removed'
        else:
            MessageReaction.objects.create(
                message=msg, user=self.user, emoji=emoji,
            )
            action = 'added'

        # Build summary
        counts = (
            MessageReaction.objects.filter(message=msg)
            .values('emoji').annotate(count=Count('id'))
            .order_by('emoji')
        )
        reactions = [{'emoji': r['emoji'], 'count': r['count']} for r in counts]

        return {
            'type': 'reaction_update',
            'channel_id': str(channel_id),
            'message_id': str(message_id),
            'reactions': reactions,
            'actor_id': self.user.id,
            'actor_username': self.user.username,
            'emoji': emoji,
            'action': action,
        }

    @database_sync_to_async
    def _mark_read(self, channel_id, message_id):
        from .models import ChannelMembership
        ChannelMembership.objects.filter(
            user=self.user, channel_id=channel_id,
        ).update(last_read_message_id=message_id)
