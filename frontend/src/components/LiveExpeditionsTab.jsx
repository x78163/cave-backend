import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../hooks/useApi'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const STATE_BADGE = {
  active: { bg: 'bg-green-900/30', border: 'border-green-700/30', text: 'text-green-400', label: 'Active' },
  underground: { bg: 'bg-amber-900/20', border: 'border-amber-700/30', text: 'text-amber-400', label: 'Underground' },
  surfaced: { bg: 'bg-green-900/30', border: 'border-green-700/30', text: 'text-green-400', label: 'Surfaced' },
  overdue: { bg: 'bg-red-900/20', border: 'border-red-700/30', text: 'text-red-400', label: 'Overdue' },
  alert_sent: { bg: 'bg-red-900/30', border: 'border-red-700', text: 'text-red-500', label: 'Alert Sent' },
  emergency_sent: { bg: 'bg-red-900/40', border: 'border-red-600', text: 'text-red-500', label: 'Emergency' },
}

const STATE_COLORS = {
  active: '#22c55e',
  underground: '#f59e0b',
  surfaced: '#22c55e',
  overdue: '#ef4444',
  alert_sent: '#ef4444',
  emergency_sent: '#ef4444',
}

/* ── Combined Overview Map ──────────────────────────────────────── */

function OverviewMap({ expeditions }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])

  useEffect(() => {
    if (!containerRef.current) return
    if (!mapRef.current) {
      const map = L.map(containerRef.current, {
        center: [39.8, -98.6],
        zoom: 5,
        scrollWheelZoom: false,
        zoomControl: true,
      })
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
      }).addTo(map)
      mapRef.current = map
    }
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  // Update markers when expeditions change
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear old markers
    markersRef.current.forEach(m => map.removeLayer(m))
    markersRef.current = []

    const bounds = []

    expeditions.forEach(exp => {
      const color = STATE_COLORS[exp.state] || '#22c55e'

      // GPS trail points
      if (exp.last_gps_points?.length > 0) {
        exp.last_gps_points.forEach(pt => {
          const marker = L.circleMarker([pt.latitude, pt.longitude], {
            radius: 6, color, fillColor: color, fillOpacity: 0.8, weight: 2,
          }).addTo(map)
          marker.bindPopup(`<b>${exp.event_name}</b><br>${pt.username}<br>Last: ${new Date(pt.recorded_at).toLocaleTimeString()}`)
          markersRef.current.push(marker)
          bounds.push([pt.latitude, pt.longitude])
        })
      }

      // Cave marker (always show if we have coords)
      if (exp.cave_latitude && exp.cave_longitude) {
        const caveMarker = L.circleMarker([exp.cave_latitude, exp.cave_longitude], {
          radius: 10, color, fillColor: color, fillOpacity: 0.2, weight: 2,
          dashArray: '4 4',
        }).addTo(map)
        caveMarker.bindPopup(`<b>${exp.event_name}</b><br>${exp.cave_name || 'Cave'}<br>Status: ${STATE_BADGE[exp.state]?.label || exp.state}`)
        markersRef.current.push(caveMarker)
        bounds.push([exp.cave_latitude, exp.cave_longitude])
      }
    })

    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 14)
    }
  }, [expeditions])

  return (
    <div
      ref={containerRef}
      className="rounded-lg overflow-hidden border border-[var(--cyber-border)] mb-6"
      style={{ height: 300 }}
    />
  )
}

/* ── Main Component ─────────────────────────────────────────────── */

export default function LiveExpeditionsTab() {
  const [expeditions, setExpeditions] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const fetchLive = useCallback(async () => {
    try {
      const data = await apiFetch('/events/live/')
      setExpeditions(data)
    } catch {
      setExpeditions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLive()
    const interval = setInterval(fetchLive, 30000)
    return () => clearInterval(interval)
  }, [fetchLive])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="text-sm text-[var(--cyber-text-dim)]">Loading live expeditions...</div>
      </div>
    )
  }

  if (expeditions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-3 h-3 rounded-full bg-green-500/30 animate-pulse mb-4" />
        <div className="text-sm text-[var(--cyber-text-dim)]">No active expeditions</div>
        <div className="text-xs text-[var(--cyber-text-dim)] mt-1">
          Live expedition tracking will appear here when an expedition is in progress
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Combined overview map */}
      <OverviewMap expeditions={expeditions} />

      {/* Expedition cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {expeditions.map(exp => {
          const badge = STATE_BADGE[exp.state] || STATE_BADGE.active
          const timeSinceStart = exp.started_at
            ? _formatElapsed(new Date(exp.started_at))
            : null
          const isOverdue = exp.expected_return && new Date(exp.expected_return) < new Date()
          const hasGps = exp.last_gps_points?.length > 0
          const hasCave = exp.cave_latitude && exp.cave_longitude

          return (
            <div
              key={exp.id}
              onClick={() => navigate(`/events/${exp.event}`)}
              className="cyber-card p-4 cursor-pointer hover:border-[var(--cyber-cyan)]/50 transition-colors"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[var(--cyber-text)] truncate">
                    {exp.event_name}
                  </div>
                  {exp.cave_name && (
                    <div className="text-xs text-[var(--cyber-text-dim)] mt-0.5">
                      {exp.cave_name}
                    </div>
                  )}
                </div>

                {/* Status badge */}
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${badge.bg} ${badge.border} ${badge.text} border flex items-center gap-1`}>
                  {['underground', 'overdue', 'alert_sent', 'emergency_sent'].includes(exp.state) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  )}
                  {badge.label}
                </span>
              </div>

              {/* Mini map — show when GPS points OR cave location exists */}
              {(hasGps || hasCave) && (
                <div className="mb-3" onClick={e => e.stopPropagation()}>
                  <MiniExpeditionMap
                    gpsPoints={exp.last_gps_points || []}
                    caveLatitude={exp.cave_latitude}
                    caveLongitude={exp.cave_longitude}
                    state={exp.state}
                  />
                </div>
              )}

              {/* Stats */}
              <div className="flex items-center gap-4 text-xs text-[var(--cyber-text-dim)]">
                <span>{exp.checkin_count}/{exp.rsvp_count} checked in</span>
                {timeSinceStart && <span>{timeSinceStart}</span>}
                {exp.expected_return && (
                  <span className={isOverdue ? 'text-red-400 font-bold' : ''}>
                    Return: {new Date(exp.expected_return).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>

              {/* Leader */}
              <div className="text-[10px] text-[var(--cyber-text-dim)] mt-2">
                Led by {exp.creator_username}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Mini map for individual expedition cards ────────────────────── */

function MiniExpeditionMap({ gpsPoints, caveLatitude, caveLongitude, state }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const center = caveLatitude && caveLongitude
      ? [caveLatitude, caveLongitude]
      : gpsPoints.length > 0
        ? [gpsPoints[0].latitude, gpsPoints[0].longitude]
        : [39.8, -98.6]

    const map = L.map(containerRef.current, {
      center,
      zoom: 15,
      scrollWheelZoom: false,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
    })

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map)

    const color = STATE_COLORS[state] || '#22c55e'
    const bounds = []

    // Cave marker
    if (caveLatitude && caveLongitude) {
      L.circleMarker([caveLatitude, caveLongitude], {
        radius: 8, color: '#00d4ff', fillColor: '#00d4ff',
        fillOpacity: 0.3, weight: 2,
      }).addTo(map)
      bounds.push([caveLatitude, caveLongitude])
    }

    // GPS points
    if (gpsPoints.length > 0) {
      gpsPoints.forEach(pt => {
        L.circleMarker([pt.latitude, pt.longitude], {
          radius: 5, color, fillColor: color, fillOpacity: 0.8, weight: 2,
        }).addTo(map)
        bounds.push([pt.latitude, pt.longitude])
      })
    }

    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 })
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 15)
    }

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [gpsPoints, caveLatitude, caveLongitude, state])

  return (
    <div
      ref={containerRef}
      className="rounded-lg overflow-hidden border border-[var(--cyber-border)]"
      style={{ height: 150 }}
    />
  )
}

function _formatElapsed(startDate) {
  const diff = Date.now() - startDate.getTime()
  const hours = Math.floor(diff / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  if (hours > 0) return `${hours}h ${minutes}m elapsed`
  return `${minutes}m elapsed`
}
