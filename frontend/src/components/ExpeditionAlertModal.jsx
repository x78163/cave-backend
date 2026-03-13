import { useNavigate } from 'react-router-dom'
import useExpeditionStore from '../stores/expeditionStore'
import { apiFetch } from '../hooks/useApi'
import { useState } from 'react'

const ALERT_CONFIGS = {
  // Surrogate alerts
  expedition_surrogate_added: {
    title: 'Safety Surrogate Designation',
    icon: '🛡',
    border: 'border-cyan-500',
    bg: 'from-cyan-900/40 to-[var(--cyber-surface)]',
    getMessage: (a) => (
      <>
        <strong>{a.leader_name}</strong> has designated you as a <strong>safety surrogate</strong> for
        expedition <strong className="text-[var(--cyber-cyan)]">{a.event_name}</strong>.
        <p className="mt-3 text-xs text-[var(--cyber-text-dim)]">
          You will be notified if the expedition becomes overdue.
          As a surrogate, you can trigger an emergency alert to the expedition's emergency contacts.
        </p>
      </>
    ),
  },
  // Expedition started (surrogate)
  active_surrogate: {
    title: 'Expedition Started',
    icon: '🚀',
    border: 'border-green-500',
    bg: 'from-green-900/30 to-[var(--cyber-surface)]',
    getMessage: (a) => (
      <>
        Expedition <strong className="text-green-400">{a.event_name}</strong> has started.
        You are a safety surrogate for this expedition.
      </>
    ),
  },
  // Overdue (surrogate)
  overdue_surrogate: {
    title: 'EXPEDITION OVERDUE',
    icon: '⚠',
    border: 'border-red-500 animate-pulse',
    bg: 'from-red-900/40 to-[var(--cyber-surface)]',
    getMessage: (a) => (
      <>
        Expedition <strong className="text-red-400">{a.event_name}</strong> is <strong className="text-red-400">OVERDUE</strong>.
        The party has not returned by the expected time.
        <p className="mt-3 text-xs text-red-300">
          Monitor the situation. If you believe the party is in danger, you can trigger an emergency alert.
        </p>
      </>
    ),
  },
  alert_sent_surrogate: {
    title: 'SURROGATE ALERT ACTIVE',
    icon: '🚨',
    border: 'border-red-600 animate-pulse',
    bg: 'from-red-900/50 to-[var(--cyber-surface)]',
    getMessage: (a) => (
      <>
        <strong className="text-red-500">ALERT:</strong> Expedition{' '}
        <strong className="text-red-400">{a.event_name}</strong> is overdue and surrogates have been alerted.
        <p className="mt-3 text-xs text-red-300">
          Check the expedition page for live status. Consider triggering an emergency alert if the party is unreachable.
        </p>
      </>
    ),
  },
  emergency_sent_surrogate: {
    title: 'EMERGENCY ALERT SENT',
    icon: '🆘',
    border: 'border-red-600 animate-pulse',
    bg: 'from-red-900/60 to-[var(--cyber-surface)]',
    getMessage: (a) => (
      <>
        <strong className="text-red-500">EMERGENCY:</strong> Emergency contacts have been notified for{' '}
        <strong className="text-red-400">{a.event_name}</strong>.
        <p className="mt-3 text-xs text-red-300">
          Emergency services or designated contacts are being alerted. Continue monitoring.
        </p>
      </>
    ),
  },
  // Expedition ended (surrogate)
  completed_surrogate: {
    title: 'Expedition Complete',
    icon: '✅',
    border: 'border-green-500',
    bg: 'from-green-900/30 to-[var(--cyber-surface)]',
    getMessage: (a) => (
      <>
        Expedition <strong className="text-green-400">{a.event_name}</strong> has been completed.
        All members accounted for.
      </>
    ),
  },
  resolved_surrogate: {
    title: 'Emergency Resolved',
    icon: '✅',
    border: 'border-green-500',
    bg: 'from-green-900/30 to-[var(--cyber-surface)]',
    getMessage: (a) => (
      <>
        The emergency for <strong className="text-green-400">{a.event_name}</strong> has been resolved.
      </>
    ),
  },

  // Leader alerts
  overdue_leader: {
    title: 'YOUR EXPEDITION IS OVERDUE',
    icon: '⏰',
    border: 'border-red-500 animate-pulse',
    bg: 'from-red-900/50 to-[var(--cyber-surface)]',
    getMessage: (a) => (
      <>
        Your expedition <strong className="text-red-400">{a.event_name}</strong> has exceeded the expected return time.
        <p className="mt-3 text-sm text-amber-300">
          Your surrogates are being notified. Please take action:
        </p>
      </>
    ),
    showLeaderActions: true,
  },
  alert_sent_leader: {
    title: 'SURROGATES HAVE BEEN ALERTED',
    icon: '🚨',
    border: 'border-red-600 animate-pulse',
    bg: 'from-red-900/50 to-[var(--cyber-surface)]',
    getMessage: (a) => (
      <>
        Your surrogates have been alerted that expedition <strong className="text-red-400">{a.event_name}</strong> is overdue.
        <p className="mt-3 text-sm text-amber-300">
          If you are safe, extend the time or complete the expedition to prevent emergency escalation.
        </p>
      </>
    ),
    showLeaderActions: true,
  },
  emergency_sent_leader: {
    title: 'EMERGENCY CONTACTS NOTIFIED',
    icon: '🆘',
    border: 'border-red-600 animate-pulse',
    bg: 'from-red-900/60 to-[var(--cyber-surface)]',
    getMessage: (a) => (
      <>
        <strong className="text-red-500">Emergency contacts have been notified</strong> for{' '}
        <strong className="text-red-400">{a.event_name}</strong>.
        <p className="mt-3 text-sm text-amber-300">
          If your party is safe, please complete or resolve the expedition immediately.
        </p>
      </>
    ),
    showLeaderActions: true,
  },
}

function getAlertKey(alert) {
  if (alert.type === 'expedition_surrogate_added') return 'expedition_surrogate_added'
  const state = alert.state
  const role = alert.role || 'surrogate'
  return `${state}_${role}`
}

export default function ExpeditionAlertModal() {
  const alertQueue = useExpeditionStore(state => state.alertQueue)
  const dismissAlert = useExpeditionStore(state => state.dismissAlert)
  const navigate = useNavigate()
  const [extendLoading, setExtendLoading] = useState(false)
  const [completeLoading, setCompleteLoading] = useState(false)

  if (alertQueue.length === 0) return null

  // Show the first alert in the queue
  const alert = alertQueue[0]
  const key = getAlertKey(alert)
  const config = ALERT_CONFIGS[key]

  if (!config) {
    // Unknown alert type — dismiss silently
    dismissAlert(alert.id)
    return null
  }

  const handleAcknowledge = () => {
    dismissAlert(alert.id)
  }

  const handleAcknowledgeAndView = () => {
    dismissAlert(alert.id)
    navigate(`/events/${alert.event_id}`)
  }

  const handleExtend = async (minutes) => {
    setExtendLoading(true)
    try {
      await apiFetch(`/events/${alert.event_id}/tracking/extend/`, {
        method: 'POST',
        body: { minutes },
      })
      dismissAlert(alert.id)
    } catch (err) {
      console.error('Failed to extend:', err)
    } finally {
      setExtendLoading(false)
    }
  }

  const handleComplete = async () => {
    setCompleteLoading(true)
    try {
      await apiFetch(`/events/${alert.event_id}/tracking/complete/`, {
        method: 'POST',
      })
      dismissAlert(alert.id)
    } catch (err) {
      console.error('Failed to complete:', err)
    } finally {
      setCompleteLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className={`max-w-md w-full mx-4 rounded-xl border-2 ${config.border} bg-gradient-to-b ${config.bg} shadow-2xl`}>
        {/* Header */}
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="text-4xl mb-3">{config.icon}</div>
          <h2 className="text-lg font-bold text-[var(--cyber-text)] tracking-wide uppercase">
            {config.title}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 pb-4 text-sm text-[var(--cyber-text)]">
          {config.getMessage(alert)}
        </div>

        {/* Alert count badge */}
        {alertQueue.length > 1 && (
          <div className="px-6 pb-2">
            <span className="text-[10px] text-[var(--cyber-text-dim)] bg-[var(--cyber-surface-2)] px-2 py-0.5 rounded-full">
              +{alertQueue.length - 1} more alert{alertQueue.length > 2 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Leader action buttons (extend/complete) */}
        {config.showLeaderActions && (
          <div className="px-6 pb-3">
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => handleExtend(30)}
                disabled={extendLoading}
                className="flex-1 px-3 py-2 text-xs font-semibold rounded-lg bg-amber-600/30 border border-amber-500/50 text-amber-300 hover:bg-amber-600/50 transition-colors disabled:opacity-50"
              >
                Extend 30 min
              </button>
              <button
                onClick={() => handleExtend(60)}
                disabled={extendLoading}
                className="flex-1 px-3 py-2 text-xs font-semibold rounded-lg bg-amber-600/30 border border-amber-500/50 text-amber-300 hover:bg-amber-600/50 transition-colors disabled:opacity-50"
              >
                Extend 1 hr
              </button>
              <button
                onClick={handleComplete}
                disabled={completeLoading}
                className="flex-1 px-3 py-2 text-xs font-semibold rounded-lg bg-green-600/30 border border-green-500/50 text-green-300 hover:bg-green-600/50 transition-colors disabled:opacity-50"
              >
                {completeLoading ? 'Completing...' : 'Complete Expedition'}
              </button>
            </div>
          </div>
        )}

        {/* Standard action buttons */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={handleAcknowledge}
            className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)] text-[var(--cyber-text)] hover:bg-[var(--cyber-surface-3)] transition-colors"
          >
            Acknowledge
          </button>
          <button
            onClick={handleAcknowledgeAndView}
            className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg bg-[var(--cyber-cyan)]/20 border border-[var(--cyber-cyan)]/50 text-[var(--cyber-cyan)] hover:bg-[var(--cyber-cyan)]/30 transition-colors"
          >
            View Expedition
          </button>
        </div>
      </div>
    </div>
  )
}
