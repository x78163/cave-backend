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

    async def chat_message(self, event):
        """Handler for group_send broadcasts — forward to this connection."""
        await self.send_json(event['message'])

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
        msg = Message.objects.create(
            channel_id=channel_id,
            author=self.user,
            content=content,
        )
        return {
            'id': str(msg.id),
            'channel_id': str(channel_id),
            'author': self.user.id,
            'author_username': self.user.username,
            'author_avatar_preset': getattr(self.user, 'avatar_preset', '') or '',
            'content': msg.content,
            'created_at': msg.created_at.isoformat(),
        }

    @database_sync_to_async
    def _touch_channel(self, channel_id):
        from .models import Channel
        Channel.objects.filter(id=channel_id).update(updated_at=timezone.now())

    @database_sync_to_async
    def _mark_read(self, channel_id, message_id):
        from .models import ChannelMembership
        ChannelMembership.objects.filter(
            user=self.user, channel_id=channel_id,
        ).update(last_read_message_id=message_id)
