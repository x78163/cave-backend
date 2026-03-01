"""Auto-create Activity entries on social events via post_save signals."""

from django.db.models.signals import post_save
from django.dispatch import receiver

from caves.models import Cave, CavePhoto, CaveComment, DescriptionRevision
from chat.models import Channel, ChannelMembership, Message
from events.models import Event, EventRSVP, EventComment
from .models import Activity, Post, CaveRating, UserFollow, Expedition, ExpeditionMember


def _create_activity(actor, action_type, cave=None, target=None, message=''):
    """Helper to create an Activity entry."""
    if actor is None:
        return
    kwargs = {
        'actor': actor,
        'action_type': action_type,
        'cave': cave,
        'message': message,
    }
    if target:
        kwargs['target_model'] = target.__class__.__name__
        kwargs['target_id'] = target.pk
    Activity.objects.create(**kwargs)


@receiver(post_save, sender=Cave)
def cave_created_activity(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    if created and instance.owner:
        _create_activity(
            instance.owner, Activity.ActionType.CAVE_CREATED,
            cave=instance, target=instance,
            message=f'Created cave "{instance.name}"',
        )


@receiver(post_save, sender=CavePhoto)
def photo_uploaded_activity(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    if created and hasattr(instance, 'cave') and instance.cave.owner:
        _create_activity(
            instance.cave.owner, Activity.ActionType.PHOTO_UPLOADED,
            cave=instance.cave, target=instance,
            message=f'Uploaded a photo to "{instance.cave.name}"',
        )


@receiver(post_save, sender=CaveComment)
def comment_added_activity(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    if created and instance.author:
        _create_activity(
            instance.author, Activity.ActionType.COMMENT_ADDED,
            cave=instance.cave, target=instance,
            message=f'Commented on "{instance.cave.name}"',
        )


@receiver(post_save, sender=DescriptionRevision)
def description_edited_activity(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    if created and instance.editor:
        _create_activity(
            instance.editor, Activity.ActionType.DESCRIPTION_EDITED,
            cave=instance.cave, target=instance,
            message=f'Edited description of "{instance.cave.name}"',
        )


@receiver(post_save, sender=CaveRating)
def rating_posted_activity(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    if created:
        _create_activity(
            instance.user, Activity.ActionType.RATING_POSTED,
            cave=instance.cave, target=instance,
            message=f'Rated "{instance.cave.name}" {instance.rating}/5',
        )


@receiver(post_save, sender=UserFollow)
def user_followed_activity(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    if created:
        _create_activity(
            instance.follower, Activity.ActionType.USER_FOLLOWED,
            target=instance,
            message=f'Followed {instance.following}',
        )


@receiver(post_save, sender=Expedition)
def expedition_created_activity(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    if created:
        _create_activity(
            instance.organizer, Activity.ActionType.EXPEDITION_CREATED,
            cave=instance.cave, target=instance,
            message=f'Created expedition "{instance.name}"',
        )


@receiver(post_save, sender=ExpeditionMember)
def expedition_joined_activity(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    if not created and instance.status == 'confirmed':
        _create_activity(
            instance.user, Activity.ActionType.EXPEDITION_JOINED,
            cave=instance.expedition.cave, target=instance,
            message=f'Joined expedition "{instance.expedition.name}"',
        )


# ── Event signals ────────────────────────────────────────────


@receiver(post_save, sender=Event)
def event_created_activity(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    if created:
        _create_activity(
            instance.created_by, Activity.ActionType.EVENT_CREATED,
            cave=instance.cave, target=instance,
            message=f'Created event "{instance.name}"',
        )
        # Wall post
        Post.objects.create(
            author=instance.created_by,
            text='Created event',
            cave=instance.cave,
            event=instance,
            event_name_cache=instance.name,
        )
        # Auto-create chat channel for event discussion
        channel = Channel.objects.create(
            name=f'{instance.name} (event)',
            channel_type='channel',
            description=f'Discussion for event: {instance.name}',
            created_by=instance.created_by,
            is_private=False,
        )
        ChannelMembership.objects.create(
            channel=channel, user=instance.created_by, role='owner',
        )
        # First message with event link
        Message.objects.create(
            channel=channel,
            author=instance.created_by,
            content=f'This channel was created for the [event:/events/{instance.id}|{instance.name}] event.',
        )
        # Link channel to event (avoid re-triggering post_save)
        Event.objects.filter(pk=instance.pk).update(chat_channel=channel)


@receiver(post_save, sender=EventRSVP)
def event_rsvp_activity(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    if created and instance.status == 'going':
        _create_activity(
            instance.user, Activity.ActionType.EVENT_RSVP,
            cave=instance.event.cave, target=instance,
            message=f'Is attending "{instance.event.name}"',
        )
        Post.objects.create(
            author=instance.user,
            text='Is attending',
            cave=instance.event.cave,
            event=instance.event,
            event_name_cache=instance.event.name,
        )
        # Auto-add to event chat channel
        if instance.event.chat_channel_id:
            ChannelMembership.objects.get_or_create(
                channel_id=instance.event.chat_channel_id,
                user=instance.user,
                defaults={'role': 'member'},
            )


@receiver(post_save, sender=EventComment)
def event_commented_activity(sender, instance, created, raw=False, **kwargs):
    if raw:
        return
    if created:
        _create_activity(
            instance.author, Activity.ActionType.EVENT_COMMENTED,
            cave=instance.event.cave, target=instance,
            message=f'Commented on event "{instance.event.name}"',
        )
        Post.objects.create(
            author=instance.author,
            text=f'Commented on',
            cave=instance.event.cave,
            event=instance.event,
            event_name_cache=instance.event.name,
        )
