import { useRef, useEffect, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import CaveMapOverlay, { slamToLatLng } from './CaveMapOverlay'
import HandDrawnMapOverlay from './HandDrawnMapOverlay'
import SurveyOverlay from './SurveyOverlay'
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
  // Survey map overlay props
  surveyMaps = [],
  surveyMapVisible = false,
  onToggleSurveyMap,
  activeSurveyId = null,
  onSurveySelect,
  onAddSurveyMap,
  editingSurveyId = null,
  onSurveyUpdated,
  onEditStart,
  onEditEnd,
  onDeleteSurvey,
  caveId = null,
  // Traditional survey overlay props
  surveyRenderData = null,
  showSurveyOverlay = false,
  // Multi-point registration converter
  converter = null,
  // Additional entrance markers
  entranceMarkers = [],
}) {
  const [surveyDropdownOpen, setSurveyDropdownOpen] = useState(false)
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

    // Add markers — use clustering when many markers, direct when few
    const useClustering = markers.length > 20
    const clusterGroup = useClustering
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
      : null

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
    if (onMapReady) onMapReady(map)

    return () => {
      map.remove()
      mapRef.current = null
      parcelLayerRef.current = null
      if (onMapReady) onMapReady(null)
    }
  }, [center?.[0], center?.[1], markers.length])

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

  // Notify Leaflet when the container height changes + auto-fit survey overlays
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.invalidateSize({ animate: false })

    // After size update, fit map to show survey overlays (rotation-aware)
    if (surveyMapVisible && surveyMaps.length > 0 && anchor) {
      const aLat = anchor.lat
      const aLon = anchor.lon
      const toShow = activeSurveyId
        ? surveyMaps.filter(s => s.id === activeSurveyId)
        : surveyMaps
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
  }, [height, surveyMapVisible, surveyMaps.length, activeSurveyId])

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
        {/* Survey map button — above center button */}
        {(onToggleSurveyMap || onAddSurveyMap) && (
          <div className="absolute bottom-12 left-3 z-[1100]">
            <div className="flex items-center">
            <button
              onClick={() => {
                if (surveyMaps.length > 0) {
                  if (onToggleSurveyMap) onToggleSurveyMap()
                } else {
                  if (onAddSurveyMap) onAddSurveyMap()
                }
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all shadow-lg
                ${surveyMapVisible
                  ? 'bg-amber-900/80 text-amber-400 border border-amber-700/50 backdrop-blur-sm'
                  : 'bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] backdrop-blur-sm hover:text-amber-400 hover:border-amber-700/50'
                }`}
            >
              {surveyMaps.length > 0
                ? (surveyMapVisible ? 'Hide Survey' : 'Show Survey')
                : 'Add Survey Map'}
            </button>
            {/* Add another survey button */}
            {surveyMapVisible && surveyMaps.length > 0 && onAddSurveyMap && (
              <button
                onClick={onAddSurveyMap}
                className="ml-1.5 px-2 py-1.5 rounded-full text-xs font-medium transition-all shadow-lg
                  bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] backdrop-blur-sm
                  hover:text-amber-400 hover:border-amber-700/50"
                title="Add another survey map"
              >
                +
              </button>
            )}
            </div>
            {/* Multi-survey selector dropdown */}
            {surveyMapVisible && surveyMaps.length > 1 && (
              <div className="relative mt-1">
                <button
                  onClick={() => setSurveyDropdownOpen(v => !v)}
                  className="px-2 py-1 rounded-full text-[10px] text-[var(--cyber-text-dim)]
                    bg-[#0a0a12]/80 border border-[var(--cyber-border)] backdrop-blur-sm
                    hover:text-white transition-all shadow-lg"
                >
                  {activeSurveyId
                    ? (surveyMaps.find(s => s.id === activeSurveyId)?.name || 'Selected')
                    : 'All Surveys'} &#9662;
                </button>
                {surveyDropdownOpen && (
                  <div className="absolute left-0 mt-1 w-44 rounded-lg bg-[#0a0a12]/95 border border-[var(--cyber-border)]
                    backdrop-blur-sm shadow-xl overflow-hidden">
                    <button
                      onClick={() => { if (onSurveySelect) onSurveySelect(null); setSurveyDropdownOpen(false) }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--cyber-surface-2)] transition-colors
                        ${!activeSurveyId ? 'text-[var(--cyber-cyan)]' : 'text-[var(--cyber-text-dim)]'}`}
                    >
                      All Surveys
                    </button>
                    {surveyMaps.map(s => (
                      <button
                        key={s.id}
                        onClick={() => { if (onSurveySelect) onSurveySelect(s.id); setSurveyDropdownOpen(false) }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--cyber-surface-2)] transition-colors
                          ${activeSurveyId === s.id ? 'text-[var(--cyber-cyan)]' : 'text-[var(--cyber-text-dim)]'}`}
                      >
                        {s.name || `Survey ${s.id.slice(0, 8)}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Edit button for active survey */}
            {surveyMapVisible && surveyMaps.length > 0 && !editingSurveyId && onEditStart && (
              <button
                onClick={() => {
                  const target = activeSurveyId || surveyMaps[0]?.id
                  if (target && onEditStart) onEditStart(target)
                }}
                className="mt-1 px-2 py-1 rounded-full text-[10px] text-[var(--cyber-text-dim)]
                  bg-[#0a0a12]/80 border border-[var(--cyber-border)] backdrop-blur-sm
                  hover:text-amber-400 hover:border-amber-700/50 transition-all shadow-lg block"
              >
                Edit
              </button>
            )}
          </div>
        )}
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
            {showSurveyOverlay && surveyRenderData?.bounds && (
              <button
                onClick={() => {
                  if (!mapRef.current || !surveyRenderData?.bounds) return
                  const toLL = converter || ((x, y) => slamToLatLng(x, y, anchor?.lat, anchor?.lon, caveHeading || 0))
                  const [minX, minY, maxX, maxY] = surveyRenderData.bounds
                  // Convert all four corners since rotation may skew the bounds
                  const corners = [
                    toLL(minX, minY), toLL(maxX, minY),
                    toLL(minX, maxY), toLL(maxX, maxY),
                  ]
                  mapRef.current.fitBounds(corners, { padding: [40, 40], animate: true })
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
        activeSurveyId={activeSurveyId}
        visible={surveyMapVisible}
        anchorLat={anchor?.lat}
        anchorLon={anchor?.lon}
        editingSurveyId={editingSurveyId}
        onSurveyUpdated={onSurveyUpdated}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
        onDeleteSurvey={onDeleteSurvey}
        caveId={caveId}
      />
      {showSurveyOverlay && surveyRenderData && (
        <SurveyOverlay
          map={mapRef.current}
          renderData={surveyRenderData}
          anchorLat={anchor?.lat}
          anchorLon={anchor?.lon}
          heading={caveHeading}
          converter={converter}
        />
      )}
    </>
  )
}
