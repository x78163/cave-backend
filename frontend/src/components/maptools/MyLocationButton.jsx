import { useState, useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'

const GPS_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="3" />
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="2" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
  </svg>
)

export default function MyLocationButton({ map, homeCenter = null }) {
  const [status, setStatus] = useState('idle') // idle | locating | active | error
  const [viewingUser, setViewingUser] = useState(false) // true = centered on user, false = default
  const [errorMsg, setErrorMsg] = useState(null)
  const watchIdRef = useRef(null)
  const dotRef = useRef(null)
  const ringRef = useRef(null)
  const hasCenteredRef = useRef(false)

  // Clean up layers + watcher when map changes or unmounts
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      if (dotRef.current) { dotRef.current.remove(); dotRef.current = null }
      if (ringRef.current) { ringRef.current.remove(); ringRef.current = null }
      hasCenteredRef.current = false
    }
  }, [map])

  // Reset when map becomes null
  useEffect(() => {
    if (!map) {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      dotRef.current = null
      ringRef.current = null
      hasCenteredRef.current = false
      setStatus('idle')
    }
  }, [map])

  const handleClick = useCallback(() => {
    if (!map) return

    if (!navigator.geolocation) {
      setStatus('error')
      setErrorMsg('Geolocation not available')
      setTimeout(() => { setErrorMsg(null); setStatus('idle') }, 4000)
      return
    }

    // Already tracking — toggle between user location and home
    if (status === 'active') {
      if (viewingUser && homeCenter) {
        map.setView(homeCenter, map.getZoom(), { animate: true })
        setViewingUser(false)
      } else if (dotRef.current) {
        map.setView(dotRef.current.getLatLng(), Math.max(map.getZoom(), 16), { animate: true })
        setViewingUser(true)
      }
      return
    }

    // Start locating
    setStatus('locating')
    setErrorMsg(null)
    hasCenteredRef.current = false

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        const latlng = L.latLng(latitude, longitude)

        if (!dotRef.current) {
          dotRef.current = L.circleMarker(latlng, {
            radius: 8,
            className: 'my-location-dot',
            fillColor: '#4285f4',
            fillOpacity: 1,
            color: '#fff',
            weight: 2,
            pane: 'markerPane',
          }).addTo(map)
        } else {
          dotRef.current.setLatLng(latlng)
        }

        if (!ringRef.current) {
          ringRef.current = L.circle(latlng, {
            radius: accuracy,
            className: 'my-location-ring',
            fillColor: '#4285f4',
            fillOpacity: 0.1,
            color: '#4285f4',
            weight: 1,
            opacity: 0.3,
          }).addTo(map)
        } else {
          ringRef.current.setLatLng(latlng)
          ringRef.current.setRadius(accuracy)
        }

        setStatus('active')

        if (!hasCenteredRef.current) {
          hasCenteredRef.current = true
          map.setView(latlng, Math.max(map.getZoom(), 16), { animate: true })
          setViewingUser(true)
        }
      },
      (err) => {
        setStatus('error')
        const msgs = {
          [err.PERMISSION_DENIED]: 'Location access denied',
          [err.POSITION_UNAVAILABLE]: 'Position unavailable',
          [err.TIMEOUT]: 'Location timed out',
        }
        setErrorMsg(msgs[err.code] || 'Location error')
        setTimeout(() => { setErrorMsg(null); setStatus('idle') }, 4000)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    )
  }, [map, status, viewingUser, homeCenter])

  return (
    <div className="relative inline-flex">
      <button
        onClick={handleClick}
        title={
          status === 'error' ? errorMsg :
          status === 'locating' ? 'Locating...' :
          status === 'active' ? (viewingUser && homeCenter ? 'Back to cave' : 'Go to my location') :
          'Show my location'
        }
        className={`w-9 h-9 rounded-lg flex items-center justify-center
          transition-all shadow-lg backdrop-blur-sm border
          ${status === 'active'
            ? 'bg-[#0a0a12]/80 text-[#4285f4] border-[#4285f4]/50 shadow-[0_0_8px_rgba(66,133,244,0.3)]'
            : status === 'error'
              ? 'bg-[#0a0a12]/80 text-red-400 border-red-700/50'
              : status === 'locating'
                ? 'bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border-[var(--cyber-border)] animate-pulse'
                : 'bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border-[var(--cyber-border)] hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50'
          }`}
      >
        {GPS_ICON}
      </button>
      {status === 'error' && errorMsg && (
        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 whitespace-nowrap
          px-2 py-1 rounded text-[10px] bg-[#0a0a12]/95 text-red-400 border border-red-700/50
          backdrop-blur-sm shadow-lg pointer-events-none">
          {errorMsg}
        </div>
      )}
    </div>
  )
}
