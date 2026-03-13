"""Expedition state machine — validates transitions, logs changes, triggers side effects."""

import logging
from django.utils import timezone

from .models import ExpeditionTracking, ExpeditionStateLog

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Allowed transitions: {from_state: [to_state, ...]}
# ---------------------------------------------------------------------------
ALLOWED_TRANSITIONS = {
    'preparing':      ['active'],
    'active':         ['underground', 'completed'],
    'underground':    ['surfaced', 'overdue', 'completed'],
    'surfaced':       ['underground', 'completed'],
    'overdue':        ['alert_sent', 'surfaced', 'completed'],
    'alert_sent':     ['emergency_sent', 'surfaced', 'completed', 'resolved'],
    'emergency_sent': ['completed', 'resolved'],
    # Terminal states have no outgoing transitions
    'completed':      [],
    'resolved':       [],
}


def transition(tracking, to_state, user=None, note=''):
    """Attempt a state transition.  Returns True if successful, False if invalid.

    Creates an ExpeditionStateLog entry and updates state_changed_at.
    Also sets started_at / completed_at timestamps for key transitions.
    """
    from_state = tracking.state

    if to_state not in ALLOWED_TRANSITIONS.get(from_state, []):
        logger.warning(
            'Invalid expedition transition %s -> %s (event %s)',
            from_state, to_state, tracking.event_id,
        )
        return False

    now = timezone.now()
    tracking.state = to_state
    tracking.state_changed_at = now

    # Set lifecycle timestamps
    if to_state == 'active' and not tracking.started_at:
        tracking.started_at = now
    elif to_state in ('completed', 'resolved'):
        tracking.completed_at = now

    tracking.save(update_fields=[
        'state', 'state_changed_at', 'started_at', 'completed_at', 'updated_at',
    ])

    ExpeditionStateLog.objects.create(
        tracking=tracking,
        from_state=from_state,
        to_state=to_state,
        triggered_by=user,
        note=note,
    )

    logger.info(
        'Expedition %s: %s -> %s (by %s)',
        tracking.event_id, from_state, to_state,
        user.username if user else 'system',
    )
    return True


def handle_gps_ping(tracking):
    """Called after a GPS point is saved.  Handles surfacing transitions.

    If the expedition is underground/overdue/alert_sent and we get a GPS ping,
    it means someone has signal again — transition to surfaced.
    """
    now = timezone.now()
    tracking.last_gps_at = now
    tracking.save(update_fields=['last_gps_at', 'updated_at'])

    surfaceable_states = ('underground', 'overdue', 'alert_sent')
    if tracking.state in surfaceable_states:
        transition(tracking, 'surfaced', note='GPS signal restored')
        return True
    return False


def extend_time(tracking, new_return, user=None):
    """Extend the expected return time.

    If currently overdue or alert_sent, reverts to underground (the party is
    still in the cave, just with a later deadline).
    """
    old_return = tracking.expected_return
    tracking.expected_return = new_return
    tracking.save(update_fields=['expected_return', 'updated_at'])

    note = f'Extended return from {old_return} to {new_return}'

    # If we were in an escalated state, revert to underground
    if tracking.state in ('overdue', 'alert_sent'):
        transition(tracking, 'underground' if tracking.state == 'overdue' else 'underground',
                   user=user, note=note)
    else:
        # Just log the extension without a state change
        ExpeditionStateLog.objects.create(
            tracking=tracking,
            from_state=tracking.state,
            to_state=tracking.state,
            triggered_by=user,
            note=note,
        )

    logger.info('Expedition %s: extended return to %s', tracking.event_id, new_return)
