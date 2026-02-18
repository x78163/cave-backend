import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi, apiFetch } from '../hooks/useApi'
import StarRating from '../components/StarRating'

const DEFAULT_USER_ID = 2 // elena_karst — first non-admin seed user

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

// ── Routes Tab ───────────────────────────────────────────────

function RoutesTab() {
  const [search, setSearch] = useState('')
  const { data, loading, refetch } = useApi(`/users/${DEFAULT_USER_ID}/routes/`)
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

function ExpeditionsTab() {
  const { data, loading } = useApi('/social/expeditions/')
  const expeditions = (Array.isArray(data) ? data : data?.results ?? [])
    .filter(e => e.organizer === DEFAULT_USER_ID)

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

function RatingsTab() {
  const { data, loading } = useApi(`/social/users/${DEFAULT_USER_ID}/ratings/`)
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

// ── Profile Page ─────────────────────────────────────────────

const TABS = [
  { key: 'routes', label: 'Routes' },
  { key: 'expeditions', label: 'Expeditions' },
  { key: 'ratings', label: 'Ratings' },
]

export default function Profile() {
  const [activeTab, setActiveTab] = useState('routes')
  const { data: routeData } = useApi(`/users/${DEFAULT_USER_ID}/routes/?limit=1`)
  const routeCount = routeData?.total ?? 0

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Profile header */}
      <div className="cyber-card p-6 mb-6">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold"
            style={{ background: 'var(--cyber-surface)', color: 'var(--cyber-cyan)', border: '2px solid var(--cyber-cyan)' }}
          >
            EK
          </div>
          <div>
            <h1 className="text-xl font-bold">elena_karst</h1>
            <p className="text-sm text-[var(--cyber-text-dim)]">Cave researcher & expedition leader</p>
          </div>
        </div>
        <div className="flex gap-6 mt-4 text-sm">
          <div>
            <span className="font-semibold text-[var(--cyber-cyan)]">{routeCount}</span>{' '}
            <span className="text-[var(--cyber-text-dim)]">routes</span>
          </div>
        </div>
      </div>

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
      {activeTab === 'routes' && <RoutesTab />}
      {activeTab === 'expeditions' && <ExpeditionsTab />}
      {activeTab === 'ratings' && <RatingsTab />}
    </div>
  )
}
