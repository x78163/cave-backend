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

/**
 * Renders cave map data as Leaflet layers on an existing map.
 *
 * Props:
 *   map          - Leaflet map instance (required)
 *   mapData      - Cave map JSON (levels, walls, trajectory)
 *   pois         - Array of POI objects [{slam_x, slam_y, poi_type, label}]
 *   anchorLat    - Cave entrance latitude
 *   anchorLon    - Cave entrance longitude
 *   heading      - SLAM heading in degrees (default 0)
 *   selectedLevel - Which level to show (index, or -1 for all)
 *   opacity      - Layer opacity 0-1 (default 0.6)
 *   visible      - Show/hide toggle
 */
export default function CaveMapOverlay({
  map,
  mapData,
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
      // Render wall polylines
      if (level.walls) {
        for (const wall of level.walls) {
          if (wall.length < 2) continue
          const latlngs = wall.map(([x, y]) => convert(x, y))
          L.polyline(latlngs, {
            color: '#00e5ff',
            weight: 1.5,
            opacity: opacity,
          }).addTo(group)
        }
      }

      // Render trajectory as dashed line
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
  }, [map, mapData, pois, anchorLat, anchorLon, heading, selectedLevel, opacity, visible])

  return null
}
