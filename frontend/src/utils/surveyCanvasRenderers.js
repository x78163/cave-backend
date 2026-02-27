/**
 * Survey rendering functions for CaveMapCanvas.
 *
 * Each function draws survey data onto a Canvas 2D context.
 * The caller (CaveMapCanvas) has already set up the world-coordinate transform
 * (ctx.translate + ctx.scale(vp.scale, -vp.scale)), so geometry draws in world
 * coords directly. Screen-space overlays (legends, north arrow) temporarily
 * reset the transform.
 *
 * Passage wall fills use offscreen canvas compositing for uniform alpha
 * (avoids double-darkening at junctions where quads overlap).
 */
import { BRANCH_COLORS } from './surveyColors'
import { matchSymbols, symbolToDataURL, symbolLabel, SYMBOLS } from './surveySymbols'

export { BRANCH_COLORS }

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export function drawSurveyGrid(ctx, vp, canvas) {
  const dpr = window.devicePixelRatio || 1
  const { width, height } = canvas

  // Reset to screen space for grid lines
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const sw = width / dpr
  const sh = height / dpr

  const scale = vp.scale
  const gridSize = scale > 5 ? 10 : scale > 1 ? 50 : 100

  // Convert screen edges to world coords to know which grid lines are visible
  const worldLeft = (-width / 2 - vp.x) / vp.scale
  const worldRight = (width / 2 - vp.x) / vp.scale
  const worldBottom = (-height / 2 - vp.y) / vp.scale  // note: flipped
  const worldTop = (height / 2 - vp.y) / vp.scale

  const worldToScreenX = (wx) => (width / (2 * dpr)) + (vp.x + wx * vp.scale) / dpr
  const worldToScreenY = (wy) => (height / (2 * dpr)) + (vp.y - wy * vp.scale) / dpr

  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1

  const gxMin = Math.floor(Math.min(worldLeft, worldRight) / gridSize) * gridSize
  const gxMax = Math.ceil(Math.max(worldLeft, worldRight) / gridSize) * gridSize
  for (let gx = gxMin; gx <= gxMax; gx += gridSize) {
    const sx = worldToScreenX(gx)
    ctx.beginPath()
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, sh)
    ctx.stroke()
  }

  const gyMin = Math.floor(Math.min(worldBottom, worldTop) / gridSize) * gridSize
  const gyMax = Math.ceil(Math.max(worldBottom, worldTop) / gridSize) * gridSize
  for (let gy = gyMin; gy <= gyMax; gy += gridSize) {
    const sy = worldToScreenY(gy)
    ctx.beginPath()
    ctx.moveTo(0, sy)
    ctx.lineTo(sw, sy)
    ctx.stroke()
  }

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Passage walls (offscreen compositing)
// ---------------------------------------------------------------------------

export function drawSurveyPassageWalls(ctx, renderData, vp, canvas) {
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

      // Apply same transform as main canvas
      oCtx.translate(canvas.width / 2 + vp.x, canvas.height / 2 + vp.y)
      oCtx.scale(vp.scale, -vp.scale)
      oCtx.fillStyle = '#ffa726'

      for (const o of list) {
        const pts = o.polygon
        if (pts.length < 3) continue
        oCtx.beginPath()
        oCtx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) oCtx.lineTo(pts[i][0], pts[i][1])
        oCtx.closePath()
        oCtx.fill()
      }

      ctx.save()
      // Reset transform to draw offscreen image at pixel coords
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalAlpha = alpha
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height,
        0, 0, canvas.width / dpr, canvas.height / dpr)
      ctx.restore()
    }

    if (lowerOutlines.length > 0) drawQuadFills(lowerOutlines, 0.10)
    drawQuadFills(upperOutlines, 0.18)

    // Deterministic pseudo-random for stable jitter across redraws
    // (seeded by coordinate values so it doesn't shimmer on pan/zoom)
    const seededRand = (x, y, i) => {
      const h = Math.sin(x * 12.9898 + y * 78.233 + i * 43.758) * 43758.5453
      return h - Math.floor(h) - 0.5  // range [-0.5, 0.5)
    }

    // Wall outlines drawn in world coords (main canvas transform is active)
    // Uses densified smooth points (Catmull-Rom → Bezier subdivisions from backend)
    // with deterministic jitter for hand-drawn feel.
    const drawWallLines = (list, dashed) => {
      const jitter = 0.06

      const drawSmooth = (pts, seed) => {
        if (pts.length < 2) return
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) {
          const jx = seededRand(pts[i][0], pts[i][1], i + seed) * jitter
          const jy = seededRand(pts[i][0], pts[i][1], i + seed + 1000) * jitter
          ctx.lineTo(pts[i][0] + jx, pts[i][1] + jy)
        }
        ctx.stroke()
      }

      for (const o of list) {
        ctx.strokeStyle = 'rgba(255,167,38,0.5)'
        ctx.lineWidth = 1 / vp.scale
        ctx.setLineDash(dashed ? [8 / vp.scale, 6 / vp.scale] : [])

        // Left wall — prefer smooth (Bezier-densified), fallback to raw
        drawSmooth(o.left_smooth || o.left || [], 0)
        // Right wall
        drawSmooth(o.right_smooth || o.right || [], 500)

        // Dead-end caps
        if (o.caps) {
          for (const cap of o.caps) {
            ctx.beginPath()
            ctx.moveTo(cap[0][0], cap[0][1])
            ctx.lineTo(cap[1][0], cap[1][1])
            ctx.stroke()
          }
        }
      }
    }

    if (lowerOutlines.length > 0) drawWallLines(lowerOutlines, true)
    drawWallLines(upperOutlines, false)
  } else {
    // Legacy fallback: passage_strokes
    const strokes = renderData.passage_strokes || []
    if (strokes.length > 0) {
      const offscreen = document.createElement('canvas')
      offscreen.width = canvas.width
      offscreen.height = canvas.height
      const oCtx = offscreen.getContext('2d')
      oCtx.translate(canvas.width / 2 + vp.x, canvas.height / 2 + vp.y)
      oCtx.scale(vp.scale, -vp.scale)
      oCtx.fillStyle = '#ffa726'

      for (const s of strokes) {
        const [x1, y1] = s.from
        const [x2, y2] = s.to
        const w1 = s.from_width
        const w2 = s.to_width
        if (w1 < 0.01 && w2 < 0.01) continue
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy)
        if (len < 0.001) continue
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
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalAlpha = 0.18
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height,
        0, 0, canvas.width / dpr, canvas.height / dpr)
      ctx.restore()

      // Wall outlines in world coords
      ctx.strokeStyle = 'rgba(255,167,38,0.5)'
      ctx.lineWidth = 1 / vp.scale
      for (const s of strokes) {
        const [x1, y1] = s.from
        const [x2, y2] = s.to
        const w1 = s.from_width, w2 = s.to_width
        if (w1 < 0.01 && w2 < 0.01) continue
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy)
        if (len < 0.001) continue
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
}

// ---------------------------------------------------------------------------
// Centerline
// ---------------------------------------------------------------------------

export function drawSurveyCenterline(ctx, renderData, vp) {
  if (!renderData.centerline?.length) return
  ctx.lineWidth = 2 / vp.scale
  for (const seg of renderData.centerline) {
    const branchId = seg[2] ?? 0
    const isLower = seg[3] ?? false
    ctx.strokeStyle = BRANCH_COLORS[branchId % BRANCH_COLORS.length]
    ctx.setLineDash(isLower ? [8 / vp.scale, 6 / vp.scale] : [])
    ctx.beginPath()
    ctx.moveTo(seg[0][0], seg[0][1])
    ctx.lineTo(seg[1][0], seg[1][1])
    ctx.stroke()
  }
  ctx.setLineDash([])
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

export function drawSurveyStations(ctx, renderData, vp) {
  if (!renderData.stations?.length) return
  const hasLevels = renderData.has_vertical_levels
  const stationCount = renderData.stations.length
  const dense = stationCount > 20
  const labelInterval = dense ? Math.max(3, Math.floor(stationCount / 12)) : 1
  const radius = 3 / vp.scale
  const junctionRadius = 6 / vp.scale

  for (let idx = 0; idx < stationCount; idx++) {
    const st = renderData.stations[idx]
    const isLower = hasLevels && st.is_lower
    const color = BRANCH_COLORS[(st.branch ?? 0) % BRANCH_COLORS.length]

    // Junction ring
    if (st.is_junction) {
      ctx.strokeStyle = color
      ctx.globalAlpha = isLower ? 0.3 : 1
      ctx.lineWidth = 2 / vp.scale
      ctx.beginPath()
      ctx.arc(st.x, st.y, junctionRadius, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // Dot
    if (isLower) {
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.35
      ctx.lineWidth = 1 / vp.scale
      ctx.beginPath()
      ctx.arc(st.x, st.y, radius * 0.67, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    } else {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(st.x, st.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }

    // Label (in screen space for readability)
    if (isLower) continue
    const isEndpoint = idx === 0 || idx === stationCount - 1
    if (dense && !isEndpoint && !st.is_junction && idx % labelInterval !== 0) continue
    ctx.save()
    ctx.scale(1, -1) // flip Y back for text
    const fontSize = Math.max(9, Math.min(12, vp.scale * 3))
    ctx.font = `${fontSize / vp.scale}px monospace`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = color
    ctx.fillText(st.name, st.x + 5 / vp.scale, -st.y - 3 / vp.scale)
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

/**
 * Pre-load symbol images into the cache for any new annotations.
 * Call this before drawSurveySymbols to ensure images are loading.
 */
export function loadSymbolImages(annotations, cache) {
  for (const ann of (annotations || [])) {
    const keys = matchSymbols(ann.comment)
    for (const key of keys) {
      if (!cache[key]) {
        const img = new Image()
        img.src = symbolToDataURL(SYMBOLS[key], '#ffa726')
        cache[key] = img
      }
    }
  }
}

export function drawSurveySymbols(ctx, renderData, vp, symbolImgCache) {
  const usedKeys = new Set()
  const annotations = renderData.shot_annotations || []

  for (const ann of annotations) {
    const keys = matchSymbols(ann.comment)
    for (const key of keys) usedKeys.add(key)
    if (keys.length === 0) continue

    const iconSize = Math.max(16, Math.min(28, vp.scale * 5)) / vp.scale
    // Draw in world coords (icon needs Y-flip for correct orientation)
    ctx.save()
    ctx.translate(ann.mid[0], ann.mid[1])
    ctx.scale(1, -1) // flip icon right-side-up

    keys.forEach((key, i) => {
      const img = symbolImgCache[key]
      if (img?.complete) {
        const offset = keys.length > 1 ? (i - (keys.length - 1) / 2) * (iconSize + 2 / vp.scale) : 0
        ctx.drawImage(img, -iconSize / 2 + offset, -iconSize / 2, iconSize, iconSize)
      }
    })
    ctx.restore()
  }

  return usedKeys
}

// ---------------------------------------------------------------------------
// North arrow (screen space)
// ---------------------------------------------------------------------------

export function drawNorthArrow(ctx, canvas) {
  const dpr = window.devicePixelRatio || 1
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const sw = canvas.width / dpr

  ctx.translate(sw - 30, 30)
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
}

// ---------------------------------------------------------------------------
// Scale bar (survey-specific, bottom-left, screen space)
// ---------------------------------------------------------------------------

export function drawSurveyScaleBar(ctx, vp, canvas) {
  const dpr = window.devicePixelRatio || 1
  const scale = vp.scale
  const gridSize = scale > 5 ? 10 : scale > 1 ? 50 : 100
  const barPx = gridSize * scale / dpr
  if (barPx < 20) return

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const sh = canvas.height / dpr

  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(15, sh - 15)
  ctx.lineTo(15 + barPx, sh - 15)
  ctx.stroke()
  ctx.font = '10px monospace'
  ctx.textAlign = 'center'
  ctx.fillText(`${gridSize}m`, 15 + barPx / 2, sh - 20)
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Branch legend (screen space, top-left)
// ---------------------------------------------------------------------------

export function drawBranchLegend(ctx, renderData, canvas) {
  if (!renderData.branches || renderData.branches.length <= 1) return
  const hasLevels = renderData.has_vertical_levels
  const dpr = window.devicePixelRatio || 1

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  let legendY = 38
  ctx.font = '10px monospace'
  ctx.textAlign = 'left'

  for (const branch of renderData.branches) {
    const color = BRANCH_COLORS[branch.id % BRANCH_COLORS.length]
    ctx.fillStyle = color
    ctx.fillRect(10, legendY, 10, 10)

    const isLower = hasLevels && branch.stations?.some(s => {
      const st = renderData.stations?.find(st => st.name === s)
      return st?.is_lower
    })
    ctx.fillStyle = '#e0e0f0'
    const label = isLower ? `${branch.name} (lower)` : branch.name
    ctx.fillText(label, 25, legendY + 9)

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
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Symbol legend (screen space, top-right)
// ---------------------------------------------------------------------------

export function drawSymbolLegend(ctx, renderData, symbolImgCache, canvas, usedSymbolKeys) {
  if (!usedSymbolKeys || usedSymbolKeys.size === 0) return
  const dpr = window.devicePixelRatio || 1

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const sw = canvas.width / dpr

  const legendIconSize = 16
  const lineH = 20
  const pad = 8
  const sortedKeys = [...usedSymbolKeys].sort()

  ctx.font = '10px monospace'
  let maxLabelW = 0
  for (const key of sortedKeys) {
    const w = ctx.measureText(symbolLabel(key)).width
    if (w > maxLabelW) maxLabelW = w
  }
  const boxW = pad + legendIconSize + 6 + maxLabelW + pad
  const boxH = pad + sortedKeys.length * lineH - (lineH - legendIconSize) + pad
  const boxX = sw - boxW - 8
  const boxY = 52

  ctx.fillStyle = 'rgba(10, 14, 20, 0.8)'
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(boxX, boxY, boxW, boxH, 6)
  ctx.fill()
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  sortedKeys.forEach((key, i) => {
    const y = boxY + pad + i * lineH
    const img = symbolImgCache[key]
    if (img?.complete) {
      ctx.drawImage(img, boxX + pad, y, legendIconSize, legendIconSize)
    }
    ctx.fillStyle = '#e0e0f0'
    ctx.font = '10px monospace'
    ctx.fillText(symbolLabel(key), boxX + pad + legendIconSize + 6, y + legendIconSize / 2)
  })
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Combined bounds helper
// ---------------------------------------------------------------------------

export function combineBounds(mapBounds, surveyBounds) {
  if (!mapBounds && !surveyBounds) return null
  if (!mapBounds) return surveyBounds
  if (!surveyBounds) return mapBounds
  return [
    Math.min(mapBounds[0], surveyBounds[0]),
    Math.min(mapBounds[1], surveyBounds[1]),
    Math.max(mapBounds[2], surveyBounds[2]),
    Math.max(mapBounds[3], surveyBounds[3]),
  ]
}
