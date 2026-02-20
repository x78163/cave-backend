import { useState, useEffect } from 'react'

export default function DocumentViewer({ document, onClose }) {
  const [blobUrl, setBlobUrl] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let revoked = false
    fetch(document.file_url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then(blob => {
        if (revoked) return
        setBlobUrl(URL.createObjectURL(blob))
      })
      .catch(() => {
        if (!revoked) setError('Failed to load document')
      })
    return () => {
      revoked = true
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    }
  }, [document.file_url])

  return (
    <div className="carousel-overlay flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <button
          onClick={onClose}
          className="text-[var(--cyber-text-dim)] hover:text-white text-sm"
        >
          &larr; Close
        </button>
        <span className="text-white text-sm font-medium truncate max-w-[60%]">
          {document.title || 'Document'}
        </span>
        <a
          href={document.file_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--cyber-cyan)] text-sm hover:underline"
        >
          Open in New Tab
        </a>
      </div>

      {/* PDF viewer */}
      <div className="flex-1 min-h-0 px-4 pb-4">
        {error ? (
          <div className="w-full h-full rounded-xl border border-[var(--cyber-border)] flex items-center justify-center"
            style={{ background: '#1a1a2e' }}>
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        ) : blobUrl ? (
          <iframe
            src={blobUrl}
            title={document.title || 'Document'}
            className="w-full h-full rounded-xl border border-[var(--cyber-border)]"
            style={{ background: '#1a1a2e' }}
          />
        ) : (
          <div className="w-full h-full rounded-xl border border-[var(--cyber-border)] flex items-center justify-center"
            style={{ background: '#1a1a2e' }}>
            <p className="text-[var(--cyber-text-dim)] text-sm">Loading...</p>
          </div>
        )}
      </div>
    </div>
  )
}
