import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../hooks/useApi'
import EventCalendar from '../components/EventCalendar'
import EventCard from '../components/EventCard'
import EventCreateModal from '../components/EventCreateModal'

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
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [dateRange, setDateRange] = useState({ start: null, end: null })

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
  }, [fetchEvents])

  const handleEventCreated = () => {
    setShowCreate(false)
    fetchEvents()
    if (dateRange.start && dateRange.end) {
      fetchCalendarEvents(dateRange.start, dateRange.end)
    }
  }

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

      {/* Upcoming events */}
      <h2 className="text-lg font-semibold mb-4">Upcoming Events</h2>
      {loading ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading...</p>
      ) : events.length === 0 ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">
          No upcoming events
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {events.map(event => (
            <EventCard
              key={event.id}
              event={event}
              onRsvpChange={fetchEvents}
            />
          ))}
        </div>
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
