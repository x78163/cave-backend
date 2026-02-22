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

    // Draw passage walls — thick polylines per shot using passage_strokes data.
    // Each shot gets a polyline with weight = average passage width (meters → approx pixels).
    // Round lineCap ensures smooth overlap at junctions.
    const strokes = renderData.passage_strokes || []
    for (const s of strokes) {
      const fromLL = toLL(s.from[0], s.from[1])
      const toLL_ = toLL(s.to[0], s.to[1])
      const avgWidth = (s.from_width + s.to_width) / 2
      if (avgWidth < 0.1) continue

      // Convert meters to approximate pixels at current zoom
      // At the equator, 1 degree ≈ 111320m. Use map's meters-per-pixel.
      const metersPerPixel = 40075016.686 * Math.cos(anchorLat * Math.PI / 180) /
        Math.pow(2, map.getZoom() + 8)
      const weightPx = Math.max(2, avgWidth / metersPerPixel)

      L.polyline([fromLL, toLL_], {
        color: '#ffa726',
        weight: weightPx,
        opacity: 0.18,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(group)
    }

    // Passage outlines (thin lines along edges)
    for (const s of strokes) {
      const fromLL = toLL(s.from[0], s.from[1])
      const toLL_ = toLL(s.to[0], s.to[1])
      const avgWidth = (s.from_width + s.to_width) / 2
      if (avgWidth < 0.1) continue

      const metersPerPixel = 40075016.686 * Math.cos(anchorLat * Math.PI / 180) /
        Math.pow(2, map.getZoom() + 8)
      const weightPx = Math.max(2, avgWidth / metersPerPixel)

      // Left and right offset lines would be complex — just draw
      // the outline as a slightly wider stroke behind the fill
      L.polyline([fromLL, toLL_], {
        color: '#ffa726',
        weight: weightPx + 2,
        opacity: 0.4,
        lineCap: 'round',
        lineJoin: 'round',
        fill: false,
      }).addTo(group)
    }

    // Draw centerline segments (seg[0] and seg[1] are coordinates, seg[2] is branch_id)
    if (renderData.centerline?.length > 0) {
      for (const seg of renderData.centerline) {
        const ll = [toLL(seg[0][0], seg[0][1]), toLL(seg[1][0], seg[1][1])]
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
