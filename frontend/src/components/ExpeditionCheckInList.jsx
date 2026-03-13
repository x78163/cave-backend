import { useState, useCallback } from 'react'
import { apiFetch } from '../hooks/useApi'
import AvatarDisplay from './AvatarDisplay'

export default function ExpeditionCheckInList({ eventId, tracking, rsvps, isLeader, onUpdate }) {
  const [loading, setLoading] = useState(null) // user id being checked in

  const checkedInIds = new Set((tracking?.checkins || []).map(c => c.user))
  const goingRsvps = (rsvps || []).filter(r => r.status === 'going')

  const handleCheckIn = useCallback(async (userId) => {
    setLoading(userId)
    try {
      await apiFetch(`/events/${eventId}/tracking/checkin/`, {
        method: 'POST',
        body: userId ? { user_id: userId } : {},
      })
      onUpdate?.()
    } catch (err) {
      console.error('Check-in failed:', err)
    } finally {
      setLoading(null)
    }
  }, [eventId, onUpdate])

  const handleCheckOut = useCallback(async (userId) => {
    setLoading(userId)
    try {
      await apiFetch(`/events/${eventId}/tracking/checkout/`, {
        method: 'POST',
        body: { user_id: userId },
      })
      onUpdate?.()
    } catch (err) {
      console.error('Check-out failed:', err)
    } finally {
      setLoading(null)
    }
  }, [eventId, onUpdate])

  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--cyber-text-dim)] mb-3">
        Manifest
      </h4>

      <div className="grid grid-cols-2 gap-4">
        {/* Expected (RSVPs) */}
        <div>
          <div className="text-xs text-[var(--cyber-text-dim)] mb-2">
            Expected ({goingRsvps.length})
          </div>
          <div className="space-y-2">
            {goingRsvps.map(rsvp => {
              const isCheckedIn = checkedInIds.has(rsvp.user)
              return (
                <div key={rsvp.user} className="flex items-center gap-2 text-sm">
                  <AvatarDisplay avatarPreset={rsvp.avatar_preset} size={24} />
                  <span className={isCheckedIn ? 'text-green-400' : 'text-[var(--cyber-text)]'}>
                    {rsvp.username}
                  </span>
                  {isCheckedIn ? (
                    <span className="text-xs text-green-500 ml-auto">&#10003;</span>
                  ) : isLeader ? (
                    <button
                      onClick={() => handleCheckIn(rsvp.user)}
                      disabled={loading === rsvp.user}
                      className="text-xs ml-auto px-2 py-0.5 rounded border border-[var(--cyber-cyan)]/30 text-[var(--cyber-cyan)] hover:bg-[var(--cyber-cyan)]/10 disabled:opacity-50"
                    >
                      {loading === rsvp.user ? '...' : 'Check In'}
                    </button>
                  ) : null}
                </div>
              )
            })}
            {goingRsvps.length === 0 && (
              <div className="text-xs text-[var(--cyber-text-dim)]">No RSVPs yet</div>
            )}
          </div>
        </div>

        {/* Checked In (actual) */}
        <div>
          <div className="text-xs text-[var(--cyber-text-dim)] mb-2">
            Checked In ({tracking?.checkins?.length || 0})
          </div>
          <div className="space-y-2">
            {(tracking?.checkins || []).map(checkin => (
              <div key={checkin.id} className="flex items-center gap-2 text-sm">
                <AvatarDisplay avatarPreset={checkin.avatar_preset} size={24} />
                <span className={checkin.checked_out_at ? 'text-[var(--cyber-text-dim)] line-through' : 'text-green-400'}>
                  {checkin.username}
                </span>
                {checkin.checked_out_at ? (
                  <span className="text-xs text-[var(--cyber-text-dim)] ml-auto">out</span>
                ) : isLeader ? (
                  <button
                    onClick={() => handleCheckOut(checkin.user)}
                    disabled={loading === checkin.user}
                    className="text-xs ml-auto px-2 py-0.5 rounded border border-red-700/30 text-red-400 hover:bg-red-900/20 disabled:opacity-50"
                  >
                    {loading === checkin.user ? '...' : 'Out'}
                  </button>
                ) : null}
                <span className="text-[10px] text-[var(--cyber-text-dim)]">
                  {new Date(checkin.checked_in_at).toLocaleTimeString()}
                </span>
              </div>
            ))}
            {(!tracking?.checkins || tracking.checkins.length === 0) && (
              <div className="text-xs text-[var(--cyber-text-dim)]">No one checked in</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
