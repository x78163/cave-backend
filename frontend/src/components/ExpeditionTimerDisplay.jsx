import { useState, useEffect } from 'react'

const STATE_COLORS = {
  preparing: 'text-[var(--cyber-text-dim)]',
  active: 'text-green-400',
  underground: 'text-amber-400',
  surfaced: 'text-green-400',
  overdue: 'text-red-400',
  alert_sent: 'text-red-500',
  emergency_sent: 'text-red-600',
  completed: 'text-[var(--cyber-cyan)]',
  resolved: 'text-[var(--cyber-text-dim)]',
}

const STATE_LABELS = {
  preparing: 'Preparing',
  active: 'Active',
  underground: 'Underground',
  surfaced: 'Surfaced',
  overdue: 'Overdue',
  alert_sent: 'Alert Sent',
  emergency_sent: 'Emergency Sent',
  completed: 'Completed',
  resolved: 'Resolved',
}

export default function ExpeditionTimerDisplay({ tracking }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  if (!tracking) return null

  const expectedReturn = tracking.expected_return ? new Date(tracking.expected_return) : null
  const startedAt = tracking.started_at ? new Date(tracking.started_at) : null
  const isActive = !['preparing', 'completed', 'resolved'].includes(tracking.state)

  // Calculate time remaining or overdue
  let timerText = ''
  let timerColor = 'text-green-400'
  if (expectedReturn && isActive) {
    const diff = expectedReturn.getTime() - now
    const absDiff = Math.abs(diff)
    const hours = Math.floor(absDiff / 3600000)
    const minutes = Math.floor((absDiff % 3600000) / 60000)
    const seconds = Math.floor((absDiff % 60000) / 1000)

    if (diff > 0) {
      timerText = `${hours}h ${minutes}m ${seconds}s remaining`
      if (diff < 1800000) timerColor = 'text-amber-400' // < 30 min
      else timerColor = 'text-green-400'
    } else {
      timerText = `${hours}h ${minutes}m ${seconds}s overdue`
      timerColor = 'text-red-400'
    }
  }

  // Elapsed time since start
  let elapsedText = ''
  if (startedAt && isActive) {
    const elapsed = now - startedAt.getTime()
    const h = Math.floor(elapsed / 3600000)
    const m = Math.floor((elapsed % 3600000) / 60000)
    elapsedText = `${h}h ${m}m elapsed`
  }

  return (
    <div className="flex flex-col gap-2">
      {/* State badge */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold uppercase tracking-wider ${STATE_COLORS[tracking.state]}`}>
          {STATE_LABELS[tracking.state] || tracking.state}
        </span>
        {['underground', 'overdue', 'alert_sent', 'emergency_sent'].includes(tracking.state) && (
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        )}
      </div>

      {/* Timer */}
      {timerText && (
        <div className={`text-2xl font-mono font-bold ${timerColor}`}>
          {timerText}
        </div>
      )}

      {/* Elapsed */}
      {elapsedText && (
        <div className="text-xs text-[var(--cyber-text-dim)]">{elapsedText}</div>
      )}

      {/* Last GPS */}
      {tracking.last_gps_at && isActive && (
        <div className="text-xs text-[var(--cyber-text-dim)]">
          Last GPS: {new Date(tracking.last_gps_at).toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
