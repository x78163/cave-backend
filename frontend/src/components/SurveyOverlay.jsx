import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { slamToLatLng } from './CaveMapOverlay'
import { matchSymbols, colorize, SYMBOLS } from '../utils/surveySymbols'

/**
 * Renders survey centerlines, passage walls, and station labels on a Leaflet map.
 * Uses the same coordinate conversion as CaveMapOverlay (survey x/y → lat/lon).
 */
export default function SurveyOverlay({ map, renderData, anchorLat, anchorLon, heading, converter: externalConverter = null }) {
  const groupRef = useRef(null)

  useEffect(() => {
    if (!map || !renderData) return

    // Clean up previous layers
    if (groupRef.current) {
      map.removeLayer(groupRef.current)
    }

    const group = L.layerGroup()
    groupRef.current = group

    const toLL = externalConverter || ((x, y) => slamToLatLng(x, y, anchorLat, anchorLon, heading || 0))

    // Passage walls — smooth Bezier outlines per branch.
    // Falls back to per-shot thick polylines for legacy render_data.
    const outlines = renderData.passage_outlines || []
    const hasLevels = renderData.has_vertical_levels

    if (outlines.length > 0) {
      for (const o of outlines) {
        const isLower = hasLevels && o.is_lower
        const wallStyle = {
          color: '#ffa726', weight: 1, opacity: 0.5,
          dashArray: isLower ? '8 6' : null,
        }
        // Fill with smooth polygon (backend sends densified points)
        const latlngs = o.polygon.map(p => toLL(p[0], p[1]))
        if (latlngs.length < 3) continue
        L.polygon(latlngs, {
          color: 'transparent', weight: 0,
          fillColor: '#ffa726',
          fillOpacity: isLower ? 0.10 : 0.18,
        }).addTo(group)

        // Left wall — use densified smooth points (match polygon boundary exactly)
        const leftLL = (o.left_smooth || o.left || []).map(p => toLL(p[0], p[1]))
        if (leftLL.length >= 2) L.polyline(leftLL, wallStyle).addTo(group)
        // Right wall
        const rightLL = (o.right_smooth || o.right || []).map(p => toLL(p[0], p[1]))
        if (rightLL.length >= 2) L.polyline(rightLL, wallStyle).addTo(group)
        // Flat caps at dead ends
        if (o.caps) {
          for (const cap of o.caps) {
            const capLL = cap.map(p => toLL(p[0], p[1]))
            L.polyline(capLL, wallStyle).addTo(group)
          }
        }
      }
    } else {
      // Legacy fallback: thick polylines per shot
      const strokes = renderData.passage_strokes || []
      for (const s of strokes) {
        const fromLL = toLL(s.from[0], s.from[1])
        const toLL_ = toLL(s.to[0], s.to[1])
        const avgWidth = (s.from_width + s.to_width) / 2
        if (avgWidth < 0.1) continue
        const metersPerPixel = 40075016.686 * Math.cos(anchorLat * Math.PI / 180) /
          Math.pow(2, map.getZoom() + 8)
        const weightPx = Math.max(2, avgWidth / metersPerPixel)
        L.polyline([fromLL, toLL_], {
          color: '#ffa726',
          weight: weightPx + 2,
          opacity: 0.4,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(group)
      }
    }

    // Draw centerline segments (seg[0]/seg[1] = coords, seg[2] = branch_id, seg[3] = is_lower)
    if (renderData.centerline?.length > 0) {
      for (const seg of renderData.centerline) {
        const isLower = seg[3] ?? false
        const ll = [toLL(seg[0][0], seg[0][1]), toLL(seg[1][0], seg[1][1])]
        L.polyline(ll, {
          color: 'var(--cyber-cyan, #00ffff)',
          weight: 2,
          opacity: 0.9,
          dashArray: isLower ? '8 6' : null,
        }).addTo(group)
      }
    }

    // Draw station markers + labels
    // Lower-level stations are dimmed; dense surveys thin out labels
    if (renderData.stations?.length > 0) {
      const stationCount = renderData.stations.length
      const dense = stationCount > 20
      const labelInterval = dense ? Math.max(3, Math.floor(stationCount / 12)) : 1

      renderData.stations.forEach((station, idx) => {
        const isLower = hasLevels && station.is_lower
        const ll = toLL(station.x, station.y)

        L.circleMarker(ll, {
          radius: isLower ? 2 : 4,
          color: '#00ffff',
          fillColor: isLower ? 'transparent' : '#00ffff',
          fillOpacity: isLower ? 0 : 0.8,
          weight: 1,
          opacity: isLower ? 0.35 : 1,
        })
          .bindTooltip(station.name, {
            permanent: false,
            direction: 'top',
            offset: [0, -6],
            className: 'survey-station-tooltip',
          })
          .addTo(group)
      })
    }

    // Symbol icons at shot midpoints (matched from comments)
    for (const ann of (renderData.shot_annotations || [])) {
      const keys = matchSymbols(ann.comment)
      if (keys.length === 0) continue
      const ll = toLL(ann.mid[0], ann.mid[1])
      keys.forEach((key, i) => {
        const svg = SYMBOLS[key]
        if (!svg) return
        const html = colorize(svg, '#ffa726')
        const size = 22
        const offset = keys.length > 1 ? (i - (keys.length - 1) / 2) * (size + 2) : 0
        const icon = L.divIcon({
          html,
          className: 'survey-symbol-icon',
          iconSize: [size, size],
          iconAnchor: [size / 2 - offset, size / 2],
        })
        L.marker(ll, { icon, interactive: false }).addTo(group)
      })
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
