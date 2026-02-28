import { useState, useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import { apiFetch } from '../../hooks/useApi'
import { polygonAreaSqMeters, sqMetersToAcres } from '../../utils/geoUtils'

const COLOR_PRESETS = [
  { color: '#00e5ff', label: 'Cyan' },
  { color: '#fb923c', label: 'Orange' },
  { color: '#4ade80', label: 'Green' },
  { color: '#a78bfa', label: 'Purple' },
  { color: '#f87171', label: 'Red' },
  { color: '#facc15', label: 'Yellow' },
]

/**
 * Polygon drawing tool for surface map annotations.
 * Click vertices, double-click to close, label + save.
 */
export default function PolygonTool({
  map, active, caveId, polygons = [],
  onPolygonAdded, onPolygonDeleted,
}) {
  const layerGroupRef = useRef(null)
  const drawGroupRef = useRef(null)
  const [vertices, setVertices] = useState([])
  const [closed, setClosed] = useState(false)
  const [label, setLabel] = useState('')
  const [color, setColor] = useState('#00e5ff')
  const [saving, setSaving] = useState(false)

  // Create layer groups
  useEffect(() => {
    if (!map) return
    const lg = L.layerGroup().addTo(map)
    const dg = L.layerGroup().addTo(map)
    layerGroupRef.current = lg
    drawGroupRef.current = dg
    return () => { lg.remove(); dg.remove() }
  }, [map])

  // Render saved polygons
  const renderPolygons = useCallback(() => {
    if (!layerGroupRef.current) return
    layerGroupRef.current.clearLayers()
    polygons.forEach(ann => {
      if (!ann.vertices || ann.vertices.length < 3) return
      const latlngs = ann.vertices.map(v => [v[0], v[1]])
      const poly = L.polygon(latlngs, {
        color: ann.color || '#00e5ff',
        weight: 2,
        opacity: 0.8,
        fillColor: ann.color || '#00e5ff',
        fillOpacity: ann.opacity || 0.3,
      })

      const areaSqM = polygonAreaSqMeters(ann.vertices.map(v => ({ lat: v[0], lon: v[1] })))
      const acres = sqMetersToAcres(areaSqM)

      poly.bindPopup(`
        <div style="font-family:Ubuntu,system-ui; min-width:140px;">
          <div style="font-weight:600; color:${ann.color || '#00e5ff'}; margin-bottom:4px;">${ann.label || 'Polygon'}</div>
          ${ann.description ? `<div style="font-size:11px; color:#aaa; margin-bottom:4px;">${ann.description}</div>` : ''}
          <div style="font-size:10px; color:#888; margin-bottom:6px;">
            ${areaSqM.toFixed(0)} m\u00B2 (${acres.toFixed(3)} acres)
          </div>
          <button onclick="document.dispatchEvent(new CustomEvent('delete-annotation',{detail:'${ann.id}'}))"
            style="font-size:11px; color:#f87171; background:none; border:1px solid #f87171; border-radius:4px; padding:2px 8px; cursor:pointer;">
            Delete
          </button>
        </div>
      `, { className: 'cyber-popup' })
      poly.addTo(layerGroupRef.current)
    })
  }, [polygons])

  useEffect(() => { renderPolygons() }, [renderPolygons])

  // Listen for delete events
  useEffect(() => {
    const handler = async (e) => {
      const annId = e.detail
      if (!annId || !caveId) return
      try {
        await apiFetch(`/caves/${caveId}/annotations/${annId}/`, { method: 'DELETE' })
        onPolygonDeleted?.(annId)
      } catch (err) {
        console.error('Failed to delete annotation:', err)
      }
    }
    document.addEventListener('delete-annotation', handler)
    return () => document.removeEventListener('delete-annotation', handler)
  }, [caveId, onPolygonDeleted])

  // Draw preview of vertices being placed
  const updateDrawPreview = useCallback((verts) => {
    if (!drawGroupRef.current) return
    drawGroupRef.current.clearLayers()
    if (verts.length === 0) return

    // Vertex markers
    verts.forEach((v, i) => {
      L.circleMarker([v.lat, v.lng], {
        radius: i === 0 ? 6 : 4,
        color: color,
        fillColor: i === 0 ? color : '#0a0a12',
        fillOpacity: 1,
        weight: 2,
      }).addTo(drawGroupRef.current)
    })

    // Lines between vertices
    if (verts.length >= 2) {
      const latlngs = verts.map(v => [v.lat, v.lng])
      L.polyline(latlngs, {
        color, weight: 2, dashArray: '6 3', opacity: 0.8,
      }).addTo(drawGroupRef.current)
    }

    // Preview polygon fill (closing line to first vertex)
    if (verts.length >= 3) {
      const latlngs = verts.map(v => [v.lat, v.lng])
      L.polygon(latlngs, {
        color, weight: 1, opacity: 0.4, fillColor: color, fillOpacity: 0.15,
      }).addTo(drawGroupRef.current)
    }
  }, [color])

  // Map click to add vertex
  useEffect(() => {
    if (!map || !active || closed) return
    const onClick = (e) => {
      setVertices(prev => {
        // If clicking near first vertex and we have 3+, close
        if (prev.length >= 3) {
          const first = prev[0]
          const dist = map.latLngToContainerPoint(e.latlng)
            .distanceTo(map.latLngToContainerPoint(L.latLng(first.lat, first.lng)))
          if (dist < 20) {
            setClosed(true)
            return prev
          }
        }
        const next = [...prev, e.latlng]
        updateDrawPreview(next)
        return next
      })
    }

    const onDblClick = (e) => {
      L.DomEvent.stopPropagation(e)
      L.DomEvent.preventDefault(e)
      if (vertices.length >= 3) setClosed(true)
    }

    map.on('click', onClick)
    map.on('dblclick', onDblClick)
    // Disable double-click zoom while drawing
    map.doubleClickZoom.disable()
    return () => {
      map.off('click', onClick)
      map.off('dblclick', onDblClick)
      map.doubleClickZoom.enable()
    }
  }, [map, active, closed, vertices.length, updateDrawPreview])

  // Update preview when color changes
  useEffect(() => {
    if (vertices.length > 0 && !closed) updateDrawPreview(vertices)
  }, [color, vertices, closed, updateDrawPreview])

  // Clear on deactivate
  useEffect(() => {
    if (!active) {
      setVertices([])
      setClosed(false)
      setLabel('')
      setColor('#00e5ff')
      drawGroupRef.current?.clearLayers()
    }
  }, [active])

  // Save polygon
  const handleSave = async () => {
    if (!label.trim() || vertices.length < 3 || !caveId) return
    setSaving(true)
    try {
      const verts = vertices.map(v => [v.lat, v.lng])
      const ann = await apiFetch(`/caves/${caveId}/annotations/`, {
        method: 'POST',
        body: JSON.stringify({
          label: label.trim(),
          color,
          opacity: 0.3,
          vertices: verts,
        }),
      })
      onPolygonAdded?.(ann)
      // Reset drawing state
      setVertices([])
      setClosed(false)
      setLabel('')
      drawGroupRef.current?.clearLayers()
    } catch (err) {
      console.error('Failed to save annotation:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setVertices([])
    setClosed(false)
    setLabel('')
    drawGroupRef.current?.clearLayers()
  }

  // Compute area for display
  const areaSqM = vertices.length >= 3
    ? polygonAreaSqMeters(vertices.map(v => ({ lat: v.lat, lon: v.lng })))
    : 0
  const acres = sqMetersToAcres(areaSqM)

  // Show form panel when polygon is closed
  if (!closed) {
    if (!active || vertices.length === 0) return null
    return (
      <div className="absolute top-3 right-12 z-[1200]
        px-3 py-2 rounded-lg
        bg-[#0a0a12]/90 text-[var(--cyber-text)] border border-[var(--cyber-cyan)]/30
        backdrop-blur-sm shadow-lg text-xs space-y-1">
        <div className="font-semibold text-[var(--cyber-cyan)]">Drawing Polygon</div>
        <div className="text-[var(--cyber-text-dim)]">{vertices.length} vertices placed</div>
        {vertices.length >= 3 && (
          <div className="text-[var(--cyber-text-dim)]">
            Area: {areaSqM.toFixed(0)} m² ({acres.toFixed(3)} ac)
          </div>
        )}
        <div className="text-[10px] text-[var(--cyber-text-dim)] opacity-60">
          {vertices.length < 3 ? 'Click to add vertices (min 3)' : 'Double-click or click first vertex to close'}
        </div>
        <button onClick={handleCancel}
          className="text-[10px] text-red-400 hover:text-red-300">
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="absolute top-3 right-12 z-[1200]
      p-3 rounded-lg w-56
      bg-[#0a0a12]/95 text-[var(--cyber-text)] border border-[var(--cyber-cyan)]/50
      backdrop-blur-sm shadow-lg space-y-2">
      <div className="text-xs font-semibold text-[var(--cyber-cyan)]">Save Polygon</div>
      <div className="text-[10px] text-[var(--cyber-text-dim)]">
        {vertices.length} vertices | {areaSqM.toFixed(0)} m² ({acres.toFixed(3)} ac)
      </div>
      <input
        type="text"
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="Label (required)"
        className="cyber-input w-full px-2 py-1.5 text-xs"
        autoFocus
        onKeyDown={e => { if (e.key === 'Enter' && label.trim()) handleSave() }}
      />
      {/* Color picker */}
      <div className="flex gap-1.5">
        {COLOR_PRESETS.map(c => (
          <button
            key={c.color}
            onClick={() => {
              setColor(c.color)
              // Update preview with new color
              if (drawGroupRef.current) {
                drawGroupRef.current.clearLayers()
                vertices.forEach((v, i) => {
                  L.circleMarker([v.lat, v.lng], {
                    radius: i === 0 ? 6 : 4, color: c.color,
                    fillColor: i === 0 ? c.color : '#0a0a12', fillOpacity: 1, weight: 2,
                  }).addTo(drawGroupRef.current)
                })
                const latlngs = vertices.map(v => [v.lat, v.lng])
                L.polygon(latlngs, {
                  color: c.color, weight: 2, opacity: 0.8,
                  fillColor: c.color, fillOpacity: 0.3,
                }).addTo(drawGroupRef.current)
              }
            }}
            title={c.label}
            className={`w-6 h-6 rounded-full border-2 transition-all ${
              color === c.color ? 'border-white scale-110' : 'border-transparent opacity-60 hover:opacity-100'
            }`}
            style={{ backgroundColor: c.color }}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!label.trim() || saving}
          className="flex-1 px-2 py-1 rounded text-xs font-medium
            bg-cyan-600/80 text-white border border-cyan-500/50
            disabled:opacity-40 transition-all"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={handleCancel}
          className="px-2 py-1 rounded text-xs
            text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
            hover:text-[var(--cyber-text)] transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
