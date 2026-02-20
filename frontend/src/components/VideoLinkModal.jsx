import { useState, useEffect } from 'react'
import { apiFetch } from '../hooks/useApi'
import { parseVideoUrl, PLATFORM_LABELS, PLATFORM_COLORS } from '../utils/videoUtils'

export default function VideoLinkModal({ caveId, onComplete, onClose }) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [parsed, setParsed] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!url.trim()) { setParsed(null); return }
    const result = parseVideoUrl(url)
    setParsed(result)
  }, [url])

  const handleSubmit = async () => {
    if (!url.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch(`/caves/${caveId}/video-links/`, {
        method: 'POST',
        body: { url, title, description },
      })
      onComplete(res)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to add video')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center px-4"
      style={{ background: 'rgba(10, 10, 18, 0.92)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="cyber-card w-full max-w-md p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold">Add Video Link</h2>
          <button onClick={onClose} className="text-[var(--cyber-text-dim)] hover:text-white text-lg">&times;</button>
        </div>

        {/* URL input */}
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Paste YouTube, Vimeo, or TikTok URL..."
          className="cyber-input w-full px-4 py-2.5 text-sm"
          autoFocus
        />

        {/* Platform badge + thumbnail preview */}
        {parsed && parsed.platform !== 'other' && (
          <div className="space-y-2">
            <span className={`inline-block px-2.5 py-1 rounded-full text-xs border ${PLATFORM_COLORS[parsed.platform]}`}>
              {PLATFORM_LABELS[parsed.platform]}
            </span>
            {parsed.thumbnailUrl && (
              <img
                src={parsed.thumbnailUrl}
                alt="Thumbnail"
                className="w-full h-40 object-cover rounded-xl border border-[var(--cyber-border)]"
              />
            )}
          </div>
        )}

        {parsed && parsed.platform === 'other' && url.trim() && (
          <p className="text-amber-400 text-xs">
            Platform not recognized. The URL will be saved as a link.
          </p>
        )}

        {/* Title + description */}
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="cyber-input w-full px-4 py-2.5 text-sm"
        />
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Description (optional)..."
          className="cyber-input w-full px-4 py-2.5 text-sm resize-none"
          rows={2}
        />

        {error && <p className="text-red-400 text-xs">{error}</p>}

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full text-sm text-[var(--cyber-text-dim)]
              bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]
              hover:border-[var(--cyber-text-dim)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!url.trim() || submitting}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all
              ${url.trim()
                ? 'bg-gradient-to-r from-cyan-600 to-cyan-700 text-white shadow-[0_0_12px_rgba(0,229,255,0.2)]'
                : 'bg-[var(--cyber-surface-2)] text-[#555570]'}`}
          >
            {submitting ? 'Adding...' : 'Add Video'}
          </button>
        </div>
      </div>
    </div>
  )
}
