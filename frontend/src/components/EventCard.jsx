import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../hooks/useApi'
import { TYPE_COLORS } from './EventCalendar'

const TRACKING_BORDER = {
  active: 'border-green-500/50',
  surfaced: 'border-green-500/50',
  underground: 'border-amber-500/50',
  overdue: 'border-red-500/50',
  alert_sent: 'border-red-600',
  emergency_sent: 'border-red-600',
}

const TRACKING_BADGE = {
  active: { bg: 'bg-green-900/30', text: 'text-green-400', label: 'Active' },
  surfaced: { bg: 'bg-green-900/30', text: 'text-green-400', label: 'Surfaced' },
  underground: { bg: 'bg-amber-900/20', text: 'text-amber-400', label: 'Underground' },
  overdue: { bg: 'bg-red-900/20', text: 'text-red-400', label: 'Overdue' },
  alert_sent: { bg: 'bg-red-900/30', text: 'text-red-500', label: 'Alert Sent' },
  emergency_sent: { bg: 'bg-red-900/40', text: 'text-red-500', label: 'Emergency' },
}

function formatEventDate(start, end, allDay) {
  const s = new Date(start)
  if (allDay) {
    const dateStr = s.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    if (end) {
      const e = new Date(end)
      if (e.toDateString() !== s.toDateString()) {
        return `${dateStr} - ${e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      }
    }
    return dateStr
  }
  const dateStr = s.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const timeStr = s.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  let result = `${dateStr} ${timeStr}`
  if (end) {
    const e = new Date(end)
    if (e.toDateString() === s.toDateString()) {
      result += ` - ${e.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    } else {
      result += ` - ${e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${e.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    }
  }
  return result
}

function getLocationText(event) {
  if (event.cave_name) return event.cave_name
  if (event.address) return event.address.split('\n')[0]
  if (event.latitude && event.longitude) return `${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}`
  return null
}

export default function EventCard({ event, onRsvpChange, tracking }) {
  const navigate = useNavigate()
  const color = TYPE_COLORS[event.event_type] || TYPE_COLORS.other
  const location = getLocationText(event)

  const handleRsvp = async (e, status) => {
    e.stopPropagation()
    try {
      if (event.user_rsvp === status) {
        await apiFetch(`/events/${event.id}/rsvp/`, { method: 'DELETE' })
      } else {
        await apiFetch(`/events/${event.id}/rsvp/`, {
          method: 'POST',
          body: { status },
        })
      }
      onRsvpChange?.()
    } catch (err) {
      console.error('RSVP failed:', err)
    }
  }

  const capacityText = event.max_participants
    ? `${event.going_count}/${event.max_participants} going`
    : `${event.going_count} going`

  // Tracking state from prop or from event serializer fields
  const trackingState = tracking?.state || event.tracking_state
  const isLiveTracking = trackingState && !['preparing', 'completed', 'resolved'].includes(trackingState)
  const borderClass = isLiveTracking ? TRACKING_BORDER[trackingState] || '' : ''
  const badge = isLiveTracking ? TRACKING_BADGE[trackingState] : null
  const isAlertState = ['overdue', 'alert_sent', 'emergency_sent'].includes(trackingState)

  return (
    <div
      onClick={() => navigate(`/events/${event.id}`)}
      className={`cyber-card p-4 cursor-pointer hover:border-[rgba(0,229,255,0.3)] transition-all ${borderClass} ${
        isAlertState ? 'animate-pulse-subtle' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-sm truncate flex-1">{event.name}</h3>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {badge && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1 ${badge.bg} ${badge.text}`}>
              {isAlertState && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
              {badge.label}
            </span>
          )}
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-medium capitalize"
            style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
          >
            {event.event_type}
          </span>
        </div>
      </div>

      <div className="space-y-1 text-xs text-[var(--cyber-text-dim)]">
        <div>{formatEventDate(event.start_date, event.end_date, event.all_day)}</div>
        {location && <div className="truncate">{location}</div>}
        <div>{capacityText}</div>
      </div>

      {/* Live tracking info */}
      {isLiveTracking && tracking && (
        <div className="flex items-center gap-3 mt-2 text-xs">
          {tracking.started_at && (
            <span className="text-[var(--cyber-text-dim)]">
              Started {new Date(tracking.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {tracking.checkin_count != null && (
            <span className="text-[var(--cyber-text-dim)]">
              {tracking.checkin_count}/{tracking.rsvp_count} checked in
            </span>
          )}
          <span className="ml-auto text-green-400 font-semibold text-[10px] uppercase tracking-wider">
            Track Live &rarr;
          </span>
        </div>
      )}

      {event.status === 'cancelled' && (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-700/30 mt-2 inline-block">
          Cancelled
        </span>
      )}

      {!isLiveTracking && (
        <div className="flex gap-2 mt-3">
          {event.is_full && event.user_rsvp !== 'going' ? (
            <span className="text-xs px-3 py-1 rounded-full bg-red-900/20 text-red-400 border border-red-700/20">
              Full
            </span>
          ) : (
            <button
              onClick={(e) => handleRsvp(e, 'going')}
              className={`text-xs px-3 py-1 rounded-full transition-all ${
                event.user_rsvp === 'going'
                  ? 'bg-[var(--cyber-cyan)] text-[var(--cyber-bg)] font-semibold'
                  : 'bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] hover:border-[var(--cyber-cyan)] hover:text-[var(--cyber-cyan)]'
              }`}
            >
              {event.user_rsvp === 'going' ? 'Going \u2713' : 'Going'}
            </button>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse-subtle {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
        .animate-pulse-subtle { animation: pulse-subtle 2s ease-in-out infinite; }
      `}</style>
    </div>
  )
}
