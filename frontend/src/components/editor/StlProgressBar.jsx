/**
 * Thin progress bar shown across the top of the editor during STL generation.
 * Shows stage name, percentage, and cancel button.
 */
export default function StlProgressBar({ progress, onCancel }) {
  if (!progress || progress.status !== 'generating') return null

  const percent = progress.percent ?? 0
  const stage = progress.stage || 'Starting...'
  const stale = progress.stale

  return (
    <div
      className="flex-shrink-0 relative"
      style={{
        height: 24,
        background: 'var(--cyber-surface)',
        borderBottom: '1px solid var(--cyber-border)',
      }}
    >
      {/* Progress fill */}
      <div
        className="absolute inset-y-0 left-0 transition-all duration-500"
        style={{
          width: `${Math.max(0, Math.min(100, percent))}%`,
          background: stale
            ? 'rgba(255,107,107,0.15)'
            : 'rgba(0,229,255,0.1)',
        }}
      />

      {/* Content */}
      <div className="relative h-full flex items-center justify-between px-3">
        <div className="flex items-center gap-2">
          {/* Spinning indicator */}
          <svg
            viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2}
            className="w-3 h-3 animate-spin"
            style={{ color: stale ? '#ff6b6b' : 'var(--cyber-cyan)' }}
          >
            <circle cx="8" cy="8" r="6" strokeDasharray="18.85 18.85" />
          </svg>

          <span className="text-[10px] font-medium" style={{ color: 'var(--cyber-text-dim)' }}>
            STL: {stage}
            {percent > 0 && ` (${percent}%)`}
          </span>

          {stale && (
            <span className="text-[10px]" style={{ color: '#ff6b6b' }}>
              — Process may be stalled
            </span>
          )}
        </div>

        <button
          onClick={onCancel}
          className="text-[10px] px-2 py-0.5 rounded font-medium hover:bg-[rgba(255,107,107,0.15)] transition-colors"
          style={{ color: '#ff6b6b' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
