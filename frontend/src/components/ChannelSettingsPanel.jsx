import { useState, useCallback, useEffect } from 'react'
import { apiFetch } from '../hooks/useApi'
import AvatarDisplay from './AvatarDisplay'

export default function ChannelSettingsPanel({ channelId, onClose, onDeleted, onLeft }) {
  const [channel, setChannel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [showAddMember, setShowAddMember] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const fetchDetail = useCallback(async () => {
    try {
      const data = await apiFetch(`/chat/channels/${channelId}/`)
      setChannel(data)
      setName(data.name)
      setDescription(data.description || '')
    } catch { /* ignore */ }
    setLoading(false)
  }, [channelId])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  const handleSaveName = useCallback(async () => {
    if (!name.trim()) return
    await apiFetch(`/chat/channels/${channelId}/`, {
      method: 'PATCH',
      body: { name: name.trim() },
    })
    setEditingName(false)
    fetchDetail()
  }, [channelId, name, fetchDetail])

  const handleSaveDesc = useCallback(async () => {
    await apiFetch(`/chat/channels/${channelId}/`, {
      method: 'PATCH',
      body: { description: description.trim() },
    })
    setEditingDesc(false)
    fetchDetail()
  }, [channelId, description, fetchDetail])

  const handleRemoveMember = useCallback(async (userId) => {
    await apiFetch(`/chat/channels/${channelId}/members/${userId}/`, {
      method: 'DELETE',
    })
    fetchDetail()
  }, [channelId, fetchDetail])

  const handleDelete = useCallback(async () => {
    await apiFetch(`/chat/channels/${channelId}/`, { method: 'DELETE' })
    onDeleted()
  }, [channelId, onDeleted])

  const handleLeave = useCallback(async () => {
    await apiFetch(`/chat/channels/${channelId}/leave/`, { method: 'DELETE' })
    onLeft()
  }, [channelId, onLeft])

  const handleSearch = useCallback(async (q) => {
    setSearchQuery(q)
    if (q.trim().length < 1) { setSearchResults([]); return }
    setSearching(true)
    try {
      const data = await apiFetch(`/users/search/?q=${encodeURIComponent(q.trim())}`)
      setSearchResults(data || [])
    } catch { setSearchResults([]) }
    setSearching(false)
  }, [])

  const handleAddMember = useCallback(async (userId) => {
    await apiFetch(`/chat/channels/${channelId}/members/`, {
      method: 'POST',
      body: { user_id: userId },
    })
    setSearchQuery('')
    setSearchResults([])
    setShowAddMember(false)
    fetchDetail()
  }, [channelId, fetchDetail])

  if (loading) {
    return (
      <div className="w-72 border-l border-[var(--cyber-border)] bg-[var(--cyber-surface)] p-4">
        <p className="text-xs text-[var(--cyber-text-dim)]">Loading...</p>
      </div>
    )
  }

  if (!channel) return null

  const isOwner = channel.is_owner
  const memberIds = new Set((channel.members || []).map(m => m.id))

  return (
    <div className="w-72 border-l border-[var(--cyber-border)] bg-[var(--cyber-surface)] flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--cyber-border)] flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--cyber-text)]">Channel Settings</span>
        <button onClick={onClose} className="text-[var(--cyber-text-dim)] hover:text-white text-lg">&times;</button>
      </div>

      <div className="p-4 space-y-4">
        {/* Channel Name */}
        <div>
          <label className="block text-[10px] text-[var(--cyber-text-dim)] uppercase tracking-wider mb-1">Name</label>
          {editingName ? (
            <div className="flex gap-1">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="cyber-input flex-1 px-3 py-1 text-sm"
                autoFocus
                maxLength={100}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
              />
              <button onClick={handleSaveName} className="text-xs text-[var(--cyber-cyan)] px-2">Save</button>
              <button onClick={() => { setEditingName(false); setName(channel.name) }} className="text-xs text-[var(--cyber-text-dim)] px-1">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--cyber-text)]">#{channel.name}</span>
              {isOwner && (
                <button onClick={() => setEditingName(true)} className="text-[10px] text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]">Edit</button>
              )}
            </div>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-[10px] text-[var(--cyber-text-dim)] uppercase tracking-wider mb-1">Description</label>
          {editingDesc ? (
            <div className="space-y-1">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="cyber-textarea w-full px-3 py-2 text-sm resize-none"
                rows={3}
                autoFocus
              />
              <div className="flex gap-1">
                <button onClick={handleSaveDesc} className="text-xs text-[var(--cyber-cyan)]">Save</button>
                <button onClick={() => { setEditingDesc(false); setDescription(channel.description || '') }} className="text-xs text-[var(--cyber-text-dim)]">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <p className="text-xs text-[var(--cyber-text-dim)] flex-1">
                {channel.description || 'No description'}
              </p>
              {isOwner && (
                <button onClick={() => setEditingDesc(true)} className="text-[10px] text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] flex-shrink-0">Edit</button>
              )}
            </div>
          )}
        </div>

        {/* Privacy */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--cyber-text-dim)]">
            {channel.is_private ? '🔒 Private' : '🌐 Public'}
          </span>
          {isOwner && (
            <button
              onClick={async () => {
                await apiFetch(`/chat/channels/${channelId}/`, {
                  method: 'PATCH',
                  body: { is_private: !channel.is_private },
                })
                fetchDetail()
              }}
              className="text-[10px] text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]"
            >
              {channel.is_private ? 'Make Public' : 'Make Private'}
            </button>
          )}
        </div>

        {/* Members */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] text-[var(--cyber-text-dim)] uppercase tracking-wider">
              Members ({channel.members?.length || 0})
            </label>
            <button
              onClick={() => setShowAddMember(!showAddMember)}
              className="text-[10px] text-[var(--cyber-cyan)] hover:underline"
            >
              {showAddMember ? 'Cancel' : '+ Add'}
            </button>
          </div>

          {showAddMember && (
            <div className="mb-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search users..."
                className="cyber-input w-full px-3 py-1.5 text-xs mb-1"
                autoFocus
              />
              {searching && <p className="text-[10px] text-[var(--cyber-text-dim)] text-center py-1">Searching...</p>}
              {searchResults
                .filter(u => !memberIds.has(u.id))
                .map(user => (
                  <button
                    key={user.id}
                    onClick={() => handleAddMember(user.id)}
                    className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg
                      hover:bg-[var(--cyber-surface-2)] transition-colors text-xs"
                  >
                    <AvatarDisplay
                      user={{ avatar_preset: user.avatar_preset, username: user.username }}
                      size="w-6 h-6"
                      textSize="text-[8px]"
                    />
                    <span className="text-[var(--cyber-text)]">{user.username}</span>
                  </button>
                ))}
            </div>
          )}

          <div className="space-y-1">
            {(channel.members || []).map(member => (
              <div key={member.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg">
                <AvatarDisplay
                  user={{ avatar_preset: member.avatar_preset, username: member.username }}
                  size="w-7 h-7"
                  textSize="text-[9px]"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-[var(--cyber-text)] truncate block">{member.username}</span>
                  {member.role === 'owner' && (
                    <span className="text-[9px] text-[var(--cyber-cyan)]">Owner</span>
                  )}
                </div>
                {isOwner && member.role !== 'owner' && (
                  <button
                    onClick={() => handleRemoveMember(member.id)}
                    className="text-[10px] text-red-400 hover:text-red-300 flex-shrink-0"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="border-t border-[var(--cyber-border)] pt-4 space-y-2">
          <button
            onClick={handleLeave}
            className="w-full text-left text-xs text-red-400 hover:text-red-300 py-1"
          >
            Leave Channel
          </button>
          {isOwner && (
            confirmDelete ? (
              <div className="space-y-1">
                <p className="text-[10px] text-red-400">Delete this channel and all messages?</p>
                <div className="flex gap-2">
                  <button onClick={handleDelete} className="text-xs text-red-400 font-semibold hover:text-red-300">Yes, Delete</button>
                  <button onClick={() => setConfirmDelete(false)} className="text-xs text-[var(--cyber-text-dim)]">Cancel</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full text-left text-xs text-red-400 hover:text-red-300 py-1"
              >
                Delete Channel
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}
