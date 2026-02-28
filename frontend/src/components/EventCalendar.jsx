import { useRef, useCallback } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'

const TYPE_COLORS = {
  expedition: '#00e5ff',
  survey: '#fbbf24',
  training: '#4ade80',
  education: '#a78bfa',
  outreach: '#fb923c',
  conservation: '#34d399',
  social: '#f472b6',
  other: '#94a3b8',
}

export default function EventCalendar({ events = [], onEventClick, onDateRangeChange }) {
  const calRef = useRef(null)

  const handleDatesSet = useCallback((info) => {
    onDateRangeChange?.(
      info.startStr.slice(0, 10),
      info.endStr.slice(0, 10),
    )
  }, [onDateRangeChange])

  const handleEventClick = useCallback((info) => {
    onEventClick?.(info.event.id)
  }, [onEventClick])

  const calendarEvents = events.map(e => ({
    id: e.id,
    title: e.name,
    start: e.start_date,
    end: e.end_date || undefined,
    allDay: e.all_day,
    backgroundColor: TYPE_COLORS[e.event_type] || TYPE_COLORS.other,
    textColor: '#0a0a12',
    borderColor: 'transparent',
  }))

  return (
    <div className="rounded-xl border border-[var(--cyber-border)] bg-[var(--cyber-surface)] p-3 overflow-hidden">
      <FullCalendar
        ref={calRef}
        plugins={[dayGridPlugin, listPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,listMonth',
        }}
        events={calendarEvents}
        datesSet={handleDatesSet}
        eventClick={handleEventClick}
        height="auto"
        dayMaxEvents={3}
        eventDisplay="block"
        fixedWeekCount={false}
      />
    </div>
  )
}

export { TYPE_COLORS }
