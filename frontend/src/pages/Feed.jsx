import { useState } from 'react'
import { useApi } from '../hooks/useApi'

const ACTION_ICONS = {
  cave_created: '🏔️',
  photo_uploaded: '📸',
  comment_added: '💬',
  rating_posted: '⭐',
  description_edited: '📝',
  expedition_created: '⛏️',
  expedition_joined: '🤝',
  user_followed: '👤',
  reconstruction_completed: '🧊',
}

export default function Feed() {
  const [offset, setOffset] = useState(0)
  const limit = 20
  const { data, loading } = useApi(`/social/feed/?limit=${limit}&offset=${offset}`)

  const activities = data?.results ?? []
  const total = data?.total ?? 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Activity Feed</h1>

      {loading ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading...</p>
      ) : activities.length === 0 ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">No activity yet</p>
      ) : (
        <div className="space-y-3">
          {activities.map(a => (
            <div key={a.id} className="cyber-card p-4 flex items-start gap-3">
              <span className="text-xl mt-0.5">
                {ACTION_ICONS[a.action_type] || '📌'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm">{a.message}</p>
                <p className="text-xs text-[var(--cyber-text-dim)] mt-1">
                  {a.action_display} — {new Date(a.created_at).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex justify-center gap-3 mt-6">
          <button
            className="cyber-btn cyber-btn-ghost px-4 py-2 text-sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            Previous
          </button>
          <span className="text-sm text-[var(--cyber-text-dim)] self-center">
            {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <button
            className="cyber-btn cyber-btn-ghost px-4 py-2 text-sm"
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
