import { useState } from 'react'
import useEditorStore, { CLOUD_COLORS } from '../../stores/editorStore'

const PAINT_PRESETS = [
  '#ff6b6b', '#fb923c', '#fbbf24', '#4ade80',
  '#00e5ff', '#38bdf8', '#c084fc', '#f472b6',
]

export default function SelectionPanel() {
  const selectedIndices = useEditorStore(s => s.selectedIndices)
  const clouds = useEditorStore(s => s.clouds)
  const paintColor = useEditorStore(s => s.paintColor)
  const setPaintColor = useEditorStore(s => s.setPaintColor)
  const paintSelectedPoints = useEditorStore(s => s.paintSelectedPoints)
  const deleteSelectedPoints = useEditorStore(s => s.deleteSelectedPoints)
  const clearSelection = useEditorStore(s => s.clearSelection)

  const [customColor, setCustomColor] = useState(paintColor)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  // Count total selected
  let totalSelected = 0
  let cloudName = ''
  for (const [cloudId, indices] of Object.entries(selectedIndices)) {
    if (indices && indices.length > 0) {
      totalSelected += indices.length
      const cloud = clouds.find(c => c.id === cloudId)
      if (cloud) cloudName = cloud.name
    }
  }

  if (totalSelected === 0) return null

  function handlePaint() {
    paintSelectedPoints(paintColor)
  }

  function handleDelete() {
    if (!showConfirmDelete) {
      setShowConfirmDelete(true)
      return
    }
    deleteSelectedPoints()
    setShowConfirmDelete(false)
  }

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-xl"
      style={{
        background: 'rgba(10,10,18,0.92)',
        border: '1px solid var(--cyber-border)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
      }}
    >
      {/* Selection info */}
      <span className="text-xs font-mono" style={{ color: 'var(--cyber-text-dim)' }}>
        <span style={{ color: '#fbbf24' }}>{totalSelected.toLocaleString()}</span>
        {' pts'}
        {cloudName && <span style={{ color: 'var(--cyber-text-dim)' }}> in {cloudName}</span>}
      </span>

      <div className="w-px h-5" style={{ background: 'var(--cyber-border)' }} />

      {/* Paint section */}
      <div className="flex items-center gap-1.5">
        {PAINT_PRESETS.map(color => (
          <button
            key={color}
            onClick={() => setPaintColor(color)}
            className="w-5 h-5 rounded-full transition-all"
            style={{
              background: color,
              outline: paintColor === color ? '2px solid white' : '2px solid transparent',
              outlineOffset: 1,
            }}
            title={color}
          />
        ))}
        <input
          type="color"
          value={customColor}
          onChange={(e) => {
            setCustomColor(e.target.value)
            setPaintColor(e.target.value)
          }}
          className="w-5 h-5 rounded cursor-pointer"
          style={{ border: 'none', padding: 0, background: 'transparent' }}
          title="Custom color"
        />
      </div>

      <button
        onClick={handlePaint}
        className="px-3 py-1 rounded-md text-xs font-semibold transition-all hover:brightness-110"
        style={{
          background: paintColor,
          color: '#0a0a12',
        }}
      >
        Paint
      </button>

      <div className="w-px h-5" style={{ background: 'var(--cyber-border)' }} />

      {/* Delete */}
      <button
        onClick={handleDelete}
        className="px-3 py-1 rounded-md text-xs font-semibold transition-all"
        style={{
          background: showConfirmDelete ? '#ff4444' : 'rgba(255,107,107,0.15)',
          color: showConfirmDelete ? 'white' : '#ff6b6b',
          border: `1px solid ${showConfirmDelete ? '#ff4444' : 'rgba(255,107,107,0.3)'}`,
        }}
        onMouseLeave={() => setShowConfirmDelete(false)}
      >
        {showConfirmDelete ? 'Confirm Delete' : 'Delete'}
      </button>

      {/* Clear selection */}
      <button
        onClick={clearSelection}
        className="px-2 py-1 rounded-md text-xs transition-all"
        style={{
          color: 'var(--cyber-text-dim)',
          background: 'rgba(255,255,255,0.05)',
        }}
        title="Clear Selection (Esc)"
      >
        Clear
      </button>
    </div>
  )
}
