import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../hooks/useApi'
import useAuthStore from '../stores/authStore'
import useExpeditionStore from '../stores/expeditionStore'
import ExpeditionTimerDisplay from './ExpeditionTimerDisplay'
import ExpeditionCheckInList from './ExpeditionCheckInList'
import ExpeditionLiveMap from './ExpeditionLiveMap'

const ACTIVE_STATES = ['active', 'underground', 'surfaced', 'overdue', 'alert_sent', 'emergency_sent']

export default function ExpeditionTrackingPanel({ event, rsvps }) {
  const { user } = useAuthStore()
  const [tracking, setTracking] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Config form state
  const [expectedReturn, setExpectedReturn] = useState('')
  const [alertDelay, setAlertDelay] = useState(30)
  const [gpsStale, setGpsStale] = useState(15)
  const [emergencyContacts, setEmergencyContacts] = useState([])
  const [newContact, setNewContact] = useState({ name: '', email: '', phone: '' })

  // Surrogate state
  const [surrogateSearch, setSurrogateSearch] = useState('')
  const [surrogateResults, setSurrogateResults] = useState([])

  // Extend time
  const [extendMinutes, setExtendMinutes] = useState(60)
  const [showExtend, setShowExtend] = useState(false)

  const { startGPSTracking, stopGPSTracking, gpsTrail, fetchGPSTrail } = useExpeditionStore()

  const isLeader = event?.created_by === user?.id || user?.is_staff
  const isActive = tracking && ACTIVE_STATES.includes(tracking.state)
  const isSurrogate = tracking?.surrogates?.some(s => s.user === user?.id)
  const isCheckedIn = tracking?.checkins?.some(c => c.user === user?.id && !c.checked_out_at)

  const fetchTracking = useCallback(async () => {
    try {
      const data = await apiFetch(`/events/${event.id}/tracking/`)
      setTracking(data)
      if (data.expected_return) {
        setExpectedReturn(data.expected_return.slice(0, 16))
      }
      setAlertDelay(data.alert_delay_minutes)
      setGpsStale(data.gps_stale_minutes)
      setEmergencyContacts(data.emergency_contacts || [])
    } catch {
      setTracking(null)
    }
  }, [event?.id])

  useEffect(() => {
    if (event?.has_tracking) fetchTracking()
  }, [event?.has_tracking, fetchTracking])

  // Poll tracking state every 30s when active
  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(fetchTracking, 30000)
    return () => clearInterval(interval)
  }, [isActive, fetchTracking])

  // Start GPS tracking when checked in and expedition is active
  useEffect(() => {
    if (isActive && isCheckedIn && event?.id) {
      startGPSTracking(event.id)
    }
    return () => { if (!isActive) stopGPSTracking() }
  }, [isActive, isCheckedIn, event?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch GPS trail when active (for live map)
  useEffect(() => {
    if (!isActive || !event?.id) return
    fetchGPSTrail(event.id)
    const interval = setInterval(() => fetchGPSTrail(event.id), 30000)
    return () => clearInterval(interval)
  }, [isActive, event?.id, fetchGPSTrail])

  const enableTracking = async () => {
    setLoading(true)
    try {
      const data = await apiFetch(`/events/${event.id}/tracking/enable/`, { method: 'POST' })
      setTracking(data)
    } catch (err) {
      setError('Failed to enable tracking')
    } finally {
      setLoading(false)
    }
  }

  const updateConfig = async () => {
    try {
      const body = {
        alert_delay_minutes: alertDelay,
        gps_stale_minutes: gpsStale,
        emergency_contacts: emergencyContacts,
      }
      if (expectedReturn) body.expected_return = new Date(expectedReturn).toISOString()
      const data = await apiFetch(`/events/${event.id}/tracking/`, { method: 'PATCH', body })
      setTracking(data)
    } catch (err) {
      setError('Failed to update configuration')
    }
  }

  const startExpedition = async () => {
    setLoading(true)
    try {
      await updateConfig()
      const data = await apiFetch(`/events/${event.id}/tracking/start/`, { method: 'POST' })
      setTracking(data)
    } catch (err) {
      setError(err?.message || 'Failed to start expedition')
    } finally {
      setLoading(false)
    }
  }

  const completeExpedition = async () => {
    setLoading(true)
    try {
      const data = await apiFetch(`/events/${event.id}/tracking/complete/`, { method: 'POST' })
      setTracking(data)
    } catch (err) {
      setError('Failed to complete expedition')
    } finally {
      setLoading(false)
    }
  }

  const handleExtendTime = async () => {
    try {
      const data = await apiFetch(`/events/${event.id}/tracking/extend/`, {
        method: 'POST',
        body: { minutes: extendMinutes },
      })
      setTracking(data)
      setShowExtend(false)
    } catch (err) {
      setError('Failed to extend time')
    }
  }

  const triggerEmergency = async () => {
    if (!confirm('This will send emergency emails to all emergency contacts. Are you sure?')) return
    try {
      const data = await apiFetch(`/events/${event.id}/tracking/trigger-emergency/`, { method: 'POST' })
      setTracking(data)
    } catch (err) {
      setError('Failed to trigger emergency')
    }
  }

  const resolveExpedition = async () => {
    try {
      const data = await apiFetch(`/events/${event.id}/tracking/resolve/`, { method: 'POST' })
      setTracking(data)
    } catch (err) {
      setError('Failed to resolve')
    }
  }

  const selfCheckIn = async () => {
    try {
      await apiFetch(`/events/${event.id}/tracking/checkin/`, { method: 'POST' })
      fetchTracking()
    } catch (err) {
      setError('Check-in failed')
    }
  }

  // Emergency contact management
  const addContact = () => {
    if (!newContact.email) return
    setEmergencyContacts([...emergencyContacts, { ...newContact }])
    setNewContact({ name: '', email: '', phone: '' })
  }
  const removeContact = (i) => {
    setEmergencyContacts(emergencyContacts.filter((_, idx) => idx !== i))
  }

  // Surrogate management
  const searchSurrogates = async (q) => {
    setSurrogateSearch(q)
    if (q.length < 1) { setSurrogateResults([]); return }
    try {
      const data = await apiFetch(`/users/search/?q=${encodeURIComponent(q)}`)
      setSurrogateResults(data)
    } catch { setSurrogateResults([]) }
  }
  const addSurrogate = async (userId) => {
    try {
      await apiFetch(`/events/${event.id}/tracking/surrogates/`, {
        method: 'POST',
        body: { user_id: userId },
      })
      fetchTracking()
      setSurrogateSearch('')
      setSurrogateResults([])
    } catch (err) {
      setError('Failed to add surrogate')
    }
  }
  const removeSurrogate = async (surrogateId) => {
    try {
      await apiFetch(`/events/${event.id}/tracking/surrogates/${surrogateId}/`, { method: 'DELETE' })
      fetchTracking()
    } catch (err) {
      setError('Failed to remove surrogate')
    }
  }

  // No tracking yet — show enable button
  if (!tracking) {
    if (!isLeader) return null
    return (
      <div className="cyber-card p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Expedition Safety Tracking</h3>
            <p className="text-xs text-[var(--cyber-text-dim)] mt-1">
              Enable check-in manifest, GPS tracking, and emergency alerts
            </p>
          </div>
          <button
            onClick={enableTracking}
            disabled={loading}
            className="px-4 py-2 text-sm rounded border border-[var(--cyber-cyan)]/30 text-[var(--cyber-cyan)] hover:bg-[var(--cyber-cyan)]/10 disabled:opacity-50"
          >
            {loading ? 'Enabling...' : 'Enable Tracking'}
          </button>
        </div>
      </div>
    )
  }

  const isPreparing = tracking.state === 'preparing'
  const isTerminal = ['completed', 'resolved'].includes(tracking.state)
  const isOverdue = ['overdue', 'alert_sent', 'emergency_sent'].includes(tracking.state)

  return (
    <div className="cyber-card p-5 mb-6">
      <h3 className="text-sm font-semibold mb-4">Expedition Safety Tracking</h3>
      {error && (
        <div className="text-xs text-red-400 mb-3 p-2 bg-red-900/20 rounded">{error}</div>
      )}

      {/* Timer display for active states */}
      {(isActive || isTerminal) && (
        <div className="mb-4">
          <ExpeditionTimerDisplay tracking={tracking} />
        </div>
      )}

      {/* Live GPS map */}
      {isActive && gpsTrail.length > 0 && (
        <div className="mb-4">
          <ExpeditionLiveMap
            gpsTrail={gpsTrail}
            caveLatitude={tracking.cave_latitude}
            caveLongitude={tracking.cave_longitude}
          />
        </div>
      )}

      {/* Warning banners */}
      {isOverdue && (
        <div className={`p-3 rounded mb-4 ${
          tracking.state === 'emergency_sent'
            ? 'bg-red-900/30 border border-red-700'
            : 'bg-amber-900/20 border border-amber-700/30'
        }`}>
          <div className="text-sm font-bold text-red-400">
            {tracking.state === 'overdue' && 'Expedition is overdue!'}
            {tracking.state === 'alert_sent' && 'Surrogates have been notified'}
            {tracking.state === 'emergency_sent' && 'Emergency contacts have been notified'}
          </div>
          <div className="text-xs text-[var(--cyber-text-dim)] mt-1">
            {tracking.state === 'overdue' && 'Surrogate notifications will be sent shortly.'}
            {tracking.state === 'alert_sent' && `Emergency emails will be sent in ${tracking.alert_delay_minutes} minutes if not resolved.`}
            {tracking.state === 'emergency_sent' && 'Emergency contacts have received an alert. Contact local emergency services (911) if a rescue is needed.'}
          </div>
        </div>
      )}

      {/* Check-in list */}
      <div className="mb-4">
        <ExpeditionCheckInList
          eventId={event.id}
          tracking={tracking}
          rsvps={rsvps}
          isLeader={isLeader}
          onUpdate={fetchTracking}
        />
        {/* Self check-in button */}
        {!isTerminal && !tracking.checkins?.some(c => c.user === user?.id) && (
          <button
            onClick={selfCheckIn}
            className="mt-3 px-4 py-2 text-sm rounded bg-green-700/20 text-green-400 border border-green-700/30 hover:bg-green-700/30"
          >
            Check In (I am here)
          </button>
        )}
      </div>

      {/* Configuration — preparing state */}
      {isPreparing && isLeader && (
        <div className="space-y-4 border-t border-[var(--cyber-border)] pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--cyber-text-dim)]">
            Configuration
          </h4>

          {/* Expected return time */}
          <div>
            <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Expected Return Time</label>
            <input
              type="datetime-local"
              value={expectedReturn}
              onChange={e => setExpectedReturn(e.target.value)}
              className="cyber-input w-full text-sm"
            />
          </div>

          {/* Alert delay */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">
                Emergency Delay (min)
              </label>
              <input
                type="number"
                value={alertDelay}
                onChange={e => setAlertDelay(parseInt(e.target.value) || 30)}
                min={5}
                className="cyber-input w-full text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">
                GPS Stale (min)
              </label>
              <input
                type="number"
                value={gpsStale}
                onChange={e => setGpsStale(parseInt(e.target.value) || 15)}
                min={5}
                className="cyber-input w-full text-sm"
              />
            </div>
          </div>

          {/* Emergency contacts */}
          <div>
            <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Emergency Contacts</label>
            {emergencyContacts.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs mb-1">
                <span className="text-[var(--cyber-text)]">{c.name}</span>
                <span className="text-[var(--cyber-text-dim)]">{c.email}</span>
                {c.phone && <span className="text-[var(--cyber-text-dim)]">{c.phone}</span>}
                <button onClick={() => removeContact(i)} className="text-red-400 ml-auto">x</button>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <input
                placeholder="Name"
                value={newContact.name}
                onChange={e => setNewContact({ ...newContact, name: e.target.value })}
                className="cyber-input text-xs flex-1"
              />
              <input
                placeholder="Email"
                value={newContact.email}
                onChange={e => setNewContact({ ...newContact, email: e.target.value })}
                className="cyber-input text-xs flex-1"
              />
              <input
                placeholder="Phone"
                value={newContact.phone}
                onChange={e => setNewContact({ ...newContact, phone: e.target.value })}
                className="cyber-input text-xs flex-[0.8]"
              />
              <button
                onClick={addContact}
                disabled={!newContact.email}
                className="text-xs px-3 py-1 rounded border border-[var(--cyber-cyan)]/30 text-[var(--cyber-cyan)] hover:bg-[var(--cyber-cyan)]/10 disabled:opacity-30"
              >
                Add
              </button>
            </div>
          </div>

          {/* Surrogates */}
          <div>
            <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">
              Safety Surrogates (notified of expedition status)
            </label>
            {tracking.surrogates?.map(s => (
              <div key={s.id} className="flex items-center gap-2 text-xs mb-1">
                <span className="text-[var(--cyber-text)]">{s.username || s.grotto_name}</span>
                <button onClick={() => removeSurrogate(s.id)} className="text-red-400 ml-auto">x</button>
              </div>
            ))}
            <div className="relative mt-2">
              <input
                placeholder="Search users to add as surrogate..."
                value={surrogateSearch}
                onChange={e => searchSurrogates(e.target.value)}
                className="cyber-input text-xs w-full"
              />
              {surrogateResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--cyber-bg-card)] border border-[var(--cyber-border)] rounded shadow-lg z-50 max-h-40 overflow-y-auto">
                  {surrogateResults.map(u => (
                    <button
                      key={u.id}
                      onClick={() => addSurrogate(u.id)}
                      className="w-full text-left px-3 py-2 text-xs text-[var(--cyber-text)] hover:bg-[var(--cyber-cyan)]/10"
                    >
                      {u.username}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Start validation warnings */}
          {(!expectedReturn || emergencyContacts.length === 0 || !tracking.surrogates?.length) && (
            <div className="text-xs text-amber-400 p-2 bg-amber-900/10 rounded border border-amber-700/20 space-y-1">
              {!expectedReturn && <div>• Expected return time is required</div>}
              {emergencyContacts.length === 0 && <div>• At least one emergency contact is required</div>}
              {!tracking.surrogates?.length && <div>• At least one safety surrogate is required</div>}
            </div>
          )}

          {/* Start button */}
          <button
            onClick={startExpedition}
            disabled={loading || !expectedReturn || emergencyContacts.length === 0 || !tracking.surrogates?.length}
            className="w-full py-3 text-sm font-bold rounded bg-green-700/20 text-green-400 border border-green-700/30 hover:bg-green-700/30 disabled:opacity-50"
          >
            {loading ? 'Starting...' : 'Start Expedition'}
          </button>
        </div>
      )}

      {/* Active state actions */}
      {isActive && (
        <div className="flex flex-wrap gap-2 border-t border-[var(--cyber-border)] pt-4 mt-4">
          {isLeader && (
            <>
              <button
                onClick={completeExpedition}
                disabled={loading}
                className="px-4 py-2 text-sm rounded bg-green-700/20 text-green-400 border border-green-700/30 hover:bg-green-700/30 disabled:opacity-50"
              >
                Expedition Complete
              </button>
              <button
                onClick={() => setShowExtend(!showExtend)}
                className="px-4 py-2 text-sm rounded bg-amber-700/20 text-amber-400 border border-amber-700/30 hover:bg-amber-700/30"
              >
                Extend Time
              </button>
            </>
          )}
          {(isLeader || isSurrogate) && isOverdue && (
            <button
              onClick={triggerEmergency}
              className="px-4 py-2 text-sm rounded bg-red-700/20 text-red-400 border border-red-700/30 hover:bg-red-700/30"
            >
              Trigger Emergency
            </button>
          )}
          {(isLeader || isSurrogate) && ['alert_sent', 'emergency_sent'].includes(tracking.state) && (
            <button
              onClick={resolveExpedition}
              className="px-4 py-2 text-sm rounded bg-[var(--cyber-cyan)]/10 text-[var(--cyber-cyan)] border border-[var(--cyber-cyan)]/30 hover:bg-[var(--cyber-cyan)]/20"
            >
              Resolve
            </button>
          )}
        </div>
      )}

      {/* Extend time form */}
      {showExtend && (
        <div className="flex items-center gap-2 mt-3">
          <input
            type="number"
            value={extendMinutes}
            onChange={e => setExtendMinutes(parseInt(e.target.value) || 60)}
            min={15}
            className="cyber-input text-sm w-24"
          />
          <span className="text-xs text-[var(--cyber-text-dim)]">minutes</span>
          <button
            onClick={handleExtendTime}
            className="px-3 py-1 text-sm rounded bg-amber-700/20 text-amber-400 border border-amber-700/30 hover:bg-amber-700/30"
          >
            Extend
          </button>
        </div>
      )}

      {/* Terminal state */}
      {isTerminal && (
        <div className="border-t border-[var(--cyber-border)] pt-4 mt-4">
          <div className="text-xs text-[var(--cyber-text-dim)]">
            {tracking.state === 'completed' ? 'Expedition completed' : 'Expedition resolved'} at{' '}
            {tracking.completed_at && new Date(tracking.completed_at).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}
