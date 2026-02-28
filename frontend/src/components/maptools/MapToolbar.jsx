import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import MeasureTool from './MeasureTool'
import CoordReadout from './CoordReadout'

const WaypointTool = lazy(() => import('./WaypointTool'))
const PolygonTool = lazy(() => import('./PolygonTool'))
const ElevationProfile = lazy(() => import('./ElevationProfile'))

const TOOL_BUTTONS = [
  { id: 'measure', label: 'Measure', icon: '📏', tier: 1 },
  { id: 'waypoint', label: 'Waypoint', icon: '📍', tier: 2 },
  { id: 'polygon', label: 'Polygon', icon: '⬠', tier: 2 },
  { id: 'elevation', label: 'Elevation', icon: '⛰', tier: 2 },
]

/**
 * Map toolbar — renders tool buttons and manages active tool state.
 * Positioned at bottom-right of map container.
 * Only one tool active at a time; Escape deactivates.
 */
export default function MapToolbar({
  map,
  enableTier2 = false,
  caveId = null,
  waypoints = [],
  onWaypointsChange = null,
  polygons = [],
  onPolygonsChange = null,
}) {
  const [activeTool, setActiveTool] = useState(null)

  // Escape key deactivates tool
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') setActiveTool(null)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // Set crosshair cursor when tool is active
  useEffect(() => {
    if (!map) return
    const container = map.getContainer()
    if (activeTool) {
      container.style.cursor = 'crosshair'
    } else {
      container.style.cursor = ''
    }
    return () => { container.style.cursor = '' }
  }, [map, activeTool])

  const toggleTool = useCallback((toolId) => {
    setActiveTool(prev => prev === toolId ? null : toolId)
  }, [])

  const visibleButtons = TOOL_BUTTONS.filter(b =>
    b.tier === 1 || (b.tier === 2 && enableTier2)
  )

  return (
    <>
      {/* Toolbar buttons — bottom-right */}
      <div className="absolute bottom-3 right-3 z-[1100] flex flex-col gap-1.5">
        {visibleButtons.map(btn => (
          <button
            key={btn.id}
            onClick={() => toggleTool(btn.id)}
            title={btn.label}
            className={`w-9 h-9 rounded-lg flex items-center justify-center text-base
              transition-all shadow-lg backdrop-blur-sm border
              ${activeTool === btn.id
                ? 'bg-cyan-900/80 text-[var(--cyber-cyan)] border-cyan-700/50 shadow-[0_0_8px_rgba(0,229,255,0.3)]'
                : 'bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border-[var(--cyber-border)] hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50'
              }`}
          >
            {btn.icon}
          </button>
        ))}
      </div>

      {/* Coord readout — always visible */}
      <CoordReadout map={map} />

      {/* Active tool components */}
      <MeasureTool map={map} active={activeTool === 'measure'} />

      <Suspense fallback={null}>
        {activeTool === 'waypoint' && (
          <WaypointTool
            map={map}
            active={true}
            caveId={caveId}
            waypoints={waypoints}
            onWaypointAdded={(wp) => onWaypointsChange?.([...waypoints, wp])}
            onWaypointDeleted={(id) => onWaypointsChange?.(waypoints.filter(w => w.id !== id))}
          />
        )}

        {activeTool === 'polygon' && (
          <PolygonTool
            map={map}
            active={true}
            caveId={caveId}
            polygons={polygons}
            onPolygonAdded={(p) => onPolygonsChange?.([...polygons, p])}
            onPolygonDeleted={(id) => onPolygonsChange?.(polygons.filter(p => p.id !== id))}
          />
        )}

        {activeTool === 'elevation' && (
          <ElevationProfile map={map} active={true} />
        )}
      </Suspense>
    </>
  )
}
