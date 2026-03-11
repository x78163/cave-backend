"""
Email sender utility — renders branded templates and sends via Django mail.

All notification emails go through this module so that:
- User preferences are checked before sending
- Branded HTML template is used consistently
- Unsubscribe links are included in every email
- Plain text fallback is auto-generated
"""

import logging

from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.html import strip_tags

from .tokens import make_unsubscribe_url

logger = logging.getLogger(__name__)


def send_notification_email(
    user,
    subject,
    template_name,
    context=None,
    preference_key=None,
):
    """Send a branded notification email to a user.

    Args:
        user: UserProfile instance (recipient).
        subject: Email subject line.
        template_name: Template path (e.g., 'emails/cave_access_request.html').
        context: Dict of template context variables.
        preference_key: NotificationPreference field name to check (e.g., 'cave_access_request').
                       If None, always sends (used for critical emails like verification).

    Returns:
        True if sent, False if skipped (preference disabled or no email).
    """
    if not user.email:
        logger.info('Skipping email to %s — no email address', user.username)
        return False

    # Check user preference (lazy-create prefs if needed)
    if preference_key:
        from users.models import NotificationPreference
        prefs = NotificationPreference.for_user(user)
        pref_value = getattr(prefs, preference_key, True)
        # For chat_digest, 'off' means disabled
        if pref_value is False or pref_value == 'off':
            logger.info(
                'Skipping %s email to %s — preference disabled',
                preference_key, user.username,
            )
            return False

    # Build context
    frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5174')
    ctx = {
        'frontend_url': frontend_url,
        'unsubscribe_url': make_unsubscribe_url(user.id, preference_key),
        'username': user.username,
        **(context or {}),
    }

    # Render HTML
    html_message = render_to_string(template_name, ctx)
    plain_message = strip_tags(html_message)

    try:
        send_mail(
            subject=subject,
            message=plain_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            html_message=html_message,
            fail_silently=False,
        )
        logger.info('Sent %s email to %s', template_name, user.email)
        return True
    except Exception:
        logger.exception('Failed to send %s email to %s', template_name, user.email)
        return False
