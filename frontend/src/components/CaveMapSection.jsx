import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../hooks/useApi'
import CaveMapCanvas from './CaveMapCanvas'
import RouteBuilder from './RouteBuilder'

const POI_TYPES = [
  { value: 'entrance', label: 'Entrance', color: '#4ade80' },
  { value: 'junction', label: 'Junction', color: '#fbbf24' },
  { value: 'squeeze', label: 'Squeeze', color: '#f87171' },
  { value: 'water', label: 'Water', color: '#60a5fa' },
  { value: 'formation', label: 'Formation', color: '#c084fc' },
  { value: 'hazard', label: 'Hazard', color: '#ef4444' },
  { value: 'biology', label: 'Biology', color: '#34d399' },
  { value: 'camp', label: 'Camp', color: '#fb923c' },
  { value: 'survey_station', label: 'Station', color: '#94a3b8' },
  { value: 'transition', label: 'Transition', color: '#a78bfa' },
  { value: 'marker', label: 'Marker', color: '#e2e8f0' },
]

const POI_ICONS = {
  entrance: '\u25B2', junction: '\u25C6', squeeze: '\u25AC', water: '~',
  formation: '\u2726', hazard: '\u26A0', biology: '\u2618', camp: '\u2302',
  survey_station: '\u2295', transition: '\u21C5', marker: '\u25CF',
}

const MODE_LABELS = {
  quick: 'Quick',
  standard: 'Standard',
  detailed: 'Detailed',
  heatmap: 'Heatmap',
  edges: 'Edges',
  raw_slice: 'Slice',
  points: 'Points',
}

// Display order for mode pills (independent of generation order)
const MODE_ORDER = ['quick', 'standard', 'detailed', 'heatmap', 'edges', 'raw_slice', 'points']

// Scale that makes the scale bar show ~1m
const ONE_METER_SCALE = 80

export default function CaveMapSection({ caveId, preloadedRoute }) {
  const [mapData, setMapData] = useState(null)
  const [pois, setPois] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedLevel, setSelectedLevel] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [selectedPoi, setSelectedPoi] = useState(null)
  const [crosshairMode, setCrosshairMode] = useState(false)
  const [addPoiCoords, setAddPoiCoords] = useState(null)

  // Map mode state
  const [availableModes, setAvailableModes] = useState([])
  const [currentMode, setCurrentMode] = useState(null)
  const [photoPickerPoiId, setPhotoPickerPoiId] = useState(null)
  const [routeOverlay, setRouteOverlay] = useState(null)
  const [routePlaceMode, setRoutePlaceMode] = useState(false)
  const [routePlacedPoint, setRoutePlacedPoint] = useState(null)
  const [savedRoutes, setSavedRoutes] = useState([])
  const [savedRoutesLoading, setSavedRoutesLoading] = useState(false)
  const canvasRef = useRef(null)
  const poiListRef = useRef(null)

  // Fetch map data for a specific mode
  const fetchMapData = useCallback(async (mode) => {
    try {
      const url = mode
        ? `/caves/${caveId}/map-data/?mode=${mode}`
        : `/caves/${caveId}/map-data/`
      const data = await apiFetch(url)
      setMapData(data)
      setAvailableModes(data.available_modes || [])
      setCurrentMode(data.mode || mode || 'quick')
      return true
    } catch { /* ignore */ }
    return false
  }, [caveId])

  // Initial load: fetch best available map
  useEffect(() => {
    fetchMapData(null).then(() => {
      setLoading(false)
    })
  }, [fetchMapData])

  // Fetch POIs
  useEffect(() => {
    apiFetch(`/mapping/caves/${caveId}/pois/`)
      .then(data => setPois(data.pois || []))
      .catch(() => {})
  }, [caveId])

  // Load preloaded route as overlay
  useEffect(() => {
    if (!preloadedRoute) return
    const computed = preloadedRoute.computed_route || {}
    setRouteOverlay({
      path: computed.path || [],
      waypoints: preloadedRoute.waypoints || [],
      junctions: computed.junctions || [],
      instructions: computed.instructions || [],
      activeInstruction: null,
    })
  }, [preloadedRoute])

  // Fetch saved routes for this cave
  useEffect(() => {
    setSavedRoutesLoading(true)
    apiFetch(`/caves/${caveId}/routes/`)
      .then(data => setSavedRoutes(data.routes || []))
      .catch(() => {})
      .finally(() => setSavedRoutesLoading(false))
  }, [caveId])

  const loadSavedRoute = useCallback((route) => {
    const computed = route.computed_route || {}
    setRouteOverlay({
      path: computed.path || [],
      waypoints: route.waypoints || [],
      junctions: computed.junctions || [],
      instructions: computed.instructions || [],
      activeInstruction: null,
    })
  }, [])

  // Switch map mode (no viewport reset)
  const switchMode = useCallback((mode) => {
    if (mode === currentMode) return
    fetchMapData(mode)
  }, [currentMode, fetchMapData])

  // Handle map tap (crosshair mode -> place POI or route waypoint)
  const handleMapTap = useCallback((world) => {
    if (!mapData) return
    if (routePlaceMode) {
      setRoutePlacedPoint({ x: world.x, y: world.y })
      return
    }
    if (!crosshairMode) return
    const level = mapData.levels[selectedLevel]
    setAddPoiCoords({ x: world.x, y: world.y, z: level ? level.z_center : 0 })
    setCrosshairMode(false)
  }, [crosshairMode, routePlaceMode, mapData, selectedLevel])

  // Route builder callbacks
  const handleRouteComputed = useCallback((routeData) => {
    const computed = routeData.computed_route || {}
    setRouteOverlay({
      path: computed.path || [],
      waypoints: routeData.waypoints || [],
      junctions: computed.junctions || [],
      instructions: computed.instructions || [],
      activeInstruction: routeData.activeInstruction ?? null,
    })
  }, [])

  const handleRouteClear = useCallback(() => {
    setRouteOverlay(null)
    setRoutePlaceMode(false)
    setRoutePlacedPoint(null)
  }, [])

  // Handle POI tap on map: center + zoom to 1m + highlight
  const handlePoiTap = useCallback((poi) => {
    if (!poi) {
      setSelectedPoi(null)
      return
    }
    setSelectedPoi(poi)
    // Center map on POI and zoom to 1m scale
    if (canvasRef.current) {
      canvasRef.current.centerOn(poi.slam_x, poi.slam_y, ONE_METER_SCALE)
    }
    // Scroll POI into view in the list
    setTimeout(() => {
      const el = document.getElementById(`poi-card-${poi.id}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 100)
  }, [])

  // Determine which level a POI belongs to (closest z_center)
  const getPoiLevel = useCallback((poi) => {
    if (!mapData || poi.slam_z == null) return selectedLevel
    let bestLevel = 0
    let bestDist = Infinity
    for (let i = 0; i < mapData.levels.length; i++) {
      const dist = Math.abs(poi.slam_z - mapData.levels[i].z_center)
      if (dist < bestDist) {
        bestDist = dist
        bestLevel = i
      }
    }
    return bestLevel
  }, [mapData, selectedLevel])

  // Handle POI click in the list card
  const handlePoiListClick = useCallback((poi) => {
    setSelectedPoi(prev => prev?.id === poi.id ? null : poi)
    // Auto-switch to the POI's level
    const poiLevel = getPoiLevel(poi)
    if (poiLevel !== selectedLevel) {
      setSelectedLevel(poiLevel)
    }
    // Center map on POI
    if (canvasRef.current && poi.slam_x != null) {
      canvasRef.current.centerOn(poi.slam_x, poi.slam_y, ONE_METER_SCALE)
    }
  }, [getPoiLevel, selectedLevel])

  // Submit new POI
  const submitPoi = useCallback(async (poiData) => {
    try {
      const newPoi = await apiFetch(`/mapping/caves/${caveId}/pois/`, {
        method: 'POST',
        body: {
          label: poiData.label,
          poi_type: poiData.poi_type,
          description: poiData.description,
          slam_x: poiData.x,
          slam_y: poiData.y,
          slam_z: poiData.z,
          source: 'profile',
        }
      })
      setPois(prev => [newPoi, ...prev])
      setAddPoiCoords(null)
      setSelectedPoi(newPoi)
    } catch (err) {
      console.error('Failed to save POI:', err.response?.data || err.message)
    }
  }, [caveId])

  // Update POI (label, description, poi_type)
  const updatePoi = useCallback(async (poiId, updates) => {
    try {
      const updated = await apiFetch(`/mapping/caves/${caveId}/pois/${poiId}/`, {
        method: 'PATCH',
        body: updates,
      })
      setPois(prev => prev.map(p => p.id === poiId ? updated : p))
      if (selectedPoi?.id === poiId) setSelectedPoi(updated)
    } catch { /* ignore */ }
  }, [caveId, selectedPoi])

  // Delete POI
  const deletePoi = useCallback(async (poiId) => {
    try {
      await apiFetch(`/mapping/caves/${caveId}/pois/${poiId}/`, {
        method: 'DELETE',
      })
      setPois(prev => prev.filter(p => p.id !== poiId))
      if (selectedPoi?.id === poiId) setSelectedPoi(null)
    } catch { /* ignore */ }
  }, [caveId, selectedPoi])

  // Attach a cave gallery photo to a POI
  const attachCavePhoto = useCallback(async (poiId, cavePhotoId) => {
    try {
      const updated = await apiFetch(`/mapping/caves/${caveId}/pois/${poiId}/`, {
        method: 'PATCH',
        body: { cave_photo: cavePhotoId, photo_source: 'gallery' },
      })
      setPois(prev => prev.map(p => p.id === poiId ? updated : p))
      if (selectedPoi?.id === poiId) setSelectedPoi(updated)
      setPhotoPickerPoiId(null)
    } catch { /* ignore */ }
  }, [caveId, selectedPoi])

  // Detach photo from POI
  const detachPoiPhoto = useCallback(async (poiId) => {
    try {
      const updated = await apiFetch(`/mapping/caves/${caveId}/pois/${poiId}/`, {
        method: 'PATCH',
        body: { cave_photo: null, photo_source: '' },
      })
      setPois(prev => prev.map(p => p.id === poiId ? updated : p))
      if (selectedPoi?.id === poiId) setSelectedPoi(updated)
    } catch { /* ignore */ }
  }, [caveId, selectedPoi])

  // --- Render states ---

  if (loading) {
    return (
      <div className="mx-4 my-3 h-[200px] rounded-2xl bg-[var(--cyber-surface)] border border-[var(--cyber-border)]
        flex items-center justify-center">
        <div className="text-[var(--cyber-text-dim)] text-sm">Loading map...</div>
      </div>
    )
  }

  if (!mapData) {
    return (
      <div className="mx-4 my-3 rounded-2xl bg-[var(--cyber-surface)] border border-[var(--cyber-border)] p-6
        flex flex-col items-center gap-3">
        <div className="text-4xl text-[var(--cyber-cyan)] opacity-30">&#x25B3;</div>
        <p className="text-[var(--cyber-text-dim)] text-sm text-center">
          No cave map data available yet
        </p>
        <p className="text-[#555570] text-xs text-center">
          Map data is generated when the cave is mapped on a device
        </p>
      </div>
    )
  }

  // --- Main map render ---

  const levels = mapData.levels || []
  const multiLevel = levels.length > 1
  const multiMode = availableModes.length > 1

  const containerClass = fullscreen
    ? 'fixed inset-0 z-[1500] bg-[var(--cyber-bg)] flex flex-col'
    : 'mx-4 my-3 rounded-2xl bg-[var(--cyber-surface)] border border-[var(--cyber-border)] overflow-hidden'

  return (
    <>
      <div className={containerClass}>
        {/* Top bar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--cyber-border)]">
          <div className="flex items-center gap-2">
            {fullscreen && (
              <button
                onClick={() => setFullscreen(false)}
                className="text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] text-sm px-2"
              >
                &larr;
              </button>
            )}
            <span className="text-white text-sm font-semibold">Cave Map</span>
          </div>

          <div className="flex items-center gap-2">
            {crosshairMode && (
              <span className="text-[10px] text-red-400 font-mono animate-pulse">TAP TO PLACE</span>
            )}
            <button
              onClick={() => { setCrosshairMode(!crosshairMode); setSelectedPoi(null) }}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all
                ${crosshairMode
                  ? 'bg-red-900/50 text-red-300 border border-red-700/50'
                  : 'bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] hover:border-[var(--cyber-cyan)] hover:text-[var(--cyber-cyan)]'
                }`}
            >
              {crosshairMode ? 'Cancel' : '+ POI'}
            </button>
            {!fullscreen && (
              <button
                onClick={() => setFullscreen(true)}
                className="px-3 py-1 rounded-full text-xs bg-[var(--cyber-surface-2)]
                  text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
                  hover:border-[var(--cyber-cyan)] hover:text-[var(--cyber-cyan)] transition-all"
              >
                Expand
              </button>
            )}
          </div>
        </div>

        {/* Mode selector row */}
        {multiMode && (
          <div className="flex gap-1.5 px-3 py-2 overflow-x-auto border-b border-[var(--cyber-border)]">
            {MODE_ORDER.filter(m => availableModes.includes(m)).map(mode => (
              <button
                key={mode}
                onClick={() => switchMode(mode)}
                className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all
                  ${mode === currentMode
                    ? 'bg-[var(--cyber-cyan)] text-[var(--cyber-bg)]'
                    : 'bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] hover:border-[var(--cyber-cyan)] hover:text-[var(--cyber-cyan)]'
                  }`}
              >
                {MODE_LABELS[mode] || mode}
              </button>
            ))}
          </div>
        )}

        {/* Level selector */}
        {multiLevel && (
          <div className="flex gap-1.5 px-3 py-2 overflow-x-auto border-b border-[var(--cyber-border)]">
            {levels.map((level, i) => (
              <button
                key={i}
                onClick={() => { setSelectedLevel(i); setSelectedPoi(null) }}
                className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all
                  ${i === selectedLevel
                    ? 'bg-[var(--cyber-cyan)] text-[var(--cyber-bg)]'
                    : 'bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]'
                  }`}
              >
                {level.name}
              </button>
            ))}
          </div>
        )}

        {/* Route builder panel */}
        <RouteBuilder
          caveId={caveId}
          mapData={mapData}
          mapMode={currentMode}
          pois={pois}
          selectedLevel={selectedLevel}
          onRouteComputed={handleRouteComputed}
          onRouteClear={handleRouteClear}
          onEnterPlaceMode={() => setRoutePlaceMode(true)}
          onExitPlaceMode={() => setRoutePlaceMode(false)}
          placedPoint={routePlacedPoint}
          onPlacedPointConsumed={() => setRoutePlacedPoint(null)}
        />

        {/* Canvas */}
        <CaveMapCanvas
          ref={canvasRef}
          mapData={mapData}
          pois={pois}
          selectedLevel={selectedLevel}
          mode={currentMode}
          onPoiTap={handlePoiTap}
          onMapTap={handleMapTap}
          crosshairMode={crosshairMode || routePlaceMode}
          compact={!fullscreen}
          selectedPoiId={selectedPoi?.id}
          routeOverlay={routeOverlay}
        />

        {/* Add POI dialog */}
        {addPoiCoords && (
          <AddPoiDialog
            coords={addPoiCoords}
            onSubmit={submitPoi}
            onCancel={() => setAddPoiCoords(null)}
          />
        )}

        {/* Photo picker modal */}
        {photoPickerPoiId && (
          <PhotoPickerModal
            caveId={caveId}
            onSelect={(photoId) => attachCavePhoto(photoPickerPoiId, photoId)}
            onCancel={() => setPhotoPickerPoiId(null)}
          />
        )}
      </div>

      {/* Saved Routes Panel — below the map */}
      {!fullscreen && savedRoutes.length > 0 && (
        <div className="mx-4 mb-3">
          <h3 className="text-white font-semibold text-sm mb-2">
            Saved Routes ({savedRoutes.length})
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {savedRoutes.map(route => {
              const computed = route.computed_route || {}
              return (
                <button
                  key={route.id}
                  onClick={() => loadSavedRoute(route)}
                  className="flex-shrink-0 cyber-card p-3 text-left hover:border-[var(--cyber-cyan)] transition-all"
                  style={{ minWidth: '160px' }}
                >
                  <div className="text-white text-xs font-semibold truncate">
                    {route.name || 'Unnamed'}
                  </div>
                  <div className="flex gap-2 mt-1">
                    {computed.total_distance_m != null && (
                      <span className="text-[var(--cyber-cyan)] text-[10px]">
                        {computed.total_distance_m.toFixed(1)}m
                      </span>
                    )}
                    {route.waypoints?.length > 0 && (
                      <span className="text-[var(--cyber-text-dim)] text-[10px]">
                        {route.waypoints.length} pts
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* POI List Cards — below the map */}
      {!fullscreen && pois.length > 0 && (
        <div ref={poiListRef} className="mx-4 mb-3">
          <h3 className="text-white font-semibold text-sm mb-2">
            Points of Interest ({pois.length})
          </h3>
          <div className="space-y-2">
            {pois.map(poi => (
              <PoiCard
                key={poi.id}
                poi={poi}
                isSelected={selectedPoi?.id === poi.id}
                onClick={() => handlePoiListClick(poi)}
                onUpdate={updatePoi}
                onDelete={deletePoi}
                onPickPhoto={() => setPhotoPickerPoiId(poi.id)}
                onDetachPhoto={() => detachPoiPhoto(poi.id)}
                levelName={mapData && mapData.levels.length > 1
                  ? mapData.levels[getPoiLevel(poi)]?.name
                  : null}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}


// --- Sub-components ---

function PoiCard({ poi, isSelected, onClick, onUpdate, onDelete, onPickPhoto, onDetachPhoto, levelName }) {
  const [editing, setEditing] = useState(false)
  const [editLabel, setEditLabel] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editType, setEditType] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const typeInfo = POI_TYPES.find(t => t.value === poi.poi_type) || POI_TYPES[POI_TYPES.length - 1]
  const photoUrl = poi.cave_photo_url || poi.photo || null

  const startEdit = (e) => {
    e.stopPropagation()
    setEditLabel(poi.label || '')
    setEditDesc(poi.description || '')
    setEditType(poi.poi_type || 'marker')
    setEditing(true)
  }

  const saveEdit = (e) => {
    e.stopPropagation()
    onUpdate(poi.id, { label: editLabel, description: editDesc, poi_type: editType })
    setEditing(false)
  }

  return (
    <div
      id={`poi-card-${poi.id}`}
      onClick={onClick}
      className={`rounded-2xl border p-3 transition-all cursor-pointer
        ${isSelected
          ? 'bg-[var(--cyber-surface)] border-[var(--cyber-cyan)] shadow-[0_0_12px_rgba(0,229,255,0.15)]'
          : 'bg-[var(--cyber-surface)] border-[var(--cyber-border)] hover:border-[var(--cyber-text-dim)]'
        }`}
    >
      {editing ? (
        /* Edit mode */
        <div className="space-y-2" onClick={e => e.stopPropagation()}>
          {/* Type selector */}
          <div className="flex gap-1 flex-wrap">
            {POI_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setEditType(t.value)}
                className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition-all
                  ${editType === t.value
                    ? 'border border-[var(--cyber-cyan)] bg-cyan-900/20'
                    : 'border border-[var(--cyber-border)] bg-[var(--cyber-surface-2)]'
                  }`}
                style={{ color: t.color }}
              >
                {POI_ICONS[t.value]} {t.label}
              </button>
            ))}
          </div>
          <input
            value={editLabel}
            onChange={e => setEditLabel(e.target.value)}
            placeholder="Label..."
            className="w-full px-3 py-1.5 text-sm rounded-xl bg-[var(--cyber-bg)]
              border border-[var(--cyber-border)] text-white
              focus:outline-none focus:border-[var(--cyber-cyan)]"
          />
          <textarea
            value={editDesc}
            onChange={e => setEditDesc(e.target.value)}
            placeholder="Description..."
            rows={2}
            className="w-full px-3 py-1.5 text-sm rounded-xl bg-[var(--cyber-bg)]
              border border-[var(--cyber-border)] text-white
              focus:outline-none focus:border-[var(--cyber-cyan)] resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={(e) => { e.stopPropagation(); setEditing(false) }}
              className="px-4 py-1 rounded-full text-xs text-[var(--cyber-text-dim)]
                bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]">
              Cancel
            </button>
            <button onClick={saveEdit}
              className="px-4 py-1 rounded-full text-xs font-semibold
                bg-gradient-to-r from-cyan-600 to-cyan-700 text-white">
              Save
            </button>
          </div>
        </div>
      ) : (
        /* Display mode */
        <>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg flex-shrink-0" style={{ color: typeInfo.color }}>
                {POI_ICONS[poi.poi_type] || POI_ICONS.marker}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-semibold truncate">
                    {poi.label || 'Unnamed POI'}
                  </span>
                  <span
                    className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border"
                    style={{ color: typeInfo.color, borderColor: typeInfo.color + '40' }}
                  >
                    {typeInfo.label}
                  </span>
                  {levelName && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-semibold
                      text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]">
                      {levelName}
                    </span>
                  )}
                </div>
                {poi.description && (
                  <p className="text-[var(--cyber-text-dim)] text-xs mt-0.5 line-clamp-2">
                    {poi.description}
                  </p>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-1 flex-shrink-0 ml-2">
              <button onClick={startEdit}
                className="text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] text-xs px-1.5 py-0.5">
                Edit
              </button>
              {confirmDelete ? (
                <button onClick={(e) => { e.stopPropagation(); onDelete(poi.id) }}
                  className="text-red-400 text-xs px-1.5 py-0.5 font-semibold">
                  Confirm
                </button>
              ) : (
                <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000) }}
                  className="text-[var(--cyber-text-dim)] hover:text-red-400 text-xs px-1.5 py-0.5">
                  Del
                </button>
              )}
            </div>
          </div>

          {/* Footer: thumbnail + coords + photo action */}
          <div className="flex items-center gap-2 mt-1.5">
            {photoUrl && (
              <div className="relative flex-shrink-0 group/thumb">
                <img src={photoUrl} alt=""
                  className="w-12 h-12 object-cover rounded-lg border border-[var(--cyber-border)]" />
                <button
                  onClick={(e) => { e.stopPropagation(); onDetachPhoto() }}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full
                    bg-red-900/80 text-red-300 text-[8px] leading-none
                    flex items-center justify-center
                    opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                  title="Remove photo"
                >&times;</button>
              </div>
            )}
            <div className="flex-1 min-w-0 flex items-center justify-between">
              <span className="text-[#555570] text-[10px] font-mono">
                x={poi.slam_x?.toFixed(1)} y={poi.slam_y?.toFixed(1)}
                {poi.slam_z != null && ` z=${poi.slam_z.toFixed(1)}`}
              </span>
              {!photoUrl && (
                <button
                  onClick={(e) => { e.stopPropagation(); onPickPhoto() }}
                  className="text-[var(--cyber-text-dim)] text-[10px] hover:text-[var(--cyber-cyan)]">
                  + Photo
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function AddPoiDialog({ coords, onSubmit, onCancel }) {
  const [label, setLabel] = useState('')
  const [poiType, setPoiType] = useState('marker')
  const [description, setDescription] = useState('')

  return (
    <div className="fixed inset-0 z-[2000] bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-[var(--cyber-surface)] border border-[var(--cyber-border)]
        rounded-2xl w-full max-w-md p-4 space-y-3">
        <h3 className="text-white font-semibold text-sm">Add Point of Interest</h3>
        <div className="text-[#555570] text-[10px] font-mono">
          x={coords.x.toFixed(2)} y={coords.y.toFixed(2)} z={coords.z.toFixed(2)}
        </div>

        {/* POI type grid */}
        <div className="grid grid-cols-5 gap-1.5">
          {POI_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => setPoiType(t.value)}
              className={`py-2 rounded-lg text-center transition-all
                ${poiType === t.value
                  ? 'border-2 border-[var(--cyber-cyan)] bg-cyan-900/20'
                  : 'border border-[var(--cyber-border)] bg-[var(--cyber-surface-2)]'
                }`}
            >
              <div className="text-base" style={{ color: t.color }}>
                {POI_ICONS[t.value]}
              </div>
              <div className="text-[var(--cyber-text-dim)] text-[9px] mt-0.5 leading-tight">
                {t.label}
              </div>
            </button>
          ))}
        </div>

        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="Label..."
          className="w-full px-4 py-2 text-sm rounded-xl bg-[var(--cyber-bg)]
            border border-[var(--cyber-border)] text-white
            focus:outline-none focus:border-[var(--cyber-cyan)]"
        />

        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Description (optional)..."
          rows={2}
          className="w-full px-4 py-2 text-sm rounded-xl bg-[var(--cyber-bg)]
            border border-[var(--cyber-border)] text-white
            focus:outline-none focus:border-[var(--cyber-cyan)] resize-none"
        />

        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onCancel}
            className="px-5 py-2 rounded-full text-sm
              text-[var(--cyber-text-dim)] bg-[var(--cyber-surface-2)]
              border border-[var(--cyber-border)]
              active:scale-[0.97] transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit({ ...coords, label, poi_type: poiType, description })}
            className="px-5 py-2 rounded-full text-sm font-semibold
              bg-gradient-to-r from-cyan-600 to-cyan-700 text-white
              shadow-[0_0_12px_rgba(0,229,255,0.2)]
              active:scale-[0.97] transition-all"
          >
            Save POI
          </button>
        </div>
      </div>
    </div>
  )
}

function PhotoPickerModal({ caveId, onSelect, onCancel }) {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch(`/caves/${caveId}/`)
      .then(data => {
        setPhotos(data.photos || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [caveId])

  return (
    <div className="fixed inset-0 z-[2000] bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-[var(--cyber-surface)] border border-[var(--cyber-border)]
        rounded-2xl w-full max-w-md p-4 max-h-[80vh] flex flex-col">
        <h3 className="text-white font-semibold text-sm mb-3">Select Photo from Gallery</h3>

        {loading ? (
          <div className="text-[var(--cyber-text-dim)] text-sm text-center py-8">Loading photos...</div>
        ) : photos.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-[var(--cyber-text-dim)] text-sm">No photos in cave gallery yet.</p>
            <p className="text-[#555570] text-xs mt-1">Upload photos in the Photos section below.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 overflow-y-auto flex-1 min-h-0">
            {photos.map(photo => (
              <button
                key={photo.id}
                onClick={() => onSelect(photo.id)}
                className="aspect-square rounded-lg overflow-hidden border-2 border-transparent
                  hover:border-[var(--cyber-cyan)] transition-all active:scale-95"
              >
                <img src={photo.image} alt={photo.caption || ''}
                  className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}

        <button
          onClick={onCancel}
          className="mt-3 w-full py-2 rounded-full text-sm
            text-[var(--cyber-text-dim)] bg-[var(--cyber-surface-2)]
            border border-[var(--cyber-border)]
            active:scale-[0.97] transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
