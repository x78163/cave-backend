"""Chat utility functions."""
import re
from caves.video_utils import parse_video_url

URL_PATTERN = re.compile(r'https?://\S+')


def extract_video_preview(content):
    """Extract the first video URL from message content.

    Returns a dict with platform info or None if no video found.
    """
    if not content:
        return None

    for match in URL_PATTERN.finditer(content):
        url = match.group(0).rstrip('.,;:!?')
        result = parse_video_url(url)
        if result and result['platform'] != 'other':
            result['original_url'] = url
            return result

    return None
