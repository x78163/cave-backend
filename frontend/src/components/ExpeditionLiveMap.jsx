import { useEffect, useRef, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Color palette for participants
const PARTICIPANT_COLORS = [
  '#00d4ff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
]

export default function ExpeditionLiveMap({ gpsTrail, caveLatitude, caveLongitude, height = 300 }) {
  const mapRef = useRef(null)
  const containerRef = useRef(null)
  const markersRef = useRef({})
  const polylinesRef = useRef({})

  // Group GPS points by user
  const pointsByUser = useMemo(() => {
    const grouped = {}
    for (const pt of (gpsTrail || [])) {
      const key = pt.user || pt.username
      if (!grouped[key]) grouped[key] = { username: pt.username, points: [] }
      grouped[key].points.push(pt)
    }
    return grouped
  }, [gpsTrail])

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const center = caveLatitude && caveLongitude
      ? [caveLatitude, caveLongitude]
      : [39.8, -98.6]

    const map = L.map(containerRef.current, {
      center,
      zoom: 15,
      scrollWheelZoom: false,
      zoomControl: true,
    })

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; CartoDB',
      maxZoom: 19,
    }).addTo(map)

    // Cave marker
    if (caveLatitude && caveLongitude) {
      L.circleMarker([caveLatitude, caveLongitude], {
        radius: 8, color: '#00d4ff', fillColor: '#00d4ff',
        fillOpacity: 0.3, weight: 2,
      }).addTo(map).bindPopup('Cave')
    }

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update markers and polylines when GPS trail changes
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear existing
    Object.values(markersRef.current).forEach(m => map.removeLayer(m))
    Object.values(polylinesRef.current).forEach(p => map.removeLayer(p))
    markersRef.current = {}
    polylinesRef.current = {}

    const userKeys = Object.keys(pointsByUser)
    const bounds = []

    userKeys.forEach((key, idx) => {
      const { username, points } = pointsByUser[key]
      const color = PARTICIPANT_COLORS[idx % PARTICIPANT_COLORS.length]
      const latLngs = points.map(p => [p.latitude, p.longitude])

      if (latLngs.length === 0) return

      // Polyline trail
      const polyline = L.polyline(latLngs, {
        color, weight: 3, opacity: 0.7,
      }).addTo(map)
      polylinesRef.current[key] = polyline

      // Current position marker (last point)
      const lastPt = points[points.length - 1]
      const marker = L.circleMarker([lastPt.latitude, lastPt.longitude], {
        radius: 7, color, fillColor: color,
        fillOpacity: 0.8, weight: 2,
      }).addTo(map)

      const timeStr = new Date(lastPt.recorded_at).toLocaleTimeString()
      marker.bindTooltip(username, { permanent: true, direction: 'top', className: 'expedition-label' })
      marker.bindPopup(`<b>${username}</b><br>Last: ${timeStr}`)
      markersRef.current[key] = marker

      bounds.push(...latLngs)
    })

    // Add cave to bounds
    if (caveLatitude && caveLongitude) {
      bounds.push([caveLatitude, caveLongitude])
    }

    // Fit bounds if we have points
    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 })
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 16)
    }
  }, [pointsByUser, caveLatitude, caveLongitude])

  return (
    <div>
      <div
        ref={containerRef}
        className="rounded-lg overflow-hidden border border-[var(--cyber-border)]"
        style={{ height }}
      />
      {/* Legend */}
      {Object.keys(pointsByUser).length > 0 && (
        <div className="flex flex-wrap gap-3 mt-2">
          {Object.keys(pointsByUser).map((key, idx) => {
            const { username, points } = pointsByUser[key]
            const color = PARTICIPANT_COLORS[idx % PARTICIPANT_COLORS.length]
            const last = points[points.length - 1]
            return (
              <div key={key} className="flex items-center gap-1.5 text-xs">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[var(--cyber-text)]">{username}</span>
                <span className="text-[var(--cyber-text-dim)]">
                  {new Date(last.recorded_at).toLocaleTimeString()}
                </span>
              </div>
            )
          })}
        </div>
      )}
      <style>{`
        .expedition-label {
          background: rgba(10, 10, 18, 0.85) !important;
          border: 1px solid var(--cyber-border) !important;
          color: var(--cyber-text) !important;
          font-size: 10px !important;
          padding: 2px 6px !important;
          border-radius: 4px !important;
          box-shadow: none !important;
        }
        .expedition-label::before { display: none !important; }
      `}</style>
    </div>
  )
}
