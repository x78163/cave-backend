import useEditorStore, { CLOUD_COLORS } from '../../stores/editorStore'

function formatPointCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export default function EditorCloudPanel() {
  const clouds = useEditorStore(s => s.clouds)
  const selectedCloudId = useEditorStore(s => s.selectedCloudId)
  const setSelectedCloud = useEditorStore(s => s.setSelectedCloud)
  const toggleVisibility = useEditorStore(s => s.toggleCloudVisibility)
  const toggleLock = useEditorStore(s => s.toggleCloudLock)
  const setCloudColor = useEditorStore(s => s.setCloudColor)
  const deleteCloud = useEditorStore(s => s.deleteCloud)
  const setImportModalOpen = useEditorStore(s => s.setImportModalOpen)
  const loading = useEditorStore(s => s.loading)

  const cycleColor = (cloudId, currentColor) => {
    const idx = CLOUD_COLORS.indexOf(currentColor)
    const next = CLOUD_COLORS[(idx + 1) % CLOUD_COLORS.length]
    setCloudColor(cloudId, next)
  }

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{
        width: 250,
        background: 'var(--cyber-surface)',
        borderLeft: '1px solid var(--cyber-border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: '1px solid var(--cyber-border)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--cyber-text-dim)' }}>
          Clouds
        </span>
        <button
          onClick={() => setImportModalOpen(true)}
          title="Import point cloud"
          className="px-2 py-1 text-xs rounded-md font-medium transition-all"
          style={{
            background: 'rgba(0,229,255,0.1)',
            border: '1px solid rgba(0,229,255,0.3)',
            color: 'var(--cyber-cyan)',
          }}
        >
          + Import
        </button>
      </div>

      {/* Cloud list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && (
          <p className="text-xs text-center py-4" style={{ color: 'var(--cyber-text-dim)' }}>
            Loading point cloud...
          </p>
        )}

        {!loading && clouds.length === 0 && (
          <p className="text-xs text-center py-4" style={{ color: 'var(--cyber-text-dim)' }}>
            No clouds loaded
          </p>
        )}

        {clouds.map(cloud => (
          <div
            key={cloud.id}
            onClick={() => setSelectedCloud(cloud.id)}
            className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-all"
            style={{
              background: selectedCloudId === cloud.id
                ? 'rgba(0,229,255,0.08)' : 'transparent',
              border: selectedCloudId === cloud.id
                ? '1px solid rgba(0,229,255,0.2)' : '1px solid transparent',
              opacity: cloud.locked ? 0.7 : 1,
            }}
          >
            {/* Visibility toggle */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleVisibility(cloud.id) }}
              title={cloud.visible ? 'Hide' : 'Show'}
              className="w-5 h-5 flex items-center justify-center rounded flex-shrink-0"
              style={{ color: cloud.visible ? 'var(--cyber-cyan)' : 'var(--cyber-text-dim)' }}
            >
              {cloud.visible ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" />
                </svg>
              )}
            </button>

            {/* Cloud info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--cyber-text)' }}>
                {cloud.name}
              </p>
              <p className="text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>
                {formatPointCount(cloud.pointCount)} points
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {/* Color swatch */}
              <button
                onClick={(e) => { e.stopPropagation(); cycleColor(cloud.id, cloud.color) }}
                title="Cycle color"
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: cloud.color || '#00e5ff',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
              />

              {/* Lock toggle */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleLock(cloud.id) }}
                title={cloud.locked ? 'Unlock' : 'Lock'}
                className="w-5 h-5 flex items-center justify-center rounded"
                style={{ color: cloud.locked ? '#fbbf24' : 'var(--cyber-text-dim)' }}
              >
                {cloud.locked ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 019.9-1" />
                  </svg>
                )}
              </button>

              {/* Delete */}
              <button
                onClick={(e) => { e.stopPropagation(); deleteCloud(cloud.id) }}
                title="Remove cloud"
                className="w-5 h-5 flex items-center justify-center rounded hover:text-red-400 transition-colors"
                style={{ color: 'var(--cyber-text-dim)' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
