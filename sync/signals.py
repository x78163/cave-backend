"""
Django signals for automatic DataDelta creation.

When a syncable model is saved or deleted, a DataDelta record is created
so the pull endpoint knows what changed since a device's last sync.

Includes sync context suppression — when the sync engine is pushing data
from a device, we tag the DataDelta with source_device so the same device
doesn't pull back its own changes.
"""

import threading

from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

from caves.models import Cave, CavePhoto, CaveComment, DescriptionRevision
from mapping.models import PointOfInterest
from sensors.models import SensorAlert
from .models import DataDelta
from .registry import get_model_name

# Thread-local storage for sync context
_sync_context = threading.local()


def set_sync_context(device):
    """Mark the current thread as being in a sync push from the given device."""
    _sync_context.device = device


def clear_sync_context():
    """Clear the sync context for the current thread."""
    _sync_context.device = None


def get_sync_device():
    """Get the device currently pushing data, or None if not in sync context."""
    return getattr(_sync_context, 'device', None)


# All syncable models
SYNCABLE_MODELS = [Cave, CavePhoto, CaveComment, DescriptionRevision, PointOfInterest, SensorAlert]


def _handle_save(sender, instance, created, **kwargs):
    """Create a DataDelta when a syncable model is saved."""
    model_name = get_model_name(sender)
    if not model_name:
        return

    sync_device = get_sync_device()

    DataDelta.objects.create(
        model_name=model_name,
        record_id=instance.pk,
        action=DataDelta.Action.CREATE if created else DataDelta.Action.UPDATE,
        source_device=sync_device,
    )


def _handle_delete(sender, instance, **kwargs):
    """Create a DataDelta when a syncable model is deleted."""
    model_name = get_model_name(sender)
    if not model_name:
        return

    sync_device = get_sync_device()

    DataDelta.objects.create(
        model_name=model_name,
        record_id=instance.pk,
        action=DataDelta.Action.DELETE,
        source_device=sync_device,
    )


def connect_signals():
    """Connect post_save and post_delete signals for all syncable models."""
    for model in SYNCABLE_MODELS:
        post_save.connect(_handle_save, sender=model, dispatch_uid=f'sync_save_{model.__name__}')
        post_delete.connect(_handle_delete, sender=model, dispatch_uid=f'sync_delete_{model.__name__}')
