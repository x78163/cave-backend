"""
Signed action tokens for one-click email actions.

Generates and verifies cryptographically signed tokens that encode an action
(e.g., approve cave access, RSVP to event) so users can act directly from email
without logging in. Tokens expire after a configurable duration.
"""

from django.conf import settings
from django.core import signing

# Default token expiry: 7 days
TOKEN_MAX_AGE = 7 * 24 * 3600

SALT = 'email-action'


def make_action_token(action, **kwargs):
    """Create a signed action token.

    Args:
        action: String identifying the action (e.g., 'cave_access_approve')
        **kwargs: Action-specific data (user_id, cave_id, request_id, etc.)

    Returns:
        URL-safe signed string.
    """
    payload = {'action': action, **kwargs}
    return signing.dumps(payload, salt=SALT)


def verify_action_token(token, max_age=TOKEN_MAX_AGE):
    """Verify and decode a signed action token.

    Args:
        token: The signed token string.
        max_age: Max age in seconds (default 7 days).

    Returns:
        Dict with action and action-specific data.

    Raises:
        signing.BadSignature: If token is invalid or expired.
    """
    return signing.loads(token, salt=SALT, max_age=max_age)


def make_action_url(action, **kwargs):
    """Create a full URL for an email action.

    Returns a URL like: https://cavedragon.llc/api/notifications/action?token=...
    """
    token = make_action_token(action, **kwargs)
    base_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5174')
    # Point to backend API — it processes the action then redirects to frontend
    return f'{base_url.rstrip("/")}/api/notifications/action?token={token}'


def make_unsubscribe_url(user_id, category=None):
    """Create an unsubscribe URL for email footer."""
    kwargs = {'user_id': user_id}
    if category:
        kwargs['category'] = category
    return make_action_url('unsubscribe', **kwargs)
