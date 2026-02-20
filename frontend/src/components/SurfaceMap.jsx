import { useRef, useEffect } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
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
 *   center            [lat, lon] — map center (required)
 *   markers           [{lat, lon, label, id}] — cave markers
 *   zoom              number — initial zoom (default 13)
 *   height            string — CSS height (default "12rem")
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
  caveMapMode = 'standard',
  cavePois = [],
  caveHeading = 0,
  caveOverlayVisible = false,
  caveOverlayOpacity = 0.6,
  caveOverlayLevel = 0,
  parcelGeometry = null,
  onViewChange = null,
  showCenterButton = false,
  initialView = null,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const parcelLayerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || !center) return

    // Initialize map — use saved view if available
    const initCenter = initialView ? initialView.center : center
    const initZoom = initialView ? initialView.zoom : zoom

    const map = L.map(containerRef.current, {
      center: initCenter,
      zoom: initZoom,
      maxZoom: 21,
      zoomControl: interactive,
      dragging: interactive,
      touchZoom: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: false,
      keyboard: false,
      attributionControl: false,
    })

    // Public OSM tile layer (native tiles up to 19, Leaflet upscales to 21)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 21,
      maxNativeZoom: 19,
      minZoom: 3,
    }).addTo(map)

    // Report view changes for persistence
    if (onViewChange) {
      map.on('moveend', () => {
        const c = map.getCenter()
        onViewChange({ center: [c.lat, c.lng], zoom: map.getZoom() })
      })
    }

    // Add markers — use clustering when many markers, direct when few
    const useClustering = markers.length > 20
    const clusterGroup = useClustering
      ? L.markerClusterGroup({
          maxClusterRadius: 50,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          iconCreateFunction: (cluster) => L.divIcon({
            html: `<div class="cave-cluster">${cluster.getChildCount()}</div>`,
            className: 'cave-cluster-icon',
            iconSize: [36, 36],
          }),
        })
      : null

    markers.forEach((m) => {
      if (m.lat == null || m.lon == null) return
      const marker = L.marker([m.lat, m.lon], { icon: caveIcon })
      if (m.label) {
        marker.bindPopup(
          `<div class="cave-popup">${m.label}</div>`,
          { className: 'cave-popup-container' }
        )
        marker.bindTooltip(m.label, {
          permanent: !useClustering,
          direction: 'right',
          offset: [12, -20],
          className: 'cave-label',
        })
      }
      if (onMarkerClick) {
        marker.on('click', () => onMarkerClick(m))
      }
      if (clusterGroup) {
        clusterGroup.addLayer(marker)
      } else {
        marker.addTo(map)
      }
    })

    if (clusterGroup) {
      map.addLayer(clusterGroup)
    }

    // Fit bounds if multiple markers (skip if restoring a saved view)
    if (!initialView && markers.length > 1) {
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
      parcelLayerRef.current = null
    }
  }, [center?.[0], center?.[1], markers.length])

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
      <div className="relative">
        <div
          ref={containerRef}
          className={`surface-map rounded-xl overflow-hidden ${className}`}
          style={{ height, width: '100%' }}
        />
        {showCenterButton && (
          <button
            onClick={() => {
              if (mapRef.current) {
                mapRef.current.setView(center, zoom, { animate: true })
              }
            }}
            className="absolute bottom-3 left-3 z-[1000] px-3 py-1.5 rounded-full text-xs font-medium
              bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
              backdrop-blur-sm hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50 transition-all shadow-lg"
            title="Center on cave"
          >
            ⌖ Center
          </button>
        )}
      </div>
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
