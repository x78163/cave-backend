import { useState, useCallback, useEffect, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../hooks/useApi'
import EventCalendar from '../components/EventCalendar'
import EventCard from '../components/EventCard'
import EventCreateModal from '../components/EventCreateModal'

const LiveExpeditionsTab = lazy(() => import('../components/LiveExpeditionsTab'))

const ACTIVE_TRACKING_STATES = ['active', 'underground', 'surfaced', 'overdue', 'alert_sent', 'emergency_sent']

const EVENT_TYPES = [
  { value: '', label: 'All' },
  { value: 'expedition', label: 'Expedition' },
  { value: 'survey', label: 'Survey' },
  { value: 'training', label: 'Training' },
  { value: 'education', label: 'Education' },
  { value: 'outreach', label: 'Outreach' },
  { value: 'conservation', label: 'Conservation' },
  { value: 'social', label: 'Social' },
  { value: 'other', label: 'Other' },
]

export default function Events() {
  const navigate = useNavigate()
  const [typeFilter, setTypeFilter] = useState('')
  const [calendarEvents, setCalendarEvents] = useState([])
  const [events, setEvents] = useState([])
  const [liveExpeditions, setLiveExpeditions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [dateRange, setDateRange] = useState({ start: null, end: null })
  const [activeTab, setActiveTab] = useState('calendar') // 'calendar' | 'live'

  // Fetch calendar events when date range changes
  const fetchCalendarEvents = useCallback(async (start, end) => {
    try {
      const params = new URLSearchParams()
      if (start) params.set('start', start)
      if (end) params.set('end', end)
      const data = await apiFetch(`/events/calendar/?${params}`)
      setCalendarEvents(data)
    } catch (err) {
      console.error('Failed to fetch calendar events:', err)
    }
  }, [])

  const handleDateRangeChange = useCallback((start, end) => {
    setDateRange({ start, end })
    fetchCalendarEvents(start, end)
  }, [fetchCalendarEvents])

  // Fetch live expeditions for the ongoing section
  const fetchLiveExpeditions = useCallback(async () => {
    try {
      const data = await apiFetch('/events/live/')
      setLiveExpeditions(data || [])
    } catch {
      setLiveExpeditions([])
    }
  }, [])

  // Fetch event cards (upcoming, filtered)
  const fetchEvents = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (typeFilter) params.set('type', typeFilter)
      // Show upcoming events from today
      params.set('start', new Date().toISOString().slice(0, 10))
      const data = await apiFetch(`/events/?${params}`)
      setEvents(data)
    } catch (err) {
      console.error('Failed to fetch events:', err)
    } finally {
      setLoading(false)
    }
  }, [typeFilter])

  useEffect(() => {
    fetchEvents()
    fetchLiveExpeditions()
  }, [fetchEvents, fetchLiveExpeditions])

  // Poll live expeditions every 30s when on calendar tab
  useEffect(() => {
    if (activeTab !== 'calendar') return
    const interval = setInterval(fetchLiveExpeditions, 30000)
    return () => clearInterval(interval)
  }, [activeTab, fetchLiveExpeditions])

  const handleEventCreated = () => {
    setShowCreate(false)
    fetchEvents()
    fetchLiveExpeditions()
    if (dateRange.start && dateRange.end) {
      fetchCalendarEvents(dateRange.start, dateRange.end)
    }
  }

  // Filter out events that are actively being tracked from the upcoming list
  const liveEventIds = new Set(liveExpeditions.map(e => e.event))
  const upcomingEvents = events.filter(e => !liveEventIds.has(e.id))

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Events</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="cyber-btn cyber-btn-cyan px-4 py-2 text-sm"
        >
          + Create Event
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-[var(--cyber-border)]">
        <button
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'calendar'
              ? 'border-[var(--cyber-cyan)] text-[var(--cyber-cyan)]'
              : 'border-transparent text-[var(--cyber-text-dim)] hover:text-[var(--cyber-text)]'
          }`}
          onClick={() => setActiveTab('calendar')}
        >
          Calendar
        </button>
        <button
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'live'
              ? 'border-green-400 text-green-400'
              : 'border-transparent text-[var(--cyber-text-dim)] hover:text-[var(--cyber-text)]'
          }`}
          onClick={() => setActiveTab('live')}
        >
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Live Expeditions
        </button>
      </div>

      {/* Live Expeditions tab */}
      {activeTab === 'live' && (
        <Suspense fallback={<div className="text-center py-12 text-[var(--cyber-text-dim)]">Loading...</div>}>
          <LiveExpeditionsTab />
        </Suspense>
      )}

      {/* Calendar tab content */}
      {activeTab === 'calendar' && (
        <>
          {/* Type filters */}
          <div className="flex gap-2 mb-6 flex-wrap">
            {EVENT_TYPES.map(t => (
              <button
                key={t.value}
                className={`cyber-btn px-3 py-1.5 text-sm ${
                  typeFilter === t.value ? 'cyber-btn-cyan' : 'cyber-btn-ghost'
                }`}
                onClick={() => setTypeFilter(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Calendar */}
          <div className="mb-8">
            <EventCalendar
              events={typeFilter ? calendarEvents.filter(e => e.event_type === typeFilter) : calendarEvents}
              onEventClick={(id) => navigate(`/events/${id}`)}
              onDateRangeChange={handleDateRangeChange}
            />
          </div>

          {/* Ongoing Expeditions */}
          {liveExpeditions.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                Ongoing Expeditions
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {liveExpeditions.map(exp => (
                  <EventCard
                    key={exp.id}
                    event={{
                      id: exp.event,
                      name: exp.event_name,
                      event_type: exp.event_type || 'expedition',
                      cave_name: exp.cave_name,
                      start_date: exp.started_at || new Date().toISOString(),
                      going_count: exp.rsvp_count,
                    }}
                    tracking={exp}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Upcoming events */}
          <h2 className="text-lg font-semibold mb-4">Upcoming Events</h2>
          {loading ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading...</p>
          ) : upcomingEvents.length === 0 ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-12">
              No upcoming events
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {upcomingEvents.map(event => (
                <EventCard
                  key={event.id}
                  event={event}
                  onRsvpChange={fetchEvents}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Create modal */}
      {showCreate && (
        <EventCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={handleEventCreated}
        />
      )}
    </div>
  )
}
