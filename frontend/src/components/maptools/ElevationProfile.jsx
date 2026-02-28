import { useState, useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import { haversineMeters, formatDistance } from '../../utils/geoUtils'
import { getElevationProfile } from '../../utils/elevationApi'

/**
 * Elevation profile tool — pick two points, see terrain cross-section.
 * Uses USGS 3DEP getSamples API, renders with HTML5 Canvas.
 */
export default function ElevationProfile({ map, active }) {
  const [pointA, setPointA] = useState(null)
  const [pointB, setPointB] = useState(null)
  const [samples, setSamples] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hoverIdx, setHoverIdx] = useState(null)
  const layerGroupRef = useRef(null)
  const canvasRef = useRef(null)
  const hoverMarkerRef = useRef(null)

  // Create layer group
  useEffect(() => {
    if (!map) return
    const lg = L.layerGroup().addTo(map)
    layerGroupRef.current = lg
    return () => { lg.remove() }
  }, [map])

  const clearAll = useCallback(() => {
    layerGroupRef.current?.clearLayers()
    if (hoverMarkerRef.current) { hoverMarkerRef.current.remove(); hoverMarkerRef.current = null }
    setPointA(null)
    setPointB(null)
    setSamples(null)
    setError(null)
    setHoverIdx(null)
  }, [])

  // Map click
  useEffect(() => {
    if (!map || !active) return
    const onClick = (e) => {
      if (!pointA) {
        clearAll()
        setPointA(e.latlng)
        L.circleMarker(e.latlng, {
          radius: 6, color: '#4ade80', fillColor: '#4ade80', fillOpacity: 1, weight: 2,
        }).addTo(layerGroupRef.current)
      } else if (!pointB) {
        setPointB(e.latlng)
        L.circleMarker(e.latlng, {
          radius: 6, color: '#f87171', fillColor: '#f87171', fillOpacity: 1, weight: 2,
        }).addTo(layerGroupRef.current)
        L.polyline([pointA, e.latlng], {
          color: '#00e5ff', weight: 2, dashArray: '8 4', opacity: 0.7,
        }).addTo(layerGroupRef.current)
      } else {
        // Third click — reset and start fresh
        clearAll()
        setPointA(e.latlng)
        L.circleMarker(e.latlng, {
          radius: 6, color: '#4ade80', fillColor: '#4ade80', fillOpacity: 1, weight: 2,
        }).addTo(layerGroupRef.current)
      }
    }
    map.on('click', onClick)
    return () => map.off('click', onClick)
  }, [map, active, pointA, pointB, clearAll])

  // Fetch elevation data when both points are set
  useEffect(() => {
    if (!pointA || !pointB) return
    const dist = haversineMeters(pointA.lat, pointA.lng, pointB.lat, pointB.lng)
    const sampleCount = dist > 2000 ? 100 : 50
    setLoading(true)
    setError(null)
    setSamples(null)

    getElevationProfile(pointA.lat, pointA.lng, pointB.lat, pointB.lng, sampleCount)
      .then(data => setSamples(data))
      .catch(err => setError(err.message || 'Failed to fetch elevation'))
      .finally(() => setLoading(false))
  }, [pointA, pointB])

  // Draw profile on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !samples || samples.length < 2) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    const W = rect.width
    const H = rect.height

    const elevs = samples.filter(s => s.elevation != null)
    if (elevs.length < 2) return

    const minE = Math.min(...elevs.map(s => s.elevation))
    const maxE = Math.max(...elevs.map(s => s.elevation))
    const range = Math.max(maxE - minE, 10)
    const maxD = elevs[elevs.length - 1].distance

    const pad = { top: 8, bottom: 18, left: 38, right: 8 }
    const plotW = W - pad.left - pad.right
    const plotH = H - pad.top - pad.bottom

    const toX = d => pad.left + (d / maxD) * plotW
    const toY = e => pad.top + plotH - ((e - minE) / range) * plotH

    // Clear
    ctx.clearRect(0, 0, W, H)

    // Grid lines
    ctx.strokeStyle = 'rgba(42, 42, 69, 0.6)'
    ctx.lineWidth = 0.5
    const gridStep = range > 100 ? 50 : range > 50 ? 20 : 10
    for (let e = Math.ceil(minE / gridStep) * gridStep; e <= maxE; e += gridStep) {
      const y = toY(e)
      ctx.beginPath()
      ctx.moveTo(pad.left, y)
      ctx.lineTo(W - pad.right, y)
      ctx.stroke()
      ctx.fillStyle = '#666688'
      ctx.font = '9px Ubuntu, system-ui'
      ctx.textAlign = 'right'
      ctx.fillText(`${Math.round(e)}m`, pad.left - 4, y + 3)
    }

    // Distance labels
    ctx.textAlign = 'center'
    ctx.fillStyle = '#666688'
    const distStep = maxD > 2000 ? 500 : maxD > 500 ? 200 : 100
    for (let d = 0; d <= maxD; d += distStep) {
      const x = toX(d)
      ctx.fillText(formatDistance(d), x, H - 2)
    }

    // Profile fill
    ctx.beginPath()
    ctx.moveTo(toX(elevs[0].distance), toY(elevs[0].elevation))
    elevs.forEach(s => ctx.lineTo(toX(s.distance), toY(s.elevation)))
    ctx.lineTo(toX(elevs[elevs.length - 1].distance), pad.top + plotH)
    ctx.lineTo(toX(elevs[0].distance), pad.top + plotH)
    ctx.closePath()
    ctx.fillStyle = 'rgba(0, 229, 255, 0.06)'
    ctx.fill()

    // Profile line
    ctx.beginPath()
    ctx.strokeStyle = '#00e5ff'
    ctx.lineWidth = 2
    elevs.forEach((s, i) => {
      if (i === 0) ctx.moveTo(toX(s.distance), toY(s.elevation))
      else ctx.lineTo(toX(s.distance), toY(s.elevation))
    })
    ctx.stroke()

    // Start/end dots
    ctx.beginPath()
    ctx.arc(toX(elevs[0].distance), toY(elevs[0].elevation), 4, 0, Math.PI * 2)
    ctx.fillStyle = '#4ade80'
    ctx.fill()

    ctx.beginPath()
    ctx.arc(toX(elevs[elevs.length - 1].distance), toY(elevs[elevs.length - 1].elevation), 4, 0, Math.PI * 2)
    ctx.fillStyle = '#f87171'
    ctx.fill()

    // Hover crosshair
    if (hoverIdx != null && hoverIdx < elevs.length) {
      const s = elevs[hoverIdx]
      const x = toX(s.distance)
      const y = toY(s.elevation)
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(x, pad.top)
      ctx.lineTo(x, pad.top + plotH)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#00e5ff'
      ctx.fill()

      // Tooltip
      ctx.fillStyle = 'rgba(10, 10, 18, 0.9)'
      const txt = `${s.elevation.toFixed(1)}m | ${formatDistance(s.distance)}`
      const tw = ctx.measureText(txt).width + 8
      const tx = Math.min(x + 8, W - tw - 4)
      const ty = Math.max(y - 20, pad.top)
      ctx.fillRect(tx, ty, tw, 16)
      ctx.fillStyle = '#00e5ff'
      ctx.font = '10px Ubuntu, system-ui'
      ctx.textAlign = 'left'
      ctx.fillText(txt, tx + 4, ty + 12)
    }
  }, [samples, hoverIdx])

  // Canvas hover
  const handleCanvasMove = useCallback((e) => {
    if (!samples || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pad = { left: 38, right: 8 }
    const plotW = rect.width - pad.left - pad.right
    const frac = (x - pad.left) / plotW
    if (frac < 0 || frac > 1) { setHoverIdx(null); return }
    const elevs = samples.filter(s => s.elevation != null)
    const idx = Math.round(frac * (elevs.length - 1))
    setHoverIdx(idx)

    // Show marker on map
    if (map && elevs[idx]) {
      if (hoverMarkerRef.current) hoverMarkerRef.current.remove()
      hoverMarkerRef.current = L.circleMarker([elevs[idx].lat, elevs[idx].lon], {
        radius: 5, color: '#00e5ff', fillColor: '#00e5ff', fillOpacity: 0.8, weight: 2,
      }).addTo(map)
    }
  }, [samples, map])

  const handleCanvasLeave = useCallback(() => {
    setHoverIdx(null)
    if (hoverMarkerRef.current) { hoverMarkerRef.current.remove(); hoverMarkerRef.current = null }
  }, [])

  // Cleanup on deactivate
  useEffect(() => {
    if (!active) clearAll()
  }, [active, clearAll])

  // Compute stats
  const stats = samples ? (() => {
    const elevs = samples.filter(s => s.elevation != null)
    if (elevs.length < 2) return null
    let gain = 0, loss = 0
    for (let i = 1; i < elevs.length; i++) {
      const diff = elevs[i].elevation - elevs[i - 1].elevation
      if (diff > 0) gain += diff
      else loss += Math.abs(diff)
    }
    return {
      gain, loss,
      min: Math.min(...elevs.map(s => s.elevation)),
      max: Math.max(...elevs.map(s => s.elevation)),
      totalDist: elevs[elevs.length - 1].distance,
    }
  })() : null

  if (!active) return null

  return (
    <>
      {/* Loading indicator */}
      {loading && (
        <div className="absolute top-3 right-12 z-[1200]
          px-3 py-2 rounded-lg text-xs
          bg-[#0a0a12]/90 text-[var(--cyber-cyan)] border border-[var(--cyber-cyan)]/30
          backdrop-blur-sm shadow-lg">
          Fetching elevation data...
        </div>
      )}

      {error && (
        <div className="absolute top-3 right-12 z-[1200]
          px-3 py-2 rounded-lg text-xs
          bg-[#0a0a12]/90 text-red-400 border border-red-500/30
          backdrop-blur-sm shadow-lg">
          {error}
        </div>
      )}

      {!pointA && !loading && (
        <div className="absolute top-3 right-12 z-[1200]
          px-3 py-2 rounded-lg text-xs
          bg-[#0a0a12]/90 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
          backdrop-blur-sm shadow-lg">
          Click start point for elevation profile
        </div>
      )}

      {pointA && !pointB && !loading && (
        <div className="absolute top-3 right-12 z-[1200]
          px-3 py-2 rounded-lg text-xs
          bg-[#0a0a12]/90 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
          backdrop-blur-sm shadow-lg">
          Click end point
        </div>
      )}

      {/* Elevation profile chart */}
      {samples && stats && (
        <div className="absolute bottom-12 left-3 right-12 z-[1100]
          cyber-card p-3 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-[var(--cyber-text-dim)]">
              Elevation Profile — {formatDistance(stats.totalDist)} |
              ↑{stats.gain.toFixed(0)}m ↓{stats.loss.toFixed(0)}m |
              Min: {stats.min.toFixed(0)}m Max: {stats.max.toFixed(0)}m
            </span>
            <button onClick={clearAll}
              className="text-[10px] text-[var(--cyber-text-dim)] hover:text-red-400 transition-colors">
              Clear
            </button>
          </div>
          <canvas
            ref={canvasRef}
            className="w-full"
            style={{ height: '140px' }}
            onMouseMove={handleCanvasMove}
            onMouseLeave={handleCanvasLeave}
          />
        </div>
      )}
    </>
  )
}
