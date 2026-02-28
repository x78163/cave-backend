import { useState, useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import { apiFetch } from '../../hooks/useApi'

const WAYPOINT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="32" viewBox="0 0 22 32">
  <path d="M11 0C4.9 0 0 4.9 0 11c0 8.25 11 21 11 21s11-12.75 11-21C22 4.9 17.1 0 11 0z" fill="#fb923c" stroke="#0a0a12" stroke-width="1.5"/>
  <circle cx="11" cy="11" r="4.5" fill="#0a0a12"/>
</svg>`

const waypointIcon = L.divIcon({
  html: WAYPOINT_SVG,
  className: '',
  iconSize: [22, 32],
  iconAnchor: [11, 32],
  popupAnchor: [0, -34],
})

/**
 * Click-to-place surface waypoints on the cave's surface map.
 * Uses existing POI API with poi_type='waypoint', source='surface'.
 */
export default function WaypointTool({
  map, active, caveId, waypoints = [],
  onWaypointAdded, onWaypointDeleted,
}) {
  const layerGroupRef = useRef(null)
  const [pendingLatLng, setPendingLatLng] = useState(null)
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  // Create layer group
  useEffect(() => {
    if (!map) return
    const lg = L.layerGroup().addTo(map)
    layerGroupRef.current = lg
    return () => { lg.remove() }
  }, [map])

  // Render existing waypoints
  const renderWaypoints = useCallback(() => {
    if (!layerGroupRef.current || !map) return
    layerGroupRef.current.clearLayers()
    waypoints.forEach(wp => {
      if (wp.latitude == null || wp.longitude == null) return
      const marker = L.marker([wp.latitude, wp.longitude], { icon: waypointIcon })
      marker.bindPopup(`
        <div style="font-family:Ubuntu,system-ui; min-width:140px;">
          <div style="font-weight:600; color:#fb923c; margin-bottom:4px;">${wp.label || 'Waypoint'}</div>
          ${wp.description ? `<div style="font-size:11px; color:#aaa; margin-bottom:6px;">${wp.description}</div>` : ''}
          <div style="font-size:10px; color:#666; margin-bottom:6px;">${wp.latitude.toFixed(6)}, ${wp.longitude.toFixed(6)}</div>
          <button onclick="document.dispatchEvent(new CustomEvent('delete-waypoint',{detail:'${wp.id}'}))"
            style="font-size:11px; color:#f87171; background:none; border:1px solid #f87171; border-radius:4px; padding:2px 8px; cursor:pointer;">
            Delete
          </button>
        </div>
      `, { className: 'cyber-popup' })
      marker.addTo(layerGroupRef.current)
    })
  }, [map, waypoints])

  useEffect(() => { renderWaypoints() }, [renderWaypoints])

  // Listen for delete events from popup buttons
  useEffect(() => {
    const handler = async (e) => {
      const wpId = e.detail
      if (!wpId || !caveId) return
      try {
        await apiFetch(`/mapping/caves/${caveId}/pois/${wpId}/`, { method: 'DELETE' })
        onWaypointDeleted?.(wpId)
      } catch (err) {
        console.error('Failed to delete waypoint:', err)
      }
    }
    document.addEventListener('delete-waypoint', handler)
    return () => document.removeEventListener('delete-waypoint', handler)
  }, [caveId, onWaypointDeleted])

  // Map click to place waypoint
  useEffect(() => {
    if (!map || !active) return
    const onClick = (e) => {
      setPendingLatLng(e.latlng)
      setLabel('')
      setDescription('')
    }
    map.on('click', onClick)
    return () => map.off('click', onClick)
  }, [map, active])

  // Cancel on deactivate
  useEffect(() => {
    if (!active) setPendingLatLng(null)
  }, [active])

  const handleSave = async () => {
    if (!label.trim() || !pendingLatLng || !caveId) return
    setSaving(true)
    try {
      const wp = await apiFetch(`/mapping/caves/${caveId}/pois/`, {
        method: 'POST',
        body: JSON.stringify({
          poi_type: 'waypoint',
          source: 'surface',
          latitude: pendingLatLng.lat,
          longitude: pendingLatLng.lng,
          label: label.trim(),
          description: description.trim(),
        }),
      })
      onWaypointAdded?.(wp)
      setPendingLatLng(null)
    } catch (err) {
      console.error('Failed to save waypoint:', err)
    } finally {
      setSaving(false)
    }
  }

  // Pending waypoint form
  if (!pendingLatLng) return null

  return (
    <div className="absolute top-3 right-12 z-[1200]
      p-3 rounded-lg w-56
      bg-[#0a0a12]/95 text-[var(--cyber-text)] border border-orange-500/50
      backdrop-blur-sm shadow-lg space-y-2">
      <div className="text-xs font-semibold text-orange-400">New Waypoint</div>
      <div className="text-[10px] text-[var(--cyber-text-dim)]">
        {pendingLatLng.lat.toFixed(6)}, {pendingLatLng.lng.toFixed(6)}
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
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="cyber-input w-full px-2 py-1.5 text-xs resize-none"
        rows={2}
      />
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!label.trim() || saving}
          className="flex-1 px-2 py-1 rounded text-xs font-medium
            bg-orange-600/80 text-white border border-orange-500/50
            disabled:opacity-40 transition-all"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={() => setPendingLatLng(null)}
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
