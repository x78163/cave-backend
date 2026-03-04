import { useEffect } from 'react'
import useEditorStore from '../../stores/editorStore'

const TOOLS = [
  { id: 'select', label: 'Select', key: 'V', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    </svg>
  )},
  { id: 'pan', label: 'Pan', key: 'H', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <path d="M12 2v20M2 12h20M7 7l-5 5 5 5M17 7l5 5-5 5M7 7l5-5 5 5M7 17l5 5 5-5" />
    </svg>
  )},
  { id: 'zoom', label: 'Zoom', key: 'Z', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35M8 11h6M11 8v6" />
    </svg>
  )},
]

const TRANSFORM_TOOLS = [
  { id: 'translate', label: 'Translate', key: 'T', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l3 3-3-3M19 9l3 3-3 3" />
      <path d="M2 12h20M12 2v20" />
    </svg>
  )},
  { id: 'rotate', label: 'Rotate', key: 'R', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  )},
  { id: 'scale', label: 'Scale', key: 'S', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
      <path d="M21 3L3 21M21 3h-6M21 3v6M3 21h6M3 21v-6" />
    </svg>
  )},
]

const BOX_SELECT = { id: 'boxSelect', label: 'Box Select', key: 'B', icon: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
    <rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="4 2" />
    <path d="M8 8h8v8H8z" opacity="0.3" fill="currentColor" stroke="none" />
  </svg>
)}

const PICK_TOOL = { id: 'pick', label: 'Pick Points', key: 'P', icon: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </svg>
)}

const POI_TOOL = { id: 'poi', label: 'Place POI', key: 'I', icon: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
    <circle cx="12" cy="9" r="2.5" />
  </svg>
)}

const FLY_MODE = { id: 'flyMode', label: 'Fly Mode (WASD)', key: 'G', icon: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
    <circle cx="12" cy="12" r="2" />
    <path d="M12 2v6M12 16v6M2 12h6M16 12h6" />
    <path d="M12 2l-1.5 2.5M12 2l1.5 2.5M12 22l-1.5-2.5M12 22l1.5-2.5M2 12l2.5-1.5M2 12l2.5 1.5M22 12l-2.5-1.5M22 12l-2.5 1.5" />
  </svg>
)}

const FIT_VIEW = { id: 'fitView', label: 'Fit to View', key: 'F', icon: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
)}

const ALIGN_TOGGLE = { id: 'align', label: 'Align Clouds', key: 'A', icon: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
    <rect x="2" y="6" width="8" height="8" rx="1" />
    <rect x="14" y="10" width="8" height="8" rx="1" />
    <path d="M10 10l4 4" />
  </svg>
)}

export default function EditorToolbar({ onFitView }) {
  const activeTool = useEditorStore(s => s.activeTool)
  const setActiveTool = useEditorStore(s => s.setActiveTool)
  const transformMode = useEditorStore(s => s.transformMode)
  const setTransformMode = useEditorStore(s => s.setTransformMode)
  const flyMode = useEditorStore(s => s.flyMode)
  const toggleFlyMode = useEditorStore(s => s.toggleFlyMode)
  const alignmentMode = useEditorStore(s => s.alignmentMode)
  const enterAlignmentMode = useEditorStore(s => s.enterAlignmentMode)
  const exitAlignmentMode = useEditorStore(s => s.exitAlignmentMode)
  const clearSelection = useEditorStore(s => s.clearSelection)
  const selectAllPoints = useEditorStore(s => s.selectAllPoints)
  const deleteSelectedPoints = useEditorStore(s => s.deleteSelectedPoints)

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const key = e.key.toUpperCase()

      // Delete selected points
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = useEditorStore.getState().selectedIndices
        const hasSelection = Object.values(sel).some(arr => arr.length > 0)
        if (hasSelection) {
          e.preventDefault()
          deleteSelectedPoints()
          return
        }
      }

      // Ctrl+A: select all points in active cloud
      if (key === 'A' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        selectAllPoints()
        return
      }

      // Escape: clear selection (before other Esc handlers)
      if (e.key === 'Escape') {
        const sel = useEditorStore.getState().selectedIndices
        const hasSelection = Object.values(sel).some(arr => arr.length > 0)
        if (hasSelection) {
          e.preventDefault()
          clearSelection()
          return
        }
      }

      // Fly mode toggle
      if (key === FLY_MODE.key) {
        e.preventDefault()
        toggleFlyMode()
        return
      }

      // Align mode toggle
      if (key === ALIGN_TOGGLE.key) {
        if (useEditorStore.getState().flyMode) return // A = strafe left in fly mode
        if (e.ctrlKey || e.metaKey) return // Ctrl+A handled above
        e.preventDefault()
        if (useEditorStore.getState().alignmentMode) exitAlignmentMode()
        else enterAlignmentMode()
        return
      }

      // Box Select tool
      if (key === BOX_SELECT.key) {
        if (useEditorStore.getState().flyMode) return
        e.preventDefault()
        setActiveTool('boxSelect')
        return
      }

      // Pick tool
      if (key === PICK_TOOL.key) {
        e.preventDefault()
        setActiveTool('pick')
        return
      }

      // POI tool
      if (key === POI_TOOL.key) {
        e.preventDefault()
        setActiveTool('poi')
        return
      }

      // Viewport tools
      const tool = TOOLS.find(t => t.key === key)
      if (tool) {
        e.preventDefault()
        setActiveTool(tool.id)
        return
      }

      // Transform tools (toggle) — skip S when fly mode is on (S = backward)
      const tTool = TRANSFORM_TOOLS.find(t => t.key === key)
      if (tTool) {
        if (key === 'S' && useEditorStore.getState().flyMode) return
        e.preventDefault()
        setTransformMode(tTool.id)
        return
      }

      if (key === FIT_VIEW.key) {
        e.preventDefault()
        onFitView?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setActiveTool, setTransformMode, toggleFlyMode, enterAlignmentMode, exitAlignmentMode, clearSelection, selectAllPoints, deleteSelectedPoints, onFitView])

  return (
    <div
      className="flex flex-col items-center gap-1 py-2 px-1"
      style={{
        width: 48,
        background: 'var(--cyber-surface)',
        borderRight: '1px solid var(--cyber-border)',
      }}
    >
      {/* Viewport tools */}
      {TOOLS.map(tool => (
        <button
          key={tool.id}
          onClick={() => setActiveTool(tool.id)}
          title={`${tool.label} (${tool.key})`}
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-all"
          style={{
            background: activeTool === tool.id ? 'rgba(0,229,255,0.15)' : 'transparent',
            color: activeTool === tool.id ? 'var(--cyber-cyan)' : 'var(--cyber-text-dim)',
            border: activeTool === tool.id ? '1px solid rgba(0,229,255,0.3)' : '1px solid transparent',
          }}
        >
          {tool.icon}
        </button>
      ))}

      <div className="w-6 border-t border-[var(--cyber-border)] my-1" />

      {/* Transform tools */}
      {TRANSFORM_TOOLS.map(tool => (
        <button
          key={tool.id}
          onClick={() => setTransformMode(tool.id)}
          title={`${tool.label} (${tool.key})`}
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-all"
          style={{
            background: transformMode === tool.id ? 'rgba(255,107,107,0.15)' : 'transparent',
            color: transformMode === tool.id ? '#ff6b6b' : 'var(--cyber-text-dim)',
            border: transformMode === tool.id ? '1px solid rgba(255,107,107,0.3)' : '1px solid transparent',
          }}
        >
          {tool.icon}
        </button>
      ))}

      <div className="w-6 border-t border-[var(--cyber-border)] my-1" />

      {/* Pick Points tool */}
      <button
        onClick={() => setActiveTool('pick')}
        title={`${PICK_TOOL.label} (${PICK_TOOL.key})`}
        className="w-9 h-9 flex items-center justify-center rounded-lg transition-all"
        style={{
          background: activeTool === 'pick' ? 'rgba(251,191,36,0.15)' : 'transparent',
          color: activeTool === 'pick' ? '#fbbf24' : 'var(--cyber-text-dim)',
          border: activeTool === 'pick' ? '1px solid rgba(251,191,36,0.3)' : '1px solid transparent',
        }}
      >
        {PICK_TOOL.icon}
      </button>

      {/* Box Select tool */}
      <button
        onClick={() => setActiveTool('boxSelect')}
        title={`${BOX_SELECT.label} (${BOX_SELECT.key})`}
        className="w-9 h-9 flex items-center justify-center rounded-lg transition-all"
        style={{
          background: activeTool === 'boxSelect' ? 'rgba(251,146,60,0.15)' : 'transparent',
          color: activeTool === 'boxSelect' ? '#fb923c' : 'var(--cyber-text-dim)',
          border: activeTool === 'boxSelect' ? '1px solid rgba(251,146,60,0.3)' : '1px solid transparent',
        }}
      >
        {BOX_SELECT.icon}
      </button>

      {/* POI tool */}
      <button
        onClick={() => setActiveTool('poi')}
        title={`${POI_TOOL.label} (${POI_TOOL.key})`}
        className="w-9 h-9 flex items-center justify-center rounded-lg transition-all"
        style={{
          background: activeTool === 'poi' ? 'rgba(244,114,182,0.15)' : 'transparent',
          color: activeTool === 'poi' ? '#f472b6' : 'var(--cyber-text-dim)',
          border: activeTool === 'poi' ? '1px solid rgba(244,114,182,0.3)' : '1px solid transparent',
        }}
      >
        {POI_TOOL.icon}
      </button>

      {/* Fly Mode toggle */}
      <button
        onClick={toggleFlyMode}
        title={`${FLY_MODE.label} (${FLY_MODE.key})`}
        className="w-9 h-9 flex items-center justify-center rounded-lg transition-all"
        style={{
          background: flyMode ? 'rgba(74,222,128,0.15)' : 'transparent',
          color: flyMode ? '#4ade80' : 'var(--cyber-text-dim)',
          border: flyMode ? '1px solid rgba(74,222,128,0.3)' : '1px solid transparent',
        }}
      >
        {FLY_MODE.icon}
      </button>

      {/* Fit View */}
      <button
        onClick={() => onFitView?.()}
        title={`${FIT_VIEW.label} (${FIT_VIEW.key})`}
        className="w-9 h-9 flex items-center justify-center rounded-lg transition-all"
        style={{
          color: 'var(--cyber-text-dim)',
          background: 'transparent',
          border: '1px solid transparent',
        }}
      >
        {FIT_VIEW.icon}
      </button>

      <div className="w-6 border-t border-[var(--cyber-border)] my-1" />

      {/* Align toggle */}
      <button
        onClick={() => alignmentMode ? exitAlignmentMode() : enterAlignmentMode()}
        title={`${ALIGN_TOGGLE.label} (${ALIGN_TOGGLE.key})`}
        className="w-9 h-9 flex items-center justify-center rounded-lg transition-all"
        style={{
          background: alignmentMode ? 'rgba(192,132,252,0.15)' : 'transparent',
          color: alignmentMode ? '#c084fc' : 'var(--cyber-text-dim)',
          border: alignmentMode ? '1px solid rgba(192,132,252,0.3)' : '1px solid transparent',
        }}
      >
        {ALIGN_TOGGLE.icon}
      </button>
    </div>
  )
}
