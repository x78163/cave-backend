import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { apiFetch, useApi } from '../hooks/useApi'
import useAuthStore from '../stores/authStore'
import AvatarDisplay from '../components/AvatarDisplay'

export default function UserProfilePage() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const { user: currentUser } = useAuthStore()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('wall')
  const [dmLoading, setDmLoading] = useState(false)

  // Redirect to own profile
  useEffect(() => {
    if (currentUser && String(currentUser.id) === String(userId)) {
      navigate('/profile', { replace: true })
    }
  }, [currentUser, userId, navigate])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const data = await apiFetch(`/users/profile/${userId}/`)
        if (!cancelled) setProfile(data)
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [userId])

  const handleSendDM = async () => {
    setDmLoading(true)
    try {
      const data = await apiFetch('/chat/dm/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: parseInt(userId) }),
      })
      navigate(`/chat/${data.channel_id}`)
    } catch (err) {
      alert(err.message || 'Could not start DM')
    }
    setDmLoading(false)
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="text-center text-[var(--cyber-text-dim)] py-16">Loading profile...</div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="text-center text-[var(--cyber-text-dim)] py-16">User not found</div>
      </div>
    )
  }

  const isSelf = currentUser && String(currentUser.id) === String(userId)

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Profile header */}
      <div className="cyber-card p-6 mb-6">
        <div className="flex items-center gap-4">
          <AvatarDisplay user={profile} size="w-16 h-16" textSize="text-2xl" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold text-[var(--cyber-text)]">{profile.username}</h1>
              {!isSelf && profile.allow_dms !== false && (
                <button
                  onClick={handleSendDM}
                  disabled={dmLoading}
                  className="cyber-btn cyber-btn-cyan text-xs px-4 py-1.5"
                >
                  {dmLoading ? '...' : 'Send DM'}
                </button>
              )}
              {!isSelf && profile.allow_dms === false && (
                <span className="text-xs text-[var(--cyber-text-dim)] italic">DMs disabled</span>
              )}
            </div>
            {profile.location && (
              <p className="text-sm text-[var(--cyber-text-dim)]">{profile.location}</p>
            )}
            {profile.bio && (
              <p className="text-sm text-[var(--cyber-text-dim)] mt-1">{profile.bio}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mt-4 text-center">
          <div className="cyber-card p-3">
            <p className="text-lg font-bold text-[var(--cyber-cyan)]">{profile.caves_explored}</p>
            <p className="text-[10px] text-[var(--cyber-text-dim)]">Caves Explored</p>
          </div>
          <div className="cyber-card p-3">
            <p className="text-lg font-bold text-[var(--cyber-cyan)]">
              {profile.total_mapping_distance ? `${(profile.total_mapping_distance).toFixed(0)}m` : '0m'}
            </p>
            <p className="text-[10px] text-[var(--cyber-text-dim)]">Mapped</p>
          </div>
          <div className="cyber-card p-3">
            <p className="text-lg font-bold text-[var(--cyber-cyan)]">{profile.expeditions_count}</p>
            <p className="text-[10px] text-[var(--cyber-text-dim)]">Expeditions</p>
          </div>
        </div>

        {/* Specialties */}
        {profile.specialties?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {profile.specialties.map((s, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--cyber-border)] text-[var(--cyber-text-dim)]">
                {s}
              </span>
            ))}
          </div>
        )}

        <p className="text-[10px] text-[var(--cyber-text-dim)] mt-3">
          Member since {new Date(profile.date_joined).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-4 border-b border-[var(--cyber-border)]">
        {[
          { key: 'wall', label: 'Wall' },
          { key: 'media', label: 'Media' },
          { key: 'events', label: 'Events' },
          { key: 'ratings', label: 'Ratings' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`pb-2 text-sm transition-colors border-b-2 ${
              activeTab === tab.key
                ? 'text-[var(--cyber-cyan)] border-[var(--cyber-cyan)]'
                : 'text-[var(--cyber-text-dim)] border-transparent hover:text-[var(--cyber-text)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content — simple read-only views */}
      <UserProfileTabContent tab={activeTab} userId={parseInt(userId)} />
    </div>
  )
}

function UserProfileTabContent({ tab, userId }) {
  if (tab === 'wall') return <UserWallTab userId={userId} />
  if (tab === 'media') return <UserMediaTab userId={userId} />
  if (tab === 'events') return <UserEventsTab userId={userId} />
  if (tab === 'ratings') return <UserRatingsTab userId={userId} />
  return null
}

function UserWallTab({ userId }) {
  const { data, loading } = useApi(`/social/posts/?user=${userId}`)
  const posts = data?.results ?? []

  if (loading) return <div className="text-center text-xs text-[var(--cyber-text-dim)] py-4">Loading...</div>
  if (posts.length === 0) return <div className="text-center text-xs text-[var(--cyber-text-dim)] py-8">No posts yet</div>

  return (
    <div className="space-y-3">
      {posts.map(post => (
        <div key={post.id} className="cyber-card p-4">
          <p className="text-sm text-[var(--cyber-text)]">{post.content}</p>
          {post.image && <img src={post.image} alt="" className="mt-2 rounded-lg max-h-48 object-cover" />}
          <p className="text-[10px] text-[var(--cyber-text-dim)] mt-2">
            {new Date(post.created_at).toLocaleDateString()}
          </p>
        </div>
      ))}
    </div>
  )
}

const EVENT_TYPE_COLORS = {
  expedition: '#00e5ff', survey: '#fbbf24', training: '#4ade80',
  education: '#a78bfa', outreach: '#fb923c', conservation: '#34d399',
  social: '#f472b6', other: '#94a3b8',
}

function UserEventsTab({ userId }) {
  const { data, loading } = useApi(`/events/user/${userId}/`)
  const events = Array.isArray(data) ? data : []

  if (loading) return <div className="text-center text-xs text-[var(--cyber-text-dim)] py-4">Loading...</div>
  if (events.length === 0) return <div className="text-center text-xs text-[var(--cyber-text-dim)] py-8">No events yet</div>

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <Link to={`/events/${ev.id}`} key={ev.id} className="cyber-card p-4 block no-underline hover:border-[var(--cyber-cyan)] transition-colors">
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase"
                style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
              >
                {ev.event_type}
              </span>
            </div>
            <h3 className="font-semibold text-sm text-[var(--cyber-text)] truncate">{ev.name}</h3>
            <p className="text-xs text-[var(--cyber-text-dim)] mt-0.5">
              {dateStr}{timeStr && ` at ${timeStr}`}
            </p>
            {ev.cave_name && (
              <p className="text-xs text-[var(--cyber-cyan)] mt-0.5 truncate">{ev.cave_name}</p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
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

function UserMediaTab({ userId }) {
  const { data, loading } = useApi(`/users/profile/${userId}/media/`)
  const items = data || []

  if (loading) return <div className="text-center text-xs text-[var(--cyber-text-dim)] py-4">Loading...</div>
  if (items.length === 0) return <div className="text-center text-xs text-[var(--cyber-text-dim)] py-8">No media yet</div>

  const photos = items.filter(i => i.type === 'photo' || i.type === 'post_image')
  return (
    <div className="grid grid-cols-3 gap-2">
      {photos.map(photo => (
        <div key={photo.id} className="aspect-square rounded-lg overflow-hidden border border-[var(--cyber-border)]">
          <img src={photo.url} alt="" className="w-full h-full object-cover" loading="lazy" />
        </div>
      ))}
    </div>
  )
}

function UserRatingsTab({ userId }) {
  const { data, loading } = useApi(`/social/ratings/?user=${userId}`)
  const ratings = data?.results ?? (Array.isArray(data) ? data : [])

  if (loading) return <div className="text-center text-xs text-[var(--cyber-text-dim)] py-4">Loading...</div>
  if (ratings.length === 0) return <div className="text-center text-xs text-[var(--cyber-text-dim)] py-8">No ratings yet</div>

  return (
    <div className="space-y-3">
      {ratings.map((r, i) => (
        <div key={i} className="cyber-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-[var(--cyber-text)]">{r.cave_name || 'Cave'}</span>
            <span className="text-[var(--cyber-cyan)]">{'★'.repeat(r.score || 0)}</span>
          </div>
          {r.review && <p className="text-xs text-[var(--cyber-text-dim)]">{r.review}</p>}
        </div>
      ))}
    </div>
  )
}
