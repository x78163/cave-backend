/**
 * Video URL parsing utility — detects platform, extracts video ID,
 * generates embed URL and thumbnail URL.
 * Mirrors backend caves/video_utils.py for instant client-side preview.
 */

const PLATFORM_PATTERNS = {
  youtube: [
    /(?:youtube\.com\/watch\?.*v=)([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /youtube\.com\/embed\/([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
  ],
  vimeo: [
    /vimeo\.com\/(\d+)/,
    /player\.vimeo\.com\/video\/(\d+)/,
  ],
  tiktok: [
    /tiktok\.com\/@[\w.]+\/video\/(\d+)/,
    /vm\.tiktok\.com\/([\w]+)/,
  ],
  facebook: [
    /facebook\.com\/.*\/videos\/(\d+)/,
    /fb\.watch\/([\w]+)/,
  ],
}

const EMBED_TEMPLATES = {
  youtube: (id) => `https://www.youtube.com/embed/${id}`,
  vimeo: (id) => `https://player.vimeo.com/video/${id}`,
  tiktok: (id) => `https://www.tiktok.com/embed/v2/${id}`,
  facebook: (_id, url) => `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}`,
}

const THUMBNAIL_TEMPLATES = {
  youtube: (id) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
}

export function parseVideoUrl(url) {
  if (!url) return null
  url = url.trim()

  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match) {
        const videoId = match[1]
        const embedFn = EMBED_TEMPLATES[platform]
        const thumbFn = THUMBNAIL_TEMPLATES[platform]
        return {
          platform,
          videoId,
          embedUrl: embedFn ? embedFn(videoId, url) : '',
          thumbnailUrl: thumbFn ? thumbFn(videoId) : '',
        }
      }
    }
  }

  return { platform: 'other', videoId: '', embedUrl: '', thumbnailUrl: '' }
}

export const PLATFORM_LABELS = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  other: 'Video',
}

export const PLATFORM_COLORS = {
  youtube: 'text-red-400 bg-red-900/30 border-red-800/30',
  vimeo: 'text-blue-400 bg-blue-900/30 border-blue-800/30',
  tiktok: 'text-pink-400 bg-pink-900/30 border-pink-800/30',
  facebook: 'text-blue-300 bg-blue-900/30 border-blue-800/30',
  other: 'text-[var(--cyber-text-dim)] bg-[var(--cyber-surface-2)] border-[var(--cyber-border)]',
}
