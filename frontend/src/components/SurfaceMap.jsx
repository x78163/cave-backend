import { useRef, useEffect } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import CaveMapOverlay from './CaveMapOverlay'

// Cyan marker SVG for cave locations
const caveIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
  <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z" fill="#00e5ff" stroke="#0a0a12" stroke-width="2"/>
  <circle cx="14" cy="14" r="6" fill="#0a0a12"/>
</svg>`

const caveIcon = L.divIcon({
  html: caveIconSvg,
  className: 'cave-marker',
  iconSize: [28, 40],
  iconAnchor: [14, 40],
  popupAnchor: [0, -40],
})

/**
 * Reusable Leaflet map component for surface maps.
 *
 * Props:
 *   center       [lat, lon] — map center (required)
 *   markers      [{lat, lon, label, id}] — cave markers
 *   zoom         number — initial zoom (default 13)
 *   height       string — CSS height (default "12rem")
 *   onMarkerClick     (marker) => void
 *   interactive       bool — enable pan/zoom (default true)
 *   className         string — additional CSS classes
 */
export default function SurfaceMap({
  center,
  markers = [],
  zoom = 13,
  height = '12rem',
  onMarkerClick,
  interactive = true,
  className = '',
  caveMapData = null,
  cavePois = [],
  caveHeading = 0,
  caveOverlayVisible = false,
  caveOverlayOpacity = 0.6,
  caveOverlayLevel = 0,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || !center) return

    // Initialize map
    const map = L.map(containerRef.current, {
      center,
      zoom,
      maxZoom: 19,
      zoomControl: interactive,
      dragging: interactive,
      touchZoom: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: false,
      keyboard: false,
      attributionControl: false,
    })

    // Public OSM tile layer
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      minZoom: 3,
    }).addTo(map)

    // Add markers
    markers.forEach((m) => {
      if (m.lat == null || m.lon == null) return
      const marker = L.marker([m.lat, m.lon], { icon: caveIcon }).addTo(map)
      if (m.label) {
        marker.bindPopup(
          `<div class="cave-popup">${m.label}</div>`,
          { className: 'cave-popup-container' }
        )
        // Permanent label visible on the map
        marker.bindTooltip(m.label, {
          permanent: true,
          direction: 'right',
          offset: [12, -20],
          className: 'cave-label',
        })
      }
      if (onMarkerClick) {
        marker.on('click', () => onMarkerClick(m))
      }
    })

    // Fit bounds if multiple markers
    if (markers.length > 1) {
      const validMarkers = markers.filter(m => m.lat != null && m.lon != null)
      if (validMarkers.length > 1) {
        const bounds = L.latLngBounds(validMarkers.map(m => [m.lat, m.lon]))
        map.fitBounds(bounds, { padding: [30, 30] })
      }
    }

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [center?.[0], center?.[1], markers.length])

  // Determine anchor point for cave overlay (first marker with lat/lon)
  const anchor = markers.find(m => m.lat != null && m.lon != null)

  if (!center) return null

  return (
    <>
      <div
        ref={containerRef}
        className={`surface-map rounded-xl overflow-hidden ${className}`}
        style={{ height, width: '100%' }}
      />
      <CaveMapOverlay
        map={mapRef.current}
        mapData={caveMapData}
        pois={cavePois}
        anchorLat={anchor?.lat}
        anchorLon={anchor?.lon}
        heading={caveHeading}
        selectedLevel={caveOverlayLevel}
        opacity={caveOverlayOpacity}
        visible={caveOverlayVisible}
      />
    </>
  )
}
