import { create } from 'zustand'
import { apiFetch } from '../hooks/useApi'

const GPS_PUSH_INTERVAL = 5 * 60 * 1000 // 5 minutes
const STATUS_POLL_INTERVAL = 30 * 1000   // 30 seconds

const useExpeditionStore = create((set, get) => ({
  // GPS tracking state
  activeEventId: null,
  watchId: null,
  gpsInterval: null,
  lastPosition: null,
  gpsError: null,

  // Status polling
  pollingInterval: null,

  // GPS trail data (for map display)
  gpsTrail: [], // [{ user, username, latitude, longitude, recorded_at }]

  /**
   * Start GPS tracking for an expedition.
   * Begins watchPosition + periodic POST to server.
   */
  startGPSTracking: (eventId) => {
    const state = get()
    if (state.activeEventId === eventId) return // already tracking

    // Stop any existing tracking
    get().stopGPSTracking()

    if (!navigator.geolocation) {
      set({ gpsError: 'Geolocation not supported' })
      return
    }

    // Start watching position
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        set({
          lastPosition: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
          },
          gpsError: null,
        })
      },
      (error) => {
        set({ gpsError: error.message })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    )

    // Push GPS position every 5 minutes
    const pushGPS = async () => {
      const { lastPosition, activeEventId } = get()
      if (!lastPosition || !activeEventId) return
      if (document.hidden) return // Skip if tab is hidden

      try {
        await apiFetch(`/events/${activeEventId}/tracking/gps/`, {
          method: 'POST',
          body: lastPosition,
        })
      } catch (err) {
        console.error('GPS push failed:', err)
      }
    }

    // Push immediately, then every 5 minutes
    const gpsInterval = setInterval(pushGPS, GPS_PUSH_INTERVAL)
    // Delay initial push by 5 seconds to let watchPosition settle
    setTimeout(pushGPS, 5000)

    set({ activeEventId: eventId, watchId, gpsInterval })

    // Handle page visibility changes
    const handleVisibility = () => {
      if (!document.hidden) {
        // Tab became visible — push position immediately
        pushGPS()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    set({ _visibilityHandler: handleVisibility })
  },

  /**
   * Stop GPS tracking.
   */
  stopGPSTracking: () => {
    const state = get()
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId)
    }
    if (state.gpsInterval) {
      clearInterval(state.gpsInterval)
    }
    if (state._visibilityHandler) {
      document.removeEventListener('visibilitychange', state._visibilityHandler)
    }
    set({
      activeEventId: null,
      watchId: null,
      gpsInterval: null,
      lastPosition: null,
      gpsError: null,
      _visibilityHandler: null,
    })
  },

  /**
   * Fetch GPS trail for an expedition (for map display).
   */
  fetchGPSTrail: async (eventId) => {
    try {
      const data = await apiFetch(`/events/${eventId}/tracking/gps/trail/`)
      set({ gpsTrail: data })
    } catch {
      set({ gpsTrail: [] })
    }
  },

  /**
   * Start polling tracking status (for live map refresh).
   */
  startPolling: (eventId, callback) => {
    get().stopPolling()
    const poll = async () => {
      try {
        const data = await apiFetch(`/events/${eventId}/tracking/`)
        callback?.(data)
      } catch { /* ignore */ }
      // Also refresh GPS trail
      get().fetchGPSTrail(eventId)
    }
    poll() // immediate
    const interval = setInterval(poll, STATUS_POLL_INTERVAL)
    set({ pollingInterval: interval })
  },

  /**
   * Stop status polling.
   */
  stopPolling: () => {
    const { pollingInterval } = get()
    if (pollingInterval) clearInterval(pollingInterval)
    set({ pollingInterval: null })
  },
}))

export default useExpeditionStore
