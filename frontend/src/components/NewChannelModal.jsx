import { useState, useCallback } from 'react'
import { apiFetch } from '../hooks/useApi'

export default function NewChannelModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  const handleCreate = useCallback(async (e) => {
    e.preventDefault()
    if (!name.trim()) return

    setCreating(true)
    setError(null)
    try {
      const data = await apiFetch('/chat/channels/', {
        method: 'POST',
        body: { name: name.trim(), description: description.trim() },
      })
      onCreated(data.id)
    } catch (err) {
      setError('Failed to create channel')
      setCreating(false)
    }
  }, [name, description, onCreated])

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--cyber-surface)] border border-[var(--cyber-border)] rounded-2xl w-full max-w-md mx-4 shadow-2xl">
        <div className="px-5 py-4 border-b border-[var(--cyber-border)] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--cyber-text)]">New Channel</h3>
          <button onClick={onClose} className="text-[var(--cyber-text-dim)] hover:text-white text-lg">&times;</button>
        </div>

        <form onSubmit={handleCreate} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-[var(--cyber-text-dim)] mb-1">Channel Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. trip-planning"
              className="cyber-input w-full px-4 py-2 text-sm"
              autoFocus
              maxLength={100}
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--cyber-text-dim)] mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this channel about?"
              className="cyber-input w-full px-4 py-2 text-sm resize-none"
              rows={2}
              style={{ borderRadius: '1rem' }}
            />
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="cyber-btn cyber-btn-ghost px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || creating}
              className="cyber-btn cyber-btn-cyan px-4 py-2 text-sm disabled:opacity-40"
            >
              {creating ? 'Creating...' : 'Create Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
