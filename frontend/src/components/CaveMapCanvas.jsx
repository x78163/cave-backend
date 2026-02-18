import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react'

const POI_COLORS = {
  entrance: '#4ade80',
  junction: '#fbbf24',
  squeeze: '#f87171',
  water: '#60a5fa',
  formation: '#c084fc',
  hazard: '#ef4444',
  biology: '#34d399',
  camp: '#fb923c',
  survey_station: '#94a3b8',
  transition: '#a78bfa',
  marker: '#e2e8f0',
}

/**
 * Interactive Canvas 2D cave map renderer.
 *
 * Renders wall polylines, trajectory path, and POI markers with
 * pan/zoom touch gestures and tap-to-select/place.
 *
 * Exposes via ref: { centerOn(x, y, scale), fitToView() }
 */
const CaveMapCanvas = forwardRef(function CaveMapCanvas({
  mapData,
  pois = [],
  selectedLevel = 0,
  mode = 'quick',
  onPoiTap,
  onMapTap,
  crosshairMode = false,
  compact = true,
  selectedPoiId = null,
}, ref) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const viewportRef = useRef({ x: 0, y: 0, scale: 1 })
  const initialFitDone = useRef(false)
  const touchRef = useRef({
    dragging: false,
    startX: 0, startY: 0,
    startVpX: 0, startVpY: 0,
    pinching: false,
    pinchDist: 0,
    pinchScale: 1,
    tapStart: 0,
    tapX: 0, tapY: 0,
    moved: false,
  })
  const rafRef = useRef(null)
  const heatmapCacheRef = useRef(null)


  // Get POIs belonging to the currently selected level.
  // Each POI is assigned to the level with the closest z_center.
  const getLevelPois = useCallback(() => {
    if (!mapData || !mapData.levels[selectedLevel]) return []
    const levels = mapData.levels
    return pois.filter(p => {
      if (p.slam_x == null || p.slam_y == null) return false
      if (p.slam_z == null) return true  // no Z info — show on all levels
      // Assign to level with closest z_center
      let bestLevel = 0
      let bestDist = Infinity
      for (let i = 0; i < levels.length; i++) {
        const dist = Math.abs(p.slam_z - levels[i].z_center)
        if (dist < bestDist) {
          bestDist = dist
          bestLevel = i
        }
      }
      return bestLevel === selectedLevel
    })
  }, [mapData, pois, selectedLevel])

  // Fit map to canvas view
  const fitToView = useCallback(() => {
    if (!mapData || !canvasRef.current) return
    const canvas = canvasRef.current
    const [xMin, yMin, xMax, yMax] = mapData.bounds
    const mapW = xMax - xMin
    const mapH = yMax - yMin
    if (mapW <= 0 || mapH <= 0) return

    const padding = 40
    const availW = canvas.width - padding * 2
    const availH = canvas.height - padding * 2
    const scale = Math.min(availW / mapW, availH / mapH)

    const centerX = (xMin + xMax) / 2
    const centerY = (yMin + yMax) / 2

    viewportRef.current = {
      x: -centerX * scale,
      y: centerY * scale,  // Y flipped
      scale,
    }
  }, [mapData])

  // Center on a world point at a given scale
  const centerOn = useCallback((worldX, worldY, targetScale) => {
    if (!canvasRef.current) return
    const scale = targetScale || viewportRef.current.scale
    viewportRef.current = {
      x: -worldX * scale,
      y: worldY * scale,  // Y flipped
      scale,
    }
  }, [])

  // Resize canvas to container (does NOT reset viewport)
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = rect.width + 'px'
    canvas.style.height = rect.height + 'px'
  }, [])

  // Build heatmap offscreen canvas when data changes
  useEffect(() => {
    if (!mapData) { heatmapCacheRef.current = null; return }
    const level = mapData.levels[selectedLevel]
    if (!level || !level.heatmap) { heatmapCacheRef.current = null; return }

    const hm = level.heatmap
    const offscreen = document.createElement('canvas')
    offscreen.width = hm.width
    offscreen.height = hm.height
    const octx = offscreen.getContext('2d')
    const imgData = octx.createImageData(hm.width, hm.height)
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
        px[idx + 3] = Math.floor(55 + val * 200)
      }
    }

    octx.putImageData(imgData, 0, 0)
    heatmapCacheRef.current = {
      canvas: offscreen,
      origin: hm.origin,
      resolution: hm.resolution,
      width: hm.width,
      height: hm.height,
    }
  }, [mapData, selectedLevel])

  // Render
  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !mapData) return

    const ctx = canvas.getContext('2d')
    const { width, height } = canvas
    const vp = viewportRef.current

    // Clear
    ctx.fillStyle = '#0a0a14'
    ctx.fillRect(0, 0, width, height)

    const level = mapData.levels[selectedLevel]
    if (!level) return

    ctx.save()

    // Viewport transform: center of canvas + pan + zoom, flip Y
    ctx.translate(width / 2 + vp.x, height / 2 + vp.y)
    ctx.scale(vp.scale, -vp.scale)

    // ---- Mode-specific wall/data rendering ----

    if (mode === 'heatmap' && heatmapCacheRef.current) {
      // Heatmap: draw density grid as colored image
      const hm = heatmapCacheRef.current
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.translate(hm.origin[0], hm.origin[1])
      ctx.scale(hm.resolution, hm.resolution)
      ctx.drawImage(hm.canvas, 0, 0)
      ctx.restore()
    } else if (mode === 'points' && level.density && level.density.points) {
      // Density-weighted point cloud — direct screen-space rendering
      const dpr = window.devicePixelRatio || 1
      const pts = level.density.points
      for (const [x, y, d] of pts) {
        const r = (1.5 + d * 3.5) * dpr / vp.scale
        const a = (0.25 + d * 0.75).toFixed(2)
        ctx.fillStyle = `rgba(200, 215, 230, ${a})`
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (mode === 'edges') {
      // Edge detection: warm amber open polylines
      ctx.strokeStyle = '#ff9800'
      ctx.lineWidth = 1.5 / vp.scale
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      for (const polyline of level.walls) {
        if (polyline.length < 2) continue
        ctx.beginPath()
        ctx.moveTo(polyline[0][0], polyline[0][1])
        for (let i = 1; i < polyline.length; i++) {
          ctx.lineTo(polyline[i][0], polyline[i][1])
        }
        ctx.stroke()
      }
    } else if (mode === 'raw_slice') {
      // Raw Poisson slice: thin light-cyan segments
      ctx.strokeStyle = '#80deea'
      ctx.lineWidth = 1 / vp.scale
      ctx.lineCap = 'round'

      for (const polyline of level.walls) {
        if (polyline.length < 2) continue
        ctx.beginPath()
        ctx.moveTo(polyline[0][0], polyline[0][1])
        for (let i = 1; i < polyline.length; i++) {
          ctx.lineTo(polyline[i][0], polyline[i][1])
        }
        ctx.stroke()
      }
    } else {
      // Default: quick/standard/detailed — cyan closed polylines
      ctx.strokeStyle = '#00e5ff'
      ctx.lineWidth = 2 / vp.scale
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      for (const polyline of level.walls) {
        if (polyline.length < 2) continue
        ctx.beginPath()
        ctx.moveTo(polyline[0][0], polyline[0][1])
        for (let i = 1; i < polyline.length; i++) {
          ctx.lineTo(polyline[i][0], polyline[i][1])
        }
        ctx.closePath()
        ctx.stroke()
      }
    }

    // Draw trajectory
    if (level.trajectory && level.trajectory.length > 1) {
      ctx.strokeStyle = mode === 'heatmap'
        ? 'rgba(255, 255, 255, 0.3)'
        : 'rgba(0, 229, 255, 0.25)'
      ctx.lineWidth = 1.5 / vp.scale
      ctx.setLineDash([0.15, 0.15])
      ctx.beginPath()
      ctx.moveTo(level.trajectory[0][0], level.trajectory[0][1])
      for (let i = 1; i < level.trajectory.length; i++) {
        ctx.lineTo(level.trajectory[i][0], level.trajectory[i][1])
      }
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Draw auto-detected level transitions (from mapData.transitions)
    if (mapData.transitions && mapData.transitions.length > 0) {
      const transRadius = 8 / vp.scale
      const transColor = '#a78bfa'

      for (const tr of mapData.transitions) {
        // Show on both levels involved in this transition
        const currentLevelIdx = mapData.levels[selectedLevel]?.index
        if (currentLevelIdx !== tr.from_level && currentLevelIdx !== tr.to_level) continue

        // Pulsing outer glow
        ctx.fillStyle = transColor + '25'
        ctx.beginPath()
        ctx.arc(tr.x, tr.y, transRadius * 2.5, 0, Math.PI * 2)
        ctx.fill()

        // Diamond shape
        const sz = transRadius * 1.6
        ctx.beginPath()
        ctx.moveTo(tr.x, tr.y + sz)
        ctx.lineTo(tr.x + sz * 0.7, tr.y)
        ctx.lineTo(tr.x, tr.y - sz)
        ctx.lineTo(tr.x - sz * 0.7, tr.y)
        ctx.closePath()
        ctx.fillStyle = '#1a1a2e'
        ctx.fill()
        ctx.strokeStyle = transColor
        ctx.lineWidth = 2 / vp.scale
        ctx.stroke()

        // Arrow icon
        ctx.save()
        ctx.scale(1, -1)
        ctx.fillStyle = transColor
        ctx.font = `bold ${sz * 1.4}px system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('\u21C5', tr.x, -tr.y)
        ctx.restore()

        // Label
        const fromName = mapData.levels[tr.from_level]?.name || `Level ${tr.from_level + 1}`
        const toName = mapData.levels[tr.to_level]?.name || `Level ${tr.to_level + 1}`
        ctx.save()
        ctx.scale(1, -1)
        ctx.fillStyle = transColor
        ctx.font = `bold ${Math.max(10, 11) / vp.scale}px system-ui`
        ctx.textAlign = 'center'
        ctx.fillText(`${fromName} \u2194 ${toName}`, tr.x, -tr.y - sz - 5 / vp.scale)
        ctx.restore()
      }
    }

    // Draw POIs
    const levelPois = getLevelPois()
    const poiRadius = 6 / vp.scale
    const labelMinScale = 15

    for (const poi of levelPois) {
      const color = POI_COLORS[poi.poi_type] || POI_COLORS.marker
      const isSelected = poi.id === selectedPoiId
      const isTransition = poi.poi_type === 'transition'

      if (isTransition) {
        // Transition POI: large diamond with ⇅ icon — always prominent
        const sz = (isSelected ? poiRadius * 2.8 : poiRadius * 2.2)

        // Pulsing outer glow
        ctx.fillStyle = color + '30'
        ctx.beginPath()
        ctx.arc(poi.slam_x, poi.slam_y, sz * 1.8, 0, Math.PI * 2)
        ctx.fill()

        // Diamond shape
        ctx.beginPath()
        ctx.moveTo(poi.slam_x, poi.slam_y + sz)       // top
        ctx.lineTo(poi.slam_x + sz * 0.7, poi.slam_y) // right
        ctx.lineTo(poi.slam_x, poi.slam_y - sz)        // bottom
        ctx.lineTo(poi.slam_x - sz * 0.7, poi.slam_y)  // left
        ctx.closePath()
        ctx.fillStyle = '#1a1a2e'
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = 2 / vp.scale
        ctx.stroke()

        // ⇅ icon text inside diamond
        ctx.save()
        ctx.scale(1, -1)
        ctx.fillStyle = color
        ctx.font = `bold ${sz * 1.4}px system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('\u21C5', poi.slam_x, -poi.slam_y)
        ctx.restore()

        // Label always visible for transitions
        if (poi.label) {
          ctx.save()
          ctx.scale(1, -1)
          ctx.fillStyle = color
          ctx.font = `bold ${Math.max(10, 12) / vp.scale}px system-ui`
          ctx.textAlign = 'center'
          ctx.fillText(poi.label, poi.slam_x, -poi.slam_y - sz - 4 / vp.scale)
          ctx.restore()
        }
      } else {
        // Standard POI: colored circle

        // Outer glow for selected
        if (isSelected) {
          ctx.fillStyle = color + '40'
          ctx.beginPath()
          ctx.arc(poi.slam_x, poi.slam_y, poiRadius * 2.5, 0, Math.PI * 2)
          ctx.fill()
        }

        // Marker circle
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(poi.slam_x, poi.slam_y, isSelected ? poiRadius * 1.3 : poiRadius, 0, Math.PI * 2)
        ctx.fill()

        // Border
        ctx.strokeStyle = '#0a0a14'
        ctx.lineWidth = 1.5 / vp.scale
        ctx.stroke()

        // Label at high zoom
        if (vp.scale > labelMinScale && poi.label) {
          ctx.save()
          ctx.scale(1, -1)
          ctx.fillStyle = color
          ctx.font = `bold ${11 / vp.scale}px system-ui`
          ctx.fillText(poi.label, poi.slam_x + poiRadius * 1.8, -poi.slam_y + 4 / vp.scale)
          ctx.restore()
        }
      }
    }

    ctx.restore()

    // --- Screen-space overlays ---

    // Scale bar
    drawScaleBar(ctx, width, height, vp.scale)

    // Crosshair
    if (crosshairMode) {
      drawCrosshair(ctx, width, height)
    }
  }, [mapData, selectedLevel, mode, getLevelPois, crosshairMode, selectedPoiId])

  // Schedule render (cancels pending to ensure latest render closure is used)
  const scheduleRender = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      render()
    })
  }, [render])

  // Expose control methods to parent via ref
  useImperativeHandle(ref, () => ({
    fitToView: () => { fitToView(); scheduleRender() },
    centerOn: (x, y, scale) => { centerOn(x, y, scale); scheduleRender() },
  }), [fitToView, centerOn, scheduleRender])

  // Resize on mount + window resize
  useEffect(() => {
    resizeCanvas()
    const onResize = () => { resizeCanvas(); scheduleRender() }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [resizeCanvas, scheduleRender])

  // Initial fit: only on first mapData arrival
  useEffect(() => {
    if (mapData && !initialFitDone.current) {
      resizeCanvas()
      fitToView()
      initialFitDone.current = true
    }
    scheduleRender()
  }, [mapData, fitToView, resizeCanvas, scheduleRender])

  // Re-render when visual props change (no viewport reset)
  useEffect(() => { scheduleRender() }, [selectedLevel, crosshairMode, selectedPoiId, pois, scheduleRender])

  // --- Touch / pointer handlers ---

  const screenToWorld = useCallback((sx, sy) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const dpr = window.devicePixelRatio || 1
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const vp = viewportRef.current
    return {
      x: (sx * dpr - cx - vp.x) / vp.scale,
      y: -(sy * dpr - cy - vp.y) / vp.scale,
    }
  }, [])

  const hitTestPoi = useCallback((sx, sy) => {
    const world = screenToWorld(sx, sy)
    const levelPois = getLevelPois()
    const vp = viewportRef.current
    const hitRadius = 20 / vp.scale  // generous touch target

    let closest = null
    let closestDist = Infinity

    for (const poi of levelPois) {
      const dx = poi.slam_x - world.x
      const dy = poi.slam_y - world.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < hitRadius && dist < closestDist) {
        closest = poi
        closestDist = dist
      }
    }
    return closest
  }, [screenToWorld, getLevelPois])

  const handlePointerDown = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const t = touchRef.current
    const vp = viewportRef.current

    t.dragging = true
    t.startX = sx
    t.startY = sy
    t.startVpX = vp.x
    t.startVpY = vp.y
    t.tapStart = Date.now()
    t.tapX = sx
    t.tapY = sy
    t.moved = false
  }, [])

  const handlePointerMove = useCallback((e) => {
    const t = touchRef.current
    if (!t.dragging || t.pinching) return

    const rect = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const dpr = window.devicePixelRatio || 1

    const dx = (sx - t.startX) * dpr
    const dy = (sy - t.startY) * dpr

    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) t.moved = true

    viewportRef.current = {
      ...viewportRef.current,
      x: t.startVpX + dx,
      y: t.startVpY + dy,
    }
    scheduleRender()
  }, [scheduleRender])

  const handlePointerUp = useCallback((e) => {
    const t = touchRef.current
    t.dragging = false

    // Detect tap (no significant movement, short duration)
    if (!t.moved && (Date.now() - t.tapStart) < 400) {
      const rect = canvasRef.current.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top

      if (crosshairMode && onMapTap) {
        const world = screenToWorld(sx, sy)
        onMapTap(world)
      } else {
        const poi = hitTestPoi(sx, sy)
        if (poi && onPoiTap) {
          onPoiTap(poi)
        } else if (onPoiTap) {
          onPoiTap(null)  // deselect
        }
      }
    }
  }, [crosshairMode, onMapTap, onPoiTap, screenToWorld, hitTestPoi])

  // Pinch zoom via touch events
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 2) {
      e.preventDefault()
      const t = touchRef.current
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      t.pinching = true
      t.pinchDist = Math.sqrt(dx * dx + dy * dy)
      t.pinchScale = viewportRef.current.scale
    }
  }, [])

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 2) {
      e.preventDefault()
      const t = touchRef.current
      if (!t.pinching) return

      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      const ratio = dist / t.pinchDist

      viewportRef.current = {
        ...viewportRef.current,
        scale: Math.max(0.5, Math.min(200, t.pinchScale * ratio)),
      }
      scheduleRender()
    }
  }, [scheduleRender])

  const handleTouchEnd = useCallback((e) => {
    if (e.touches.length < 2) {
      touchRef.current.pinching = false
    }
  }, [])

  // Button zoom (zooms toward center of canvas)
  const zoomBy = useCallback((factor) => {
    const vp = viewportRef.current
    const newScale = Math.max(0.5, Math.min(200, vp.scale * factor))
    const scaleRatio = newScale / vp.scale

    viewportRef.current = {
      x: vp.x * scaleRatio,
      y: vp.y * scaleRatio,
      scale: newScale,
    }
    scheduleRender()
  }, [scheduleRender])

  // Scroll wheel zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.15 : 0.87
    const vp = viewportRef.current

    // Zoom toward cursor position
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const mx = (e.clientX - rect.left) * dpr - canvas.width / 2
    const my = (e.clientY - rect.top) * dpr - canvas.height / 2

    const newScale = Math.max(0.5, Math.min(200, vp.scale * factor))
    const scaleRatio = newScale / vp.scale

    viewportRef.current = {
      x: mx - (mx - vp.x) * scaleRatio,
      y: my - (my - vp.y) * scaleRatio,
      scale: newScale,
    }
    scheduleRender()
  }, [scheduleRender])

  return (
    <div ref={containerRef} className={`w-full ${compact ? 'h-[300px]' : 'flex-1'} relative`}>
      <canvas
        ref={canvasRef}
        className={`cave-map-canvas w-full h-full ${crosshairMode ? 'crosshair-mode' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
      />

      {/* Zoom controls */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 z-10">
        <button
          onClick={() => zoomBy(1.4)}
          className="w-8 h-8 rounded-lg bg-[var(--cyber-surface)]/80 backdrop-blur
            border border-[var(--cyber-border)] text-[var(--cyber-cyan)]
            hover:bg-[var(--cyber-surface)] hover:border-[var(--cyber-cyan)]
            active:scale-95 transition-all flex items-center justify-center
            text-base font-bold leading-none"
        >
          +
        </button>
        <button
          onClick={() => zoomBy(0.7)}
          className="w-8 h-8 rounded-lg bg-[var(--cyber-surface)]/80 backdrop-blur
            border border-[var(--cyber-border)] text-[var(--cyber-cyan)]
            hover:bg-[var(--cyber-surface)] hover:border-[var(--cyber-cyan)]
            active:scale-95 transition-all flex items-center justify-center
            text-base font-bold leading-none"
        >
          &minus;
        </button>
        <button
          onClick={() => { fitToView(); scheduleRender() }}
          className="w-8 h-8 rounded-lg bg-[var(--cyber-surface)]/80 backdrop-blur
            border border-[var(--cyber-border)] text-[var(--cyber-cyan)]
            hover:bg-[var(--cyber-surface)] hover:border-[var(--cyber-cyan)]
            active:scale-95 transition-all flex items-center justify-center
            text-[11px] font-semibold leading-none"
          title="Fit to view"
        >
          &#x2922;
        </button>
      </div>
    </div>
  )
})

export default CaveMapCanvas


// --- Drawing helpers ---

function drawScaleBar(ctx, width, height, scale) {
  // Calculate a nice round scale bar length
  const targetPx = 80
  const worldLen = targetPx / scale
  const nice = niceRound(worldLen)
  const barPx = nice * scale

  const x = width - barPx - 20
  const y = height - 25

  ctx.fillStyle = '#0a0a14cc'
  ctx.fillRect(x - 8, y - 16, barPx + 16, 28)

  ctx.strokeStyle = '#00e5ff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + barPx, y)
  // End ticks
  ctx.moveTo(x, y - 5)
  ctx.lineTo(x, y + 5)
  ctx.moveTo(x + barPx, y - 5)
  ctx.lineTo(x + barPx, y + 5)
  ctx.stroke()

  ctx.fillStyle = '#00e5ff'
  ctx.font = '11px system-ui'
  ctx.textAlign = 'center'
  ctx.fillText(nice >= 1 ? `${nice}m` : `${Math.round(nice * 100)}cm`, x + barPx / 2, y - 6)
}

function drawCrosshair(ctx, width, height) {
  const cx = width / 2
  const cy = height / 2
  const size = 20

  ctx.strokeStyle = '#ff4444'
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 4])

  ctx.beginPath()
  ctx.moveTo(cx - size, cy)
  ctx.lineTo(cx + size, cy)
  ctx.moveTo(cx, cy - size)
  ctx.lineTo(cx, cy + size)
  ctx.stroke()
  ctx.setLineDash([])

  // Small circle
  ctx.beginPath()
  ctx.arc(cx, cy, 4, 0, Math.PI * 2)
  ctx.stroke()
}

function niceRound(value) {
  const order = Math.pow(10, Math.floor(Math.log10(value)))
  const fraction = value / order
  if (fraction < 1.5) return order
  if (fraction < 3.5) return 2 * order
  if (fraction < 7.5) return 5 * order
  return 10 * order
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
