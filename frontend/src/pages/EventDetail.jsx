import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { apiFetch } from '../hooks/useApi'
import useAuthStore from '../stores/authStore'
import { TYPE_COLORS } from '../components/EventCalendar'
import AvatarDisplay from '../components/AvatarDisplay'
import EventComments from '../components/EventComments'
import EventCreateModal from '../components/EventCreateModal'
import EventInviteModal from '../components/EventInviteModal'
import ExpeditionTrackingPanel from '../components/ExpeditionTrackingPanel'
import L from 'leaflet'
import MyLocationButton from '../components/maptools/MyLocationButton'
import 'leaflet/dist/leaflet.css'

function formatDate(dateStr, allDay) {
  const d = new Date(dateStr)
  if (allDay) return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) +
    ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function EventDetail() {
  const { eventId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [event, setEvent] = useState(null)
  const [rsvps, setRsvps] = useState([])
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)
  const [showInvite, setShowInvite] = useState(false)

  const fetchEvent = useCallback(async () => {
    try {
      const data = await apiFetch(`/events/${eventId}/`)
      setEvent(data)
    } catch (err) {
      console.error('Failed to fetch event:', err)
    } finally {
      setLoading(false)
    }
  }, [eventId])

  const fetchRsvps = useCallback(async () => {
    try {
      const data = await apiFetch(`/events/${eventId}/rsvps/`)
      setRsvps(data)
    } catch (err) {
      console.error('Failed to fetch RSVPs:', err)
    }
  }, [eventId])

  useEffect(() => {
    fetchEvent()
    fetchRsvps()
  }, [fetchEvent, fetchRsvps])

  const handleRsvp = async (status) => {
    try {
      if (event.user_rsvp === status) {
        await apiFetch(`/events/${eventId}/rsvp/`, { method: 'DELETE' })
      } else {
        await apiFetch(`/events/${eventId}/rsvp/`, { method: 'POST', body: { status } })
      }
      fetchEvent()
      fetchRsvps()
    } catch (err) {
      console.error('RSVP failed:', err)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this event? This will also delete the event chat channel. This cannot be undone.')) return
    try {
      await apiFetch(`/events/${eventId}/`, { method: 'DELETE' })
      navigate('/events')
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[var(--cyber-text-dim)]">Loading...</p>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <p className="text-[var(--cyber-text-dim)]">Event not found</p>
        <Link to="/events" className="text-[var(--cyber-cyan)] text-sm mt-2 inline-block">Back to Events</Link>
      </div>
    )
  }

  const color = TYPE_COLORS[event.event_type] || TYPE_COLORS.other
  const isCreator = user?.id === event.created_by
  const isAdmin = user?.is_staff
  const canEdit = isCreator || isAdmin

  const goingRsvps = rsvps.filter(r => r.status === 'going')

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Back link */}
      <Link to="/events" className="text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] mb-4 inline-block">
        &larr; Back to Events
      </Link>

      {/* Header */}
      <div className="cyber-card p-6 mb-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium capitalize"
                style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
                {event.event_type}
              </span>
              {event.status === 'cancelled' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-700/30">
                  Cancelled
                </span>
              )}
              {event.visibility !== 'public' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400 border border-purple-700/30 capitalize">
                  {event.visibility.replace('_', ' ')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">{event.name}</h1>
              {/* Chat channel link */}
              {event.chat_channel && (
                <Link
                  to={`/chat/${event.chat_channel}`}
                  className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full no-underline transition-all
                    bg-[var(--cyber-surface-2)] text-[var(--cyber-cyan)] border border-[var(--cyber-cyan)]/30
                    hover:bg-[var(--cyber-cyan)]/10 hover:border-[var(--cyber-cyan)]"
                  title="Event discussion chat"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  Chat
                </Link>
              )}
            </div>
          </div>
          {canEdit && (
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => setShowEdit(true)}
                className="cyber-btn cyber-btn-ghost px-3 py-1.5 text-xs">Edit</button>
              <button onClick={handleDelete}
                className="cyber-btn px-3 py-1.5 text-xs bg-red-900/30 text-red-400 border border-red-700/30
                  hover:bg-red-900/50 rounded-full">Delete</button>
            </div>
          )}
        </div>

        {/* Date */}
        <div className="text-sm text-[var(--cyber-text-dim)] mb-1">
          {formatDate(event.start_date, event.all_day)}
          {event.end_date && (
            <span> &mdash; {formatDate(event.end_date, event.all_day)}</span>
          )}
        </div>

        {/* Location */}
        {(event.cave_name || event.address || event.google_maps_link) && (
          <div className="text-sm mt-2 space-y-0.5">
            {event.cave_name && (
              <div>
                <Link to={`/caves/${event.cave}`} className="text-[var(--cyber-cyan)] hover:underline">
                  {event.cave_name}
                </Link>
              </div>
            )}
            {event.address && <div className="text-[var(--cyber-text-dim)]">{event.address}</div>}
            {event.google_maps_link && (
              <a href={event.google_maps_link} target="_blank" rel="noopener noreferrer"
                className="text-[var(--cyber-cyan)] text-xs hover:underline inline-block">
                Open in Google Maps &rarr;
              </a>
            )}
          </div>
        )}

        {/* Organizer */}
        <div className="text-xs text-[var(--cyber-text-dim)] mt-3">
          Organized by <span className="text-[var(--cyber-text)]">{event.creator_username}</span>
          {event.grotto_name && <span> &middot; {event.grotto_name}</span>}
          {event.poc_username && event.poc_username !== event.creator_username && (
            <span> &middot; Contact: <span className="text-[var(--cyber-text)]">{event.poc_username}</span></span>
          )}
        </div>
      </div>

      {/* Location map + meetup instructions */}
      {(event.latitude || event.meetup_instructions) && (
        <div className="cyber-card p-5 mb-6">
          <h3 className="text-sm font-semibold mb-3">Location & Meetup</h3>
          {event.latitude && event.longitude && (
            <div className="rounded-lg overflow-hidden border border-[var(--cyber-border)] mb-3" style={{ height: 220 }}>
              <EventMiniMap lat={event.latitude} lng={event.longitude} />
            </div>
          )}
          {event.meetup_instructions && (
            <div className="text-sm text-[var(--cyber-text-dim)] whitespace-pre-wrap">
              {event.meetup_instructions}
            </div>
          )}
        </div>
      )}

      {/* RSVP */}
      <div className="cyber-card p-5 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm font-semibold">RSVP</span>
          {event.is_full && event.user_rsvp !== 'going' ? (
            <>
              <span className="text-xs px-4 py-1.5 rounded-full bg-red-900/20 text-red-400 border border-red-700/20">
                Event is full
              </span>
              <button
                onClick={() => handleRsvp('not_going')}
                className={`text-xs px-4 py-1.5 rounded-full transition-all capitalize ${
                  event.user_rsvp === 'not_going'
                    ? 'bg-[var(--cyber-cyan)] text-[var(--cyber-bg)] font-semibold'
                    : 'bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] hover:border-[var(--cyber-cyan)] hover:text-[var(--cyber-cyan)]'
                }`}
              >
                not going{event.user_rsvp === 'not_going' ? ' \u2713' : ''}
              </button>
            </>
          ) : (
            ['going', 'not_going'].map(status => (
              <button
                key={status}
                onClick={() => handleRsvp(status)}
                className={`text-xs px-4 py-1.5 rounded-full transition-all capitalize ${
                  event.user_rsvp === status
                    ? 'bg-[var(--cyber-cyan)] text-[var(--cyber-bg)] font-semibold'
                    : 'bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] hover:border-[var(--cyber-cyan)] hover:text-[var(--cyber-cyan)]'
                }`}
              >
                {status.replace('_', ' ')}{event.user_rsvp === status ? ' \u2713' : ''}
              </button>
            ))
          )}
        </div>

        {/* Going header */}
        <div className="flex items-center justify-between mb-3 border-b border-[var(--cyber-border)] pb-2">
          <span className="text-xs text-[var(--cyber-cyan)] font-medium">
            Going ({goingRsvps.length})
          </span>
          {event.visibility === 'private' && canEdit && (
            <button onClick={() => setShowInvite(true)}
              className="text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]">
              + Invite
            </button>
          )}
        </div>

        {/* Attendee list with avatars and linked profiles */}
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {goingRsvps.map(r => (
            <Link key={r.id} to={`/users/${r.user}`}
              className="flex items-center gap-2.5 no-underline hover:bg-[var(--cyber-surface-2)] rounded-lg px-2 py-1.5 -mx-2 transition-colors">
              <AvatarDisplay
                user={{ username: r.username, avatar: r.avatar, avatar_preset: r.avatar_preset }}
                size="w-7 h-7"
                textSize="text-[10px]"
              />
              <span className="text-sm text-[var(--cyber-text)] hover:text-[var(--cyber-cyan)] transition-colors">
                {r.username}
              </span>
            </Link>
          ))}
          {goingRsvps.length === 0 && (
            <p className="text-xs text-[var(--cyber-text-dim)] text-center py-2">No one yet</p>
          )}
        </div>

        {event.max_participants && (
          <div className="text-xs text-[var(--cyber-text-dim)] mt-3 pt-2 border-t border-[var(--cyber-border)]">
            Capacity: {event.going_count}/{event.max_participants}
          </div>
        )}
      </div>

      {/* Expedition Safety Tracking */}
      <ExpeditionTrackingPanel event={event} rsvps={rsvps} />

      {/* Description */}
      {event.description && (
        <div className="cyber-card p-5 mb-6">
          <h3 className="text-sm font-semibold mb-3">Description</h3>
          <div className="prose-cave" dangerouslySetInnerHTML={{ __html: markdownToSimpleHtml(event.description) }} />
        </div>
      )}

      {/* Required equipment */}
      {event.required_equipment && (
        <div className="cyber-card p-5 mb-6">
          <h3 className="text-sm font-semibold mb-2">Required Equipment</h3>
          <p className="text-sm text-[var(--cyber-text-dim)] whitespace-pre-wrap">{event.required_equipment}</p>
        </div>
      )}

      {/* Comments */}
      <div className="cyber-card p-5 mb-6">
        <EventComments eventId={eventId} />
      </div>

      {/* Edit modal */}
      {showEdit && (
        <EventCreateModal
          editEvent={event}
          onClose={() => setShowEdit(false)}
          onCreated={() => { setShowEdit(false); fetchEvent() }}
        />
      )}

      {/* Invite modal */}
      {showInvite && (
        <EventInviteModal
          eventId={eventId}
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  )
}

function EventMiniMap({ lat, lng }) {
  const mapRef = useRef(null)
  const containerRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      center: [lat, lng],
      zoom: 15,
      zoomControl: true,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false,
    })

    // Dark labeled road map (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map)

    // Center control button
    const CenterControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const btn = L.DomUtil.create('div', 'leaflet-bar leaflet-control')
        btn.innerHTML = `<a href="#" title="Center on location" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;background:var(--cyber-surface);color:var(--cyber-cyan);font-size:16px;text-decoration:none;border:1px solid var(--cyber-border);">&#8982;</a>`
        btn.querySelector('a').addEventListener('click', (e) => {
          e.preventDefault()
          map.setView([lat, lng], 15)
        })
        return btn
      },
    })
    map.addControl(new CenterControl())

    L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="width:14px;height:14px;border-radius:50%;background:var(--cyber-cyan);border:2px solid #fff;box-shadow:0 0 8px var(--cyber-cyan)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    }).addTo(map)
    mapRef.current = map
    setMapReady(true)
    return () => { map.remove(); mapRef.current = null; setMapReady(false) }
  }, [lat, lng])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {mapReady && (
        <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 1100 }}>
          <MyLocationButton map={mapRef.current} homeCenter={[lat, lng]} />
        </div>
      )}
    </div>
  )
}

/**
 * Simple markdown -> HTML for rendering descriptions.
 */
function markdownToSimpleHtml(md) {
  if (!md) return ''
  let html = md
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  html = html.replace(/\n\n/g, '</p><p>')
  html = html.replace(/\n/g, '<br>')
  html = `<p>${html}</p>`
  return html
}
