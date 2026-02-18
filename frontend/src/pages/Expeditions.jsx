import { useState } from 'react'
import { useApi } from '../hooks/useApi'

const STATUS_COLORS = {
  planning: { border: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' },
  confirmed: { border: '#4ade80', color: '#4ade80' },
  completed: { border: 'var(--cyber-text-dim)', color: 'var(--cyber-text-dim)' },
  cancelled: { border: '#ef4444', color: '#ef4444' },
}

export default function Expeditions() {
  const [statusFilter, setStatusFilter] = useState('')
  const url = statusFilter
    ? `/social/expeditions/?status=${statusFilter}`
    : '/social/expeditions/'
  const { data, loading } = useApi(url)
  const expeditions = data ?? []

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Expeditions</h1>

      {/* Status filter */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {['', 'planning', 'confirmed', 'completed', 'cancelled'].map(s => (
          <button
            key={s}
            className={`cyber-btn px-3 py-1.5 text-sm ${
              statusFilter === s ? 'cyber-btn-cyan' : 'cyber-btn-ghost'
            }`}
            onClick={() => setStatusFilter(s)}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading...</p>
      ) : expeditions.length === 0 ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">
          No expeditions found
        </p>
      ) : (
        <div className="space-y-4">
          {expeditions.map(exp => {
            const colors = STATUS_COLORS[exp.status] || STATUS_COLORS.planning
            return (
              <div key={exp.id} className="cyber-card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{exp.name}</h3>
                    {exp.description && (
                      <p className="text-sm text-[var(--cyber-text-dim)] mt-1">
                        {exp.description}
                      </p>
                    )}
                  </div>
                  <span
                    className="cyber-badge capitalize"
                    style={{ borderColor: colors.border, color: colors.color }}
                  >
                    {exp.status}
                  </span>
                </div>

                <div className="flex flex-wrap gap-4 mt-3 text-sm text-[var(--cyber-text-dim)]">
                  <span>
                    📅 {new Date(exp.planned_date).toLocaleDateString()}
                  </span>
                  <span>
                    👥 {exp.confirmed_count}/{exp.max_members || '∞'} confirmed
                    ({exp.member_count} total)
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
