import { useState, useCallback, useEffect } from 'react'
import { apiFetch } from '../hooks/useApi'

export default function BrowseChannelsModal({ onClose, onJoined }) {
  const [query, setQuery] = useState('')
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(null)

  const fetchChannels = useCallback(async (q = '') => {
    setLoading(true)
    try {
      const params = q ? `?q=${encodeURIComponent(q)}` : ''
      const data = await apiFetch(`/chat/browse/${params}`)
      setChannels(data || [])
    } catch { setChannels([]) }
    setLoading(false)
  }, [])

  useEffect(() => { fetchChannels() }, [fetchChannels])

  const handleSearch = useCallback((q) => {
    setQuery(q)
    fetchChannels(q.trim())
  }, [fetchChannels])

  const handleJoin = useCallback(async (channelId) => {
    setJoining(channelId)
    try {
      await apiFetch(`/chat/channels/${channelId}/join/`, { method: 'POST' })
      onJoined(channelId)
    } catch {
      setJoining(null)
    }
  }, [onJoined])

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--cyber-surface)] border border-[var(--cyber-border)] rounded-2xl w-full max-w-lg mx-4 shadow-2xl max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[var(--cyber-border)] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--cyber-text)]">Browse Public Channels</h3>
          <button onClick={onClose} className="text-[var(--cyber-text-dim)] hover:text-white text-lg">&times;</button>
        </div>

        <div className="px-5 pt-4">
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search channels..."
            className="cyber-input w-full px-4 py-2 text-sm"
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {loading && (
            <p className="text-xs text-[var(--cyber-text-dim)] text-center py-4">Loading...</p>
          )}

          {!loading && channels.length === 0 && (
            <p className="text-xs text-[var(--cyber-text-dim)] text-center py-4">No public channels found</p>
          )}

          {channels.map(ch => (
            <div
              key={ch.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--cyber-border)]
                hover:border-cyan-700/30 transition-colors"
            >
              <span className="text-[var(--cyber-cyan)] text-lg font-medium">#</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[var(--cyber-text)] font-medium">{ch.name}</div>
                {ch.description && (
                  <p className="text-xs text-[var(--cyber-text-dim)] truncate mt-0.5">{ch.description}</p>
                )}
                <span className="text-[10px] text-[var(--cyber-text-dim)]">
                  {ch.member_count} member{ch.member_count !== 1 ? 's' : ''}
                </span>
              </div>
              {ch.is_member ? (
                <span className="text-[10px] text-[var(--cyber-cyan)] px-3 py-1 rounded-full border border-cyan-700/30">
                  Joined
                </span>
              ) : (
                <button
                  onClick={() => handleJoin(ch.id)}
                  disabled={joining === ch.id}
                  className="cyber-btn cyber-btn-cyan px-3 py-1 text-xs disabled:opacity-40"
                >
                  {joining === ch.id ? 'Joining...' : 'Join'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
