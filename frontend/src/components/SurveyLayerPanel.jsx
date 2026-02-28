import { useState } from 'react'

/**
 * Unified survey layer selector for the surface map.
 * Lists both computed surveys (SurveyOverlay) and scanned images (HandDrawnMapOverlay)
 * with independent toggle controls for each layer.
 */
export default function SurveyLayerPanel({
  surveys = [],
  surveyMaps = [],
  activeSurveyOverlays = {},
  visibleImageIds = new Set(),
  onToggleSurveyOverlay,
  onToggleImageOverlay,
  onAddSurveyMap,
  onEditImage,
}) {
  const [open, setOpen] = useState(false)

  // Only show surveys that have render_data (i.e. have been computed)
  const computedSurveys = surveys.filter(s => s.render_data)
  const totalCount = computedSurveys.length + surveyMaps.length
  const activeCount = Object.keys(activeSurveyOverlays).length + visibleImageIds.size
  const hasAny = totalCount > 0 || onAddSurveyMap

  if (!hasAny) return null

  return (
    <div className="absolute bottom-12 left-3 z-[1100]">
      {/* Expanded panel */}
      {open && totalCount > 0 && (
        <div className="mb-1.5 w-52 rounded-lg bg-[#0a0a12]/95 border border-[var(--cyber-border)]
          backdrop-blur-sm shadow-xl overflow-hidden">
          <div className="max-h-[200px] overflow-y-auto">
            {/* Computed surveys */}
            {computedSurveys.length > 0 && (
              <div>
                {surveyMaps.length > 0 && (
                  <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-wider text-[var(--cyber-text-dim)] opacity-60">
                    Surveys
                  </div>
                )}
                {computedSurveys.map(s => {
                  const isActive = !!activeSurveyOverlays[s.id]
                  return (
                    <button
                      key={s.id}
                      onClick={() => onToggleSurveyOverlay?.(s.id, s.render_data)}
                      className="w-full text-left px-3 py-1.5 flex items-center gap-2
                        hover:bg-[var(--cyber-surface-2)] transition-colors"
                    >
                      <span className={`w-2.5 h-2.5 rounded-full border-2 flex-shrink-0 transition-colors ${
                        isActive
                          ? 'bg-[var(--cyber-cyan)] border-[var(--cyber-cyan)]'
                          : 'border-[var(--cyber-text-dim)] bg-transparent'
                      }`} />
                      <span className={`text-xs truncate flex-1 ${
                        isActive ? 'text-[var(--cyber-cyan)]' : 'text-[var(--cyber-text-dim)]'
                      }`}>
                        {s.name}
                      </span>
                      {s.source === 'slam' && (
                        <span className="text-[8px] px-1 py-0.5 rounded flex-shrink-0"
                          style={{ background: 'rgba(255,0,200,0.15)', color: 'var(--cyber-magenta)', border: '1px solid rgba(255,0,200,0.3)' }}>
                          SLAM
                        </span>
                      )}
                      <span className="text-[9px] text-[var(--cyber-text-dim)] opacity-60 flex-shrink-0">
                        {s.station_count}st
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Scanned survey images */}
            {surveyMaps.length > 0 && (
              <div>
                {computedSurveys.length > 0 && (
                  <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-wider text-[var(--cyber-text-dim)] opacity-60">
                    Scanned Maps
                  </div>
                )}
                {surveyMaps.map(sm => {
                  const isActive = visibleImageIds.has(sm.id)
                  return (
                    <div
                      key={sm.id}
                      className="flex items-center gap-2 px-3 py-1.5
                        hover:bg-[var(--cyber-surface-2)] transition-colors"
                    >
                      <button
                        onClick={() => onToggleImageOverlay?.(sm.id)}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                      >
                        <span className={`w-2.5 h-2.5 rounded-full border-2 flex-shrink-0 transition-colors ${
                          isActive
                            ? 'bg-amber-400 border-amber-400'
                            : 'border-[var(--cyber-text-dim)] bg-transparent'
                        }`} />
                        <span className={`text-xs truncate flex-1 ${
                          isActive ? 'text-amber-400' : 'text-[var(--cyber-text-dim)]'
                        }`}>
                          {sm.name || 'Survey Map'}
                        </span>
                      </button>
                      <span className="text-[8px] px-1 py-0.5 rounded flex-shrink-0
                        bg-amber-900/20 text-amber-500/60 border border-amber-700/20">
                        IMG
                      </span>
                      {onEditImage && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onEditImage(sm.id) }}
                          className="text-[9px] text-[var(--cyber-text-dim)] hover:text-amber-400 transition-colors flex-shrink-0"
                          title="Edit calibration"
                        >
                          ✎
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Add button */}
          {onAddSurveyMap && (
            <button
              onClick={onAddSurveyMap}
              className="w-full px-3 py-1.5 text-xs text-[var(--cyber-text-dim)]
                hover:text-amber-400 hover:bg-[var(--cyber-surface-2)]
                border-t border-[var(--cyber-border)] transition-colors text-left"
            >
              + Add Scanned Map
            </button>
          )}
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => totalCount > 0 ? setOpen(v => !v) : onAddSurveyMap?.()}
        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all shadow-lg backdrop-blur-sm
          ${activeCount > 0
            ? 'bg-amber-900/80 text-amber-400 border border-amber-700/50'
            : 'bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] hover:text-amber-400 hover:border-amber-700/50'
          }`}
      >
        {totalCount > 0
          ? `Surveys (${totalCount})`
          : 'Add Survey Map'}
      </button>
    </div>
  )
}
