/**
 * Scrollable turn-by-turn itinerary preview for a computed route.
 */

const ICON_MAP = {
  start: '▶',
  end: '◼',
  junction: '↗',
  transition: '⇅',
  poi: '📍',
}

const TYPE_COLORS = {
  start: 'text-green-400',
  end: 'text-red-400',
  junction: 'text-[var(--cyber-cyan)]',
  transition: 'text-purple-400',
  poi: 'text-amber-400',
}

export default function RoutePreview({
  instructions = [],
  totalDistance = 0,
  totalTime = 0,
  onInstructionClick,
}) {
  if (!instructions.length) return null

  const formatTime = (seconds) => {
    const min = Math.floor(seconds / 60)
    const sec = Math.floor(seconds % 60)
    if (min === 0) return `${sec}s`
    return `${min}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <div className="px-3 pb-2">
      {/* Scrollable instruction list */}
      <div className="max-h-64 overflow-y-auto space-y-1 pr-1
        scrollbar-thin scrollbar-thumb-[var(--cyber-border)] scrollbar-track-transparent">
        {instructions.map((inst, i) => {
          const icon = ICON_MAP[inst.type] || '•'
          const colorClass = TYPE_COLORS[inst.type] || 'text-[var(--cyber-text-dim)]'

          return (
            <button
              key={i}
              onClick={() => onInstructionClick?.(inst)}
              className="w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-lg
                hover:bg-[var(--cyber-cyan)]/5 transition-all group"
            >
              {/* Icon */}
              <span className={`${colorClass} text-sm flex-shrink-0 w-5 text-center mt-0.5`}>
                {icon}
              </span>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs leading-tight">
                  {inst.text}
                </p>
                <div className="flex gap-3 mt-0.5">
                  {inst.cumulative_distance_m > 0 && (
                    <span className="text-[var(--cyber-text-dim)] text-[10px]">
                      {inst.cumulative_distance_m.toFixed(1)}m
                    </span>
                  )}
                  {inst.cumulative_time_s > 0 && (
                    <span className="text-[var(--cyber-text-dim)] text-[10px]">
                      {formatTime(inst.cumulative_time_s)}
                    </span>
                  )}
                  {inst.compass_name && (
                    <span className="text-[var(--cyber-cyan)]/60 text-[10px]">
                      {inst.compass_name} {Math.round(inst.compass_heading)}°
                    </span>
                  )}
                </div>
              </div>

              {/* Level badge for transitions */}
              {inst.type === 'transition' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/50
                  text-purple-300 border border-purple-700/30 flex-shrink-0">
                  L{(inst.to_level ?? inst.level ?? 0) + 1}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
