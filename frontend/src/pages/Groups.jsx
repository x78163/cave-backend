import { useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useApi, apiFetch } from '../hooks/useApi'
import PostCard from '../components/PostCard'
import PostComposer from '../components/PostComposer'
import useAuthStore from '../stores/authStore'

// ── Group List ──────────────────────────────────────────────

function GroupList() {
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
      await apiFetch('/users/grottos/', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
        }),
      })
      setName('')
      setDescription('')
      setShowCreate(false)
      refetch()
    } catch { /* ignore */ }
    setCreating(false)
  }

  if (loading) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading groups...</p>
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Groups</h1>
        <button
          className="cyber-btn cyber-btn-cyan px-4 py-2 text-sm"
          onClick={() => setShowCreate(s => !s)}
        >
          {showCreate ? 'Cancel' : 'Create Group'}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="cyber-card p-5 mb-6">
          <input
            type="text"
            placeholder="Group name"
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
        <p className="text-center text-[var(--cyber-text-dim)] py-12">No groups yet</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {grottos.map(g => (
            <Link
              key={g.id}
              to={`/groups/${g.id}`}
              className="cyber-card p-5 no-underline block"
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

// ── Group Detail ────────────────────────────────────────────

function GroupDetail({ grottoId }) {
  const { user } = useAuthStore()
  const userId = user?.id
  const [activeTab, setActiveTab] = useState('wall')
  const { data: grotto, loading: grottoLoading } = useApi(`/users/grottos/${grottoId}/`)
  const { data: membersData, loading: membersLoading, refetch: refetchMembers } = useApi(`/users/grottos/${grottoId}/members/`)
  const { data: postsData, loading: postsLoading, refetch: refetchPosts } = useApi(`/social/posts/?grotto=${grottoId}`)

  const members = membersData?.members ?? []
  const posts = postsData?.results ?? []

  const myMembership = members.find(m => m.user?.id === userId)

  const handleApply = useCallback(async () => {
    try {
      await apiFetch(`/users/grottos/${grottoId}/apply/`, { method: 'POST' })
      refetchMembers()
    } catch { /* ignore */ }
  }, [grottoId, refetchMembers])

  const handleApproveMember = useCallback(async (membershipId) => {
    try {
      await apiFetch(`/users/grottos/${grottoId}/members/${membershipId}/`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      })
      refetchMembers()
    } catch { /* ignore */ }
  }, [grottoId, refetchMembers])

  const handleRejectMember = useCallback(async (membershipId) => {
    try {
      await apiFetch(`/users/grottos/${grottoId}/members/${membershipId}/`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected' }),
      })
      refetchMembers()
    } catch { /* ignore */ }
  }, [grottoId, refetchMembers])

  const handleInvite = useCallback(async () => {
    const inviteUserId = prompt('Enter user ID to invite:')
    if (!inviteUserId) return
    try {
      await apiFetch(`/users/grottos/${grottoId}/invite/`, {
        method: 'POST',
        body: JSON.stringify({ user: parseInt(inviteUserId) }),
      })
      refetchMembers()
    } catch (err) {
      alert(err.message)
    }
  }, [grottoId, refetchMembers])

  const handleDeletePost = useCallback(async (post) => {
    if (!confirm('Delete this post?')) return
    try {
      await apiFetch(`/social/posts/${post.id}/`, { method: 'DELETE' })
      refetchPosts()
    } catch { /* ignore */ }
  }, [refetchPosts])

  if (grottoLoading) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading group...</p>
  }

  if (!grotto) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">Group not found</p>
  }

  const activeMembers = members.filter(m => m.status === 'active')
  const pendingMembers = members.filter(m => m.status === 'pending_application' || m.status === 'pending_invitation')
  const isAdmin = myMembership?.role === 'admin'
  const isMember = myMembership?.status === 'active'

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="cyber-card p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <Link to="/groups" className="text-xs text-[var(--cyber-text-dim)] no-underline hover:text-[var(--cyber-cyan)]">
              &larr; All Groups
            </Link>
            <h1 className="text-xl font-bold mt-1">{grotto.name}</h1>
            {grotto.description && (
              <p className="text-sm text-[var(--cyber-text-dim)] mt-1">{grotto.description}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <span
                className="cyber-badge"
                style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' }}
              >
                {activeMembers.length} members
              </span>
              <span
                className="cyber-badge"
                style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}
              >
                {grotto.privacy ?? 'public'}
              </span>
            </div>
            {!myMembership && (
              <button className="cyber-btn cyber-btn-cyan px-3 py-1.5 text-xs" onClick={handleApply}>
                Apply to Join
              </button>
            )}
            {myMembership?.status === 'pending_application' && (
              <span className="text-xs text-[var(--cyber-text-dim)]">Application pending</span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        {[{ key: 'wall', label: 'Wall' }, { key: 'members', label: 'Members' }].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
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
            <p className="text-center text-[var(--cyber-text-dim)] py-12">No group posts yet</p>
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

      {/* Members tab */}
      {activeTab === 'members' && (
        <div>
          {isAdmin && (
            <div className="flex justify-end mb-4">
              <button className="cyber-btn cyber-btn-cyan px-3 py-1.5 text-xs" onClick={handleInvite}>
                Invite Member
              </button>
            </div>
          )}

          {isAdmin && pendingMembers.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-[var(--cyber-text-dim)] mb-3">Pending</h3>
              <div className="space-y-2">
                {pendingMembers.map(m => (
                  <div key={m.id} className="cyber-card p-3 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-sm text-[var(--cyber-text)]">{m.user?.username}</span>
                      <span
                        className="cyber-badge ml-2 text-[10px]"
                        style={{ borderColor: '#fbbf24', color: '#fbbf24' }}
                      >
                        {m.status === 'pending_application' ? 'applied' : 'invited'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="cyber-btn cyber-btn-cyan px-2 py-1 text-xs"
                        onClick={() => handleApproveMember(m.id)}
                      >
                        Approve
                      </button>
                      <button
                        className="cyber-btn cyber-btn-ghost px-2 py-1 text-xs"
                        style={{ borderColor: '#ef4444', color: '#ef4444' }}
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

          <h3 className="text-sm font-semibold text-[var(--cyber-text-dim)] mb-3">Members</h3>
          {membersLoading ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-8">Loading...</p>
          ) : activeMembers.length === 0 ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-8">No active members</p>
          ) : (
            <div className="space-y-2">
              {activeMembers.map(m => (
                <div key={m.id} className="cyber-card p-3 flex items-center justify-between">
                  <span className="font-semibold text-sm text-[var(--cyber-text)]">{m.user?.username}</span>
                  <span
                    className="cyber-badge text-[10px]"
                    style={{
                      borderColor: m.role === 'admin' ? 'var(--cyber-magenta)' : 'var(--cyber-border)',
                      color: m.role === 'admin' ? 'var(--cyber-magenta)' : 'var(--cyber-text-dim)',
                    }}
                  >
                    {m.role}
                  </span>
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
