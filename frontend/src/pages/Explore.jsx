import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import L from 'leaflet'
import { Link, useNavigate } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import useAuthStore from '../stores/authStore'
import SurfaceMap from '../components/SurfaceMap'
import BulkImportModal from '../components/BulkImportModal'

const EXPLORE_VIEW_KEY = 'explore-map-view'
const EXPLORE_CAVES_KEY = 'explore-caves-cache'

export default function Explore() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [hoveredCaveId, setHoveredCaveId] = useState(null)
  const [sortBy, setSortBy] = useState('name')
  const { data, loading, refetch } = useApi('/caves/')

  // Restore saved map view from sessionStorage (persists within tab)
  const savedView = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(EXPLORE_VIEW_KEY)
      if (raw) return JSON.parse(raw)
    } catch { /* ignore */ }
    return null
  }, [])

  const initialLoadRef = useRef(true)

  // Use cached caves for instant markers, then swap in fresh data when API responds
  const cachedCaves = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(EXPLORE_CAVES_KEY)
      if (raw) return JSON.parse(raw)
    } catch { /* ignore */ }
    return null
  }, [])

  const freshCaves = data?.caves ?? data?.results ?? data ?? []
  const caves = freshCaves.length > 0 ? freshCaves : (cachedCaves ?? [])

  // Cache caves whenever fresh data arrives
  useEffect(() => {
    if (freshCaves.length > 0) {
      try {
        sessionStorage.setItem(EXPLORE_CAVES_KEY, JSON.stringify(freshCaves))
      } catch { /* quota exceeded — ignore */ }
    }
  }, [freshCaves])

  const filtered = useMemo(() => {
    let list = search
      ? caves.filter(c => {
          const q = search.toLowerCase()
          return c.name.toLowerCase().includes(q) ||
            (c.region || '').toLowerCase().includes(q) ||
            (c.country || '').toLowerCase().includes(q) ||
            (c.city || '').toLowerCase().includes(q) ||
            (c.zip_code || '').toLowerCase().includes(q) ||
            (c.aliases || '').toLowerCase().includes(q)
        })
      : [...caves]

    switch (sortBy) {
      case 'stars':
        list.sort((a, b) => (Number(b.average_rating) || 0) - (Number(a.average_rating) || 0)
          || (b.rating_count || 0) - (a.rating_count || 0))
        break
      case 'mapped':
        list = list.filter(c => c.has_map)
        break
      case 'unmapped':
        list = list.filter(c => !c.has_map)
        break
      case 'public_land':
        list = list.filter(c => c.public_land_name && c.public_land_name !== 'N/A')
        list.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'no_details':
        list = list.filter(c => !c.description && !c.total_length && !c.has_map && !(c.rating_count > 0))
        break
      case 'activity':
        list.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
        break
      default: // 'name'
        list.sort((a, b) => a.name.localeCompare(b.name))
    }
    return list
  }, [caves, search, sortBy])

  // Caves with GPS coordinates for the overview map
  const markers = useMemo(
    () => filtered
      .filter(c => c.latitude != null && c.longitude != null)
      .map(c => ({ lat: c.latitude, lon: c.longitude, label: c.name, id: c.id, approximate: c.coordinates_approximate })),
    [filtered]
  )

  // Default center: continental US; shift to markers if available
  const mapCenter = useMemo(() => {
    const US_CENTER = [39.8, -98.6]
    if (markers.length === 0) return US_CENTER
    if (markers.length === 1) return [markers[0].lat, markers[0].lon]
    return US_CENTER
  }, [markers])

  const handleViewChange = useCallback((view) => {
    if (view?.center && view?.zoom != null) {
      sessionStorage.setItem(EXPLORE_VIEW_KEY, JSON.stringify(view))
    }
  }, [])

  const mapRef = useRef(null)

  // Fit map to search results (skip if markers span continents — e.g. NZ + US)
  // On initial mount with a saved view, skip fitBounds so the restored position is preserved
  useEffect(() => {
    const map = mapRef.current
    if (!map || markers.length <= 1) return  // single marker handled by mapCenter
    if (initialLoadRef.current) {
      initialLoadRef.current = false
      if (savedView) return  // skip fitBounds on restore — user's saved position wins
    }
    const timer = setTimeout(() => {
      if (!mapRef.current) return
      const lats = markers.map(mk => mk.lat)
      const latSpan = Math.max(...lats) - Math.min(...lats)
      if (latSpan > 50) return  // intercontinental spread, keep current view
      const bounds = L.latLngBounds(markers.map(mk => [mk.lat, mk.lon]))
      mapRef.current.fitBounds(bounds, { padding: [30, 30], animate: true })
    }, 150)
    return () => clearTimeout(timer)
  }, [markers])

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Explore Caves</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--cyber-text-dim)]">
            {filtered.length} cave{filtered.length !== 1 ? 's' : ''}
          </span>
          {user?.is_staff && (
            <button
              onClick={() => setShowImport(true)}
              className="px-4 py-1.5 rounded-full text-sm font-semibold
                border border-[var(--cyber-cyan)] text-[var(--cyber-cyan)]
                hover:bg-[rgba(0,255,255,0.08)] transition-all"
            >
              Bulk Import
            </button>
          )}
          <Link to="/caves/new"
            className="px-4 py-1.5 rounded-full text-sm font-semibold no-underline
              bg-gradient-to-r from-cyan-600 to-cyan-700 text-white
              shadow-[0_0_12px_rgba(0,229,255,0.2)] active:scale-[0.97] transition-all">
            + New Cave
          </Link>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by name, city, state, zip, alias..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="cyber-input flex-1 px-4 py-2.5"
        />
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="cyber-input px-3 py-2.5 text-sm min-w-[140px]"
        >
          <option value="name">Name A-Z</option>
          <option value="stars">Top Rated</option>
          <option value="activity">Recent Activity</option>
          <option value="mapped">Mapped</option>
          <option value="unmapped">Unmapped</option>
          <option value="public_land">Public Land</option>
          <option value="no_details">Needs Details</option>
        </select>
      </div>

      {/* Overview map */}
      {mapCenter && (
        <div className="mb-6">
          <SurfaceMap
            center={mapCenter}
            markers={markers}
            zoom={markers.length === 1 ? 13 : 5}
            height="16rem"
            onMarkerClick={(m) => navigate(`/caves/${m.id}`)}
            className="border border-[var(--cyber-border)]"
            onViewChange={handleViewChange}
            onMapReady={(map) => { mapRef.current = map }}
            initialView={savedView}
          />
        </div>
      )}

      {loading ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading caves...</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">No caves found</p>
      ) : (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pr-1"
          style={{ maxHeight: '60vh' }}
        >
          {filtered.map(cave => (
            <Link
              key={cave.id}
              to={`/caves/${cave.id}`}
              onMouseEnter={() => setHoveredCaveId(cave.id)}
              onMouseLeave={() => setHoveredCaveId(null)}
              className={`cyber-card p-5 no-underline block transition-all duration-300 ${
                hoveredCaveId === cave.id
                  ? 'ring-2 ring-[var(--cyber-cyan)] shadow-[0_0_16px_rgba(0,229,255,0.25)]'
                  : ''
              }`}
            >
              {cave.cover_photo && (
                <img
                  src={cave.cover_photo}
                  alt={cave.name}
                  className="w-full h-36 object-cover rounded-lg mb-3"
                />
              )}
              <h3 className="font-semibold text-[var(--cyber-text)]">
                {cave.name}
                {cave.aliases && (
                  <span className="font-normal text-[var(--cyber-text-dim)] text-sm"> ({cave.aliases})</span>
                )}
              </h3>
              <p className="text-xs text-[var(--cyber-text-dim)] mt-1">
                {cave.region && `${cave.region}, `}{cave.country || 'Unknown location'}
              </p>

              <div className="flex flex-wrap gap-2 mt-3">
                {cave.total_length && (
                  <span
                    className="cyber-badge"
                    style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}
                  >
                    {cave.total_length}m
                  </span>
                )}
                {cave.has_map && (
                  <span
                    className="cyber-badge"
                    style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' }}
                  >
                    3D Map
                  </span>
                )}
                {cave.rating_count > 0 && (
                  <span
                    className="cyber-badge"
                    style={{ borderColor: '#fbbf24', color: '#fbbf24' }}
                  >
                    ★ {Number(cave.average_rating).toFixed(1)} ({cave.rating_count})
                  </span>
                )}
                {cave.public_land_name && cave.public_land_name !== 'N/A' && (
                  <span
                    className="cyber-badge"
                    style={{ borderColor: '#4ade80', color: '#4ade80' }}
                    title={cave.public_land_name}
                  >
                    {cave.public_land_type || 'Public Land'}
                  </span>
                )}
              </div>

              <p className="text-xs text-[var(--cyber-text-dim)] mt-3 line-clamp-2">
                {cave.description || 'No description yet'}
              </p>
            </Link>
          ))}
        </div>
      )}
      {showImport && (
        <BulkImportModal
          onClose={() => setShowImport(false)}
          onComplete={() => refetch()}
        />
      )}
    </div>
  )
}
