import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { slamToLatLng } from './CaveMapOverlay'

/**
 * Renders survey centerlines, passage walls, and station labels on a Leaflet map.
 * Uses the same coordinate conversion as CaveMapOverlay (survey x/y → lat/lon).
 */
export default function SurveyOverlay({ map, renderData, anchorLat, anchorLon, heading }) {
  const groupRef = useRef(null)

  useEffect(() => {
    if (!map || !renderData) return

    // Clean up previous layers
    if (groupRef.current) {
      map.removeLayer(groupRef.current)
    }

    const group = L.layerGroup()
    groupRef.current = group

    const toLL = (x, y) => slamToLatLng(x, y, anchorLat, anchorLon, heading || 0)

    // Draw passage walls (semi-transparent amber fill)
    if (renderData.walls_left?.length > 1 && renderData.walls_right?.length > 1) {
      const leftLL = renderData.walls_left.map(p => toLL(p[0], p[1]))
      const rightLL = renderData.walls_right.map(p => toLL(p[0], p[1]))

      // Close the polygon: left wall forward + right wall reversed
      const polygon = [...leftLL, ...rightLL.slice().reverse()]
      L.polygon(polygon, {
        color: '#ffa726',
        weight: 1.5,
        fillColor: '#ffa726',
        fillOpacity: 0.12,
        dashArray: null,
      }).addTo(group)

      // Draw wall outlines
      L.polyline(leftLL, { color: '#ffa726', weight: 1.5, opacity: 0.6 }).addTo(group)
      L.polyline(rightLL, { color: '#ffa726', weight: 1.5, opacity: 0.6 }).addTo(group)
    }

    // Draw centerline segments
    if (renderData.centerline?.length > 0) {
      for (const seg of renderData.centerline) {
        const ll = seg.map(p => toLL(p[0], p[1]))
        L.polyline(ll, {
          color: 'var(--cyber-cyan, #00ffff)',
          weight: 2,
          opacity: 0.9,
        }).addTo(group)
      }
    }

    // Draw station markers + labels
    if (renderData.stations?.length > 0) {
      for (const station of renderData.stations) {
        const ll = toLL(station.x, station.y)
        L.circleMarker(ll, {
          radius: 4,
          color: '#00ffff',
          fillColor: '#00ffff',
          fillOpacity: 0.8,
          weight: 1,
        })
          .bindTooltip(station.name, {
            permanent: false,
            direction: 'top',
            offset: [0, -6],
            className: 'survey-station-tooltip',
          })
          .addTo(group)
      }
    }

    group.addTo(map)

    return () => {
      if (groupRef.current) {
        map.removeLayer(groupRef.current)
        groupRef.current = null
      }
    }
  }, [map, renderData, anchorLat, anchorLon, heading])

  return null
}
