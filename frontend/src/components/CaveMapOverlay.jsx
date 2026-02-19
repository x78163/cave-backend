import { useEffect, useRef } from 'react'
import L from 'leaflet'

/**
 * Convert SLAM coordinates (meters) to lat/lon using a flat-earth approximation.
 *
 * @param {number} slamX - X in SLAM frame (meters)
 * @param {number} slamY - Y in SLAM frame (meters)
 * @param {number} anchorLat - Cave entrance latitude
 * @param {number} anchorLon - Cave entrance longitude
 * @param {number} headingDeg - SLAM frame heading in degrees clockwise from north
 * @returns {[number, number]} [lat, lon]
 */
export function slamToLatLng(slamX, slamY, anchorLat, anchorLon, headingDeg) {
  const h = (headingDeg || 0) * Math.PI / 180
  const eastM  =  slamX * Math.cos(h) + slamY * Math.sin(h)
  const northM = -slamX * Math.sin(h) + slamY * Math.cos(h)
  const lat = anchorLat + northM / 111320
  const lon = anchorLon + eastM / (111320 * Math.cos(anchorLat * Math.PI / 180))
  return [lat, lon]
}

// POI colors matching CaveMapSection
const POI_COLORS = {
  entrance: '#4ade80', junction: '#fbbf24', squeeze: '#f87171', water: '#60a5fa',
  formation: '#c084fc', hazard: '#ef4444', biology: '#34d399', camp: '#fb923c',
  survey_station: '#94a3b8', transition: '#a78bfa', marker: '#e2e8f0',
}

// Heatmap colormap: inferno-like (dark → purple → red → orange → yellow)
const HEATMAP_STOPS = [
  [0.0,   0,   0,  20],
  [0.15, 20,   0, 100],
  [0.3,  80,   0, 160],
  [0.45, 160, 20, 120],
  [0.6,  200, 50,  40],
  [0.75, 240, 130, 10],
  [0.9,  255, 210, 30],
  [1.0,  255, 255, 180],
]

function heatmapRGB(t) {
  for (let i = 0; i < HEATMAP_STOPS.length - 1; i++) {
    if (t <= HEATMAP_STOPS[i + 1][0]) {
      const s = (t - HEATMAP_STOPS[i][0]) / (HEATMAP_STOPS[i + 1][0] - HEATMAP_STOPS[i][0])
      return [
        Math.floor(HEATMAP_STOPS[i][1] + s * (HEATMAP_STOPS[i + 1][1] - HEATMAP_STOPS[i][1])),
        Math.floor(HEATMAP_STOPS[i][2] + s * (HEATMAP_STOPS[i + 1][2] - HEATMAP_STOPS[i][2])),
        Math.floor(HEATMAP_STOPS[i][3] + s * (HEATMAP_STOPS[i + 1][3] - HEATMAP_STOPS[i][3])),
      ]
    }
  }
  return [255, 255, 180]
}

/**
 * Renders cave map data as Leaflet layers on an existing map.
 * Supports all map modes: walls-based (quick, standard, detailed, edges, raw_slice),
 * heatmap (grid image overlay), and points (density-weighted circle markers).
 */
export default function CaveMapOverlay({
  map,
  mapData,
  mode = 'standard',
  pois = [],
  anchorLat,
  anchorLon,
  heading = 0,
  selectedLevel = 0,
  opacity = 0.6,
  visible = true,
}) {
  const layerGroupRef = useRef(null)

  useEffect(() => {
    if (!map || !mapData || !anchorLat || !anchorLon) return

    // Remove previous layers
    if (layerGroupRef.current) {
      map.removeLayer(layerGroupRef.current)
      layerGroupRef.current = null
    }

    if (!visible) return

    const group = L.layerGroup()

    // Find primary entrance POI to use as anchor offset.
    // The cave GPS marks the entrance, so shift the overlay so the
    // entrance POI's SLAM coords align with that GPS point.
    const entrance = pois.find(p => p.poi_type === 'entrance' && p.slam_x != null && p.slam_y != null)
    const offX = entrance ? entrance.slam_x : 0
    const offY = entrance ? entrance.slam_y : 0

    const convert = (x, y) => slamToLatLng(x - offX, y - offY, anchorLat, anchorLon, heading)

    const levels = mapData.levels || []
    const levelsToRender = selectedLevel === -1
      ? levels
      : levels.filter(l => l.index === selectedLevel)

    for (const level of levelsToRender) {
      // ── Heatmap mode: render as image overlay ──
      if (mode === 'heatmap' && level.heatmap) {
        const hm = level.heatmap
        const canvas = document.createElement('canvas')
        canvas.width = hm.width
        canvas.height = hm.height
        const ctx = canvas.getContext('2d')
        const imgData = ctx.createImageData(hm.width, hm.height)
        const px = imgData.data

        for (let row = 0; row < hm.height; row++) {
          for (let col = 0; col < hm.width; col++) {
            const val = hm.data[row][col]
            const idx = (row * hm.width + col) * 4
            if (val <= 0.01) {
              px[idx + 3] = 0
              continue
            }
            const [r, g, b] = heatmapRGB(val)
            px[idx] = r
            px[idx + 1] = g
            px[idx + 2] = b
            px[idx + 3] = Math.floor((55 + val * 200) * opacity)
          }
        }
        ctx.putImageData(imgData, 0, 0)

        // Convert grid corners from SLAM coords to lat/lon
        const ox = hm.origin[0]
        const oy = hm.origin[1]
        const sw = convert(ox, oy)
        const ne = convert(ox + hm.width * hm.resolution, oy + hm.height * hm.resolution)
        const bounds = L.latLngBounds(sw, ne)

        L.imageOverlay(canvas.toDataURL(), bounds, {
          opacity: 1, // alpha already baked into pixels
          interactive: false,
        }).addTo(group)

      // ── Points mode: render density-weighted circle markers ──
      } else if (mode === 'points' && level.density && level.density.points) {
        const pts = level.density.points
        for (const [x, y, d] of pts) {
          const latlng = convert(x, y)
          const radius = 2 + d * 4
          const alpha = (0.25 + d * 0.75) * opacity
          L.circleMarker(latlng, {
            radius: radius,
            color: 'transparent',
            fillColor: `rgb(200, 215, 230)`,
            fillOpacity: alpha,
            weight: 0,
          }).addTo(group)
        }

      // ── Walls-based modes (quick, standard, detailed, edges, raw_slice) ──
      } else if (level.walls) {
        const wallColor = mode === 'edges' ? '#ff9800' : '#00e5ff'
        for (const wall of level.walls) {
          if (wall.length < 2) continue
          const latlngs = wall.map(([x, y]) => convert(x, y))
          L.polyline(latlngs, {
            color: wallColor,
            weight: 1.5,
            opacity: opacity,
          }).addTo(group)
        }
      }

      // Render trajectory as dashed line (all modes)
      if (level.trajectory && level.trajectory.length >= 2) {
        const latlngs = level.trajectory.map(([x, y]) => convert(x, y))
        L.polyline(latlngs, {
          color: '#ffffff',
          weight: 1,
          opacity: opacity * 0.5,
          dashArray: '4 6',
        }).addTo(group)
      }
    }

    // Render POIs
    for (const poi of pois) {
      if (poi.slam_x == null || poi.slam_y == null) continue
      const latlng = convert(poi.slam_x, poi.slam_y)
      const color = POI_COLORS[poi.poi_type] || '#e2e8f0'
      L.circleMarker(latlng, {
        radius: 4,
        color: color,
        fillColor: color,
        fillOpacity: opacity,
        weight: 1,
        opacity: opacity,
      }).bindTooltip(poi.label || poi.poi_type, {
        permanent: false,
        direction: 'top',
        offset: [0, -6],
        className: 'cave-overlay-tooltip',
      }).addTo(group)
    }

    group.addTo(map)
    layerGroupRef.current = group

    return () => {
      if (layerGroupRef.current) {
        map.removeLayer(layerGroupRef.current)
        layerGroupRef.current = null
      }
    }
  }, [map, mapData, mode, pois, anchorLat, anchorLon, heading, selectedLevel, opacity, visible])

  return null
}
