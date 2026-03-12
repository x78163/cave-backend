import { useState, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useApi, apiFetch } from '../hooks/useApi'
import PostCard from '../components/PostCard'
import PostComposer from '../components/PostComposer'
import AvatarDisplay from '../components/AvatarDisplay'
import useAuthStore from '../stores/authStore'

// Role colors
const ROLE_COLORS = {
  admin: 'var(--cyber-magenta)',
  officer: '#f59e0b',
  member: 'var(--cyber-border)',
}
const ROLE_TEXT_COLORS = {
  admin: 'var(--cyber-magenta)',
  officer: '#f59e0b',
  member: 'var(--cyber-text-dim)',
}

// ── Grotto List ─────────────────────────────────────────────

function GroupList() {
  const navigate = useNavigate()
  const { data, loading, refetch } = useApi('/users/grottos/')
  const grottos = data?.grottos ?? []
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      const grotto = await apiFetch('/users/grottos/', {
        method: 'POST',
        body: { name: name.trim(), description: description.trim() },
      })
      setName('')
      setDescription('')
      setShowCreate(false)
      navigate(`/grottos/${grotto.id}`)
    } catch { /* ignore */ }
    setCreating(false)
  }

  if (loading) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading grottos...</p>
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Grottos</h1>
        <button
          className="cyber-btn cyber-btn-cyan px-4 py-2 text-sm"
          onClick={() => setShowCreate(s => !s)}
        >
          {showCreate ? 'Cancel' : 'Create Grotto'}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="cyber-card p-5 mb-6">
          <input
            type="text"
            placeholder="Grotto name"
            value={name}
            onChange={e => setName(e.target.value)}
            className="cyber-input w-full px-4 py-2.5 mb-3"
          />
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            className="cyber-textarea w-full px-4 py-2.5 mb-3 resize-none"
          />
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="cyber-btn cyber-btn-cyan px-4 py-2 text-sm"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}

      {grottos.length === 0 ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">No grottos yet</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {grottos.map(g => (
            <Link
              key={g.id}
              to={`/grottos/${g.id}`}
              className="cyber-card p-5 no-underline block hover:border-[var(--cyber-cyan)]/30 transition-colors"
            >
              <h3 className="font-semibold text-[var(--cyber-text)] truncate">{g.name}</h3>
              <div className="flex gap-2 mt-2">
                <span
                  className="cyber-badge text-[10px]"
                  style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' }}
                >
                  {g.member_count ?? 0} members
                </span>
                <span
                  className="cyber-badge text-[10px]"
                  style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}
                >
                  {g.privacy ?? 'public'}
                </span>
                {g.user_membership?.status === 'active' && (
                  <span
                    className="cyber-badge text-[10px]"
                    style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)', background: 'rgba(0,255,255,0.08)' }}
                  >
                    Joined
                  </span>
                )}
              </div>
              {g.description && (
                <p className="text-xs text-[var(--cyber-text-dim)] mt-3 line-clamp-2">
                  {g.description}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Grotto Detail ───────────────────────────────────────────

function GroupDetail({ grottoId }) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const userId = user?.id
  const [activeTab, setActiveTab] = useState('wall')
  const { data: grotto, loading: grottoLoading, refetch: refetchGrotto } = useApi(`/users/grottos/${grottoId}/`)
  const { data: membersData, loading: membersLoading, refetch: refetchMembers } = useApi(`/users/grottos/${grottoId}/members/`)
  const { data: postsData, loading: postsLoading, refetch: refetchPosts } = useApi(`/social/posts/?grotto=${grottoId}`)

  // Tab data — lazy loaded
  const { data: cavesData, loading: cavesLoading } = useApi(activeTab === 'caves' ? `/users/grottos/${grottoId}/caves/` : null)
  const { data: eventsData, loading: eventsLoading } = useApi(activeTab === 'events' ? `/users/grottos/${grottoId}/events/` : null)
  const { data: mediaData, loading: mediaLoading } = useApi(activeTab === 'media' ? `/users/grottos/${grottoId}/media/` : null)

  const members = membersData?.members ?? []
  const posts = postsData?.results ?? []

  const myMembership = grotto?.user_membership
  const myRole = myMembership?.role
  const isAdmin = myRole === 'admin' && myMembership?.status === 'active'
  const isOfficerPlus = (myRole === 'admin' || myRole === 'officer') && myMembership?.status === 'active'
  const isMember = myMembership?.status === 'active'
  const isPending = myMembership?.status === 'pending_application' || grotto?.has_pending_request

  // State for edit mode
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [saving, setSaving] = useState(false)

  // State for invite modal
  const [showInvite, setShowInvite] = useState(false)
  const [inviteQuery, setInviteQuery] = useState('')
  const { data: searchResults } = useApi(inviteQuery.length >= 1 ? `/users/search/?q=${encodeURIComponent(inviteQuery)}` : null)
  const [inviting, setInviting] = useState(null)
  const [invitedIds, setInvitedIds] = useState(new Set())

  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState('')
  const [showApplyForm, setShowApplyForm] = useState(false)

  // Role change state
  const [changingRole, setChangingRole] = useState(null)

  const handleApply = useCallback(async () => {
    setApplying(true)
    try {
      await apiFetch(`/users/grottos/${grottoId}/apply/`, {
        method: 'POST',
        body: { message: applyMsg.trim() },
      })
      setShowApplyForm(false)
      refetchGrotto()
    } catch { /* ignore */ }
    setApplying(false)
  }, [grottoId, applyMsg, refetchGrotto])

  const handleLeave = useCallback(async () => {
    if (!confirm('Leave this grotto?')) return
    try {
      await apiFetch(`/users/grottos/${grottoId}/leave/`, { method: 'POST' })
      refetchGrotto()
      refetchMembers()
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to leave')
    }
  }, [grottoId, refetchGrotto, refetchMembers])

  const handleRemoveMember = useCallback(async (membershipId, username) => {
    if (!confirm(`Remove ${username} from the grotto?`)) return
    try {
      await apiFetch(`/users/grottos/${grottoId}/members/${membershipId}/`, { method: 'DELETE' })
      refetchMembers()
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to remove')
    }
  }, [grottoId, refetchMembers])

  const handleApproveMember = useCallback(async (membershipId) => {
    try {
      await apiFetch(`/users/grottos/${grottoId}/members/${membershipId}/`, {
        method: 'PATCH',
        body: { status: 'active' },
      })
      refetchMembers()
    } catch { /* ignore */ }
  }, [grottoId, refetchMembers])

  const handleRejectMember = useCallback(async (membershipId) => {
    try {
      await apiFetch(`/users/grottos/${grottoId}/members/${membershipId}/`, {
        method: 'PATCH',
        body: { status: 'rejected' },
      })
      refetchMembers()
    } catch { /* ignore */ }
  }, [grottoId, refetchMembers])

  const handleRoleChange = useCallback(async (membershipId, newRole) => {
    setChangingRole(membershipId)
    try {
      await apiFetch(`/users/grottos/${grottoId}/members/${membershipId}/`, {
        method: 'PATCH',
        body: { role: newRole },
      })
      refetchMembers()
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to change role')
    }
    setChangingRole(null)
  }, [grottoId, refetchMembers])

  const handleInviteUser = useCallback(async (targetUserId) => {
    setInviting(targetUserId)
    try {
      await apiFetch(`/users/grottos/${grottoId}/invite/`, {
        method: 'POST',
        body: { user_id: targetUserId },
      })
      setInvitedIds(prev => new Set([...prev, targetUserId]))
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to invite')
    }
    setInviting(null)
  }, [grottoId])

  const handleSaveEdit = useCallback(async () => {
    setSaving(true)
    try {
      await apiFetch(`/users/grottos/${grottoId}/`, {
        method: 'PATCH',
        body: { name: editName.trim(), description: editDesc.trim() },
      })
      setEditing(false)
      refetchGrotto()
    } catch { /* ignore */ }
    setSaving(false)
  }, [grottoId, editName, editDesc, refetchGrotto])

  const handleDeleteGroup = useCallback(async () => {
    if (!confirm('Delete this grotto? This cannot be undone.')) return
    try {
      await apiFetch(`/users/grottos/${grottoId}/`, { method: 'DELETE' })
      navigate('/grottos')
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to delete')
    }
  }, [grottoId, navigate])

  const handleDeletePost = useCallback(async (post) => {
    if (!confirm('Delete this post?')) return
    try {
      await apiFetch(`/social/posts/${post.id}/`, { method: 'DELETE' })
      refetchPosts()
    } catch { /* ignore */ }
  }, [refetchPosts])

  if (grottoLoading) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading grotto...</p>
  }

  if (!grotto) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">Grotto not found</p>
  }

  const activeMembers = members.filter(m => m.status === 'active')
  const pendingMembers = members.filter(m => m.status === 'pending_application')

  const TABS = [
    { key: 'wall', label: 'Wall' },
    { key: 'caves', label: 'Caves' },
    { key: 'events', label: 'Events' },
    { key: 'media', label: 'Media' },
    { key: 'members', label: `Members (${activeMembers.length})` },
  ]

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="cyber-card p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <Link to="/grottos" className="text-xs text-[var(--cyber-text-dim)] no-underline hover:text-[var(--cyber-cyan)]">
              &larr; All Grottos
            </Link>

            {editing ? (
              <div className="mt-2 space-y-2">
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="cyber-input w-full px-3 py-2 text-lg font-bold"
                />
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  className="cyber-textarea w-full px-3 py-2 text-sm resize-none"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button onClick={handleSaveEdit} disabled={saving || !editName.trim()}
                    className="cyber-btn cyber-btn-cyan px-3 py-1.5 text-xs">
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(false)}
                    className="text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-text)]">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-xl font-bold mt-1">{grotto.name}</h1>
                {grotto.description && (
                  <p className="text-sm text-[var(--cyber-text-dim)] mt-1">{grotto.description}</p>
                )}
                {grotto.created_by_username && (
                  <p className="text-xs text-[#555570] mt-1">
                    Created by{' '}
                    <span
                      className="text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] cursor-pointer"
                      onClick={() => navigate(`/users/${grotto.created_by}`)}
                    >
                      {grotto.created_by_username}
                    </span>
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex gap-2">
              <span className="cyber-badge" style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' }}>
                {activeMembers.length} members
              </span>
              <span className="cyber-badge" style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}>
                {grotto.privacy ?? 'public'}
              </span>
            </div>

            {/* Join / Pending / Leave / Edit */}
            {!myMembership && !isPending && (
              showApplyForm ? (
                <div className="flex flex-col items-end gap-1">
                  <textarea
                    value={applyMsg}
                    onChange={e => setApplyMsg(e.target.value)}
                    placeholder="Message (optional)..."
                    className="cyber-textarea px-2 py-1.5 text-xs resize-none w-48"
                    rows={2}
                  />
                  <div className="flex gap-1">
                    <button onClick={handleApply} disabled={applying}
                      className="cyber-btn cyber-btn-cyan px-3 py-1.5 text-xs">
                      {applying ? '...' : 'Send'}
                    </button>
                    <button onClick={() => setShowApplyForm(false)}
                      className="text-xs text-[var(--cyber-text-dim)]">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button className="cyber-btn cyber-btn-cyan px-3 py-1.5 text-xs" onClick={() => setShowApplyForm(true)}>
                  Apply to Join
                </button>
              )
            )}

            {isPending && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-amber-900/20 border border-amber-800/30 text-amber-400">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
                Application Pending
              </span>
            )}

            {isMember && !isAdmin && (
              <button onClick={handleLeave}
                className="text-xs text-red-400 hover:text-red-300 transition-colors">
                Leave Grotto
              </button>
            )}

            {isAdmin && (
              <div className="flex gap-2">
                <button onClick={() => { setEditName(grotto.name); setEditDesc(grotto.description || ''); setEditing(true) }}
                  className="text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] transition-colors">
                  Edit
                </button>
                <button onClick={handleDeleteGroup}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors">
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'text-[var(--cyber-bg)] bg-[var(--cyber-cyan)]'
                : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Wall tab */}
      {activeTab === 'wall' && (
        <>
          {isMember && (
            <PostComposer grottoId={grottoId} onPostCreated={refetchPosts} />
          )}
          {postsLoading ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading posts...</p>
          ) : posts.length === 0 ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-12">No grotto posts yet</p>
          ) : (
            <div className="space-y-4">
              {posts.map(post => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUserId={userId}
                  onReact={refetchPosts}
                  onDelete={handleDeletePost}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Caves tab */}
      {activeTab === 'caves' && (
        <div>
          {cavesLoading ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading caves...</p>
          ) : (cavesData?.caves ?? []).length === 0 ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-12">No caves yet</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(cavesData?.caves ?? []).map(cave => (
                <Link
                  key={cave.id}
                  to={`/caves/${cave.id}`}
                  className="cyber-card p-4 no-underline block hover:border-[var(--cyber-cyan)]/30 transition-colors"
                >
                  <h3 className="font-semibold text-sm text-[var(--cyber-text)] truncate">{cave.name}</h3>
                  <div className="flex gap-2 mt-2">
                    {cave.region && (
                      <span className="text-[10px] text-[var(--cyber-text-dim)]">{cave.city ? `${cave.city}, ` : ''}{cave.region}</span>
                    )}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <span
                      className="cyber-badge text-[10px]"
                      style={{
                        borderColor: cave.visibility === 'public' ? 'var(--cyber-cyan)' : cave.visibility === 'unlisted' ? '#a855f7' : 'var(--cyber-border)',
                        color: cave.visibility === 'public' ? 'var(--cyber-cyan)' : cave.visibility === 'unlisted' ? '#a855f7' : 'var(--cyber-text-dim)',
                      }}
                    >
                      {cave.visibility}
                    </span>
                    {cave.has_map && (
                      <span className="cyber-badge text-[10px]" style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' }}>
                        mapped
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Events tab */}
      {activeTab === 'events' && (
        <div>
          {eventsLoading ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading events...</p>
          ) : (eventsData?.events ?? []).length === 0 ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-12">No events yet</p>
          ) : (
            <div className="space-y-3">
              {(eventsData?.events ?? []).map(event => (
                <Link
                  key={event.id}
                  to={`/events/${event.id}`}
                  className="cyber-card p-4 no-underline block hover:border-[var(--cyber-cyan)]/30 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-[var(--cyber-text)]">{event.name}</h3>
                    <span
                      className="cyber-badge text-[10px]"
                      style={{ borderColor: '#f59e0b', color: '#f59e0b' }}
                    >
                      {event.event_type}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--cyber-text-dim)] mt-1">
                    {new Date(event.start_date).toLocaleDateString()}
                    {event.cave_name && <> &middot; {event.cave_name}</>}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Media tab */}
      {activeTab === 'media' && (
        <div>
          {mediaLoading ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading media...</p>
          ) : (mediaData?.media ?? []).length === 0 ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-12">No media yet</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {(mediaData?.media ?? []).map(photo => (
                <div key={photo.id} className="cyber-card overflow-hidden aspect-square">
                  <img
                    src={photo.image}
                    alt={photo.caption || 'Cave photo'}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Members tab */}
      {activeTab === 'members' && (
        <div>
          {isOfficerPlus && (
            <div className="flex justify-end mb-4">
              <button
                className="cyber-btn cyber-btn-cyan px-3 py-1.5 text-xs"
                onClick={() => setShowInvite(true)}
              >
                Invite Member
              </button>
            </div>
          )}

          {/* Invite modal */}
          {showInvite && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
              onClick={() => { setShowInvite(false); setInviteQuery('') }}>
              <div className="cyber-card p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
                <h3 className="font-semibold text-sm mb-3">Invite User</h3>
                <input
                  value={inviteQuery}
                  onChange={e => setInviteQuery(e.target.value)}
                  placeholder="Search by username..."
                  className="cyber-input w-full px-3 py-2 text-sm mb-2"
                  autoFocus
                />
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {(searchResults?.users ?? searchResults ?? []).map(u => {
                    const alreadyMember = members.some(m => m.user?.id === u.id && m.status === 'active')
                    const alreadyInvited = invitedIds.has(u.id)
                    return (
                      <div key={u.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--cyber-surface-2)]">
                        <div className="flex items-center gap-2">
                          <AvatarDisplay user={u} size="w-7 h-7" textSize="text-xs" />
                          <span className="text-sm text-[var(--cyber-text)]">{u.username}</span>
                        </div>
                        {alreadyMember ? (
                          <span className="text-[10px] text-[var(--cyber-text-dim)]">Already member</span>
                        ) : alreadyInvited ? (
                          <span className="text-[10px] text-amber-400">Invited</span>
                        ) : (
                          <button
                            onClick={() => handleInviteUser(u.id)}
                            disabled={inviting === u.id}
                            className="cyber-btn cyber-btn-cyan px-2 py-1 text-[10px]"
                          >
                            {inviting === u.id ? '...' : 'Invite'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {inviteQuery && (searchResults?.users ?? searchResults ?? []).length === 0 && (
                    <p className="text-xs text-[var(--cyber-text-dim)] text-center py-3">No users found</p>
                  )}
                </div>
                <button onClick={() => { setShowInvite(false); setInviteQuery('') }}
                  className="mt-3 text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-text)]">
                  Close
                </button>
              </div>
            </div>
          )}

          {/* Pending members */}
          {isOfficerPlus && pendingMembers.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-[var(--cyber-text-dim)] mb-3">Pending</h3>
              <div className="space-y-2">
                {pendingMembers.map(m => (
                  <div key={m.id} className="cyber-card p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AvatarDisplay user={m.user} size="w-7 h-7" textSize="text-xs" />
                      <span
                        className="font-semibold text-sm text-[var(--cyber-text)] cursor-pointer hover:text-[var(--cyber-cyan)]"
                        onClick={() => navigate(`/users/${m.user?.id}`)}
                      >
                        {m.user?.username}
                      </span>
                      <span
                        className="cyber-badge text-[10px]"
                        style={{ borderColor: '#fbbf24', color: '#fbbf24' }}
                      >
                        applied
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-emerald-600 to-emerald-700 text-white"
                        onClick={() => handleApproveMember(m.id)}
                      >
                        Approve
                      </button>
                      <button
                        className="px-2.5 py-1 rounded-full text-xs text-red-400 border border-red-800/30 hover:bg-red-900/20"
                        onClick={() => handleRejectMember(m.id)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active members */}
          <h3 className="text-sm font-semibold text-[var(--cyber-text-dim)] mb-3">Members</h3>
          {membersLoading ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-8">Loading...</p>
          ) : activeMembers.length === 0 ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-8">No active members</p>
          ) : (
            <div className="space-y-2">
              {activeMembers.map(m => (
                <div key={m.id} className="cyber-card p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AvatarDisplay user={m.user} size="w-7 h-7" textSize="text-xs" />
                    <span
                      className="font-semibold text-sm text-[var(--cyber-text)] cursor-pointer hover:text-[var(--cyber-cyan)]"
                      onClick={() => navigate(`/users/${m.user?.id}`)}
                    >
                      {m.user?.username}
                    </span>
                    <span
                      className="cyber-badge text-[10px]"
                      style={{
                        borderColor: ROLE_COLORS[m.role] || 'var(--cyber-border)',
                        color: ROLE_TEXT_COLORS[m.role] || 'var(--cyber-text-dim)',
                      }}
                    >
                      {m.role}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Role dropdown — admin only, can't change own role or other admins */}
                    {isAdmin && m.user?.id !== userId && m.role !== 'admin' && (
                      <select
                        value={m.role}
                        onChange={e => handleRoleChange(m.id, e.target.value)}
                        disabled={changingRole === m.id}
                        className="text-xs bg-[var(--cyber-surface)] border border-[var(--cyber-border)] text-[var(--cyber-text)] rounded px-2 py-1"
                      >
                        <option value="member">Member</option>
                        <option value="officer">Officer</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                    {/* Remove — officer+ can remove members (not officers/admins), admin can remove anyone except self */}
                    {isOfficerPlus && m.user?.id !== userId && (
                      (isAdmin || (myRole === 'officer' && m.role === 'member')) ? (
                        <button
                          onClick={() => handleRemoveMember(m.id, m.user?.username)}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors"
                        >
                          Remove
                        </button>
                      ) : null
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Router Entry ────────────────────────────────────────────

export default function Groups() {
  const { grottoId } = useParams()

  if (grottoId) {
    return <GroupDetail grottoId={grottoId} />
  }
  return <GroupList />
}
