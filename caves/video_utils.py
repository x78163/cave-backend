"""
Video URL parsing utility — detects platform, extracts video ID,
generates embed URL and thumbnail URL.
"""
import re

PLATFORM_PATTERNS = {
    'youtube': [
        r'(?:youtube\.com/watch\?.*v=)([\w-]{11})',
        r'youtu\.be/([\w-]{11})',
        r'youtube\.com/embed/([\w-]{11})',
        r'youtube\.com/shorts/([\w-]{11})',
    ],
    'vimeo': [
        r'vimeo\.com/(\d+)',
        r'player\.vimeo\.com/video/(\d+)',
    ],
    'tiktok': [
        r'tiktok\.com/@[\w.]+/video/(\d+)',
        r'vm\.tiktok\.com/([\w]+)',
    ],
    'facebook': [
        r'facebook\.com/.*/videos/(\d+)',
        r'fb\.watch/([\w]+)',
    ],
}

EMBED_TEMPLATES = {
    'youtube': 'https://www.youtube.com/embed/{video_id}',
    'vimeo': 'https://player.vimeo.com/video/{video_id}',
    'tiktok': 'https://www.tiktok.com/embed/v2/{video_id}',
}

THUMBNAIL_TEMPLATES = {
    'youtube': 'https://img.youtube.com/vi/{video_id}/hqdefault.jpg',
}


def parse_video_url(url):
    """Parse a video URL and return platform info.

    Returns dict with keys: platform, video_id, embed_url, thumbnail_url
    """
    url = (url or '').strip()

    for platform, patterns in PLATFORM_PATTERNS.items():
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                video_id = match.group(1)
                embed_url = EMBED_TEMPLATES.get(platform, '').format(video_id=video_id)
                thumbnail_url = THUMBNAIL_TEMPLATES.get(platform, '').format(video_id=video_id)

                # Facebook uses URL-based embed
                if platform == 'facebook':
                    from urllib.parse import quote
                    embed_url = f'https://www.facebook.com/plugins/video.php?href={quote(url, safe="")}'

                return {
                    'platform': platform,
                    'video_id': video_id,
                    'embed_url': embed_url,
                    'thumbnail_url': thumbnail_url,
                }

    return {
        'platform': 'other',
        'video_id': '',
        'embed_url': '',
        'thumbnail_url': '',
    }
