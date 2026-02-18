"""
Sync engine — core logic for processing push and pull operations.

Handles creating/updating/deleting records from device data,
building pull responses from DataDeltas, and managing sync context
to prevent signal loops.
"""

import logging

from django.db import transaction

from .models import SyncSession, SyncLog, DataDelta
from .registry import get_registry_entry, SYNC_REGISTRY
from .signals import set_sync_context, clear_sync_context

logger = logging.getLogger(__name__)


class SyncEngine:

    def __init__(self, session):
        self.session = session
        self.device = session.device

    def log(self, level, message, model_name='', record_id=None):
        """Write a SyncLog entry."""
        SyncLog.objects.create(
            session=self.session,
            level=level,
            message=message,
            model_name=model_name,
            record_id=record_id,
        )

    def process_push(self, records):
        """
        Process a batch of records pushed from the device.

        Each record is a dict with:
            model_name: str (e.g. "Cave")
            action: str ("create", "update", "delete")
            data: dict (field values)

        Returns (processed_count, errors_list).
        """
        processed = 0
        errors = []

        # Sort records by sync order so dependencies are created first
        sync_order = list(SYNC_REGISTRY.keys())
        sorted_records = sorted(
            records,
            key=lambda r: sync_order.index(r['model_name']) if r['model_name'] in sync_order else 999,
        )

        for record in sorted_records:
            model_name = record.get('model_name', '')
            action = record.get('action', '')
            data = record.get('data', {})

            entry = get_registry_entry(model_name)
            if not entry:
                err = f"Unknown model: {model_name}"
                errors.append({'model_name': model_name, 'error': err})
                self.log('error', err, model_name=model_name)
                continue

            # Use savepoint so one failure doesn't roll back the whole batch
            sid = transaction.savepoint()
            try:
                set_sync_context(self.device)

                if action == 'delete':
                    self._process_delete(entry, data, model_name)
                else:
                    self._process_upsert(entry, data, model_name, action)

                transaction.savepoint_commit(sid)
                processed += 1

            except Exception as e:
                transaction.savepoint_rollback(sid)
                record_id = data.get('id', '')
                err = f"{action} {model_name} {record_id}: {str(e)}"
                errors.append({
                    'model_name': model_name,
                    'record_id': str(record_id),
                    'error': str(e),
                })
                self.log('error', err, model_name=model_name, record_id=record_id or None)
                logger.warning("Sync push error: %s", err)

            finally:
                clear_sync_context()

        # Update session counters
        self.session.records_pushed += processed
        self.session.save(update_fields=['records_pushed'])

        return processed, errors

    def _process_upsert(self, entry, data, model_name, action):
        """Create or update a record."""
        record_id = data.get('id')

        # Inject origin_device
        data['origin_device'] = str(self.device.pk)

        if record_id:
            # Try to find existing record
            try:
                instance = entry.model.objects.get(pk=record_id)
                serializer = entry.serializer(instance, data=data, partial=True)
            except entry.model.DoesNotExist:
                # Device says update but record doesn't exist — create it
                serializer = entry.serializer(data=data)
        else:
            serializer = entry.serializer(data=data)

        serializer.is_valid(raise_exception=True)
        instance = serializer.save()

        actual_action = 'updated' if record_id and entry.model.objects.filter(pk=record_id).exists() else 'created'
        self.log('info', f'{actual_action} {model_name}', model_name=model_name, record_id=instance.pk)

    def _process_delete(self, entry, data, model_name):
        """Delete a record by UUID."""
        record_id = data.get('id')
        if not record_id:
            raise ValueError("Delete action requires 'id' in data")

        try:
            instance = entry.model.objects.get(pk=record_id)
            instance.delete()
            self.log('info', f'deleted {model_name}', model_name=model_name, record_id=record_id)
        except entry.model.DoesNotExist:
            # Already deleted — not an error for sync
            self.log('warning', f'{model_name} {record_id} already deleted', model_name=model_name, record_id=record_id)

    def process_pull(self, since_timestamp=None):
        """
        Build pull response — all DataDeltas since the given timestamp
        that didn't originate from this device.

        Returns list of delta dicts with embedded record data.
        """
        qs = DataDelta.objects.all()

        if since_timestamp:
            qs = qs.filter(timestamp__gt=since_timestamp)

        # Exclude changes that came from this device
        qs = qs.exclude(source_device=self.device)

        # Order by timestamp ascending so device processes in order
        qs = qs.order_by('timestamp')

        deltas = []
        file_records = []  # Records that have files to download

        for delta in qs:
            entry = get_registry_entry(delta.model_name)
            if not entry:
                continue

            delta_dict = {
                'id': str(delta.id),
                'model_name': delta.model_name,
                'record_id': str(delta.record_id),
                'action': delta.action,
                'timestamp': delta.timestamp.isoformat(),
            }

            if delta.action == DataDelta.Action.DELETE:
                delta_dict['data'] = None
            else:
                # Serialize the current record state
                try:
                    instance = entry.model.objects.get(pk=delta.record_id)
                    serializer = entry.serializer(instance)
                    delta_dict['data'] = serializer.data

                    # Check if this record has file fields with data
                    if entry.file_fields:
                        for field_name in entry.file_fields:
                            field_val = getattr(instance, field_name, None)
                            if field_val:
                                file_records.append({
                                    'model_name': delta.model_name,
                                    'record_id': str(delta.record_id),
                                    'field_name': field_name,
                                })
                except entry.model.DoesNotExist:
                    # Record was deleted after delta was created
                    delta_dict['action'] = 'delete'
                    delta_dict['data'] = None

            deltas.append(delta_dict)

            # Mark delta as processed by this session
            delta.sync_session = self.session
            delta.save(update_fields=['sync_session'])

        # Update session counters
        self.session.records_pulled += len(deltas)
        self.session.save(update_fields=['records_pulled'])

        return deltas, file_records
