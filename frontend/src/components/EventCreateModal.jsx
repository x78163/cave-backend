import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../hooks/useApi'
import RichTextEditor from './RichTextEditor'
import FineTuneMapModal from './FineTuneMapModal'
import parseCoordinates from '../utils/parseCoordinates'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const EVENT_TYPES = [
  { value: 'expedition', label: 'Expedition' },
  { value: 'survey', label: 'Survey Trip' },
  { value: 'training', label: 'Training' },
  { value: 'education', label: 'Education' },
  { value: 'outreach', label: 'Outreach' },
  { value: 'conservation', label: 'Conservation' },
  { value: 'social', label: 'Social Gathering' },
  { value: 'other', label: 'Other' },
]

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public' },
  { value: 'all_grotto', label: 'All Grotto Members' },
  { value: 'grotto_only', label: 'Grotto Only' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private (Invite Only)' },
]

const LOCATION_TABS = [
  { key: 'coordinates', label: 'Coordinates' },
  { key: 'address', label: 'Address' },
  { key: 'maps', label: 'Maps Link' },
]

// Cyan pin for mini map
const pinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30" viewBox="0 0 20 30">
  <path d="M10 0C4.5 0 0 4.5 0 10c0 7.5 10 20 10 20s10-12.5 10-20C20 4.5 15.5 0 10 0z" fill="#00e5ff" stroke="#0a0a12" stroke-width="1.5"/>
  <circle cx="10" cy="10" r="4" fill="#0a0a12"/>
</svg>`
const pinIcon = L.divIcon({
  html: pinSvg,
  className: 'cave-marker',
  iconSize: [20, 30],
  iconAnchor: [10, 30],
})

/* ── Mini Map Preview ──────────────────────────────────────── */

function MiniMap({ lat, lon }) {
  const ref = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    if (!mapRef.current) {
      const map = L.map(ref.current, {
        center: [lat, lon],
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
      })
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19 }
      ).addTo(map)
      markerRef.current = L.marker([lat, lon], { icon: pinIcon }).addTo(map)
      mapRef.current = map
    } else {
      mapRef.current.setView([lat, lon], 14)
      markerRef.current?.setLatLng([lat, lon])
    }
  }, [lat, lon])

  useEffect(() => {
    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  return (
    <div ref={ref} style={{ height: 130 }}
      className="rounded-lg overflow-hidden border border-[var(--cyber-border)]" />
  )
}

/* ── Main Modal ────────────────────────────────────────────── */

export default function EventCreateModal({ onClose, onCreated, editEvent = null }) {
  // Basic fields
  const [name, setName] = useState(editEvent?.name || '')
  const [eventType, setEventType] = useState(editEvent?.event_type || 'expedition')
  const [description, setDescription] = useState(editEvent?.description || '')
  const [visibility, setVisibility] = useState(editEvent?.visibility || 'public')

  // Date/time — split into day + time for calendar picker
  const [startDay, setStartDay] = useState(() => editEvent?.start_date?.slice(0, 10) || '')
  const [endDay, setEndDay] = useState(() => editEvent?.end_date?.slice(0, 10) || '')
  const [startTime, setStartTime] = useState(() => editEvent?.start_date?.slice(11, 16) || '09:00')
  const [endTime, setEndTime] = useState(() => editEvent?.end_date?.slice(11, 16) || '17:00')
  const [allDay, setAllDay] = useState(editEvent?.all_day || false)

  // Calendar state
  const [calendarPhase, setCalendarPhase] = useState('start')
  const [hoverDay, setHoverDay] = useState(null)
  const [viewMonth, setViewMonth] = useState(() => {
    if (editEvent?.start_date) return new Date(editEvent.start_date.slice(0, 10) + 'T12:00:00')
    return new Date()
  })

  // Location
  const [locationTab, setLocationTab] = useState('address')
  const [coordinates, setCoordinates] = useState(() => {
    if (editEvent?.latitude && editEvent?.longitude) return `${editEvent.latitude}, ${editEvent.longitude}`
    return ''
  })
  const [address, setAddress] = useState(editEvent?.address || '')
  const [googleMapsLink, setGoogleMapsLink] = useState(editEvent?.google_maps_link || '')
  const [parsedLat, setParsedLat] = useState(editEvent?.latitude || null)
  const [parsedLon, setParsedLon] = useState(editEvent?.longitude || null)
  const [coordError, setCoordError] = useState('')
  const [showFineTune, setShowFineTune] = useState(false)

  // Cave picker
  const [caveId, setCaveId] = useState(editEvent?.cave || '')
  const [caveSearch, setCaveSearch] = useState('')
  const [caveResults, setCaveResults] = useState([])
  const [selectedCaveName, setSelectedCaveName] = useState(editEvent?.cave_name || '')
  const [caveSearchDone, setCaveSearchDone] = useState(false)

  // Logistics
  const [requiredEquipment, setRequiredEquipment] = useState(editEvent?.required_equipment || '')
  const [meetupInstructions, setMeetupInstructions] = useState(editEvent?.meetup_instructions || '')
  const [maxParticipants, setMaxParticipants] = useState(editEvent?.max_participants || '')

  // Grotto
  const [grottoId, setGrottoId] = useState(editEvent?.grotto || '')
  const [grottos, setGrottos] = useState([])

  // Private invite
  const [inviteSearch, setInviteSearch] = useState('')
  const [inviteResults, setInviteResults] = useState([])
  const [invitedUsers, setInvitedUsers] = useState([])

  // Expedition tracking config
  const [enableTracking, setEnableTracking] = useState(false)
  const [expectedReturn, setExpectedReturn] = useState('')
  const [alertDelay, setAlertDelay] = useState(30)
  const [gpsStale, setGpsStale] = useState(15)
  const [emergencyContacts, setEmergencyContacts] = useState([])
  const [newContact, setNewContact] = useState({ name: '', email: '', phone: '' })
  const [surrogateSearch, setSurrogateSearch] = useState('')
  const [surrogateResults, setSurrogateResults] = useState([])
  const [addedSurrogates, setAddedSurrogates] = useState([])

  // UI
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // ── Data fetching ──

  useEffect(() => {
    apiFetch('/users/grottos/')
      .then(data => {
        const all = data?.grottos ?? (Array.isArray(data) ? data : data?.results || [])
        // Only show grottos where user is officer or admin
        const eligible = all.filter(g =>
          g.user_membership?.status === 'active' &&
          (g.user_membership?.role === 'admin' || g.user_membership?.role === 'officer')
        )
        setGrottos(eligible)
      })
      .catch(() => {})
  }, [])

  // Cave search
  useEffect(() => {
    if (caveSearch.length < 1) { setCaveResults([]); setCaveSearchDone(false); return }
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch(`/caves/?search=${encodeURIComponent(caveSearch)}&limit=8`)
        const results = Array.isArray(data) ? data : data?.caves || data?.results || []
        setCaveResults(results)
        setCaveSearchDone(true)
      } catch { setCaveResults([]); setCaveSearchDone(true) }
    }, 250)
    return () => clearTimeout(timer)
  }, [caveSearch])

  // User search for private invite
  useEffect(() => {
    if (inviteSearch.length < 1 || visibility !== 'private') { setInviteResults([]); return }
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch(`/users/search/?q=${encodeURIComponent(inviteSearch)}`)
        const results = Array.isArray(data) ? data : data?.results || []
        const invitedIds = new Set(invitedUsers.map(u => u.id))
        setInviteResults(results.filter(u => !invitedIds.has(u.id)))
      } catch { setInviteResults([]) }
    }, 300)
    return () => clearTimeout(timer)
  }, [inviteSearch, visibility, invitedUsers])

  // Surrogate search for tracking
  useEffect(() => {
    if (surrogateSearch.length < 1 || !enableTracking) { setSurrogateResults([]); return }
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch(`/users/search/?q=${encodeURIComponent(surrogateSearch)}`)
        const results = Array.isArray(data) ? data : data?.results || []
        const addedIds = new Set(addedSurrogates.map(u => u.id))
        setSurrogateResults(results.filter(u => !addedIds.has(u.id)))
      } catch { setSurrogateResults([]) }
    }, 300)
    return () => clearTimeout(timer)
  }, [surrogateSearch, enableTracking, addedSurrogates])

  // ── Handlers ──

  const handleCoordinateChange = (val) => {
    setCoordinates(val)
    setCoordError('')
    if (!val.trim()) { setParsedLat(null); setParsedLon(null); return }
    try {
      const { lat, lon } = parseCoordinates(val)
      setParsedLat(lat)
      setParsedLon(lon)
    } catch (err) {
      if (!err.needsBackendResolve) setCoordError(err.message)
    }
  }

  const handleMapsLinkChange = (val) => {
    setGoogleMapsLink(val)
    if (!val.trim()) return
    try {
      const { lat, lon } = parseCoordinates(val)
      setParsedLat(lat)
      setParsedLon(lon)
      setCoordError('')
    } catch { /* not parseable yet */ }
  }

  const handleCaveSelect = (cave) => {
    setCaveId(cave.id)
    setSelectedCaveName(cave.name)
    setCaveSearch('')
    setCaveResults([])
    setCaveSearchDone(false)
    if (cave.latitude && cave.longitude) {
      setParsedLat(cave.latitude)
      setParsedLon(cave.longitude)
      setCoordinates(`${cave.latitude}, ${cave.longitude}`)
    }
    if (!address && cave.city) {
      setAddress(`${cave.city}${cave.region ? ', ' + cave.region : ''}`)
    }
  }

  const handleDayClick = (dayStr) => {
    if (calendarPhase === 'start' || !startDay) {
      setStartDay(dayStr)
      setEndDay('')
      setCalendarPhase('end')
    } else {
      if (dayStr < startDay) {
        setEndDay(startDay)
        setStartDay(dayStr)
      } else if (dayStr === startDay) {
        setEndDay('')
      } else {
        setEndDay(dayStr)
      }
      setCalendarPhase('start')
    }
  }

  const handleFineTune = (picked) => {
    setParsedLat(picked.lat)
    setParsedLon(picked.lon)
    setCoordinates(`${picked.lat}, ${picked.lon}`)
    setShowFineTune(false)
  }

  const handleSubmit = async () => {
    if (!name.trim() || !startDay) return
    setSubmitting(true)
    setError(null)
    try {
      const body = {
        name: name.trim(),
        event_type: eventType,
        description,
        start_date: allDay
          ? startDay + 'T00:00:00Z'
          : new Date(`${startDay}T${startTime}`).toISOString(),
        all_day: allDay,
        address,
        google_maps_link: googleMapsLink,
        required_equipment: requiredEquipment,
        meetup_instructions: meetupInstructions,
        visibility,
      }
      if (endDay) {
        body.end_date = allDay
          ? endDay + 'T23:59:59Z'
          : new Date(`${endDay}T${endTime}`).toISOString()
      }
      if (parsedLat != null) body.latitude = parsedLat
      if (parsedLon != null) body.longitude = parsedLon
      if (caveId) body.cave = caveId
      if (maxParticipants) body.max_participants = parseInt(maxParticipants, 10)
      if (grottoId) {
        body.grotto = grottoId
      }

      let eventData
      if (editEvent) {
        eventData = await apiFetch(`/events/${editEvent.id}/`, { method: 'PATCH', body })
      } else {
        eventData = await apiFetch('/events/', { method: 'POST', body })
      }

      // Send invitations for private events
      if (visibility === 'private' && invitedUsers.length > 0 && eventData?.id) {
        await Promise.allSettled(
          invitedUsers.map(u =>
            apiFetch(`/events/${eventData.id}/invitations/`, {
              method: 'POST',
              body: { user_id: u.id },
            })
          )
        )
      }

      // Set up expedition tracking if enabled
      if (enableTracking && eventData?.id && !editEvent) {
        try {
          await apiFetch(`/events/${eventData.id}/tracking/enable/`, { method: 'POST' })
          const trackingConfig = {
            alert_delay_minutes: alertDelay,
            gps_stale_minutes: gpsStale,
            emergency_contacts: emergencyContacts,
          }
          if (expectedReturn) trackingConfig.expected_return = new Date(expectedReturn).toISOString()
          await apiFetch(`/events/${eventData.id}/tracking/`, { method: 'PATCH', body: trackingConfig })
          // Add surrogates
          await Promise.allSettled(
            addedSurrogates.map(u =>
              apiFetch(`/events/${eventData.id}/tracking/surrogates/`, {
                method: 'POST',
                body: { user_id: u.id },
              })
            )
          )
        } catch (trackErr) {
          console.error('Failed to configure tracking:', trackErr)
        }
      }

      onCreated?.()
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to save event')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Calendar rendering helpers ──

  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const today = new Date().toISOString().slice(0, 10)
  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const weeks = []
  let week = new Array(firstDayOfWeek).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d)
    if (week.length === 7) { weeks.push(week); week = [] }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null)
    weeks.push(week)
  }

  const dayStr = (d) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const isInRange = (d) => {
    if (!d || !startDay) return false
    const ds = dayStr(d)
    const end = endDay || (calendarPhase === 'end' ? hoverDay : null)
    if (!end) return ds === startDay
    const [a, b] = startDay <= end ? [startDay, end] : [end, startDay]
    return ds >= a && ds <= b
  }

  const isRangeStart = (d) => d && dayStr(d) === startDay
  const isRangeEnd = (d) => {
    if (!d) return false
    return dayStr(d) === endDay || (calendarPhase === 'end' && dayStr(d) === hoverDay && !endDay)
  }

  const needsGrotto = visibility === 'grotto_only' || visibility === 'all_grotto'
  const hasCoords = parsedLat != null && parsedLon != null

  // ── Render ──

  return (
    <div className="fixed inset-0 z-[2000] flex items-start justify-center pt-8 pb-8 overflow-y-auto"
      onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl bg-[var(--cyber-surface)] border border-[var(--cyber-border)]
          rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[var(--cyber-surface)] border-b border-[var(--cyber-border)] px-6 py-4 z-10
          flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-bold">{editEvent ? 'Edit Event' : 'Create Event'}</h2>
          <button onClick={onClose} className="text-[var(--cyber-text-dim)] hover:text-white text-xl">&times;</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Name */}
          <div>
            <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Event Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="cyber-input w-full px-4 py-2 text-sm" placeholder="e.g. Big Cave Survey Trip" />
          </div>

          {/* Grotto event (at top for planning) */}
          {grottos.length > 0 && (
            <div className="border border-[var(--cyber-border)] rounded-xl p-4 space-y-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <div className={`relative w-9 h-5 rounded-full transition-all duration-300 cursor-pointer ${
                  grottoId
                    ? 'bg-cyan-900/50 border border-[var(--cyber-cyan)]'
                    : 'bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]'
                }`}
                  onClick={(e) => { e.preventDefault(); grottoId ? setGrottoId('') : setGrottoId(grottos[0]?.id || '') }}
                >
                  <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 ${
                    grottoId ? 'left-[18px] bg-[var(--cyber-cyan)]' : 'left-0.5 bg-[var(--cyber-text-dim)]'
                  }`} />
                </div>
                <span className="text-[var(--cyber-text)]">Create as grotto event</span>
              </label>
              {grottoId && (
                <select value={grottoId} onChange={e => setGrottoId(e.target.value)}
                  className="cyber-input w-full px-4 py-2 text-sm rounded-xl">
                  <option value="">Select grotto...</option>
                  {grottos.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              )}
            </div>
          )}

          {/* Type + Visibility */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Type</label>
              <select value={eventType} onChange={e => setEventType(e.target.value)}
                className="cyber-input w-full px-4 py-2 text-sm rounded-xl">
                {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Visibility</label>
              <select value={visibility} onChange={e => setVisibility(e.target.value)}
                className="cyber-input w-full px-4 py-2 text-sm rounded-xl">
                {VISIBILITY_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>
          </div>

          {/* Visibility → Grotto picker */}
          {needsGrotto && grottos.length > 0 && (
            <div className="border border-cyan-700/30 rounded-xl p-3 bg-cyan-900/10">
              <label className="text-xs text-[var(--cyber-text-dim)] block mb-1.5">
                {visibility === 'grotto_only' ? 'Select Grotto *' : 'Grotto (optional)'}
              </label>
              <select value={grottoId} onChange={e => setGrottoId(e.target.value)}
                className="cyber-input w-full px-4 py-2 text-sm rounded-xl">
                <option value="">Select grotto...</option>
                {grottos.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}

          {/* Visibility → Private invite */}
          {visibility === 'private' && (
            <div className="border border-purple-700/30 rounded-xl p-3 bg-purple-900/10">
              <label className="text-xs text-[var(--cyber-text-dim)] block mb-1.5">Invite Users</label>
              {invitedUsers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {invitedUsers.map(u => (
                    <span key={u.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                      bg-purple-900/40 text-purple-300 border border-purple-700/30">
                      {u.username}
                      <button onClick={() => setInvitedUsers(prev => prev.filter(x => x.id !== u.id))}
                        className="hover:text-red-400 ml-0.5">&times;</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="relative">
                <input value={inviteSearch} onChange={e => setInviteSearch(e.target.value)}
                  className="cyber-input w-full px-4 py-2 text-sm" placeholder="Search users to invite..." />
                {inviteResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]
                    rounded-xl overflow-hidden z-20 max-h-32 overflow-y-auto">
                    {inviteResults.map(u => (
                      <button key={u.id} onClick={() => {
                        setInvitedUsers(prev => [...prev, u])
                        setInviteSearch('')
                        setInviteResults([])
                      }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--cyber-surface)] transition-colors text-[var(--cyber-text)]">
                        {u.username}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-[var(--cyber-text-dim)] mt-1.5">
                You can also invite more people after creating the event.
              </p>
            </div>
          )}

          {/* ── Date Section ── */}
          <div className="border border-[var(--cyber-border)] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs text-[var(--cyber-text-dim)] font-medium">Date & Time *</label>
              {/* Cyberpunk toggle */}
              <button onClick={() => setAllDay(!allDay)} className="flex items-center gap-2 group cursor-pointer">
                <span className="text-xs text-[var(--cyber-text-dim)] group-hover:text-[var(--cyber-text)]">All Day</span>
                <div className={`relative w-9 h-5 rounded-full transition-all duration-300 ${
                  allDay
                    ? 'bg-cyan-900/50 border border-[var(--cyber-cyan)] shadow-[0_0_8px_rgba(0,229,255,0.3)]'
                    : 'bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]'
                }`}>
                  <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 ${
                    allDay
                      ? 'left-[18px] bg-[var(--cyber-cyan)] shadow-[0_0_6px_var(--cyber-cyan)]'
                      : 'left-0.5 bg-[var(--cyber-text-dim)]'
                  }`} />
                </div>
              </button>
            </div>

            {/* Inline calendar */}
            <div className="bg-[var(--cyber-bg)]/50 rounded-lg p-3">
              {/* Month navigation */}
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => setViewMonth(new Date(year, month - 1, 1))}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--cyber-text-dim)]
                    hover:text-[var(--cyber-cyan)] hover:bg-[var(--cyber-surface-2)] transition-colors text-xs">
                  ◀
                </button>
                <span className="text-sm font-medium text-[var(--cyber-text)]">
                  {viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
                <button onClick={() => setViewMonth(new Date(year, month + 1, 1))}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--cyber-text-dim)]
                    hover:text-[var(--cyber-cyan)] hover:bg-[var(--cyber-surface-2)] transition-colors text-xs">
                  ▶
                </button>
              </div>

              {/* Day-of-week headers */}
              <div className="grid grid-cols-7 text-center mb-1">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                  <div key={d} className="text-[10px] text-[var(--cyber-text-dim)] py-1 font-medium">{d}</div>
                ))}
              </div>

              {/* Day grid */}
              {weeks.map((w, wi) => (
                <div key={wi} className="grid grid-cols-7">
                  {w.map((d, di) => {
                    if (!d) return <div key={di} />
                    const ds = dayStr(d)
                    const start = isRangeStart(d)
                    const end = isRangeEnd(d)
                    const inRange = isInRange(d)
                    const isToday = ds === today
                    const isPast = ds < today
                    return (
                      <button
                        key={di}
                        onClick={() => handleDayClick(ds)}
                        onMouseEnter={() => setHoverDay(ds)}
                        onMouseLeave={() => setHoverDay(null)}
                        className={`h-8 text-xs transition-all ${
                          start || end
                            ? 'bg-[var(--cyber-cyan)] text-[var(--cyber-bg)] font-bold rounded-full z-10 shadow-[0_0_8px_rgba(0,229,255,0.4)]'
                            : inRange
                              ? 'bg-cyan-900/40 text-[var(--cyber-cyan)]'
                              : isPast
                                ? 'text-[var(--cyber-text-dim)]/40 hover:bg-[var(--cyber-surface-2)]/50'
                                : isToday
                                  ? 'text-[var(--cyber-cyan)] font-semibold ring-1 ring-cyan-500/40 rounded-full'
                                  : 'text-[var(--cyber-text)] hover:bg-[var(--cyber-surface-2)] hover:text-[var(--cyber-cyan)]'
                        }`}
                      >
                        {d}
                      </button>
                    )
                  })}
                </div>
              ))}

              {/* Selected date display */}
              <div className="flex items-center gap-2 mt-3 text-xs">
                <span className={`px-2.5 py-1 rounded-md border ${
                  startDay
                    ? 'border-cyan-700/40 text-[var(--cyber-cyan)] bg-cyan-900/20'
                    : 'border-[var(--cyber-border)] text-[var(--cyber-text-dim)]'
                }`}>
                  {startDay
                    ? new Date(startDay + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'Start date'}
                </span>
                <span className="text-[var(--cyber-text-dim)]">→</span>
                <span className={`px-2.5 py-1 rounded-md border ${
                  endDay
                    ? 'border-cyan-700/40 text-[var(--cyber-cyan)] bg-cyan-900/20'
                    : 'border-[var(--cyber-border)] text-[var(--cyber-text-dim)]'
                }`}>
                  {endDay
                    ? new Date(endDay + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'End (optional)'}
                </span>
                {startDay && (
                  <button onClick={() => { setStartDay(''); setEndDay(''); setCalendarPhase('start') }}
                    className="text-[10px] text-[var(--cyber-text-dim)] hover:text-red-400 ml-auto">
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Time pickers (non-all-day) */}
            {!allDay && startDay && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="text-[10px] text-[var(--cyber-text-dim)] block mb-1">Start Time</label>
                  <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                    className="cyber-input w-full px-3 py-1.5 text-sm rounded-lg event-time-input" />
                </div>
                {endDay && (
                  <div>
                    <label className="text-[10px] text-[var(--cyber-text-dim)] block mb-1">End Time</label>
                    <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                      className="cyber-input w-full px-3 py-1.5 text-sm rounded-lg event-time-input" />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Cave Picker (improved) ── */}
          <div>
            <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Cave (optional)</label>
            {caveId ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-cyan-900/15 border border-cyan-700/30 rounded-xl">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="var(--cyber-cyan)" className="flex-shrink-0">
                  <path d="M8 0C4.7 0 2 2.7 2 6c0 4.5 6 10 6 10s6-5.5 6-10c0-3.3-2.7-6-6-6zm0 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
                </svg>
                <span className="text-sm text-[var(--cyber-cyan)] font-medium">{selectedCaveName}</span>
                <button onClick={() => { setCaveId(''); setSelectedCaveName(''); setCaveSearch('') }}
                  className="text-xs text-[var(--cyber-text-dim)] hover:text-red-400 ml-auto">&times; Remove</button>
              </div>
            ) : (
              <div className="relative">
                <input value={caveSearch}
                  onChange={e => { setCaveSearch(e.target.value); setCaveSearchDone(false) }}
                  className="cyber-input w-full px-4 py-2 text-sm"
                  placeholder="Start typing a cave name..." />
                {caveSearch.length >= 1 && (caveResults.length > 0 || caveSearchDone) && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]
                    rounded-xl overflow-hidden z-20 max-h-48 overflow-y-auto">
                    {caveResults.map(c => (
                      <button key={c.id} onClick={() => handleCaveSelect(c)}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--cyber-surface)] transition-colors flex items-center gap-2">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--cyber-cyan)" className="flex-shrink-0 opacity-60">
                          <path d="M8 0C4.7 0 2 2.7 2 6c0 4.5 6 10 6 10s6-5.5 6-10c0-3.3-2.7-6-6-6zm0 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
                        </svg>
                        <span className="text-[var(--cyber-text)]">{c.name}</span>
                        {c.city && (
                          <span className="text-[var(--cyber-text-dim)] text-xs ml-auto">
                            {c.city}{c.region ? `, ${c.region}` : ''}
                          </span>
                        )}
                      </button>
                    ))}
                    {caveSearchDone && caveResults.length === 0 && (
                      <div className="px-4 py-3 text-center">
                        <p className="text-xs text-[var(--cyber-text-dim)]">
                          "<span className="text-amber-400">{caveSearch}</span>" not found in database
                        </p>
                        <p className="text-[10px] text-[var(--cyber-text-dim)] mt-0.5">
                          You can still create the event without linking a cave
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Location (tabbed card) ── */}
          <div className="border border-[var(--cyber-border)] rounded-xl overflow-hidden">
            <div className="flex border-b border-[var(--cyber-border)] bg-[var(--cyber-bg)]/30">
              {LOCATION_TABS.map(tab => (
                <button key={tab.key} onClick={() => setLocationTab(tab.key)}
                  className={`flex-1 text-xs py-2.5 transition-colors font-medium ${
                    locationTab === tab.key
                      ? 'text-[var(--cyber-cyan)] border-b-2 border-[var(--cyber-cyan)] bg-cyan-900/10'
                      : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-text)]'
                  }`}>
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-4">
              {locationTab === 'coordinates' && (
                <div>
                  <input value={coordinates} onChange={e => handleCoordinateChange(e.target.value)}
                    className="cyber-input w-full px-4 py-2 text-sm"
                    placeholder="e.g. 35.658, -85.588 or DMS, UTM, MGRS..." />
                  {coordError && <p className="text-amber-400 text-[10px] mt-1">{coordError}</p>}
                  {hasCoords && locationTab === 'coordinates' && (
                    <p className="text-emerald-400 text-[10px] mt-1 font-mono">
                      {parsedLat.toFixed(6)}, {parsedLon.toFixed(6)}
                    </p>
                  )}
                </div>
              )}

              {locationTab === 'address' && (
                <input value={address} onChange={e => setAddress(e.target.value)}
                  className="cyber-input w-full px-4 py-2 text-sm"
                  placeholder="e.g. 123 Cave Rd, Nashville TN" />
              )}

              {locationTab === 'maps' && (
                <div>
                  <input value={googleMapsLink} onChange={e => handleMapsLinkChange(e.target.value)}
                    className="cyber-input w-full px-4 py-2 text-sm"
                    placeholder="Paste a Google Maps link..." />
                  {hasCoords && locationTab === 'maps' && (
                    <p className="text-emerald-400 text-[10px] mt-1 font-mono">
                      Coordinates extracted: {parsedLat.toFixed(6)}, {parsedLon.toFixed(6)}
                    </p>
                  )}
                </div>
              )}

              {/* Mini map preview */}
              {hasCoords && (
                <div className="mt-3">
                  <MiniMap lat={parsedLat} lon={parsedLon} />
                  <button onClick={() => setShowFineTune(true)}
                    className="text-[10px] text-[var(--cyber-cyan)] hover:underline mt-1.5 flex items-center gap-1">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 0C4.7 0 2 2.7 2 6c0 4.5 6 10 6 10s6-5.5 6-10c0-3.3-2.7-6-6-6zm0 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
                    </svg>
                    Fine Tune Location
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Description</label>
            <RichTextEditor
              content={description}
              onChange={setDescription}
              placeholder="Describe the event, what to expect, meeting points, etc."
            />
          </div>

          {/* Equipment */}
          <div>
            <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Required Equipment</label>
            <textarea value={requiredEquipment} onChange={e => setRequiredEquipment(e.target.value)}
              className="cyber-textarea w-full px-4 py-2 text-sm min-h-[60px] resize-y"
              placeholder="Helmet, headlamp, vertical gear, etc." />
          </div>

          {/* Meetup / parking instructions */}
          <div>
            <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Parking / Meetup Instructions</label>
            <textarea value={meetupInstructions} onChange={e => setMeetupInstructions(e.target.value)}
              className="cyber-textarea w-full px-4 py-2 text-sm min-h-[60px] resize-y"
              placeholder="Park at the trailhead lot, meet at the kiosk. 4WD recommended." />
          </div>

          {/* Max participants */}
          <div>
            <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Max Participants (optional)</label>
            <input type="number" min="1" value={maxParticipants}
              onChange={e => setMaxParticipants(e.target.value)}
              className="cyber-input w-48 px-4 py-2 text-sm" placeholder="Unlimited" />
          </div>

          {/* Expedition Safety Tracking (only for new events) */}
          {!editEvent && (
            <div className="border border-[var(--cyber-border)] rounded-xl p-4 space-y-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <div className={`relative w-9 h-5 rounded-full transition-all duration-300 cursor-pointer ${
                  enableTracking
                    ? 'bg-green-900/50 border border-green-500'
                    : 'bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]'
                }`}
                  onClick={(e) => { e.preventDefault(); setEnableTracking(!enableTracking) }}
                >
                  <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 ${
                    enableTracking ? 'left-[18px] bg-green-400' : 'left-0.5 bg-[var(--cyber-text-dim)]'
                  }`} />
                </div>
                <span className="text-[var(--cyber-text)]">Enable Expedition Safety Tracking</span>
              </label>
              {enableTracking && (
                <div className="space-y-4 pt-1">
                  <p className="text-[10px] text-[var(--cyber-text-dim)]">
                    Configure check-in manifest, GPS tracking, emergency contacts, and surrogate notifications.
                    You can also adjust these settings on the event detail page before starting.
                  </p>

                  {/* Expected return */}
                  <div>
                    <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Expected Return Time</label>
                    <input type="datetime-local" value={expectedReturn}
                      onChange={e => setExpectedReturn(e.target.value)}
                      className="cyber-input w-full px-3 py-2 text-sm rounded-lg event-time-input" />
                  </div>

                  {/* Delay settings */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Emergency Delay (min)</label>
                      <input type="number" value={alertDelay} min={5}
                        onChange={e => setAlertDelay(parseInt(e.target.value) || 30)}
                        className="cyber-input w-full px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">GPS Stale (min)</label>
                      <input type="number" value={gpsStale} min={5}
                        onChange={e => setGpsStale(parseInt(e.target.value) || 15)}
                        className="cyber-input w-full px-3 py-2 text-sm" />
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
                        <button onClick={() => setEmergencyContacts(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-red-400 ml-auto">&times;</button>
                      </div>
                    ))}
                    <div className="flex gap-2 mt-2">
                      <input placeholder="Name" value={newContact.name}
                        onChange={e => setNewContact({ ...newContact, name: e.target.value })}
                        className="cyber-input text-xs flex-1" />
                      <input placeholder="Email *" value={newContact.email}
                        onChange={e => setNewContact({ ...newContact, email: e.target.value })}
                        className="cyber-input text-xs flex-1" />
                      <input placeholder="Phone" value={newContact.phone}
                        onChange={e => setNewContact({ ...newContact, phone: e.target.value })}
                        className="cyber-input text-xs flex-[0.8]" />
                      <button onClick={() => {
                        if (!newContact.email) return
                        setEmergencyContacts([...emergencyContacts, { ...newContact }])
                        setNewContact({ name: '', email: '', phone: '' })
                      }}
                        disabled={!newContact.email}
                        className="text-xs px-3 py-1 rounded border border-green-700/30 text-green-400 hover:bg-green-700/10 disabled:opacity-30">
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Surrogates */}
                  <div>
                    <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">
                      Safety Surrogates (notified of expedition status)
                    </label>
                    {addedSurrogates.map(s => (
                      <div key={s.id} className="flex items-center gap-2 text-xs mb-1">
                        <span className="text-[var(--cyber-text)]">{s.username}</span>
                        <button onClick={() => setAddedSurrogates(prev => prev.filter(x => x.id !== s.id))}
                          className="text-red-400 ml-auto">&times;</button>
                      </div>
                    ))}
                    <div className="relative mt-2">
                      <input placeholder="Search users to add as surrogate..."
                        value={surrogateSearch}
                        onChange={e => setSurrogateSearch(e.target.value)}
                        className="cyber-input text-xs w-full" />
                      {surrogateResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]
                          rounded-xl overflow-hidden z-20 max-h-32 overflow-y-auto">
                          {surrogateResults.map(u => (
                            <button key={u.id} onClick={() => {
                              setAddedSurrogates(prev => [...prev, u])
                              setSurrogateSearch('')
                              setSurrogateResults([])
                            }}
                              className="w-full text-left px-3 py-2 text-xs text-[var(--cyber-text)] hover:bg-[var(--cyber-cyan)]/10">
                              {u.username}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && <p className="text-red-400 text-sm">{error}</p>}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose}
              className="cyber-btn cyber-btn-ghost px-5 py-2 text-sm">Cancel</button>
            <button onClick={handleSubmit} disabled={submitting || !name.trim() || !startDay}
              className="cyber-btn cyber-btn-cyan px-5 py-2 text-sm disabled:opacity-50">
              {submitting ? 'Saving...' : editEvent ? 'Save Changes' : 'Create Event'}
            </button>
          </div>
        </div>
      </div>

      {/* Fine Tune modal */}
      {showFineTune && (
        <FineTuneMapModal
          initialLat={parsedLat}
          initialLon={parsedLon}
          onConfirm={handleFineTune}
          onClose={() => setShowFineTune(false)}
        />
      )}
    </div>
  )
}
