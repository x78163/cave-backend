import { useState, useEffect } from 'react'
import { apiFetch } from '../hooks/useApi'

export default function EventInviteModal({ eventId, onClose }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [users, setUsers] = useState([])
  const [grottos, setGrottos] = useState([])
  const [tab, setTab] = useState('users')
  const [sending, setSending] = useState(null)
  const [sent, setSent] = useState(new Set())

  // Search users
  useEffect(() => {
    if (searchQuery.length < 1 || tab !== 'users') { setUsers([]); return }
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch(`/users/search/?q=${encodeURIComponent(searchQuery)}`)
        setUsers(Array.isArray(data) ? data : data?.results || [])
      } catch { setUsers([]) }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, tab])

  // Fetch grottos
  useEffect(() => {
    if (tab !== 'grottos') return
    apiFetch('/users/grottos/')
      .then(data => setGrottos(Array.isArray(data) ? data : data?.results || []))
      .catch(() => {})
  }, [tab])

  const handleInvite = async (type, id) => {
    const key = `${type}-${id}`
    if (sent.has(key)) return
    setSending(key)
    try {
      const body = type === 'user' ? { user_id: id } : { grotto_id: id }
      await apiFetch(`/events/${eventId}/invitations/`, { method: 'POST', body })
      setSent(prev => new Set(prev).add(key))
    } catch (err) {
      console.error('Invite failed:', err)
    } finally {
      setSending(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-md bg-[var(--cyber-surface)] border border-[var(--cyber-border)]
        rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>

        <div className="px-5 py-4 border-b border-[var(--cyber-border)] flex items-center justify-between">
          <h2 className="text-base font-bold">Invite to Event</h2>
          <button onClick={onClose} className="text-[var(--cyber-text-dim)] hover:text-white text-xl">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--cyber-border)]">
          {['users', 'grottos'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 text-sm py-2.5 capitalize transition-colors ${
                tab === t
                  ? 'text-[var(--cyber-cyan)] border-b-2 border-[var(--cyber-cyan)]'
                  : 'text-[var(--cyber-text-dim)]'
              }`}>
              {t}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'users' && (
            <>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="cyber-input w-full px-4 py-2 text-sm mb-3"
                placeholder="Search users..."
                autoFocus
              />
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {users.map(u => {
                  const key = `user-${u.id}`
                  return (
                    <div key={u.id} className="flex items-center justify-between py-1.5">
                      <span className="text-sm">{u.username}</span>
                      <button
                        onClick={() => handleInvite('user', u.id)}
                        disabled={sending === key || sent.has(key)}
                        className={`text-xs px-3 py-1 rounded-full transition-all ${
                          sent.has(key)
                            ? 'bg-green-900/30 text-green-400 border border-green-700/30'
                            : 'cyber-btn cyber-btn-ghost'
                        }`}
                      >
                        {sent.has(key) ? 'Sent' : sending === key ? '...' : 'Invite'}
                      </button>
                    </div>
                  )
                })}
                {searchQuery && users.length === 0 && (
                  <p className="text-xs text-[var(--cyber-text-dim)] text-center py-4">No users found</p>
                )}
              </div>
            </>
          )}

          {tab === 'grottos' && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {grottos.map(g => {
                const key = `grotto-${g.id}`
                return (
                  <div key={g.id} className="flex items-center justify-between py-1.5">
                    <span className="text-sm">{g.name}</span>
                    <button
                      onClick={() => handleInvite('grotto', g.id)}
                      disabled={sending === key || sent.has(key)}
                      className={`text-xs px-3 py-1 rounded-full transition-all ${
                        sent.has(key)
                          ? 'bg-green-900/30 text-green-400 border border-green-700/30'
                          : 'cyber-btn cyber-btn-ghost'
                      }`}
                    >
                      {sent.has(key) ? 'Sent' : sending === key ? '...' : 'Invite'}
                    </button>
                  </div>
                )
              })}
              {grottos.length === 0 && (
                <p className="text-xs text-[var(--cyber-text-dim)] text-center py-4">No grottos available</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
