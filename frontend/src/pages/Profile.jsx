import { useState, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useApi, apiFetch } from '../hooks/useApi'
import api from '../services/api'
import StarRating from '../components/StarRating'
import PostCard from '../components/PostCard'
import PostComposer from '../components/PostComposer'
import AvatarDisplay from '../components/AvatarDisplay'
import useAuthStore from '../stores/authStore'
import { SPECIALTIES, AVATAR_PRESETS } from '../constants/profileOptions'

// ── Helpers ──────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function formatTime(seconds) {
  if (!seconds) return '—'
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`
}

async function downloadExport(caveId, routeId, format, routeName) {
  const suffix = format === 'ros2' ? '?format=ros2' : ''
  const res = await fetch(`/api/caves/${caveId}/routes/${routeId}/export/${suffix}`)
  if (!res.ok) throw new Error(`Export failed: ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const ext = format === 'ros2' ? '.ros2.json' : '.json'
  a.download = `${(routeName || 'route').replace(/\s+/g, '_')}${ext}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ── Wall Tab ────────────────────────────────────────────────

function WallTab({ userId }) {
  const { data, loading, refetch } = useApi(`/social/posts/?user=${userId}`)
  const posts = data?.results ?? []

  const handleDelete = useCallback(async (post) => {
    if (!confirm('Delete this post?')) return
    try {
      await apiFetch(`/social/posts/${post.id}/`, { method: 'DELETE' })
      refetch()
    } catch { /* ignore */ }
  }, [refetch])

  return (
    <>
      <PostComposer onPostCreated={refetch} />
      {loading ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading posts...</p>
      ) : posts.length === 0 ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">No posts yet</p>
      ) : (
        <div className="space-y-4">
          {posts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={userId}
              onReact={refetch}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </>
  )
}

// ── Routes Tab ───────────────────────────────────────────────

function RoutesTab({ userId }) {
  const [search, setSearch] = useState('')
  const { data, loading, refetch } = useApi(`/users/${userId}/routes/`)
  const routes = data?.results ?? []
  const navigate = useNavigate()

  const filtered = search
    ? routes.filter(r =>
        r.name?.toLowerCase().includes(search.toLowerCase()) ||
        r.cave_detail?.name?.toLowerCase().includes(search.toLowerCase())
      )
    : routes

  const handleDelete = useCallback(async (route) => {
    if (!confirm(`Delete route "${route.name}"?`)) return
    try {
      await apiFetch(`/caves/${route.cave}/routes/${route.id}/`, { method: 'DELETE' })
      refetch()
    } catch { /* ignore */ }
  }, [refetch])

  if (loading) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading routes...</p>
  }

  return (
    <>
      <input
        type="text"
        placeholder="Search routes or caves..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="cyber-input w-full px-4 py-2.5 mb-4"
      />

      {filtered.length === 0 ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">
          {search ? 'No matching routes' : 'No saved routes yet'}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(route => {
            const computed = route.computed_route || {}
            return (
              <div key={route.id} className="cyber-card p-5">
                <h3 className="font-semibold text-[var(--cyber-text)] truncate">
                  {route.name || 'Unnamed Route'}
                </h3>
                <p className="text-xs text-[var(--cyber-text-dim)] mt-1">
                  {route.cave_detail?.name || 'Unknown cave'}
                </p>

                <div className="flex flex-wrap gap-2 mt-3">
                  {computed.total_distance_m != null && (
                    <span className="cyber-badge" style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' }}>
                      {computed.total_distance_m.toFixed(1)}m
                    </span>
                  )}
                  {computed.total_time_s != null && (
                    <span className="cyber-badge" style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}>
                      {formatTime(computed.total_time_s)}
                    </span>
                  )}
                  {route.waypoints?.length > 0 && (
                    <span className="cyber-badge" style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}>
                      {route.waypoints.length} waypoints
                    </span>
                  )}
                </div>

                <p className="text-xs text-[var(--cyber-text-dim)] mt-2">
                  {formatDate(route.created_at)}
                </p>

                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    className="cyber-btn cyber-btn-cyan px-3 py-1 text-xs"
                    onClick={() => navigate(`/caves/${route.cave}?route=${route.id}`)}
                  >
                    View on Map
                  </button>
                  <button
                    className="cyber-btn cyber-btn-ghost px-3 py-1 text-xs"
                    style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}
                    onClick={() => downloadExport(route.cave, route.id, 'json', route.name)}
                  >
                    JSON
                  </button>
                  <button
                    className="cyber-btn cyber-btn-ghost px-3 py-1 text-xs"
                    style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}
                    onClick={() => downloadExport(route.cave, route.id, 'ros2', route.name)}
                  >
                    ROS2
                  </button>
                  <button
                    className="cyber-btn cyber-btn-ghost px-3 py-1 text-xs"
                    style={{ borderColor: '#ef4444', color: '#ef4444' }}
                    onClick={() => handleDelete(route)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ── Expeditions Tab ──────────────────────────────────────────

function ExpeditionsTab({ userId }) {
  const { data, loading } = useApi('/social/expeditions/')
  const expeditions = (Array.isArray(data) ? data : data?.results ?? [])
    .filter(e => e.organizer === userId)

  if (loading) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading expeditions...</p>
  }

  if (expeditions.length === 0) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">No expeditions yet</p>
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {expeditions.map(exp => (
        <div key={exp.id} className="cyber-card p-5">
          <h3 className="font-semibold text-[var(--cyber-text)] truncate">{exp.name}</h3>
          <p className="text-xs text-[var(--cyber-text-dim)] mt-1">
            {formatDate(exp.planned_date)}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <span
              className="cyber-badge"
              style={{
                borderColor: exp.status === 'completed' ? '#22c55e' : 'var(--cyber-cyan)',
                color: exp.status === 'completed' ? '#22c55e' : 'var(--cyber-cyan)',
              }}
            >
              {exp.status}
            </span>
            <span className="cyber-badge" style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}>
              {exp.confirmed_count ?? 0}/{exp.max_members ?? '?'} members
            </span>
          </div>
          {exp.description && (
            <p className="text-xs text-[var(--cyber-text-dim)] mt-3 line-clamp-2">
              {exp.description}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Ratings Tab ──────────────────────────────────────────────

function RatingsTab({ userId }) {
  const { data, loading } = useApi(`/social/users/${userId}/ratings/`)
  const ratings = data?.results ?? []

  if (loading) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading ratings...</p>
  }

  if (ratings.length === 0) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">No ratings yet</p>
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {ratings.map(r => (
        <div key={r.id} className="cyber-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-[var(--cyber-text)] truncate">
              {r.cave_name || 'Unknown cave'}
            </h3>
            <StarRating value={r.rating} size="text-sm" />
          </div>
          {r.review_text && (
            <p className="text-sm text-[var(--cyber-text-dim)] mt-3">
              {r.review_text}
            </p>
          )}
          <p className="text-xs text-[var(--cyber-text-dim)] mt-2">
            {formatDate(r.created_at)}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Media Tab ───────────────────────────────────────────────

function CaveStatusBadge({ item }) {
  if (item.cave) {
    return (
      <Link
        to={`/caves/${item.cave}`}
        className="cyber-badge text-[10px] no-underline"
        style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' }}
      >
        {item.cave_name_cache || 'View cave'}
      </Link>
    )
  }
  if (item.cave_name_cache) {
    return (
      <span
        className="cyber-badge text-[10px]"
        style={{ borderColor: '#ef4444', color: '#ef4444' }}
      >
        {item.cave_name_cache} (Deleted)
      </span>
    )
  }
  return null
}

function MediaTab({ userId }) {
  const [subTab, setSubTab] = useState('photos')
  const { data, loading } = useApi(`/users/profile/${userId}/media/`)

  const photos = data?.photos ?? []
  const documents = data?.documents ?? []
  const videoLinks = data?.video_links ?? []

  const SUB_TABS = [
    { key: 'photos', label: 'Photos', count: data?.photo_count ?? 0 },
    { key: 'documents', label: 'Documents', count: data?.document_count ?? 0 },
    { key: 'videos', label: 'Videos', count: data?.video_link_count ?? 0 },
  ]

  if (loading) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading media...</p>
  }

  return (
    <>
      {/* Sub-tab bar */}
      <div className="flex gap-2 mb-4">
        {SUB_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setSubTab(tab.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              subTab === tab.key
                ? 'text-[var(--cyber-bg)] bg-[var(--cyber-cyan)]'
                : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]'
            }`}
          >
            {tab.label}{tab.count > 0 ? ` (${tab.count})` : ''}
          </button>
        ))}
      </div>

      {/* Photos grid */}
      {subTab === 'photos' && (
        photos.length === 0 ? (
          <p className="text-center text-[var(--cyber-text-dim)] py-12">No photos yet</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {photos.map(photo => (
              <div key={photo.id} className="cyber-card overflow-hidden">
                <img
                  src={photo.image}
                  alt={photo.caption || ''}
                  className="w-full aspect-square object-cover"
                />
                <div className="p-3">
                  {photo.caption && (
                    <p className="text-xs text-[var(--cyber-text)] truncate">{photo.caption}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <CaveStatusBadge item={photo} />
                    {photo.visibility !== 'public' && (
                      <span
                        className="cyber-badge text-[10px]"
                        style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}
                      >
                        {photo.visibility}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-[var(--cyber-text-dim)] mt-1">
                    {formatDate(photo.uploaded_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Documents list */}
      {subTab === 'documents' && (
        documents.length === 0 ? (
          <p className="text-center text-[var(--cyber-text-dim)] py-12">No documents yet</p>
        ) : (
          <div className="space-y-3">
            {documents.map(doc => (
              <div key={doc.id} className="cyber-card p-4 flex items-center gap-4">
                <div
                  className="w-10 h-10 rounded flex items-center justify-center shrink-0 text-lg"
                  style={{ background: 'var(--cyber-surface)', border: '1px solid var(--cyber-border)' }}
                >
                  {'\u{1F4C4}'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--cyber-text)] font-medium truncate">
                    {doc.title || doc.file?.split('/').pop() || 'Untitled'}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <CaveStatusBadge item={doc} />
                    {doc.visibility !== 'public' && (
                      <span
                        className="cyber-badge text-[10px]"
                        style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}
                      >
                        {doc.visibility}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-[var(--cyber-text-dim)] mt-1">
                    {formatDate(doc.uploaded_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Videos grid */}
      {subTab === 'videos' && (
        videoLinks.length === 0 ? (
          <p className="text-center text-[var(--cyber-text-dim)] py-12">No videos yet</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {videoLinks.map(video => (
              <div key={video.id} className="cyber-card p-4">
                <a
                  href={video.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium truncate block"
                  style={{ color: 'var(--cyber-cyan)' }}
                >
                  {video.title || video.url}
                </a>
                {video.description && (
                  <p className="text-xs text-[var(--cyber-text-dim)] mt-1 line-clamp-2">
                    {video.description}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <CaveStatusBadge item={video} />
                  {video.visibility !== 'public' && (
                    <span
                      className="cyber-badge text-[10px]"
                      style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}
                    >
                      {video.visibility}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-[var(--cyber-text-dim)] mt-1">
                  {formatDate(video.added_at)}
                </p>
              </div>
            ))}
          </div>
        )
      )}
    </>
  )
}

// ── Profile Edit Panel ───────────────────────────────────────

function ProfileEditPanel({ user, onSave, onCancel }) {
  const [firstName, setFirstName] = useState(user?.first_name || '')
  const [lastName, setLastName] = useState(user?.last_name || '')
  const [bio, setBio] = useState(user?.bio || '')
  const [location, setLocation] = useState(user?.location || '')
  const [avatarPreset, setAvatarPreset] = useState(user?.avatar_preset || '')
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [selectedSpecialties, setSelectedSpecialties] = useState(user?.specialties || [])
  const [saving, setSaving] = useState(false)

  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setAvatarFile(file)
      setAvatarPreset('')
      setAvatarPreview(URL.createObjectURL(file))
    }
  }

  const handlePresetSelect = (key) => {
    setAvatarPreset(key)
    setAvatarFile(null)
    if (avatarPreview) {
      URL.revokeObjectURL(avatarPreview)
      setAvatarPreview(null)
    }
  }

  const toggleSpecialty = (s) => {
    setSelectedSpecialties(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : prev.length < 10 ? [...prev, s] : prev
    )
  }

  const selectedPreset = AVATAR_PRESETS.find(p => p.key === avatarPreset)

  const handleSave = async () => {
    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('first_name', firstName)
      formData.append('last_name', lastName)
      formData.append('bio', bio)
      formData.append('location', location)
      formData.append('avatar_preset', avatarPreset)
      formData.append('specialties', JSON.stringify(selectedSpecialties))
      if (avatarFile) formData.append('avatar', avatarFile)

      await api.patch('/users/me/', formData)
      await useAuthStore.getState().fetchMe()
      onSave()
    } catch (err) {
      console.error('Profile save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="cyber-card p-6 mb-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold" style={{ color: 'var(--cyber-cyan)' }}>Edit Profile</h2>
        <button onClick={onCancel} className="text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-text)]">
          Cancel
        </button>
      </div>

      {/* Avatar section */}
      <div className="mb-5">
        <label className="block text-xs font-medium mb-2" style={{ color: 'var(--cyber-text-dim)' }}>Avatar</label>
        <div className="flex items-center gap-4 mb-3">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl shrink-0"
            style={{ background: 'var(--cyber-surface)', border: '2px solid var(--cyber-cyan)' }}
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="preview" className="w-full h-full rounded-full object-cover" />
            ) : selectedPreset ? (
              selectedPreset.emoji
            ) : user?.avatar ? (
              <img src={user.avatar} alt="avatar" className="w-full h-full rounded-full object-cover" />
            ) : (
              <span className="font-bold" style={{ color: 'var(--cyber-cyan)' }}>
                {(user?.username || '??').split('_').map(w => w[0]?.toUpperCase()).join('').slice(0, 2)}
              </span>
            )}
          </div>
          <label className="cyber-btn cyber-btn-ghost px-3 py-1.5 text-xs cursor-pointer">
            <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
            Upload Photo
          </label>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {AVATAR_PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => handlePresetSelect(p.key)}
              className="flex flex-col items-center gap-0.5 p-1.5 rounded-lg transition-colors"
              style={{
                background: avatarPreset === p.key ? 'var(--cyber-surface-2)' : 'transparent',
                border: avatarPreset === p.key ? '1px solid var(--cyber-cyan)' : '1px solid transparent',
              }}
            >
              <span className="text-xl">{p.emoji}</span>
              <span className="text-[9px]" style={{ color: 'var(--cyber-text-dim)' }}>{p.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Name fields */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>First Name</label>
          <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
            className="cyber-input w-full px-3 py-2 text-sm" placeholder="First name" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>Last Name</label>
          <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
            className="cyber-input w-full px-3 py-2 text-sm" placeholder="Last name" />
        </div>
      </div>

      {/* Bio */}
      <div className="mb-3">
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>Bio</label>
        <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3}
          className="cyber-textarea w-full px-3 py-2 text-sm resize-none" placeholder="Tell us about yourself..." />
      </div>

      {/* Location */}
      <div className="mb-4">
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>Location</label>
        <input type="text" value={location} onChange={e => setLocation(e.target.value)}
          className="cyber-input w-full px-3 py-2 text-sm" placeholder="City, Country (e.g. Ljubljana, Slovenia)" />
      </div>

      {/* Specialties */}
      <div className="mb-5">
        <label className="block text-xs font-medium mb-2" style={{ color: 'var(--cyber-text-dim)' }}>
          Specialties {selectedSpecialties.length > 0 && `(${selectedSpecialties.length})`}
        </label>
        <div className="flex flex-wrap gap-2">
          {SPECIALTIES.map(s => {
            const active = selectedSpecialties.includes(s)
            return (
              <button key={s} type="button" onClick={() => toggleSpecialty(s)}
                className="cyber-badge px-3 py-1.5 text-xs cursor-pointer transition-colors"
                style={{
                  borderColor: active ? 'var(--cyber-cyan)' : 'var(--cyber-border)',
                  color: active ? 'var(--cyber-cyan)' : 'var(--cyber-text-dim)',
                  background: active ? 'rgba(0, 255, 255, 0.08)' : 'transparent',
                }}>
                {s}
              </button>
            )
          })}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="cyber-btn cyber-btn-ghost px-4 py-2 text-sm">Cancel</button>
        <button onClick={handleSave} disabled={saving}
          className="cyber-btn cyber-btn-cyan px-4 py-2 text-sm disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

// ── Profile Page ─────────────────────────────────────────────

const TABS = [
  { key: 'wall', label: 'Wall' },
  { key: 'media', label: 'Media' },
  { key: 'routes', label: 'Routes' },
  { key: 'expeditions', label: 'Expeditions' },
  { key: 'ratings', label: 'Ratings' },
]

export default function Profile() {
  const { user } = useAuthStore()
  const userId = user?.id
  const [activeTab, setActiveTab] = useState('wall')
  const [isEditing, setIsEditing] = useState(false)
  const { data: routeData } = useApi(userId ? `/users/${userId}/routes/?limit=1` : null)
  const { data: postsData } = useApi(userId ? `/social/posts/?user=${userId}&limit=1` : null)
  const { data: followersData } = useApi(userId ? `/social/users/${userId}/followers/` : null)
  const { data: followingData } = useApi(userId ? `/social/users/${userId}/following/` : null)
  const routeCount = routeData?.total ?? 0
  const postCount = postsData?.total ?? 0
  const followerCount = Array.isArray(followersData) ? followersData.length : 0
  const followingCount = Array.isArray(followingData) ? followingData.length : 0

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {isEditing ? (
        <ProfileEditPanel
          user={user}
          onSave={() => setIsEditing(false)}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <>
          {/* Profile header */}
          <div className="cyber-card p-6 mb-6">
            <div className="flex items-center gap-4">
              <AvatarDisplay user={user} size="w-16 h-16" textSize="text-2xl" />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h1 className="text-xl font-bold">{user?.username}</h1>
                  <button
                    className="cyber-btn cyber-btn-ghost px-3 py-1.5 text-xs"
                    onClick={() => setIsEditing(true)}
                  >
                    Edit Profile
                  </button>
                </div>
                <p className="text-sm text-[var(--cyber-text-dim)]">{user?.bio || 'No bio yet'}</p>
                {user?.location && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--cyber-text-dim)' }}>{user.location}</p>
                )}
              </div>
            </div>

            {/* Specialties */}
            {user?.specialties?.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {user.specialties.map(s => (
                  <span key={s} className="cyber-badge text-[10px]"
                    style={{ borderColor: 'var(--cyber-magenta)', color: 'var(--cyber-magenta)' }}>
                    {s}
                  </span>
                ))}
              </div>
            )}

            {/* Stats */}
            <div className="flex flex-wrap gap-6 mt-4 text-sm">
              <div>
                <span className="font-semibold text-[var(--cyber-cyan)]">{postCount}</span>{' '}
                <span className="text-[var(--cyber-text-dim)]">posts</span>
              </div>
              <div>
                <span className="font-semibold text-[var(--cyber-cyan)]">{followerCount}</span>{' '}
                <span className="text-[var(--cyber-text-dim)]">followers</span>
              </div>
              <div>
                <span className="font-semibold text-[var(--cyber-cyan)]">{followingCount}</span>{' '}
                <span className="text-[var(--cyber-text-dim)]">following</span>
              </div>
              <div>
                <span className="font-semibold text-[var(--cyber-cyan)]">{routeCount}</span>{' '}
                <span className="text-[var(--cyber-text-dim)]">routes</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 mb-6">
        {TABS.map(tab => (
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

      {/* Tab content */}
      {activeTab === 'wall' && userId && <WallTab userId={userId} />}
      {activeTab === 'media' && userId && <MediaTab userId={userId} />}
      {activeTab === 'routes' && userId && <RoutesTab userId={userId} />}
      {activeTab === 'expeditions' && userId && <ExpeditionsTab userId={userId} />}
      {activeTab === 'ratings' && userId && <RatingsTab userId={userId} />}
    </div>
  )
}
