import { useRef, useEffect } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import CaveMapOverlay from './CaveMapOverlay'

// Cyan marker SVG for cave locations
const caveIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
  <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z" fill="#00e5ff" stroke="#0a0a12" stroke-width="2"/>
  <circle cx="14" cy="14" r="6" fill="#0a0a12"/>
</svg>`

const highlightIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="48" viewBox="0 0 34 48">
  <path d="M17 0C7.6 0 0 7.6 0 17c0 12.75 17 31 17 31s17-18.25 17-31C34 7.6 26.4 0 17 0z" fill="#fff" stroke="#00e5ff" stroke-width="2.5"/>
  <circle cx="17" cy="17" r="7" fill="#00e5ff"/>
</svg>`

const caveIcon = L.divIcon({
  html: caveIconSvg,
  className: 'cave-marker',
  iconSize: [28, 40],
  iconAnchor: [14, 40],
  popupAnchor: [0, -40],
})

const highlightIcon = L.divIcon({
  html: highlightIconSvg,
  className: 'cave-marker cave-marker-highlight',
  iconSize: [34, 48],
  iconAnchor: [17, 48],
  popupAnchor: [0, -48],
})

/**
 * Reusable Leaflet map component for surface maps.
 *
 * Props:
 *   center            [lat, lon] — map center (required)
 *   markers           [{lat, lon, label, id}] — cave markers
 *   zoom              number — initial zoom (default 13)
 *   height            string — CSS height (default "12rem")
 *   onMarkerClick     (marker) => void
 *   onMarkerHover     (marker | null) => void — called on marker mouseover/mouseout
 *   highlightedMarkerId  string|number — externally highlighted marker id
 *   interactive       bool — enable pan/zoom (default true)
 *   className         string — additional CSS classes
 */
export default function SurfaceMap({
  center,
  markers = [],
  zoom = 13,
  height = '12rem',
  onMarkerClick,
  onMarkerHover,
  highlightedMarkerId,
  interactive = true,
  className = '',
  caveMapData = null,
  caveMapMode = 'standard',
  cavePois = [],
  caveHeading = 0,
  caveOverlayVisible = false,
  caveOverlayOpacity = 0.6,
  caveOverlayLevel = 0,
  parcelGeometry = null,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerMapRef = useRef({}) // id → Leaflet marker
  const parcelLayerRef = useRef(null)

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
    const markerLookup = {}
    markers.forEach((m) => {
      if (m.lat == null || m.lon == null) return
      const marker = L.marker([m.lat, m.lon], { icon: caveIcon }).addTo(map)
      if (m.id != null) markerLookup[m.id] = marker
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
      if (onMarkerHover) {
        marker.on('mouseover', () => onMarkerHover(m))
        marker.on('mouseout', () => onMarkerHover(null))
      }
    })
    markerMapRef.current = markerLookup

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
      markerMapRef.current = {}
      parcelLayerRef.current = null
    }
  }, [center?.[0], center?.[1], markers.length])

  // React to external highlight changes — swap icon and pan
  useEffect(() => {
    const lookup = markerMapRef.current
    // Reset all markers to default icon
    Object.values(lookup).forEach(m => m.setIcon(caveIcon))
    // Highlight + pan to the active one
    if (highlightedMarkerId != null && lookup[highlightedMarkerId]) {
      const m = lookup[highlightedMarkerId]
      m.setIcon(highlightIcon)
      m.setZIndexOffset(1000)
      if (mapRef.current) {
        mapRef.current.panTo(m.getLatLng(), { animate: true, duration: 0.4 })
      }
    }
  }, [highlightedMarkerId])

  // Render parcel boundary polygon
  useEffect(() => {
    if (parcelLayerRef.current) {
      parcelLayerRef.current.remove()
      parcelLayerRef.current = null
    }
    if (!mapRef.current || !parcelGeometry || !parcelGeometry.length) return
    // parcelGeometry is [[lat, lon], ...] rings — Leaflet expects [lat, lng]
    const polygon = L.polygon(parcelGeometry, {
      color: '#00e5ff',
      weight: 2,
      opacity: 0.7,
      fillColor: '#00e5ff',
      fillOpacity: 0.08,
      dashArray: '6, 4',
    }).addTo(mapRef.current)
    parcelLayerRef.current = polygon
  }, [parcelGeometry, center?.[0], center?.[1]])

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
        mode={caveMapMode}
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
