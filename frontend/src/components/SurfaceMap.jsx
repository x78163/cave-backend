import { useRef, useEffect, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import CaveMapOverlay, { slamToLatLng } from './CaveMapOverlay'
import HandDrawnMapOverlay from './HandDrawnMapOverlay'
import SurveyOverlay from './SurveyOverlay'
import MapToolbar from './maptools/MapToolbar'
import SurveyLayerPanel from './SurveyLayerPanel'
import {
  BASE_LAYERS, getStoredLayerId, storeLayerId, getLayerById,
  getStoredHillshade, storeHillshade, create3DEPHillshadeLayer, HILLSHADE_OVERLAY,
} from '../utils/mapLayers'

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

// Red marker SVG for approximate locations
const approxIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
  <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z" fill="#ff006e" stroke="#0a0a12" stroke-width="2"/>
  <circle cx="14" cy="14" r="6" fill="#0a0a12"/>
</svg>`

const approxIcon = L.divIcon({
  html: approxIconSvg,
  className: 'cave-marker',
  iconSize: [28, 40],
  iconAnchor: [14, 40],
  popupAnchor: [0, -40],
})

// Green marker SVG for additional cave entrances
const entranceIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="32" viewBox="0 0 22 32">
  <path d="M11 0C4.9 0 0 4.9 0 11c0 8.25 11 21 11 21s11-12.75 11-21C22 4.9 17.1 0 11 0z" fill="#4ade80" stroke="#0a0a12" stroke-width="1.5"/>
  <circle cx="11" cy="11" r="4.5" fill="#0a0a12"/>
</svg>`

const entranceIcon = L.divIcon({
  html: entranceIconSvg,
  className: 'cave-marker',
  iconSize: [22, 32],
  iconAnchor: [11, 32],
  popupAnchor: [0, -32],
})

// Purple marker SVG for nearby caves (smaller than standard)
const nearbyIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="26" viewBox="0 0 18 26">
  <path d="M9 0C4 0 0 4 0 9c0 6.75 9 17 9 17s9-10.25 9-17C18 4 14 0 9 0z" fill="#a78bfa" stroke="#0a0a12" stroke-width="1.5"/>
  <circle cx="9" cy="9" r="3.5" fill="#0a0a12"/>
</svg>`

const nearbyIcon = L.divIcon({
  html: nearbyIconSvg,
  className: 'cave-marker nearby-marker',
  iconSize: [18, 26],
  iconAnchor: [9, 26],
  popupAnchor: [0, -26],
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
  onMapReady = null,
  // Survey map overlay props (scanned images)
  surveyMaps = [],
  visibleImageIds = new Set(),
  onToggleImageOverlay,
  editingSurveyId = null,
  onSurveyUpdated,
  onEditStart,
  onEditEnd,
  onDeleteSurvey,
  caveId = null,
  // Unified survey layer panel props
  surveys = [],
  activeSurveyOverlays = {},
  onToggleSurveyOverlay,
  onAddSurveyMap,
  // Multi-point registration converter
  converter = null,
  // Additional entrance markers
  entranceMarkers = [],
  // Nearby cave markers + survey overlays
  nearbyMarkers = [],
  nearbySurveyOverlays = {},
  onToggleNearbySurvey = null,
  // Map tools
  enableMapTools = false,
  enableTier2Tools = false,
  waypoints = [],
  onWaypointsChange = null,
  annotations = [],
  onAnnotationsChange = null,
}) {
  const [activeLayerId, setActiveLayerId] = useState(getStoredLayerId)
  const [layerMenuOpen, setLayerMenuOpen] = useState(false)
  const [hillshadeOn, setHillshadeOn] = useState(getStoredHillshade)
  const activeLayerRef = useRef(getStoredLayerId())
  const tileLayerRef = useRef(null)
  const hillshadeLayerRef = useRef(null)
  const hillshadeOnRef = useRef(getStoredHillshade())
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const parcelLayerRef = useRef(null)
  const entranceLayerRef = useRef(null)
  const nearbyLayerRef = useRef(null)
  const markerGroupRef = useRef(null)

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
      attributionControl: true,
      renderer: L.svg({ padding: 2.0 }),
    })

    // Dynamic tile layer based on user selection
    const layerConfig = getLayerById(activeLayerRef.current)
    const tile = L.tileLayer(layerConfig.url, {
      ...layerConfig.options,
      attribution: layerConfig.attribution,
    }).addTo(map)
    tileLayerRef.current = tile

    // Apply per-layer CSS filter directly on the tile pane
    const tilePane = map.getPane('tilePane')
    if (tilePane) tilePane.style.filter = layerConfig.filter || ''

    // 3DEP LiDAR hillshade overlay (if previously enabled)
    const hsLayer = create3DEPHillshadeLayer(L)
    hillshadeLayerRef.current = hsLayer
    if (hillshadeOnRef.current) hsLayer.addTo(map)

    // Report view changes for persistence
    if (onViewChange) {
      map.on('moveend', () => {
        const c = map.getCenter()
        onViewChange({ center: [c.lat, c.lng], zoom: map.getZoom() })
      })
    }

    mapRef.current = map
    if (onMapReady) onMapReady(map)

    return () => {
      map.remove()
      mapRef.current = null
      markerGroupRef.current = null
      parcelLayerRef.current = null
      if (onMapReady) onMapReady(null)
    }
  }, [center?.[0], center?.[1]])  // eslint-disable-line react-hooks/exhaustive-deps

  // Reactively manage cave markers without destroying the map
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove old marker layer
    if (markerGroupRef.current) {
      map.removeLayer(markerGroupRef.current)
      markerGroupRef.current = null
    }

    if (markers.length === 0) return

    const useClustering = markers.length > 20
    const group = useClustering
      ? L.markerClusterGroup({
          maxClusterRadius: 50,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          iconCreateFunction: (cluster) => {
            const children = cluster.getAllChildMarkers()
            const allApprox = children.length > 0 && children.every(m => m.options.approximate)
            const cls = allApprox ? 'cave-cluster cave-cluster-approx' : 'cave-cluster'
            return L.divIcon({
              html: `<div class="${cls}">${cluster.getChildCount()}</div>`,
              className: 'cave-cluster-icon',
              iconSize: [36, 36],
            })
          },
        })
      : L.layerGroup()

    markers.forEach((m) => {
      if (m.lat == null || m.lon == null) return
      const icon = m.approximate ? approxIcon : caveIcon
      const marker = L.marker([m.lat, m.lon], { icon, approximate: !!m.approximate })
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
      group.addLayer(marker)
    })

    group.addTo(map)
    markerGroupRef.current = group
  }, [markers])  // eslint-disable-line react-hooks/exhaustive-deps

  // Render entrance markers (reactive to entranceMarkers changes)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Remove old entrance layer
    if (entranceLayerRef.current) {
      map.removeLayer(entranceLayerRef.current)
      entranceLayerRef.current = null
    }
    if (entranceMarkers.length === 0) return
    const group = L.layerGroup()
    entranceMarkers.forEach((m) => {
      if (m.lat == null || m.lon == null) return
      const marker = L.marker([m.lat, m.lon], { icon: entranceIcon })
      if (m.label) {
        marker.bindPopup(
          `<div class="cave-popup">${m.label}</div>`,
          { className: 'cave-popup-container' }
        )
        marker.bindTooltip(m.label, {
          permanent: false,
          direction: 'right',
          offset: [10, -16],
          className: 'cave-label',
        })
      }
      marker.addTo(group)
    })
    group.addTo(map)
    entranceLayerRef.current = group
  }, [entranceMarkers])

  // Render nearby cave markers (reactive to nearbyMarkers changes)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (nearbyLayerRef.current) {
      map.removeLayer(nearbyLayerRef.current)
      nearbyLayerRef.current = null
    }

    if (nearbyMarkers.length === 0) return

    const group = L.layerGroup()
    nearbyMarkers.forEach((m) => {
      if (m.lat == null || m.lon == null) return
      const marker = L.marker([m.lat, m.lon], { icon: nearbyIcon })

      const surveyBtn = m.hasSurvey
        ? `<button class="nearby-survey-btn" data-cave-id="${m.id}"
             style="color:#a78bfa;text-decoration:underline;cursor:pointer;background:none;border:none;font-size:11px;padding:0;margin-top:4px;display:block;width:100%">
             Toggle Survey
           </button>`
        : ''

      marker.bindPopup(
        `<div class="cave-popup" style="text-align:center">
           <a href="/caves/${m.id}" style="color:#a78bfa;font-weight:600;text-decoration:none">${m.label}</a>
           <div style="font-size:10px;color:#888;margin-top:2px">${m.distance_m}m away</div>
           ${surveyBtn}
         </div>`,
        { className: 'cave-popup-container' }
      )

      marker.bindTooltip(m.label, {
        permanent: false,
        direction: 'right',
        offset: [8, -13],
        className: 'cave-label nearby-cave-label',
      })

      marker.addTo(group)
    })

    group.addTo(map)
    nearbyLayerRef.current = group

    // Leaflet popups stop click propagation, so attach handlers via popupopen
    const onPopupOpen = (e) => {
      const el = e.popup.getElement()
      if (!el) return
      const btn = el.querySelector('.nearby-survey-btn')
      if (btn && onToggleNearbySurvey) {
        btn.addEventListener('click', () => {
          const caveId = btn.dataset.caveId
          const m = nearbyMarkers.find(mk => mk.id === caveId)
          if (m) onToggleNearbySurvey(m)
        })
      }
    }
    map.on('popupopen', onPopupOpen)

    return () => {
      map.off('popupopen', onPopupOpen)
    }
  }, [nearbyMarkers, onToggleNearbySurvey])

  // Notify Leaflet when the container height changes + auto-fit survey overlays
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.invalidateSize({ animate: false })

    // After size update, fit map to show survey image overlays (rotation-aware)
    if (visibleImageIds.size > 0 && surveyMaps.length > 0 && anchor) {
      const aLat = anchor.lat
      const aLon = anchor.lon
      const toShow = surveyMaps.filter(s => visibleImageIds.has(s.id))
      let combined = null
      toShow.forEach(s => {
        const sc = s.scale || 0.1
        const ax = s.anchor_x ?? 0.5
        const ay = s.anchor_y ?? 0.5
        const w = s.image_width || 600
        const h = s.image_height || 500
        const hdg = s.heading || 0
        const latD = (h * sc) / 111320
        const lonD = (w * sc) / (111320 * Math.cos(aLat * Math.PI / 180))
        const south = aLat - (1 - ay) * latD
        const north = aLat + ay * latD
        const west = aLon - ax * lonD
        const east = aLon + (1 - ax) * lonD

        let b
        if (hdg === 0) {
          b = L.latLngBounds([south, west], [north, east])
        } else {
          // Rotated bounding box — rotate corners around anchor
          const corners = [[south, west], [south, east], [north, west], [north, east]]
          const rad = hdg * Math.PI / 180
          const c = Math.cos(rad), sn = Math.sin(rad)
          const rotated = corners.map(([lat, lon]) => {
            const dLat = lat - aLat, dLon = lon - aLon
            return [aLat + dLat * c + dLon * sn, aLon - dLat * sn + dLon * c]
          })
          const lats = rotated.map(r => r[0]), lons = rotated.map(r => r[1])
          b = L.latLngBounds(
            [Math.min(...lats), Math.min(...lons)],
            [Math.max(...lats), Math.max(...lons)]
          )
        }
        combined = combined ? combined.extend(b) : b
      })
      if (combined && !mapRef.current.getBounds().contains(combined)) {
        mapRef.current.fitBounds(combined.pad(0.15), { animate: true, maxZoom: mapRef.current.getZoom() })
      }
    }
  }, [height, visibleImageIds.size, surveyMaps.length])

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

  // Switch tile layer without recreating the map
  const switchLayer = useCallback((newLayerId) => {
    storeLayerId(newLayerId)
    activeLayerRef.current = newLayerId
    setActiveLayerId(newLayerId)
    setLayerMenuOpen(false)

    const map = mapRef.current
    if (!map) return

    const layerConfig = getLayerById(newLayerId)

    // Apply filter BEFORE swapping tiles so old tiles get new filter instantly
    const tilePane = map.getPane('tilePane')
    if (tilePane) tilePane.style.filter = layerConfig.filter || ''

    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current)

    const newTile = L.tileLayer(layerConfig.url, {
      ...layerConfig.options,
      attribution: layerConfig.attribution,
    })
    newTile.addTo(map)
    newTile.bringToBack()
    tileLayerRef.current = newTile
  }, [])

  // Toggle 3DEP LiDAR hillshade overlay
  const toggleHillshade = useCallback(() => {
    const map = mapRef.current
    const hs = hillshadeLayerRef.current
    if (!map || !hs) return

    const next = !hillshadeOnRef.current
    hillshadeOnRef.current = next
    setHillshadeOn(next)
    storeHillshade(next)

    if (next) {
      hs.addTo(map)
    } else {
      map.removeLayer(hs)
    }
  }, [])

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
        {/* Tile layer switcher — top-left */}
        {interactive && (
          <div className="absolute top-3 left-12 z-[1200]">
            <button
              onClick={() => setLayerMenuOpen(v => !v)}
              className="px-2.5 py-1.5 rounded-full text-xs font-medium transition-all shadow-lg
                bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
                backdrop-blur-sm hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50"
            >
              <span className="flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0L0 4l8 4 8-4L8 0z" opacity="0.9"/>
                  <path d="M0 8l8 4 8-4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M0 12l8 4 8-4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                {getLayerById(activeLayerId).label}
              </span>
            </button>
            {layerMenuOpen && (
              <div className="mt-1 rounded-lg bg-[#0a0a12]/95 border border-[var(--cyber-border)]
                backdrop-blur-sm shadow-xl overflow-hidden min-w-[120px]">
                {BASE_LAYERS.map(layer => (
                  <button
                    key={layer.id}
                    onClick={() => switchLayer(layer.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors
                      hover:bg-[var(--cyber-surface-2)]
                      ${activeLayerId === layer.id
                        ? 'text-[var(--cyber-cyan)]'
                        : 'text-[var(--cyber-text-dim)]'
                      }`}
                  >
                    {layer.label}
                  </button>
                ))}
                {/* 3DEP LiDAR hillshade overlay toggle */}
                <div className="border-t border-[var(--cyber-border)]">
                  <button
                    onClick={toggleHillshade}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2
                      hover:bg-[var(--cyber-surface-2)]
                      ${hillshadeOn ? 'text-[var(--cyber-cyan)]' : 'text-[var(--cyber-text-dim)]'}`}
                  >
                    <span className={`inline-block w-3 h-3 rounded-sm border transition-colors
                      ${hillshadeOn
                        ? 'bg-[var(--cyber-cyan)] border-[var(--cyber-cyan)]'
                        : 'border-[var(--cyber-border)]'
                      }`}
                    >
                      {hillshadeOn && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#0a0a12" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                    {HILLSHADE_OVERLAY.label}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {/* Unified survey layer panel — above center button */}
        <SurveyLayerPanel
          surveys={surveys}
          surveyMaps={surveyMaps}
          activeSurveyOverlays={activeSurveyOverlays}
          visibleImageIds={visibleImageIds}
          onToggleSurveyOverlay={onToggleSurveyOverlay}
          onToggleImageOverlay={onToggleImageOverlay}
          onAddSurveyMap={onAddSurveyMap}
          onEditImage={onEditStart}
        />
        {/* North arrow — 12.5% of viewport height, visual reference for overlay alignment */}
        <div
          className="absolute top-3 right-3 z-[1100] flex flex-col items-center pointer-events-none"
          style={{ height: '12.5%', minHeight: 40 }}
          title="North"
        >
          <span className="text-[10px] font-bold text-[var(--cyber-cyan)] leading-none mb-0.5"
            style={{ textShadow: '0 0 6px rgba(0,229,255,0.6)' }}>N</span>
          <svg width="14" viewBox="0 0 14 40" fill="none" className="flex-1" preserveAspectRatio="xMidYMid meet">
            {/* Arrowhead */}
            <path d="M7 0L2 10h10L7 0z" fill="#00e5ff" fillOpacity="0.9" />
            {/* Shaft */}
            <rect x="5.5" y="9" width="3" height="31" rx="1.5" fill="#00e5ff" fillOpacity="0.5" />
          </svg>
        </div>
        {showCenterButton && (
          <div className="absolute bottom-3 left-3 z-[1100] flex gap-2">
            <button
              onClick={() => {
                if (mapRef.current) {
                  mapRef.current.setView(center, mapRef.current.getZoom(), { animate: true })
                }
              }}
              className="px-3 py-1.5 rounded-full text-xs font-medium
                bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
                backdrop-blur-sm hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50 transition-all shadow-lg"
              title="Center on cave"
            >
              ⌖ Center
            </button>
            {Object.values(activeSurveyOverlays).some(rd => rd?.bounds) && (
              <button
                onClick={() => {
                  if (!mapRef.current) return
                  const toLL = converter || ((x, y) => slamToLatLng(x, y, anchor?.lat, anchor?.lon, caveHeading || 0))
                  const allCorners = []
                  Object.values(activeSurveyOverlays).forEach(rd => {
                    if (!rd?.bounds) return
                    const [minX, minY, maxX, maxY] = rd.bounds
                    allCorners.push(toLL(minX, minY), toLL(maxX, minY), toLL(minX, maxY), toLL(maxX, maxY))
                  })
                  if (allCorners.length > 0) mapRef.current.fitBounds(allCorners, { padding: [40, 40], animate: true })
                }}
                className="px-3 py-1.5 rounded-full text-xs font-medium
                  bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
                  backdrop-blur-sm hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50 transition-all shadow-lg"
                title="Zoom to fit survey"
              >
                ⊞ Survey
              </button>
            )}
          </div>
        )}
        {/* Map tools toolbar */}
        {enableMapTools && (
          <MapToolbar
            map={mapRef.current}
            enableTier2={enableTier2Tools}
            caveId={caveId}
            waypoints={waypoints}
            onWaypointsChange={onWaypointsChange}
            polygons={annotations}
            onPolygonsChange={onAnnotationsChange}
          />
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
        converter={converter}
      />
      <HandDrawnMapOverlay
        map={mapRef.current}
        surveys={surveyMaps}
        visibleImageIds={visibleImageIds}
        anchorLat={anchor?.lat}
        anchorLon={anchor?.lon}
        editingSurveyId={editingSurveyId}
        onSurveyUpdated={onSurveyUpdated}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
        onDeleteSurvey={onDeleteSurvey}
        caveId={caveId}
      />
      {/* Computed survey overlays (one per active survey) */}
      {Object.entries(activeSurveyOverlays).map(([surveyId, renderData]) => (
        <SurveyOverlay
          key={`survey-${surveyId}`}
          map={mapRef.current}
          renderData={renderData}
          anchorLat={anchor?.lat}
          anchorLon={anchor?.lon}
          heading={caveHeading}
          converter={converter}
        />
      ))}
      {/* Nearby cave survey overlays (muted gray styling) */}
      {Object.entries(nearbySurveyOverlays).map(([caveId, overlay]) => (
        <SurveyOverlay
          key={`nearby-${caveId}`}
          map={mapRef.current}
          renderData={overlay.renderData}
          anchorLat={overlay.anchorLat}
          anchorLon={overlay.anchorLon}
          heading={overlay.heading}
          muted
        />
      ))}
    </>
  )
}
