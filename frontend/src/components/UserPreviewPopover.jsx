import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../hooks/useApi'
import AvatarDisplay from './AvatarDisplay'

export default function UserPreviewPopover({ userId, anchorRect, onClose, currentUserId }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const ref = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch(`/users/profile/${userId}/`)
        if (!cancelled) setProfile(data)
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [userId])

  // Close on click outside (deferred)
  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClick) }
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleSendDM = async () => {
    try {
      const data = await apiFetch('/chat/dm/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      onClose()
      navigate(`/chat/${data.channel_id}`)
    } catch (err) {
      alert(err.message || 'Could not start DM')
    }
  }

  if (!anchorRect) return null

  // Position
  const style = {
    position: 'fixed',
    zIndex: 9999,
  }
  const cardW = 280
  const cardH = 260
  let top = anchorRect.bottom + 4
  let left = anchorRect.left
  if (top + cardH > window.innerHeight - 8) top = anchorRect.top - cardH - 4
  if (left + cardW > window.innerWidth - 8) left = window.innerWidth - cardW - 8
  if (left < 8) left = 8
  style.top = top + 'px'
  style.left = left + 'px'

  return createPortal(
    <div ref={ref} style={style} className="w-[280px] bg-[var(--cyber-surface)] border border-[var(--cyber-border)] rounded-lg shadow-xl overflow-hidden">
      {loading ? (
        <div className="p-6 text-center text-xs text-[var(--cyber-text-dim)]">Loading...</div>
      ) : profile ? (
        <div className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <AvatarDisplay
              user={profile}
              size="w-12 h-12"
              textSize="text-lg"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--cyber-text)] truncate">{profile.username}</p>
              {profile.location && (
                <p className="text-[11px] text-[var(--cyber-text-dim)] truncate">{profile.location}</p>
              )}
            </div>
          </div>
          {profile.bio && (
            <p className="text-xs text-[var(--cyber-text-dim)] line-clamp-2 mb-2">{profile.bio}</p>
          )}
          {profile.specialties?.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {profile.specialties.slice(0, 4).map((s, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--cyber-border)] text-[var(--cyber-text-dim)]">
                  {s}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => { onClose(); navigate(`/users/${userId}`) }}
              className="flex-1 text-xs py-1.5 rounded-lg border border-[var(--cyber-border)] text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50 transition-colors"
            >
              View Profile
            </button>
            {userId !== currentUserId && profile.allow_dms !== false && (
              <button
                onClick={handleSendDM}
                className="flex-1 text-xs py-1.5 rounded-lg border border-cyan-700/50 text-[var(--cyber-cyan)] hover:bg-cyan-900/20 transition-colors"
              >
                Send DM
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="p-6 text-center text-xs text-[var(--cyber-text-dim)]">User not found</div>
      )}
    </div>,
    document.body,
  )
}
