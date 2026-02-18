import { useState, useCallback } from 'react'
import { apiFetch } from '../hooks/useApi'
import RoutePreview from './RoutePreview'

const SPEED_MIN = 0.5
const SPEED_MAX = 3.0
const SPEED_STEP = 0.1

export default function RouteBuilder({
  caveId,
  mapData,
  mapMode = 'heatmap', // current map layer the user is viewing
  pois = [],
  selectedLevel = 0,
  onRouteComputed,    // callback(routeData) — passes route overlay to canvas
  onRouteClear,       // callback() — clear route overlay
  onEnterPlaceMode,   // callback() — enter crosshair mode for waypoint placement
  onExitPlaceMode,    // callback() — exit crosshair mode
  placedPoint,        // {x, y} — latest point placed on map (from crosshair)
  onPlacedPointConsumed, // callback() — acknowledge point consumed
}) {
  const [mode, setMode] = useState('idle')  // idle | building | computing | computed
  const [waypoints, setWaypoints] = useState([])
  const [speedKmh, setSpeedKmh] = useState(1.0)
  const [routeData, setRouteData] = useState(null)
  const [error, setError] = useState(null)
  const [placing, setPlacing] = useState(false)
  const [showPoiPicker, setShowPoiPicker] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [savedRouteId, setSavedRouteId] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [computedMapMode, setComputedMapMode] = useState(null)

  // Handle placed point from map tap
  if (placedPoint && placing) {
    const level = mapData?.levels?.[selectedLevel]
    const newWp = {
      slam_x: placedPoint.x,
      slam_y: placedPoint.y,
      level: level?.index ?? selectedLevel,
      label: `Point ${waypoints.length + 1}`,
    }
    setWaypoints(prev => [...prev, newWp])
    setPlacing(false)
    onExitPlaceMode?.()
    onPlacedPointConsumed?.()
  }

  const startBuilding = useCallback(() => {
    setMode('building')
    setWaypoints([])
    setRouteData(null)
    setError(null)
    setSaved(false)
    setSavedRouteId(null)
    onRouteClear?.()
  }, [onRouteClear])

  const addFromMap = useCallback(() => {
    setPlacing(true)
    setShowPoiPicker(false)
    onEnterPlaceMode?.()
  }, [onEnterPlaceMode])

  const addFromPoi = useCallback((poi) => {
    const newWp = {
      slam_x: poi.slam_x,
      slam_y: poi.slam_y,
      level: poi.slam_z != null ? _getPoiLevel(poi, mapData) : selectedLevel,
      label: poi.label || poi.poi_type || 'POI',
      poi_id: poi.id,
    }
    setWaypoints(prev => [...prev, newWp])
    setShowPoiPicker(false)
  }, [mapData, selectedLevel])

  const removeWaypoint = useCallback((index) => {
    setWaypoints(prev => prev.filter((_, i) => i !== index))
  }, [])

  const moveWaypoint = useCallback((index, direction) => {
    setWaypoints(prev => {
      const arr = [...prev]
      const newIdx = index + direction
      if (newIdx < 0 || newIdx >= arr.length) return arr
      ;[arr[index], arr[newIdx]] = [arr[newIdx], arr[index]]
      return arr
    })
  }, [])

  const computeRoute = useCallback(async () => {
    if (waypoints.length < 2) return
    setMode('computing')
    setError(null)

    try {
      const result = await apiFetch(`/caves/${caveId}/routes/compute/`, {
        method: 'POST',
        body: JSON.stringify({
          waypoints,
          speed_kmh: speedKmh,
        }),
      })
      setRouteData(result)
      setComputedMapMode(mapMode)
      setMode('computed')
      onRouteComputed?.(result)
    } catch (err) {
      setError(err.message)
      setMode('building')
    }
  }, [caveId, waypoints, speedKmh, onRouteComputed])

  const saveRoute = useCallback(async () => {
    if (!routeData || !saveName.trim()) return
    setSaving(true)
    try {
      const result = await apiFetch(`/caves/${caveId}/routes/`, {
        method: 'POST',
        body: JSON.stringify({
          name: saveName.trim(),
          waypoints: routeData.waypoints,
          computed_route: routeData.computed_route,
          speed_kmh: routeData.speed_kmh,
        }),
      })
      setSaved(true)
      setSavedRouteId(result.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }, [caveId, routeData, saveName])

  const exportPdf = useCallback(async () => {
    if (!savedRouteId) return
    setExporting(true)
    setError(null)
    try {
      const modeParam = computedMapMode ? `?map_mode=${computedMapMode}` : ''
      const res = await fetch(`/api/caves/${caveId}/routes/${savedRouteId}/export-pdf/${modeParam}`)
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`${res.status}: ${body}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${saveName.trim() || 'route'}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting(false)
    }
  }, [caveId, savedRouteId, saveName, computedMapMode])

  const clearRoute = useCallback(() => {
    setMode('idle')
    setWaypoints([])
    setRouteData(null)
    setError(null)
    setSaveName('')
    setSaved(false)
    setSavedRouteId(null)
    setComputedMapMode(null)
    if (placing) {
      setPlacing(false)
      onExitPlaceMode?.()
    }
    onRouteClear?.()
  }, [placing, onExitPlaceMode, onRouteClear])

  // --- IDLE mode ---
  if (mode === 'idle') {
    return (
      <div className="px-3 py-2 border-b border-[var(--cyber-border)]">
        <button
          onClick={startBuilding}
          className="px-4 py-1.5 rounded-full text-xs font-semibold
            bg-[var(--cyber-surface-2)] text-[var(--cyber-cyan)]
            border border-[var(--cyber-cyan)]/30
            hover:bg-[var(--cyber-cyan)]/10 transition-all"
        >
          Plan a Route
        </button>
      </div>
    )
  }

  // --- BUILDING mode ---
  if (mode === 'building' || mode === 'computing') {
    return (
      <div className="border-b border-[var(--cyber-border)]">
        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-white text-sm font-semibold">Route Builder</span>
          <button
            onClick={clearRoute}
            className="text-[var(--cyber-text-dim)] hover:text-red-400 text-xs"
          >
            Cancel
          </button>
        </div>

        {/* Waypoint list */}
        <div className="px-3 pb-2 space-y-1">
          {waypoints.map((wp, i) => (
            <div key={i} className="flex items-center gap-2 bg-[var(--cyber-bg)]/50 rounded-lg px-2 py-1">
              <span className="w-5 h-5 rounded-full bg-[var(--cyber-cyan)] text-[var(--cyber-bg)]
                flex items-center justify-center text-xs font-bold flex-shrink-0">
                {i + 1}
              </span>
              <span className="text-white text-xs flex-1 truncate">{wp.label}</span>
              {mapData?.levels?.length > 1 && (
                <span className="text-[var(--cyber-text-dim)] text-[10px]">
                  L{(wp.level ?? 0) + 1}
                </span>
              )}
              <button onClick={() => moveWaypoint(i, -1)} disabled={i === 0}
                className="text-[var(--cyber-text-dim)] hover:text-white text-xs disabled:opacity-20">
                ▲
              </button>
              <button onClick={() => moveWaypoint(i, 1)} disabled={i === waypoints.length - 1}
                className="text-[var(--cyber-text-dim)] hover:text-white text-xs disabled:opacity-20">
                ▼
              </button>
              <button onClick={() => removeWaypoint(i)}
                className="text-[var(--cyber-text-dim)] hover:text-red-400 text-xs">
                ✕
              </button>
            </div>
          ))}

          {waypoints.length === 0 && (
            <p className="text-[var(--cyber-text-dim)] text-xs py-2">
              Add at least 2 waypoints to compute a route
            </p>
          )}
        </div>

        {/* Add waypoint buttons */}
        <div className="px-3 pb-2 flex gap-2">
          <button
            onClick={addFromMap}
            disabled={placing}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-all
              ${placing
                ? 'bg-red-900/50 text-red-300 border border-red-700/50 animate-pulse'
                : 'bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] hover:border-[var(--cyber-cyan)] hover:text-[var(--cyber-cyan)]'
              }`}
          >
            {placing ? 'Tap Map...' : '+ Tap Map'}
          </button>
          <button
            onClick={() => setShowPoiPicker(!showPoiPicker)}
            className="px-3 py-1 rounded-full text-xs font-semibold
              bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)]
              border border-[var(--cyber-border)]
              hover:border-[var(--cyber-cyan)] hover:text-[var(--cyber-cyan)] transition-all"
          >
            + From POI
          </button>
        </div>

        {/* POI picker dropdown */}
        {showPoiPicker && pois.length > 0 && (
          <div className="px-3 pb-2 max-h-32 overflow-y-auto space-y-1">
            {pois.map(poi => (
              <button
                key={poi.id}
                onClick={() => addFromPoi(poi)}
                className="w-full text-left px-2 py-1 rounded-lg text-xs
                  bg-[var(--cyber-bg)]/50 text-white
                  hover:bg-[var(--cyber-cyan)]/10 transition-all"
              >
                {poi.label || poi.poi_type} <span className="text-[var(--cyber-text-dim)]">({poi.poi_type})</span>
              </button>
            ))}
          </div>
        )}

        {/* Speed slider */}
        <div className="px-3 pb-2 flex items-center gap-2">
          <span className="text-[var(--cyber-text-dim)] text-xs">Speed:</span>
          <input
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={SPEED_STEP}
            value={speedKmh}
            onChange={e => setSpeedKmh(parseFloat(e.target.value))}
            className="flex-1 h-1 accent-[var(--cyber-cyan)]"
          />
          <span className="text-[var(--cyber-cyan)] text-xs font-mono w-16 text-right">
            {speedKmh.toFixed(1)} km/h
          </span>
        </div>

        {/* Compute button */}
        <div className="px-3 pb-3">
          <button
            onClick={computeRoute}
            disabled={waypoints.length < 2 || mode === 'computing'}
            className="w-full px-4 py-2 rounded-xl text-sm font-bold transition-all
              bg-[var(--cyber-cyan)] text-[var(--cyber-bg)]
              hover:bg-[var(--cyber-cyan)]/90
              disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {mode === 'computing' ? 'Computing...' : 'Compute Route'}
          </button>
        </div>

        {error && (
          <div className="px-3 pb-2">
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}
      </div>
    )
  }

  // --- COMPUTED mode ---
  if (mode === 'computed' && routeData) {
    const route = routeData.computed_route
    return (
      <div className="border-b border-[var(--cyber-border)]">
        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-white text-sm font-semibold">Route Computed</span>
          <button
            onClick={clearRoute}
            className="text-[var(--cyber-text-dim)] hover:text-red-400 text-xs"
          >
            Clear
          </button>
        </div>

        {/* Stats */}
        <div className="px-3 pb-2 flex gap-4 text-xs">
          <span className="text-[var(--cyber-cyan)] font-mono">
            {route.total_distance_m?.toFixed(1)}m
          </span>
          <span className="text-[var(--cyber-text-dim)]">
            ~{Math.ceil((route.total_time_s || 0) / 60)} min
          </span>
          <span className="text-[var(--cyber-text-dim)]">
            {route.levels_used?.length || 1} level{(route.levels_used?.length || 1) > 1 ? 's' : ''}
          </span>
        </div>

        {/* Instructions preview */}
        <RoutePreview
          instructions={route.instructions || []}
          totalDistance={route.total_distance_m}
          totalTime={route.total_time_s}
          onInstructionClick={(inst) => {
            // Highlight this instruction on the map
            onRouteComputed?.({ ...routeData, activeInstruction: inst.index })
          }}
        />

        {/* Save / Export */}
        <div className="px-3 pb-3 space-y-2">
          {!saved ? (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Route name..."
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg text-xs
                  bg-[var(--cyber-bg)] text-white border border-[var(--cyber-border)]
                  focus:border-[var(--cyber-cyan)] outline-none"
              />
              <button
                onClick={saveRoute}
                disabled={!saveName.trim() || saving}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold
                  bg-[var(--cyber-cyan)] text-[var(--cyber-bg)]
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {saving ? '...' : 'Save'}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-green-400 text-xs">Route saved!</p>
              <button
                onClick={exportPdf}
                disabled={exporting}
                className="w-full px-4 py-1.5 rounded-lg text-xs font-semibold
                  bg-[var(--cyber-surface-2)] text-[var(--cyber-magenta)]
                  border border-[var(--cyber-magenta)]/30
                  hover:bg-[var(--cyber-magenta)]/10 transition-all
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {exporting ? 'Generating PDF...' : 'Download PDF'}
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="px-3 pb-2">
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}
      </div>
    )
  }

  return null
}


function _getPoiLevel(poi, mapData) {
  if (!mapData?.levels) return 0
  let bestLevel = 0
  let bestDist = Infinity
  for (let i = 0; i < mapData.levels.length; i++) {
    const dist = Math.abs(poi.slam_z - mapData.levels[i].z_center)
    if (dist < bestDist) {
      bestDist = dist
      bestLevel = mapData.levels[i].index
    }
  }
  return bestLevel
}
