import { useState, useCallback, lazy, Suspense } from 'react'
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

// ── Events Tab ──────────────────────────────────────────────

const EVENT_TYPE_COLORS = {
  expedition: '#00e5ff', survey: '#fbbf24', training: '#4ade80',
  education: '#a78bfa', outreach: '#fb923c', conservation: '#34d399',
  social: '#f472b6', other: '#94a3b8',
}

function EventsTab({ userId }) {
  const { data, loading } = useApi(userId ? `/events/user/${userId}/` : null)
  const events = Array.isArray(data) ? data : []

  if (loading) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading events...</p>
  }

  if (events.length === 0) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-12">No events yet</p>
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {events.map(ev => {
        const color = EVENT_TYPE_COLORS[ev.event_type] || EVENT_TYPE_COLORS.other
        const startDate = ev.start_date ? new Date(ev.start_date) : null
        const dateStr = startDate
          ? startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
          : ''
        const timeStr = startDate && !ev.all_day
          ? startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
          : ''
        return (
          <Link to={`/events/${ev.id}`} key={ev.id} className="cyber-card p-5 block no-underline hover:border-[var(--cyber-cyan)] transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase"
                style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
              >
                {ev.event_type}
              </span>
              {ev.status === 'cancelled' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium text-red-400 border border-red-400/40">
                  Cancelled
                </span>
              )}
            </div>
            <h3 className="font-semibold text-[var(--cyber-text)] truncate">{ev.name}</h3>
            <p className="text-xs text-[var(--cyber-text-dim)] mt-1">
              {dateStr}{timeStr && ` at ${timeStr}`}
            </p>
            {ev.cave_name && (
              <p className="text-xs text-[var(--cyber-cyan)] mt-1 truncate">{ev.cave_name}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              {ev.going_count > 0 && (
                <span className="cyber-badge text-[10px]" style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' }}>
                  {ev.going_count} going
                </span>
              )}
              {ev.user_rsvp === 'going' && (
                <span
                  className="cyber-badge text-[10px]"
                  style={{ borderColor: '#22c55e', color: '#22c55e' }}
                >
                  Going
                </span>
              )}
            </div>
          </Link>
        )
      })}
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
  const [allowDms, setAllowDms] = useState(user?.allow_dms !== false)
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
      formData.append('allow_dms', allowDms)
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

      {/* Direct Messages */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <label className="block text-xs font-medium" style={{ color: 'var(--cyber-text-dim)' }}>Allow Direct Messages</label>
          <p className="text-[10px] text-[var(--cyber-text-dim)]/60 mt-0.5">Other users can send you DMs</p>
        </div>
        <button
          type="button"
          onClick={() => setAllowDms(!allowDms)}
          className={`relative w-10 h-5 rounded-full transition-colors ${allowDms ? 'bg-cyan-700' : 'bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${allowDms ? 'left-5' : 'left-0.5'}`} />
        </button>
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

const BASE_TABS = [
  { key: 'wall', label: 'Wall' },
  { key: 'media', label: 'Media' },
  { key: 'routes', label: 'Routes' },
  { key: 'events', label: 'My Events' },
  { key: 'requests', label: 'Requests', color: '#f59e0b' },
  { key: 'ratings', label: 'Ratings' },
  { key: 'notifications', label: 'Notifications' },
]

function InviteCodeSection() {
  const [codes, setCodes] = useState([])
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(null)
  const [loaded, setLoaded] = useState(false)

  const loadCodes = useCallback(async () => {
    try {
      const data = await apiFetch('/users/invite-codes/')
      setCodes(data.invite_codes || [])
      setLoaded(true)
    } catch { /* ignore */ }
  }, [])

  const generateCode = async () => {
    setGenerating(true)
    try {
      const data = await apiFetch('/users/invite-codes/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_uses: 1 }),
      })
      setCodes(prev => [data, ...prev])
    } catch { /* ignore */ }
    setGenerating(false)
  }

  const copyLink = (code) => {
    const url = `${window.location.origin}/register?code=${code}`
    navigator.clipboard.writeText(url)
    setCopied(code)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--cyber-border)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: 'var(--cyber-text-dim)' }}>Invite Codes</span>
        <div className="flex gap-2">
          {!loaded && (
            <button onClick={loadCodes} className="cyber-btn cyber-btn-ghost px-2 py-1 text-[10px]">
              Show
            </button>
          )}
          <button
            onClick={generateCode}
            disabled={generating}
            className="cyber-btn cyber-btn-cyan px-2 py-1 text-[10px] disabled:opacity-50"
          >
            {generating ? '...' : '+ Generate'}
          </button>
        </div>
      </div>
      {loaded && codes.length > 0 && (
        <div className="space-y-1">
          {codes.map(c => (
            <div key={c.id} className="flex items-center gap-2 text-xs">
              <span className="font-mono tracking-wider" style={{
                color: c.is_active && (c.max_uses === 0 || c.use_count < c.max_uses)
                  ? 'var(--cyber-cyan)' : 'var(--cyber-text-dim)',
                textDecoration: !c.is_active ? 'line-through' : 'none',
              }}>
                {c.code}
              </span>
              <span style={{ color: 'var(--cyber-text-dim)' }}>
                {c.use_count}/{c.max_uses || '\u221E'}
              </span>
              <button
                onClick={() => copyLink(c.code)}
                className="text-[10px] hover:underline"
                style={{ color: copied === c.code ? '#22c55e' : 'var(--cyber-magenta)' }}
              >
                {copied === c.code ? 'Copied!' : 'Copy Link'}
              </button>
            </div>
          ))}
        </div>
      )}
      {loaded && codes.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--cyber-text-dim)' }}>No codes yet. Generate one to invite someone.</p>
      )}
    </div>
  )
}

export default function Profile() {
  const { user } = useAuthStore()
  const userId = user?.id
  const [activeTab, setActiveTab] = useState('wall')
  const [isEditing, setIsEditing] = useState(false)
  const { data: routeData } = useApi(userId ? `/users/${userId}/routes/?limit=1` : null)
  const { data: postsData } = useApi(userId ? `/social/posts/?user=${userId}&limit=1` : null)
  const { data: followersData } = useApi(userId ? `/social/users/${userId}/followers/` : null)
  const { data: followingData } = useApi(userId ? `/social/users/${userId}/following/` : null)
  const { data: requestCounts, refetch: refetchRequestCounts } = useApi('/requests/counts/')
  const inboxCount = requestCounts?.inbox_pending ?? 0
  const TABS = BASE_TABS.map(t =>
    t.key === 'requests' && inboxCount > 0
      ? { ...t, badge: inboxCount }
      : t
  )
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

            <InviteCodeSection />
          </div>
        </>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 flex-wrap">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? tab.color
                  ? `text-[var(--cyber-bg)]`
                  : 'text-[var(--cyber-bg)] bg-[var(--cyber-cyan)]'
                : tab.color
                  ? `hover:text-[${tab.color}]`
                  : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]'
            }`}
            style={
              activeTab === tab.key && tab.color
                ? { background: tab.color, color: 'var(--cyber-bg)' }
                : activeTab !== tab.key && tab.color
                  ? { color: tab.color, opacity: 0.7 }
                  : activeTab !== tab.key
                    ? { color: 'var(--cyber-text-dim)' }
                    : undefined
            }
          >
            {tab.label}
            {tab.badge > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold"
                style={{
                  background: activeTab === tab.key ? '#fff' : (tab.color || 'var(--cyber-magenta)'),
                  color: activeTab === tab.key ? (tab.color || 'var(--cyber-bg)') : '#fff',
                }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'wall' && userId && <WallTab userId={userId} />}
      {activeTab === 'media' && userId && <MediaTab userId={userId} />}
      {activeTab === 'routes' && userId && <RoutesTab userId={userId} />}
      {activeTab === 'events' && userId && <EventsTab userId={userId} />}
      {activeTab === 'ratings' && userId && <RatingsTab userId={userId} />}
      {activeTab === 'requests' && <RequestsTab onCountChange={refetchRequestCounts} />}
      {activeTab === 'notifications' && <NotificationPrefsTab />}
    </div>
  )
}

// ── Requests Tab ────────────────────────────────────────────

const REQUEST_TYPE_LABELS = {
  cave_access: 'Cave Access',
  cave_edit: 'Cave Edit',
  contact_access: 'Contact Access',
  contact_submission: 'Contact Submission',
  event_access: 'Event Access',
  grotto_membership: 'Grotto Membership',
  grotto_invitation: 'Grotto Invitation',
  map_upload: 'Map Upload',
  admin_escalation: 'Admin Escalation',
}

const REQUEST_TYPE_COLORS = {
  cave_access: { bg: 'bg-purple-900/30', text: 'text-purple-400', border: 'border-purple-800/30' },
  cave_edit: { bg: 'bg-indigo-900/30', text: 'text-indigo-400', border: 'border-indigo-800/30' },
  contact_access: { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-800/30' },
  contact_submission: { bg: 'bg-cyan-900/30', text: 'text-[var(--cyber-cyan)]', border: 'border-cyan-800/30' },
  event_access: { bg: 'bg-pink-900/30', text: 'text-pink-400', border: 'border-pink-800/30' },
  grotto_membership: { bg: 'bg-emerald-900/30', text: 'text-emerald-400', border: 'border-emerald-800/30' },
  grotto_invitation: { bg: 'bg-teal-900/30', text: 'text-teal-400', border: 'border-teal-800/30' },
  map_upload: { bg: 'bg-blue-900/30', text: 'text-blue-400', border: 'border-blue-800/30' },
  admin_escalation: { bg: 'bg-red-900/30', text: 'text-red-400', border: 'border-red-800/30' },
}

function RequestsTab({ onCountChange }) {
  const navigate = useNavigate()
  const [view, setView] = useState('inbox') // inbox | outgoing
  const [statusFilter, setStatusFilter] = useState('')
  const { data: inboxData, refetch: refetchInbox } = useApi('/requests/inbox/')
  const { data: outgoingData, refetch: refetchOutgoing } = useApi('/requests/outgoing/')
  const { data: counts, refetch: refetchCounts } = useApi('/requests/counts/')

  const inbox = Array.isArray(inboxData) ? inboxData : []
  const outgoing = Array.isArray(outgoingData) ? outgoingData : []

  const filteredInbox = statusFilter ? inbox.filter(r => r.status === statusFilter) : inbox
  const filteredOutgoing = statusFilter ? outgoing.filter(r => r.status === statusFilter) : outgoing

  const items = view === 'inbox' ? filteredInbox : filteredOutgoing

  const onResolved = () => {
    refetchInbox()
    refetchOutgoing()
    refetchCounts()
    onCountChange?.()
  }

  return (
    <div>
      {/* View toggle + filter */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex gap-1">
          <button
            onClick={() => setView('inbox')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              view === 'inbox'
                ? 'bg-[#f59e0b] text-[var(--cyber-bg)]'
                : 'text-[var(--cyber-text-dim)] hover:text-[#f59e0b]'
            }`}
          >
            Inbox
            {(counts?.inbox_pending ?? 0) > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-red-500 text-white">
                {counts.inbox_pending}
              </span>
            )}
          </button>
          <button
            onClick={() => setView('outgoing')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              view === 'outgoing'
                ? 'bg-[#f59e0b] text-[var(--cyber-bg)]'
                : 'text-[var(--cyber-text-dim)] hover:text-[#f59e0b]'
            }`}
          >
            Outgoing
            {(counts?.outgoing_pending ?? 0) > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-amber-600 text-white">
                {counts.outgoing_pending}
              </span>
            )}
          </button>
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-[var(--cyber-surface)] border border-[var(--cyber-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--cyber-text)]"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="denied">Denied</option>
        </select>
      </div>

      {/* Request list */}
      {items.length === 0 ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-8 text-sm">
          {statusFilter
            ? `No ${statusFilter} requests`
            : view === 'inbox'
              ? 'No incoming requests'
              : 'No outgoing requests'}
        </p>
      ) : (
        <div className="space-y-3">
          {items.map(req => (
            <ProfileRequestCard
              key={req.id}
              request={req}
              isInbox={view === 'inbox'}
              onResolved={onResolved}
              navigate={navigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ProfileRequestCard({ request, isInbox, onResolved, navigate }) {
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState(null)
  const [responseMsg, setResponseMsg] = useState('')
  const [showResponse, setShowResponse] = useState(false)

  const resolve = async (newStatus) => {
    setResolving(true)
    setError(null)
    try {
      await apiFetch(`/requests/${request.id}/resolve/`, {
        method: 'PATCH',
        body: { status: newStatus, response_message: responseMsg.trim() },
      })
      onResolved()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed')
    } finally {
      setResolving(false)
    }
  }

  const cancel = async () => {
    setResolving(true)
    try {
      await apiFetch(`/requests/${request.id}/`, { method: 'DELETE' })
      onResolved()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed')
    } finally {
      setResolving(false)
    }
  }

  const colors = REQUEST_TYPE_COLORS[request.request_type] || REQUEST_TYPE_COLORS.cave_access
  const typeLabel = REQUEST_TYPE_LABELS[request.request_type] || request.request_type
  const isPending = request.status === 'pending'

  // Build target description
  let targetLabel = ''
  if (request.cave_name) targetLabel = request.cave_name
  else if (request.event_name) targetLabel = request.event_name
  else if (request.grotto_name) targetLabel = request.grotto_name

  const targetLink = request.cave_id
    ? `/caves/${request.cave_id}`
    : request.event_id
      ? `/events/${request.event_id}`
      : null

  return (
    <div className="rounded-2xl bg-[var(--cyber-surface)] border border-[var(--cyber-border)] p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-[var(--cyber-text)] text-sm font-medium cursor-pointer hover:text-[var(--cyber-cyan)] transition-colors"
            onClick={() => navigate(`/users/${isInbox ? request.requester_id : request.requester_id}`)}
          >
            {isInbox ? request.requester_username : 'You'}
          </span>
          <span className="text-[var(--cyber-text-dim)] text-xs">
            {request.request_type === 'grotto_invitation' ? 'invited you to' : 'requested'}
          </span>
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${colors.bg} ${colors.text} ${colors.border}`}>
            {typeLabel}
          </span>
          {targetLabel && (
            <>
              <span className="text-[var(--cyber-text-dim)] text-xs">for</span>
              {targetLink ? (
                <span
                  className="text-[var(--cyber-cyan)] text-sm cursor-pointer hover:underline"
                  onClick={() => navigate(targetLink)}
                >
                  {targetLabel}
                </span>
              ) : (
                <span className="text-[var(--cyber-text)] text-sm">{targetLabel}</span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isPending && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              request.status === 'accepted'
                ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/30'
                : 'bg-red-900/30 text-red-400 border border-red-800/30'
            }`}>
              {request.status === 'accepted' ? 'Accepted' : 'Denied'}
            </span>
          )}
          <span className="text-[#555570] text-xs">
            {new Date(request.created_at).toLocaleDateString()}
          </span>
          <button
            onClick={cancel}
            disabled={resolving}
            className="ml-1 w-5 h-5 flex items-center justify-center rounded-full text-[var(--cyber-text-dim)] hover:text-red-400 hover:bg-red-900/20 transition-colors"
            title={isPending ? (isInbox ? 'Decline & remove' : 'Cancel & remove') : 'Remove'}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 1L9 9M9 1L1 9" />
            </svg>
          </button>
        </div>
      </div>

      {request.message && (
        <p className="text-[var(--cyber-text-dim)] text-sm mb-2 pl-1">{request.message}</p>
      )}

      {request.response_message && (
        <div className="text-xs mb-2 p-2 rounded-lg bg-[var(--cyber-bg)] border border-[var(--cyber-border)]">
          <span className="text-[var(--cyber-text-dim)]">Response: </span>
          <span className="text-[var(--cyber-text)]">{request.response_message}</span>
        </div>
      )}

      {/* Contact submission payload */}
      {request.request_type === 'contact_submission' && request.payload && (
        <div className="text-xs space-y-0.5 mb-2 p-2 rounded-lg bg-[var(--cyber-bg)] border border-[var(--cyber-border)]">
          {request.payload.phone && <p className="text-[var(--cyber-text-dim)]">Phone: <span className="text-[var(--cyber-text)]">{request.payload.phone}</span></p>}
          {request.payload.email && <p className="text-[var(--cyber-text-dim)]">Email: <span className="text-[var(--cyber-text)]">{request.payload.email}</span></p>}
          {request.payload.address && <p className="text-[var(--cyber-text-dim)]">Address: <span className="text-[var(--cyber-text)]">{request.payload.address}</span></p>}
        </div>
      )}

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

      {/* Actions */}
      {isPending && isInbox && (
        <>
          {showResponse && (
            <textarea
              value={responseMsg}
              onChange={e => setResponseMsg(e.target.value)}
              placeholder="Optional message to the requester..."
              className="w-full bg-[var(--cyber-bg)] border border-[var(--cyber-border)] rounded-lg p-2 text-xs text-[var(--cyber-text)] placeholder:text-[var(--cyber-text-dim)]/40 mb-2 resize-none"
              rows={2}
            />
          )}
          <div className="flex items-center gap-2">
            <button onClick={() => resolve('accepted')} disabled={resolving}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-emerald-600 to-emerald-700 text-white">
              {resolving ? '...' : request.request_type === 'grotto_invitation' ? 'Accept' : 'Approve'}
            </button>
            <button onClick={() => resolve('denied')} disabled={resolving}
              className="px-3 py-1.5 rounded-full text-xs text-red-400 border border-red-800/30 hover:bg-red-900/20 transition-colors">
              {request.request_type === 'grotto_invitation' ? 'Decline' : 'Deny'}
            </button>
            <button
              onClick={() => setShowResponse(!showResponse)}
              className="px-2 py-1.5 text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-text)] transition-colors"
            >
              {showResponse ? 'Hide Reply' : 'Reply'}
            </button>
          </div>
        </>
      )}

      {isPending && !isInbox && (
        <button onClick={cancel} disabled={resolving}
          className="px-3 py-1.5 rounded-full text-xs text-red-400 border border-red-800/30 hover:bg-red-900/20 transition-colors">
          {resolving ? '...' : 'Cancel Request'}
        </button>
      )}

      {!isPending && request.resolved_by_username && (
        <p className="text-[#555570] text-xs mt-1">
          Resolved by {request.resolved_by_username} on {new Date(request.resolved_at).toLocaleDateString()}
        </p>
      )}
    </div>
  )
}

// ── Notification Preferences ─────────────────────────────────

const PREF_SECTIONS = [
  {
    title: 'Cave Access',
    prefs: [
      { key: 'cave_access_request', label: 'Someone requests access to your cave' },
      { key: 'cave_access_granted', label: 'Your access request is approved/denied' },
      { key: 'landowner_contact_request', label: 'Someone requests landowner contact info' },
    ],
  },
  {
    title: 'Events',
    prefs: [
      { key: 'event_invitation', label: 'You are invited to an event' },
      { key: 'event_update', label: 'An event you RSVPed to is updated/cancelled' },
      { key: 'event_reminder', label: 'Reminder before an event' },
    ],
  },
  {
    title: 'Social',
    prefs: [
      { key: 'comment_on_post', label: 'Someone comments on your post' },
      { key: 'comment_reply', label: 'Someone replies to your comment' },
      { key: 'mention', label: 'Someone @mentions you' },
      { key: 'new_follower', label: 'Someone follows you' },
    ],
  },
  {
    title: 'Wiki',
    prefs: [
      { key: 'wiki_cave_edit', label: 'Wiki article edited for a cave you own' },
    ],
  },
]

const DIGEST_OPTIONS = [
  { value: 'immediate', label: 'Immediate' },
  { value: 'daily', label: 'Daily digest' },
  { value: 'weekly', label: 'Weekly digest' },
  { value: 'off', label: 'Off' },
]

function NotificationPrefsTab() {
  const [prefs, setPrefs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useCallback(() => {}, [])

  useState(() => {
    apiFetch('/users/notification-prefs/')
      .then(data => setPrefs(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  })

  const updatePref = async (key, value) => {
    const prev = prefs[key]
    setPrefs(p => ({ ...p, [key]: value }))
    setSaving(true)
    try {
      await apiFetch('/users/notification-prefs/', {
        method: 'PATCH',
        body: { [key]: value },
      })
    } catch {
      setPrefs(p => ({ ...p, [key]: prev }))
    }
    setSaving(false)
  }

  if (loading || !prefs) {
    return <div className="text-center text-xs text-[var(--cyber-text-dim)] py-8">Loading preferences...</div>
  }

  return (
    <div className="max-w-xl space-y-6">
      <p className="text-xs text-[var(--cyber-text-dim)]">
        Control which email notifications you receive. {saving && <span className="text-[var(--cyber-cyan)]">Saving...</span>}
      </p>

      {PREF_SECTIONS.map(section => (
        <div key={section.title}>
          <h3 className="text-sm font-semibold text-[var(--cyber-text)] mb-3">{section.title}</h3>
          <div className="space-y-2">
            {section.prefs.map(({ key, label }) => (
              <label key={key} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--cyber-surface)] cursor-pointer">
                <span className="text-sm text-[var(--cyber-text-dim)]">{label}</span>
                <button
                  onClick={() => updatePref(key, !prefs[key])}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    prefs[key] ? 'bg-[var(--cyber-cyan)]' : 'bg-[#333]'
                  }`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                    prefs[key] ? 'left-5' : 'left-0.5'
                  }`} />
                </button>
              </label>
            ))}
          </div>
        </div>
      ))}

      {/* Chat digest frequency */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--cyber-text)] mb-3">Chat</h3>
        <div className="flex items-center justify-between py-2 px-3">
          <span className="text-sm text-[var(--cyber-text-dim)]">Unread message digest</span>
          <select
            value={prefs.chat_digest || 'daily'}
            onChange={e => updatePref('chat_digest', e.target.value)}
            className="cyber-input text-xs px-3 py-1.5 rounded-lg"
          >
            {DIGEST_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
