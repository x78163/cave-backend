import { useState, useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import { haversineMeters, bearingDegrees, formatDistance } from '../../utils/geoUtils'

/**
 * Click-two-points measurement tool.
 * Shows distance (m + ft) and bearing between two map clicks.
 * Third click resets. Copy button for clipboard.
 */
export default function MeasureTool({ map, active }) {
  const [pointA, setPointA] = useState(null)
  const [pointB, setPointB] = useState(null)
  const [copied, setCopied] = useState(false)
  const layerGroupRef = useRef(null)
  const liveLineRef = useRef(null)
  const liveLabelRef = useRef(null)

  // Create / destroy layer group
  useEffect(() => {
    if (!map) return
    const lg = L.layerGroup().addTo(map)
    layerGroupRef.current = lg
    return () => { lg.remove() }
  }, [map])

  // Clear all layers
  const clearLayers = useCallback(() => {
    layerGroupRef.current?.clearLayers()
    if (liveLineRef.current) { liveLineRef.current.remove(); liveLineRef.current = null }
    if (liveLabelRef.current) { liveLabelRef.current.remove(); liveLabelRef.current = null }
  }, [])

  // Draw endpoint marker
  const drawPoint = useCallback((latlng) => {
    if (!layerGroupRef.current) return
    L.circleMarker(latlng, {
      radius: 5, color: '#00e5ff', fillColor: '#00e5ff', fillOpacity: 1, weight: 2,
    }).addTo(layerGroupRef.current)
  }, [])

  // Draw final measurement line + label
  const drawMeasurement = useCallback((a, b) => {
    if (!layerGroupRef.current) return
    L.polyline([a, b], {
      color: '#00e5ff', weight: 2, dashArray: '8 4', opacity: 0.9,
    }).addTo(layerGroupRef.current)

    const dist = haversineMeters(a.lat, a.lng, b.lat, b.lng)
    const bearing = bearingDegrees(a.lat, a.lng, b.lat, b.lng)
    const mid = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2)

    const labelText = `${formatDistance(dist)} (${formatDistance(dist, true)})\nBearing: ${bearing.toFixed(1)}°`
    L.marker(mid, { opacity: 0, interactive: false }).bindTooltip(labelText, {
      permanent: true, direction: 'center', className: 'measure-label',
    }).addTo(layerGroupRef.current)
  }, [])

  // Map click handler
  useEffect(() => {
    if (!map || !active) return

    const onClick = (e) => {
      L.DomEvent.stopPropagation(e)
      if (!pointA) {
        setPointA(e.latlng)
        setPointB(null)
        setCopied(false)
        clearLayers()
        drawPoint(e.latlng)
      } else if (!pointB) {
        setPointB(e.latlng)
        drawPoint(e.latlng)
        drawMeasurement(pointA, e.latlng)
        // Remove live preview
        if (liveLineRef.current) { liveLineRef.current.remove(); liveLineRef.current = null }
        if (liveLabelRef.current) { liveLabelRef.current.remove(); liveLabelRef.current = null }
      } else {
        // Third click — reset
        setPointA(e.latlng)
        setPointB(null)
        setCopied(false)
        clearLayers()
        drawPoint(e.latlng)
      }
    }

    map.on('click', onClick)
    return () => map.off('click', onClick)
  }, [map, active, pointA, pointB, clearLayers, drawPoint, drawMeasurement])

  // Live preview line while moving after first click
  useEffect(() => {
    if (!map || !active || !pointA || pointB) return

    const onMove = (e) => {
      if (liveLineRef.current) liveLineRef.current.remove()
      if (liveLabelRef.current) liveLabelRef.current.remove()

      liveLineRef.current = L.polyline([pointA, e.latlng], {
        color: '#00e5ff', weight: 1.5, dashArray: '4 4', opacity: 0.6,
      }).addTo(map)

      const dist = haversineMeters(pointA.lat, pointA.lng, e.latlng.lat, e.latlng.lng)
      const mid = L.latLng((pointA.lat + e.latlng.lat) / 2, (pointA.lng + e.latlng.lng) / 2)
      liveLabelRef.current = L.marker(mid, { opacity: 0, interactive: false }).bindTooltip(
        formatDistance(dist), { permanent: true, direction: 'center', className: 'measure-label' }
      ).addTo(map)
    }

    map.on('mousemove', onMove)
    return () => {
      map.off('mousemove', onMove)
      if (liveLineRef.current) { liveLineRef.current.remove(); liveLineRef.current = null }
      if (liveLabelRef.current) { liveLabelRef.current.remove(); liveLabelRef.current = null }
    }
  }, [map, active, pointA, pointB])

  // Cleanup on deactivate
  useEffect(() => {
    if (!active) {
      clearLayers()
      setPointA(null)
      setPointB(null)
      setCopied(false)
    }
  }, [active, clearLayers])

  // Copy result
  const handleCopy = useCallback(() => {
    if (!pointA || !pointB) return
    const dist = haversineMeters(pointA.lat, pointA.lng, pointB.lat, pointB.lng)
    const bearing = bearingDegrees(pointA.lat, pointA.lng, pointB.lat, pointB.lng)
    const text = `${formatDistance(dist)} / ${formatDistance(dist, true)} | Bearing: ${bearing.toFixed(1)}° | From: ${pointA.lat.toFixed(6)},${pointA.lng.toFixed(6)} To: ${pointB.lat.toFixed(6)},${pointB.lng.toFixed(6)}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [pointA, pointB])

  // Result panel (when measurement complete)
  if (!active || !pointA || !pointB) return null

  const dist = haversineMeters(pointA.lat, pointA.lng, pointB.lat, pointB.lng)
  const bearing = bearingDegrees(pointA.lat, pointA.lng, pointB.lat, pointB.lng)

  return (
    <div className="absolute top-3 right-12 z-[1200]
      px-3 py-2 rounded-lg text-xs
      bg-[#0a0a12]/90 text-[var(--cyber-text)] border border-[var(--cyber-cyan)]/50
      backdrop-blur-sm shadow-lg space-y-1 min-w-[180px]">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[var(--cyber-cyan)]">Measurement</span>
        <button
          onClick={handleCopy}
          className="px-1.5 py-0.5 rounded text-[10px] border transition-all
            border-[var(--cyber-border)] text-[var(--cyber-text-dim)]
            hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="text-[var(--cyber-text-dim)]">
        {formatDistance(dist)} / {formatDistance(dist, true)}
      </div>
      <div className="text-[var(--cyber-text-dim)]">
        Bearing: {bearing.toFixed(1)}°
      </div>
      <div className="text-[9px] text-[var(--cyber-text-dim)] opacity-60">
        Click to measure again
      </div>
    </div>
  )
}
