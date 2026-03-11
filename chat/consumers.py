from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone


class ChatConsumer(AsyncJsonWebsocketConsumer):
    """Single WebSocket per user, multiplexed across all their channels."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = None
        self.channel_groups = set()
        self.personal_group = None

    async def connect(self):
        self.user = self.scope.get('user')
        if not self.user or self.user.is_anonymous:
            await self.close(code=4001)
            return

        # Join personal notification group
        self.personal_group = f'user_{self.user.id}'
        await self.channel_layer.group_add(self.personal_group, self.channel_name)

        # Join all channel groups the user belongs to
        memberships = await self._get_user_channel_ids()
        for channel_id in memberships:
            group_name = f'chat_{channel_id}'
            await self.channel_layer.group_add(group_name, self.channel_name)
            self.channel_groups.add(group_name)

        await self.accept()

    async def disconnect(self, close_code):
        if self.personal_group:
            await self.channel_layer.group_discard(self.personal_group, self.channel_name)
        for group_name in self.channel_groups:
            await self.channel_layer.group_discard(group_name, self.channel_name)

    async def receive_json(self, content):
        msg_type = content.get('type')

        if msg_type == 'chat.message':
            channel_id = content.get('channel_id')
            text = (content.get('content') or '').strip()
            reply_to = content.get('reply_to')
            if not text or not channel_id:
                return

            if not await self._is_member(channel_id):
                await self.send_json({'type': 'error', 'message': 'Not a member'})
                return

            message = await self._save_message(channel_id, text, reply_to)
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

    async def chat_message_edit(self, event):
        """Forward message edit events."""
        await self.send_json(event['data'])

    async def chat_message_delete(self, event):
        """Forward message delete events."""
        await self.send_json(event['data'])

    async def chat_message_pin(self, event):
        """Forward message pin/unpin events."""
        await self.send_json(event['data'])

    async def chat_notification(self, event):
        """Forward personal notification — only reaches target user's group."""
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
    def _save_message(self, channel_id, content, reply_to=None):
        import re
        from django.contrib.auth import get_user_model
        from .models import Message, MessageMention, Notification, ChannelMembership
        from .utils import extract_video_preview

        User = get_user_model()
        video_preview = extract_video_preview(content)

        # Validate reply_to
        reply_to_id = None
        reply_to_msg = None
        if reply_to:
            try:
                reply_to_msg = Message.objects.select_related('author').get(
                    id=reply_to, channel_id=channel_id, is_deleted=False,
                )
                # Enforce flat threading
                if not reply_to_msg.reply_to_id:
                    reply_to_id = reply_to_msg.id
                else:
                    reply_to_msg = None
            except Message.DoesNotExist:
                pass

        msg = Message.objects.create(
            channel_id=channel_id,
            author=self.user,
            content=content,
            video_preview=video_preview,
            reply_to_id=reply_to_id,
        )

        # Parse and save mentions
        mentioned_users = []
        mention_matches = re.findall(r'@(\w+)', content)
        if mention_matches:
            mentioned_users = list(User.objects.filter(username__in=mention_matches))
            channel_member_ids = set(
                ChannelMembership.objects.filter(channel_id=channel_id)
                .values_list('user_id', flat=True)
            )
            for user in mentioned_users:
                if user.id != self.user.id:
                    MessageMention.objects.get_or_create(
                        message=msg, user=user,
                    )
                    if user.id in channel_member_ids:
                        Notification.objects.create(
                            user=user,
                            notification_type='mention',
                            message=msg,
                            channel_id=channel_id,
                            actor=self.user,
                        )
                        # Send mention email notification
                        from notifications.tasks import send_mention_notification_email
                        from django.conf import settings as django_settings
                        frontend_url = getattr(django_settings, 'FRONTEND_URL', 'http://localhost:5174')
                        send_mention_notification_email.delay(
                            recipient_user_id=user.id,
                            mentioner_username=self.user.username,
                            message_text=content[:500],
                            context_label='a chat message',
                            content_url=f'{frontend_url}/chat',
                        )

        # Reply notification
        if reply_to_msg and reply_to_msg.author_id != self.user.id:
            Notification.objects.create(
                user=reply_to_msg.author,
                notification_type='reply',
                message=msg,
                channel_id=channel_id,
                actor=self.user,
            )

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
            for u in mentioned_users if u.id != self.user.id
        ]

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
