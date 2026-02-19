import { useState, useMemo, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import SurfaceMap from '../components/SurfaceMap'

export default function Explore() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const { data, loading } = useApi('/caves/')
  const caves = data?.caves ?? data?.results ?? data ?? []

  // Bidirectional hover state
  const [hoveredCaveId, setHoveredCaveId] = useState(null)
  const hoverTimerRef = useRef(null)
  const cardRefsMap = useRef({})

  const filtered = search
    ? caves.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.region || '').toLowerCase().includes(search.toLowerCase()) ||
        (c.country || '').toLowerCase().includes(search.toLowerCase())
      )
    : caves

  // Caves with GPS coordinates for the overview map
  const markers = useMemo(
    () => filtered
      .filter(c => c.latitude != null && c.longitude != null)
      .map(c => ({ lat: c.latitude, lon: c.longitude, label: c.name, id: c.id })),
    [filtered]
  )

  const mapCenter = useMemo(() => {
    if (markers.length === 0) return null
    const avgLat = markers.reduce((s, m) => s + m.lat, 0) / markers.length
    const avgLon = markers.reduce((s, m) => s + m.lon, 0) / markers.length
    return [avgLat, avgLon]
  }, [markers])

  // Map marker hovered → scroll card into view + highlight
  const handleMarkerHover = useCallback((marker) => {
    if (!marker) {
      setHoveredCaveId(null)
      return
    }
    setHoveredCaveId(marker.id)
    const el = cardRefsMap.current[marker.id]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [])

  // Card hovered → after 1s delay, highlight map marker + pan
  const handleCardEnter = useCallback((caveId) => {
    clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      setHoveredCaveId(caveId)
    }, 1000)
  }, [])

  const handleCardLeave = useCallback(() => {
    clearTimeout(hoverTimerRef.current)
    setHoveredCaveId(null)
  }, [])

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Explore Caves</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--cyber-text-dim)]">
            {filtered.length} cave{filtered.length !== 1 ? 's' : ''}
          </span>
          <Link to="/caves/new"
            className="px-4 py-1.5 rounded-full text-sm font-semibold no-underline
              bg-gradient-to-r from-cyan-600 to-cyan-700 text-white
              shadow-[0_0_12px_rgba(0,229,255,0.2)] active:scale-[0.97] transition-all">
            + New Cave
          </Link>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search caves..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="cyber-input w-full px-4 py-2.5 mb-6"
      />

      {/* Overview map */}
      {mapCenter && !loading && (
        <div className="mb-6">
          <SurfaceMap
            center={mapCenter}
            markers={markers}
            zoom={markers.length === 1 ? 13 : 10}
            height="16rem"
            onMarkerClick={(m) => navigate(`/caves/${m.id}`)}
            onMarkerHover={handleMarkerHover}
            highlightedMarkerId={hoveredCaveId}
            className="border border-[var(--cyber-border)]"
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
              ref={el => { cardRefsMap.current[cave.id] = el }}
              to={`/caves/${cave.id}`}
              onMouseEnter={() => handleCardEnter(cave.id)}
              onMouseLeave={handleCardLeave}
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
              <h3 className="font-semibold text-[var(--cyber-text)]">{cave.name}</h3>
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
              </div>

              <p className="text-xs text-[var(--cyber-text-dim)] mt-3 line-clamp-2">
                {cave.description || 'No description yet'}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
