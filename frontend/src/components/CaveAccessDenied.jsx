import { useState } from 'react'
import { apiFetch } from '../hooks/useApi'

export default function CaveAccessDenied({ caveId, caveName, ownerUsername, visibility, user, navigate }) {
  const [requestSent, setRequestSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(null)

  const handleRequestAccess = async () => {
    setSending(true)
    setError(null)
    try {
      await apiFetch(`/caves/${caveId}/requests/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_type: 'cave_access',
          message: message.trim(),
        }),
      })
      setRequestSent(true)
    } catch (err) {
      const msg = err?.response?.data?.error || 'Failed to send request'
      setError(msg)
    }
    setSending(false)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--cyber-bg)] px-4">
      <div className="cyber-card p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-[#f59e0b] flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-[var(--cyber-text)] mb-2">{caveName}</h2>

        <span
          className="inline-block cyber-badge text-xs mb-4"
          style={{ borderColor: '#f59e0b', color: '#f59e0b' }}
        >
          {visibility === 'private' ? 'Private Cave' : 'Restricted Access'}
        </span>

        <p className="text-sm text-[var(--cyber-text-dim)] mb-6">
          This cave requires permission to view.
          {ownerUsername && (
            <> Contact the owner (<strong className="text-[var(--cyber-text)]">{ownerUsername}</strong>) or request access below.</>
          )}
        </p>

        {!user ? (
          <div>
            <p className="text-sm text-[var(--cyber-text-dim)] mb-4">
              Log in to request access to this cave.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="cyber-btn cyber-btn-cyan px-6 py-2"
            >
              Log In
            </button>
          </div>
        ) : requestSent ? (
          <div className="text-sm text-[#4ade80]">
            Access request sent! The cave owner will be notified.
          </div>
        ) : (
          <div>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Optional message to the cave owner..."
              className="w-full bg-[var(--cyber-surface)] border border-[var(--cyber-border)] rounded-lg p-3 text-sm text-[var(--cyber-text)] placeholder:text-[var(--cyber-text-dim)]/40 mb-3 resize-none"
              rows={3}
            />
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <button
              onClick={handleRequestAccess}
              disabled={sending}
              className="cyber-btn cyber-btn-cyan px-6 py-2 w-full"
            >
              {sending ? 'Sending...' : 'Request Access'}
            </button>
          </div>
        )}
      </div>

      <button
        onClick={() => navigate('/explore')}
        className="mt-6 text-sm text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] transition-colors"
      >
        Back to Explore
      </button>
    </div>
  )
}
