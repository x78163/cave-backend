import { PLATFORM_LABELS } from '../utils/videoUtils'

export default function VideoEmbed({ video, onClose }) {
  const aspectRatio = video.platform === 'tiktok' ? '9/16' : '16/9'

  if (!video.embed_url) {
    return (
      <div className="carousel-overlay flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
          <button onClick={onClose} className="text-[var(--cyber-text-dim)] hover:text-white text-sm">
            &larr; Close
          </button>
          <span className="text-white text-sm font-medium">{video.title || 'Video'}</span>
          <a href={video.url} target="_blank" rel="noopener noreferrer"
            className="text-[var(--cyber-cyan)] text-sm hover:underline">
            Open Link
          </a>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-[var(--cyber-text-dim)]">This video platform cannot be embedded.</p>
            <a href={video.url} target="_blank" rel="noopener noreferrer"
              className="inline-block px-5 py-2 rounded-full text-sm font-semibold
                bg-gradient-to-r from-cyan-600 to-cyan-700 text-white">
              Open in Browser
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="carousel-overlay flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <button onClick={onClose} className="text-[var(--cyber-text-dim)] hover:text-white text-sm">
          &larr; Close
        </button>
        <span className="text-white text-sm font-medium truncate max-w-[60%]">
          {video.title || PLATFORM_LABELS[video.platform] || 'Video'}
        </span>
        <a href={video.url} target="_blank" rel="noopener noreferrer"
          className="text-[var(--cyber-cyan)] text-sm hover:underline">
          Open Original
        </a>
      </div>

      {/* Embed */}
      <div className="flex-1 flex items-center justify-center px-4 pb-4">
        <div className={`w-full ${video.platform === 'tiktok' ? 'max-w-sm' : 'max-w-3xl'}`}
          style={{ aspectRatio }}>
          <iframe
            src={video.embed_url}
            title={video.title || 'Video'}
            className="w-full h-full rounded-xl border border-[var(--cyber-border)]"
            allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          />
        </div>
      </div>
    </div>
  )
}
