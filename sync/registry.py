"""
Sync model registry — maps model name strings to their Model class,
sync serializer, file fields, and dependency order.

Used by the sync engine to generically process push/pull records
without hardcoding model references everywhere.
"""

from collections import OrderedDict

from caves.models import Cave, CavePhoto, CaveComment, DescriptionRevision
from mapping.models import PointOfInterest
from sensors.models import SensorAlert
from .sync_serializers import (
    SyncCaveSerializer, SyncCavePhotoSerializer, SyncCaveCommentSerializer,
    SyncDescriptionRevisionSerializer, SyncPointOfInterestSerializer,
    SyncSensorAlertSerializer,
)


class ModelRegistryEntry:
    __slots__ = ('model', 'serializer', 'file_fields', 'dependencies')

    def __init__(self, model, serializer, file_fields=None, dependencies=None):
        self.model = model
        self.serializer = serializer
        self.file_fields = file_fields or []
        self.dependencies = dependencies or []


# OrderedDict preserves sync order — models must be synced in dependency order.
# Cave first (no deps), then models that FK to Cave, then SensorAlert.
SYNC_REGISTRY = OrderedDict([
    ('Cave', ModelRegistryEntry(
        model=Cave,
        serializer=SyncCaveSerializer,
        file_fields=['cover_photo'],
    )),
    ('CavePhoto', ModelRegistryEntry(
        model=CavePhoto,
        serializer=SyncCavePhotoSerializer,
        file_fields=['image'],
        dependencies=['Cave'],
    )),
    ('CaveComment', ModelRegistryEntry(
        model=CaveComment,
        serializer=SyncCaveCommentSerializer,
        dependencies=['Cave'],
    )),
    ('DescriptionRevision', ModelRegistryEntry(
        model=DescriptionRevision,
        serializer=SyncDescriptionRevisionSerializer,
        dependencies=['Cave'],
    )),
    ('PointOfInterest', ModelRegistryEntry(
        model=PointOfInterest,
        serializer=SyncPointOfInterestSerializer,
        file_fields=['photo'],
        dependencies=['Cave', 'CavePhoto'],
    )),
    ('SensorAlert', ModelRegistryEntry(
        model=SensorAlert,
        serializer=SyncSensorAlertSerializer,
        dependencies=['Cave'],
    )),
])


def get_registry_entry(model_name):
    """Look up a registry entry by model name. Returns None if not found."""
    return SYNC_REGISTRY.get(model_name)


def get_model_name(model_class):
    """Reverse lookup: get the registry key for a model class."""
    for name, entry in SYNC_REGISTRY.items():
        if entry.model is model_class:
            return name
    return None


def get_syncable_models():
    """Return list of (model_name, model_class) in sync order."""
    return [(name, entry.model) for name, entry in SYNC_REGISTRY.items()]
