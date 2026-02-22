import { useRef, useEffect, useState, useCallback } from 'react'

/**
 * Standalone 2D canvas renderer for survey data.
 * Pan/zoom with mouse/touch, renders centerline + passage walls + station labels.
 * No Leaflet dependency — works in survey-local coordinates (meters).
 */
export default function SurveyCanvas({ renderData, height = 400 }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const dragRef = useRef(null)
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

    // Passage walls (amber filled polygon)
    if (renderData.walls_left?.length > 1 && renderData.walls_right?.length > 1) {
      ctx.fillStyle = 'rgba(255,167,38,0.12)'
      ctx.strokeStyle = 'rgba(255,167,38,0.5)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      const left = renderData.walls_left
      const right = renderData.walls_right
      const [sx0, sy0] = toScreen(left[0][0], left[0][1])
      ctx.moveTo(sx0, sy0)
      for (let i = 1; i < left.length; i++) {
        const [sx, sy] = toScreen(left[i][0], left[i][1])
        ctx.lineTo(sx, sy)
      }
      for (let i = right.length - 1; i >= 0; i--) {
        const [sx, sy] = toScreen(right[i][0], right[i][1])
        ctx.lineTo(sx, sy)
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }

    // Centerline segments (cyan)
    if (renderData.centerline?.length > 0) {
      ctx.strokeStyle = '#00ffff'
      ctx.lineWidth = 2
      for (const seg of renderData.centerline) {
        const [x1, y1] = toScreen(seg[0][0], seg[0][1])
        const [x2, y2] = toScreen(seg[1][0], seg[1][1])
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
      }
    }

    // Station dots + labels
    if (renderData.stations?.length > 0) {
      ctx.fillStyle = '#00ffff'
      ctx.font = `${Math.max(9, Math.min(12, scale * 3))}px monospace`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      for (const st of renderData.stations) {
        const [sx, sy] = toScreen(st.x, st.y)
        ctx.beginPath()
        ctx.arc(sx, sy, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillText(st.name, sx + 5, sy - 3)
      }
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
  }, [renderData, transform, canvasSize])

  // Mouse handlers for pan + zoom
  const handleMouseDown = useCallback((e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx: transform.x, ty: transform.y }
  }, [transform])

  const handleMouseMove = useCallback((e) => {
    if (!dragRef.current) return
    setTransform(prev => ({
      ...prev,
      x: dragRef.current.tx + (e.clientX - dragRef.current.startX),
      y: dragRef.current.ty + (e.clientY - dragRef.current.startY),
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
        <button
          onClick={fitToView}
          className="absolute top-2 left-2 cyber-btn cyber-btn-ghost px-2 py-1 text-[10px]"
          title="Fit to view"
        >
          Fit
        </button>
      )}
    </div>
  )
}
