import { useRef, useEffect, useState, useCallback } from 'react'
import { BRANCH_COLORS } from '../utils/surveyColors'
import { matchSymbols, symbolToDataURL, symbolLabel, SYMBOLS } from '../utils/surveySymbols'

/**
 * Standalone 2D canvas renderer for survey data.
 * Pan/zoom with mouse/touch, renders centerline + passage walls + station labels.
 * Color-codes branches and highlights junction stations.
 * No Leaflet dependency — works in survey-local coordinates (meters).
 */
export default function SurveyCanvas({ renderData, height = 400 }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const dragRef = useRef(null)
  const symbolImgCache = useRef({})
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })

  // Resize canvas to match container width
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const resize = () => {
      const w = container.clientWidth
      const h = height
      canvas.width = w
      canvas.height = h
      setCanvasSize({ w, h })
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [height])

  // Compute initial transform to fit all data in view
  const fitToView = useCallback(() => {
    if (!renderData?.bounds || !canvasSize.w) return
    const [xMin, yMin, xMax, yMax] = renderData.bounds
    const w = xMax - xMin || 1
    const h = yMax - yMin || 1
    const padding = 40
    const scale = Math.min(
      (canvasSize.w - padding * 2) / w,
      (canvasSize.h - padding * 2) / h,
    )
    const cx = (xMin + xMax) / 2
    const cy = (yMin + yMax) / 2
    setTransform({
      x: canvasSize.w / 2 - cx * scale,
      y: canvasSize.h / 2 + cy * scale, // flip Y (canvas Y down, survey Y north)
      scale,
    })
  }, [renderData, canvasSize])

  // Fit when data or canvas size changes
  useEffect(() => {
    fitToView()
  }, [fitToView])

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !canvasSize.w) return
    const ctx = canvas.getContext('2d')
    const { x: tx, y: ty, scale } = transform

    // Clear
    ctx.fillStyle = '#0a0e14'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (!renderData?.stations?.length) {
      // Draw placeholder text
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.font = '14px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(
        'No survey data computed yet. Add shots and click "Save & Compute".',
        canvas.width / 2, canvas.height / 2,
      )
      return
    }

    const toScreen = (sx, sy) => [tx + sx * scale, ty - sy * scale]

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    const gridSize = scale > 5 ? 10 : scale > 1 ? 50 : 100
    const [xMin, yMin, xMax, yMax] = renderData.bounds || [0, 0, 0, 0]
    const gxMin = Math.floor(xMin / gridSize) * gridSize
    const gyMin = Math.floor(yMin / gridSize) * gridSize
    for (let gx = gxMin; gx <= xMax + gridSize; gx += gridSize) {
      const [sx] = toScreen(gx, 0)
      ctx.beginPath()
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, canvas.height)
      ctx.stroke()
    }
    for (let gy = gyMin; gy <= yMax + gridSize; gy += gridSize) {
      const [, sy] = toScreen(0, gy)
      ctx.beginPath()
      ctx.moveTo(0, sy)
      ctx.lineTo(canvas.width, sy)
      ctx.stroke()
    }

    // Passage walls — per-shot quads (trapezoids without round caps).
    // Each shot produces a quad from LRUD projected perpendicular to the shot bearing.
    // Offscreen canvas compositing ensures uniform fill at overlapping junctions.
    // Falls back to legacy passage_strokes if passage_outlines is absent.
    const outlines = renderData.passage_outlines || []
    const hasLevels = renderData.has_vertical_levels

    if (outlines.length > 0) {
      const upperOutlines = hasLevels ? outlines.filter(o => !o.is_lower) : outlines
      const lowerOutlines = hasLevels ? outlines.filter(o => o.is_lower) : []

      const drawQuadFills = (list, alpha) => {
        const offscreen = document.createElement('canvas')
        offscreen.width = canvas.width
        offscreen.height = canvas.height
        const oCtx = offscreen.getContext('2d')
        oCtx.fillStyle = '#ffa726'

        for (const o of list) {
          const pts = o.polygon.map(p => toScreen(p[0], p[1]))
          if (pts.length < 3) continue
          oCtx.beginPath()
          oCtx.moveTo(pts[0][0], pts[0][1])
          for (let i = 1; i < pts.length; i++) oCtx.lineTo(pts[i][0], pts[i][1])
          oCtx.closePath()
          oCtx.fill()
        }

        ctx.save()
        ctx.globalAlpha = alpha
        ctx.drawImage(offscreen, 0, 0)
        ctx.restore()
      }

      if (lowerOutlines.length > 0) drawQuadFills(lowerOutlines, 0.10)
      drawQuadFills(upperOutlines, 0.18)

      // Wall outlines — per-shot left/right wall segments + caps at dead ends
      const drawWallLines = (list, dashed) => {
        ctx.strokeStyle = 'rgba(255,167,38,0.5)'
        ctx.lineWidth = 1
        ctx.setLineDash(dashed ? [8, 6] : [])
        for (const o of list) {
          // Left wall segment
          const lp = (o.left || []).map(p => toScreen(p[0], p[1]))
          if (lp.length >= 2) {
            ctx.beginPath()
            ctx.moveTo(lp[0][0], lp[0][1])
            ctx.lineTo(lp[1][0], lp[1][1])
            ctx.stroke()
          }
          // Right wall segment
          const rp = (o.right || []).map(p => toScreen(p[0], p[1]))
          if (rp.length >= 2) {
            ctx.beginPath()
            ctx.moveTo(rp[0][0], rp[0][1])
            ctx.lineTo(rp[1][0], rp[1][1])
            ctx.stroke()
          }
          // Flat caps at terminal (dead-end) stations
          if (o.caps) {
            for (const cap of o.caps) {
              const [c0, c1] = cap.map(p => toScreen(p[0], p[1]))
              ctx.beginPath()
              ctx.moveTo(c0[0], c0[1])
              ctx.lineTo(c1[0], c1[1])
              ctx.stroke()
            }
          }
        }
        ctx.setLineDash([])
      }

      if (lowerOutlines.length > 0) drawWallLines(lowerOutlines, true)
      drawWallLines(upperOutlines, false)
    } else {
      // Legacy fallback: per-shot trapezoid strokes
      const strokes = renderData.passage_strokes || []
      if (strokes.length > 0) {
        const offscreen = document.createElement('canvas')
        offscreen.width = canvas.width
        offscreen.height = canvas.height
        const oCtx = offscreen.getContext('2d')
        oCtx.fillStyle = '#ffa726'

        for (const s of strokes) {
          const [x1, y1] = toScreen(s.from[0], s.from[1])
          const [x2, y2] = toScreen(s.to[0], s.to[1])
          const w1 = s.from_width * scale
          const w2 = s.to_width * scale
          if (w1 < 0.5 && w2 < 0.5) continue
          const dx = x2 - x1, dy = y2 - y1
          const len = Math.sqrt(dx * dx + dy * dy)
          if (len < 0.1) continue
          const px = -dy / len, py = dx / len
          const hw1 = w1 / 2, hw2 = w2 / 2
          oCtx.beginPath()
          oCtx.moveTo(x1 + px * hw1, y1 + py * hw1)
          oCtx.lineTo(x2 + px * hw2, y2 + py * hw2)
          oCtx.lineTo(x2 - px * hw2, y2 - py * hw2)
          oCtx.lineTo(x1 - px * hw1, y1 - py * hw1)
          oCtx.closePath()
          oCtx.fill()
        }
        ctx.save()
        ctx.globalAlpha = 0.18
        ctx.drawImage(offscreen, 0, 0)
        ctx.restore()

        ctx.strokeStyle = 'rgba(255,167,38,0.5)'
        ctx.lineWidth = 1
        for (const s of strokes) {
          const [x1, y1] = toScreen(s.from[0], s.from[1])
          const [x2, y2] = toScreen(s.to[0], s.to[1])
          const w1 = s.from_width * scale, w2 = s.to_width * scale
          if (w1 < 0.5 && w2 < 0.5) continue
          const dx = x2 - x1, dy = y2 - y1
          const len = Math.sqrt(dx * dx + dy * dy)
          if (len < 0.1) continue
          const px = -dy / len, py = dx / len
          const hw1 = w1 / 2, hw2 = w2 / 2
          ctx.beginPath()
          ctx.moveTo(x1 + px * hw1, y1 + py * hw1)
          ctx.lineTo(x2 + px * hw2, y2 + py * hw2)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(x1 - px * hw1, y1 - py * hw1)
          ctx.lineTo(x2 - px * hw2, y2 - py * hw2)
          ctx.stroke()
        }
      }
    }

    // Centerline segments (color-coded by branch, dashed for lower level)
    if (renderData.centerline?.length > 0) {
      ctx.lineWidth = 2
      for (const seg of renderData.centerline) {
        const branchId = seg[2] ?? 0
        const isLower = seg[3] ?? false
        ctx.strokeStyle = BRANCH_COLORS[branchId % BRANCH_COLORS.length]
        ctx.setLineDash(isLower ? [8, 6] : [])
        const [x1, y1] = toScreen(seg[0][0], seg[0][1])
        const [x2, y2] = toScreen(seg[1][0], seg[1][1])
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
      }
      ctx.setLineDash([])
    }

    // Station dots + labels (color-coded by branch, junction markers)
    // For multi-level caves, lower-level stations are dimmed (no labels, smaller dots)
    // For dense surveys (>20 stations), thin out labels to reduce clutter
    if (renderData.stations?.length > 0) {
      const stationCount = renderData.stations.length
      const dense = stationCount > 20
      // For dense surveys, only label every Nth station plus first/last/junctions
      const labelInterval = dense ? Math.max(3, Math.floor(stationCount / 12)) : 1

      ctx.font = `${Math.max(9, Math.min(12, scale * 3))}px monospace`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      for (let idx = 0; idx < stationCount; idx++) {
        const st = renderData.stations[idx]
        const isLower = hasLevels && st.is_lower
        const [sx, sy] = toScreen(st.x, st.y)
        const color = BRANCH_COLORS[(st.branch ?? 0) % BRANCH_COLORS.length]

        // Junction ring (larger outline for branching stations)
        if (st.is_junction) {
          ctx.strokeStyle = color
          ctx.globalAlpha = isLower ? 0.3 : 1
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(sx, sy, 6, 0, Math.PI * 2)
          ctx.stroke()
          ctx.globalAlpha = 1
        }

        // Dot — lower level gets smaller hollow circles
        if (isLower) {
          ctx.strokeStyle = color
          ctx.globalAlpha = 0.35
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(sx, sy, 2, 0, Math.PI * 2)
          ctx.stroke()
          ctx.globalAlpha = 1
        } else {
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(sx, sy, 3, 0, Math.PI * 2)
          ctx.fill()
        }

        // Label — skip for lower level; thin out for dense surveys
        if (isLower) continue
        const isEndpoint = idx === 0 || idx === stationCount - 1
        if (dense && !isEndpoint && !st.is_junction && idx % labelInterval !== 0) continue
        ctx.fillStyle = color
        ctx.fillText(st.name, sx + 5, sy - 3)
      }
    }

    // Symbol icons at shot midpoints (matched from comments)
    const usedSymbolKeys = new Set()
    for (const ann of (renderData.shot_annotations || [])) {
      const keys = matchSymbols(ann.comment)
      // Pre-load any new symbol images
      for (const key of keys) {
        usedSymbolKeys.add(key)
        if (!symbolImgCache.current[key]) {
          const img = new Image()
          img.src = symbolToDataURL(SYMBOLS[key], '#ffa726')
          symbolImgCache.current[key] = img
        }
      }
      if (keys.length === 0) continue
      const [mx, my] = toScreen(ann.mid[0], ann.mid[1])
      const iconSize = Math.max(16, Math.min(28, scale * 5))
      keys.forEach((key, i) => {
        const img = symbolImgCache.current[key]
        if (img?.complete) {
          const offset = keys.length > 1 ? (i - (keys.length - 1) / 2) * (iconSize + 2) : 0
          ctx.drawImage(img, mx - iconSize / 2 + offset, my - iconSize / 2, iconSize, iconSize)
        }
      })
    }

    // North arrow (top-right corner)
    ctx.save()
    ctx.translate(canvas.width - 30, 30)
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, -15)
    ctx.lineTo(-5, 5)
    ctx.lineTo(0, 0)
    ctx.lineTo(5, 5)
    ctx.closePath()
    ctx.fill()
    ctx.font = '10px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('N', 0, -18)
    ctx.restore()

    // Scale bar (bottom-left)
    const barMeters = gridSize
    const barPx = barMeters * scale
    if (barPx > 20) {
      ctx.strokeStyle = '#ffffff'
      ctx.fillStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(15, canvas.height - 15)
      ctx.lineTo(15 + barPx, canvas.height - 15)
      ctx.stroke()
      ctx.font = '10px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`${barMeters}m`, 15 + barPx / 2, canvas.height - 20)
    }

    // Branch legend (top-left, below Fit button area — only when 2+ branches)
    if (renderData.branches?.length > 1) {
      let legendY = 38
      ctx.font = '10px monospace'
      ctx.textAlign = 'left'
      for (const branch of renderData.branches) {
        const color = BRANCH_COLORS[branch.id % BRANCH_COLORS.length]
        ctx.fillStyle = color
        ctx.fillRect(10, legendY, 10, 10)

        // Add dashed indicator for lower-level branches
        const isLower = hasLevels && branch.stations?.some(s => {
          const st = renderData.stations?.find(st => st.name === s)
          return st?.is_lower
        })
        ctx.fillStyle = '#e0e0f0'
        const label = isLower ? `${branch.name} (lower)` : branch.name
        ctx.fillText(label, 25, legendY + 9)

        // Draw dashed line through the legend swatch for lower levels
        if (isLower) {
          ctx.strokeStyle = color
          ctx.lineWidth = 1
          ctx.setLineDash([3, 2])
          ctx.beginPath()
          ctx.moveTo(10, legendY + 5)
          ctx.lineTo(20, legendY + 5)
          ctx.stroke()
          ctx.setLineDash([])
        }

        legendY += 16
      }
    }

    // Symbol legend (top-right, below north arrow — only when symbols are used)
    if (usedSymbolKeys.size > 0) {
      const legendIconSize = 16
      const lineH = 20
      const pad = 8
      const sortedKeys = [...usedSymbolKeys].sort()

      // Measure max label width for background
      ctx.font = '10px monospace'
      let maxLabelW = 0
      for (const key of sortedKeys) {
        const w = ctx.measureText(symbolLabel(key)).width
        if (w > maxLabelW) maxLabelW = w
      }
      const boxW = pad + legendIconSize + 6 + maxLabelW + pad
      const boxH = pad + sortedKeys.length * lineH - (lineH - legendIconSize) + pad
      const boxX = canvas.width - boxW - 8
      const boxY = 52

      // Background
      ctx.fillStyle = 'rgba(10, 14, 20, 0.8)'
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(boxX, boxY, boxW, boxH, 6)
      ctx.fill()
      ctx.stroke()

      // Items
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      sortedKeys.forEach((key, i) => {
        const y = boxY + pad + i * lineH
        const img = symbolImgCache.current[key]
        if (img?.complete) {
          ctx.drawImage(img, boxX + pad, y, legendIconSize, legendIconSize)
        }
        ctx.fillStyle = '#e0e0f0'
        ctx.font = '10px monospace'
        ctx.fillText(symbolLabel(key), boxX + pad + legendIconSize + 6, y + legendIconSize / 2)
      })
    }
  }, [renderData, transform, canvasSize])

  // Mouse handlers for pan + zoom
  const handleMouseDown = useCallback((e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx: transform.x, ty: transform.y }
  }, [transform])

  const handleMouseMove = useCallback((e) => {
    const drag = dragRef.current
    if (!drag) return
    setTransform(prev => ({
      ...prev,
      x: drag.tx + (e.clientX - drag.startX),
      y: drag.ty + (e.clientY - drag.startY),
    }))
  }, [])

  const handleMouseUp = useCallback(() => {
    dragRef.current = null
  }, [])

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setTransform(prev => ({
      scale: prev.scale * zoomFactor,
      x: mx - (mx - prev.x) * zoomFactor,
      y: my - (my - prev.y) * zoomFactor,
    }))
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative rounded-xl overflow-hidden"
      style={{ height, border: '1px solid var(--cyber-border)' }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: dragRef.current ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      {renderData?.stations?.length > 0 && (
        <div className="absolute bottom-3 right-3 z-10 flex gap-1.5">
          <button
            onClick={() => {
              const cx = canvasSize.w / 2
              const cy = canvasSize.h / 2
              const zf = 1.3
              setTransform(prev => ({
                scale: prev.scale * zf,
                x: cx - (cx - prev.x) * zf,
                y: cy - (cy - prev.y) * zf,
              }))
            }}
            className="w-8 h-8 rounded-full text-sm font-bold
              bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
              backdrop-blur-sm hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50 transition-all shadow-lg"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => {
              const cx = canvasSize.w / 2
              const cy = canvasSize.h / 2
              const zf = 1 / 1.3
              setTransform(prev => ({
                scale: prev.scale * zf,
                x: cx - (cx - prev.x) * zf,
                y: cy - (cy - prev.y) * zf,
              }))
            }}
            className="w-8 h-8 rounded-full text-sm font-bold
              bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
              backdrop-blur-sm hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50 transition-all shadow-lg"
            title="Zoom out"
          >
            −
          </button>
          <button
            onClick={fitToView}
            className="px-3 h-8 rounded-full text-xs font-medium
              bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
              backdrop-blur-sm hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50 transition-all shadow-lg"
            title="Fit survey to view"
          >
            ⌖ Center
          </button>
        </div>
      )}
    </div>
  )
}
