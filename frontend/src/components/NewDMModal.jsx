import { useState, useCallback } from 'react'
import { apiFetch } from '../hooks/useApi'
import AvatarDisplay from './AvatarDisplay'

export default function NewDMModal({ onClose, onCreated }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  const handleSearch = useCallback(async (q) => {
    setQuery(q)
    if (q.trim().length < 1) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const data = await apiFetch(`/users/search/?q=${encodeURIComponent(q.trim())}`)
      setResults(data || [])
    } catch {
      setResults([])
    }
    setLoading(false)
  }, [])

  const handleSelect = useCallback(async (user) => {
    setCreating(true)
    try {
      const data = await apiFetch('/chat/dm/', {
        method: 'POST',
        body: { user_id: user.id },
      })
      onCreated(data.channel_id)
    } catch {
      setCreating(false)
    }
  }, [onCreated])

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--cyber-surface)] border border-[var(--cyber-border)] rounded-2xl w-full max-w-md mx-4 shadow-2xl">
        <div className="px-5 py-4 border-b border-[var(--cyber-border)] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--cyber-text)]">New Direct Message</h3>
          <button onClick={onClose} className="text-[var(--cyber-text-dim)] hover:text-white text-lg">&times;</button>
        </div>

        <div className="p-5">
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by username..."
            className="cyber-input w-full px-4 py-2 text-sm"
            autoFocus
          />

          <div className="mt-3 max-h-64 overflow-y-auto">
            {loading && (
              <p className="text-xs text-[var(--cyber-text-dim)] text-center py-4">Searching...</p>
            )}

            {!loading && results.length === 0 && query.length >= 1 && (
              <p className="text-xs text-[var(--cyber-text-dim)] text-center py-4">No users found</p>
            )}

            {results.map(user => (
              <button
                key={user.id}
                onClick={() => handleSelect(user)}
                disabled={creating}
                className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg
                  hover:bg-[var(--cyber-surface-2)] transition-colors disabled:opacity-50"
              >
                <AvatarDisplay
                  user={{ avatar_preset: user.avatar_preset, username: user.username }}
                  size="w-8 h-8"
                  textSize="text-xs"
                />
                <span className="text-sm text-[var(--cyber-text)]">{user.username}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
