import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { apiFetch } from '../hooks/useApi'

/**
 * Renders one or more survey map overlays on a Leaflet map.
 *
 * Each survey is a processed transparent PNG positioned at the cave entrance GPS,
 * rotated/scaled per its persisted calibration. When a survey is being edited,
 * calibration controls (rotation, opacity) are shown.
 *
 * Props:
 *   map               Leaflet map instance
 *   surveys           Array of SurveyMap objects from API
 *   activeSurveyId    UUID of the currently displayed survey (null = show all)
 *   visible           Master visibility toggle
 *   anchorLat         Cave entrance latitude
 *   anchorLon         Cave entrance longitude
 *   editingSurveyId   UUID of survey being edited (null = all locked)
 *   onSurveyUpdated   (updatedSurvey) => void — called after edit save
 *   onEditStart       (surveyId) => void — request edit mode
 *   onEditEnd         () => void — close edit mode
 *   caveId            UUID of the cave (for PATCH calls)
 */
export default function HandDrawnMapOverlay({
  map,
  surveys = [],
  activeSurveyId = null,
  visible = true,
  anchorLat,
  anchorLon,
  editingSurveyId = null,
  onSurveyUpdated,
  onEditStart,
  onEditEnd,
  onDeleteSurvey,
  caveId,
}) {
  const layersRef = useRef(new Map()) // surveyId -> L.imageOverlay
  const [panelOpen, setPanelOpen] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Local editing state — only used when editingSurveyId is set
  const [editHeading, setEditHeading] = useState(0)
  const [editOpacity, setEditOpacity] = useState(0.75)
  const [saving, setSaving] = useState(false)

  // Sync editing state when editingSurveyId changes
  useEffect(() => {
    setConfirmDelete(false)
    if (editingSurveyId) {
      const s = surveys.find(s => s.id === editingSurveyId)
      if (s) {
        setEditHeading(s.heading || 0)
        setEditOpacity(s.opacity ?? 0.75)
      }
    }
  }, [editingSurveyId])

  // Which surveys to render
  const visibleSurveys = visible
    ? (activeSurveyId
        ? surveys.filter(s => s.id === activeSurveyId)
        : surveys)
    : []

  // Main effect: create/update/remove Leaflet image overlays
  useEffect(() => {
    if (!map || anchorLat == null || anchorLon == null) {
      // Remove all layers
      layersRef.current.forEach(layer => layer.remove())
      layersRef.current.clear()
      return
    }

    const currentIds = new Set(visibleSurveys.map(s => s.id))

    // Remove overlays no longer visible
    layersRef.current.forEach((layer, id) => {
      if (!currentIds.has(id)) {
        layer.remove()
        layersRef.current.delete(id)
      }
    })

    // Create or update each visible survey
    visibleSurveys.forEach(s => {
      const isEditing = s.id === editingSurveyId
      const heading = isEditing ? editHeading : (s.heading || 0)
      const opacity = isEditing ? editOpacity : (s.opacity ?? 0.75)
      const scale = s.scale || 0.1
      const ax = s.anchor_x ?? 0.5
      const ay = s.anchor_y ?? 0.5
      const imgW = s.image_width || 600
      const imgH = s.image_height || 500

      // Calculate bounds
      const widthM = imgW * scale
      const heightM = imgH * scale
      const latDeg = heightM / 111320
      const lonDeg = widthM / (111320 * Math.cos(anchorLat * Math.PI / 180))

      const south = anchorLat - (1 - ay) * latDeg
      const north = anchorLat + ay * latDeg
      const west = anchorLon - ax * lonDeg
      const east = anchorLon + (1 - ax) * lonDeg
      const bounds = L.latLngBounds([south, west], [north, east])

      // Remove previous layer for this survey (will recreate)
      const existing = layersRef.current.get(s.id)
      if (existing) existing.remove()

      // Create overlay WITHOUT adding to map yet
      const overlay = L.imageOverlay(s.overlay_url, bounds, {
        opacity,
        interactive: false,
        className: 'hand-drawn-overlay',
      })

      // Helper: append rotation to whatever transform Leaflet sets
      const originX = (ax * 100).toFixed(1)
      const originY = (ay * 100).toFixed(1)
      const applyRotation = (img) => {
        if (!img) return
        img.style.transformOrigin = `${originX}% ${originY}%`
        if (heading !== 0) {
          img.style.transform += ` rotate(${heading}deg)`
        }
      }

      // Patch _reset and _animateZoom BEFORE addTo(map) — Leaflet's addTo
      // captures method references via getEvents() for event binding, so
      // patches must be in place before that happens
      const origReset = overlay._reset.bind(overlay)
      overlay._reset = function () {
        origReset()
        applyRotation(this._image)
      }

      const origAnimateZoom = overlay._animateZoom.bind(overlay)
      overlay._animateZoom = function (e) {
        origAnimateZoom(e)
        applyRotation(this._image)
      }

      // Now add to map — Leaflet binds our patched methods as event handlers
      overlay.addTo(map)

      layersRef.current.set(s.id, overlay)
    })

    return () => {
      layersRef.current.forEach(layer => layer.remove())
      layersRef.current.clear()
    }
  }, [map, anchorLat, anchorLon, visibleSurveys.length, activeSurveyId,
      editingSurveyId, editHeading, editOpacity,
      // Re-render when survey calibration changes
      ...surveys.map(s => `${s.id}-${s.heading}-${s.scale}-${s.opacity}-${s.anchor_x}-${s.anchor_y}`)])

  // Save calibration changes
  const handleSave = async () => {
    if (!editingSurveyId || !caveId) return
    setSaving(true)
    try {
      const updated = await apiFetch(`/caves/${caveId}/survey-maps/${editingSurveyId}/`, {
        method: 'PATCH',
        body: {
          heading: editHeading,
          opacity: editOpacity,
          is_locked: true,
        },
      })
      if (onSurveyUpdated) onSurveyUpdated(updated)
      if (onEditEnd) onEditEnd()
    } catch (err) {
      console.error('Failed to save calibration:', err)
    } finally {
      setSaving(false)
    }
  }

  // Don't render controls if nothing visible or not editing
  if (!visible || surveys.length === 0) return null
  if (!editingSurveyId) return null

  const editingSurvey = surveys.find(s => s.id === editingSurveyId)
  if (!editingSurvey) return null

  return (
    <div className="mt-2 rounded-xl bg-[#0a0a12]/90 backdrop-blur-sm border border-[var(--cyber-border)] shadow-lg overflow-hidden">
      {/* Panel header */}
      <button
        onClick={() => setPanelOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-[var(--cyber-text-dim)] hover:text-white transition-colors"
      >
        <span className="font-medium text-[var(--cyber-cyan)]">
          Editing: {editingSurvey.name || 'Survey Map'}
        </span>
        <span className="text-[10px]">{panelOpen ? '\u25BE' : '\u25B8'}</span>
      </button>

      {panelOpen && (
        <div className="px-3 pb-3 space-y-3">
          {/* Rotation */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-[var(--cyber-text-dim)] uppercase tracking-wide">Rotation</label>
              <span className="text-[10px] text-[var(--cyber-cyan)] font-mono">{editHeading}&deg;</span>
            </div>
            <input
              type="range" min={-180} max={180} step={1}
              value={editHeading}
              onChange={e => setEditHeading(Number(e.target.value))}
              className="w-full accent-[var(--cyber-cyan)] h-1"
            />
            <div className="flex justify-between text-[8px] text-[var(--cyber-text-dim)] mt-0.5">
              <span>-180&deg;</span>
              <button onClick={() => setEditHeading(0)} className="text-[var(--cyber-cyan)] hover:underline">Reset</button>
              <span>180&deg;</span>
            </div>
          </div>

          {/* Scale readout */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-[var(--cyber-text-dim)] uppercase tracking-wide">Scale</label>
              <span className="text-[10px] text-[var(--cyber-cyan)] font-mono">
                {(editingSurvey.scale || 0.1).toFixed(2)} m/px
              </span>
            </div>
            <span className="text-[9px] text-[var(--cyber-text-dim)]">
              ~{Math.round((editingSurvey.image_width || 600) * (editingSurvey.scale || 0.1))}m wide
            </span>
          </div>

          {/* Opacity */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-[var(--cyber-text-dim)] uppercase tracking-wide">Opacity</label>
              <span className="text-[10px] text-[var(--cyber-cyan)] font-mono">{Math.round(editOpacity * 100)}%</span>
            </div>
            <input
              type="range" min={0.1} max={1.0} step={0.05}
              value={editOpacity}
              onChange={e => setEditOpacity(Number(e.target.value))}
              className="w-full accent-[var(--cyber-cyan)] h-1"
            />
          </div>

          {/* Save / Cancel */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-1.5 rounded text-xs font-medium transition-all
                bg-[var(--cyber-cyan)]/20 text-[var(--cyber-cyan)] border border-cyan-700/50
                hover:bg-[var(--cyber-cyan)]/30 disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Confirm & Lock'}
            </button>
            <button
              onClick={onEditEnd}
              className="px-3 py-1.5 rounded text-xs text-[var(--cyber-text-dim)]
                border border-[var(--cyber-border)] hover:text-white transition-all"
            >
              Cancel
            </button>
          </div>

          {/* Delete */}
          {onDeleteSurvey && (
            <div className="pt-2 border-t border-[var(--cyber-border)]">
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
                >
                  Delete this survey map
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-red-400">Delete permanently?</span>
                  <button
                    onClick={() => { onDeleteSurvey(editingSurveyId); setConfirmDelete(false) }}
                    className="px-2 py-0.5 rounded text-[10px] font-medium text-red-400 border border-red-700/50
                      hover:bg-red-900/30 transition-all"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-2 py-0.5 rounded text-[10px] text-[var(--cyber-text-dim)]
                      border border-[var(--cyber-border)] hover:text-white transition-all"
                  >
                    No
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
