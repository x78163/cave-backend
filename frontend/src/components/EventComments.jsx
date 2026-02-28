import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../hooks/useApi'
import useAuthStore from '../stores/authStore'

export default function EventComments({ eventId }) {
  const { user } = useAuthStore()
  const [comments, setComments] = useState([])
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchComments = useCallback(async () => {
    try {
      const data = await apiFetch(`/events/${eventId}/comments/`)
      setComments(data)
    } catch (err) {
      console.error('Failed to fetch comments:', err)
    }
  }, [eventId])

  useEffect(() => {
    fetchComments()
  }, [fetchComments])

  const handleSubmit = async () => {
    if (!text.trim() || submitting) return
    setSubmitting(true)
    try {
      await apiFetch(`/events/${eventId}/comments/`, {
        method: 'POST',
        body: { text: text.trim() },
      })
      setText('')
      fetchComments()
    } catch (err) {
      console.error('Failed to post comment:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (commentId) => {
    try {
      await apiFetch(`/events/${eventId}/comments/${commentId}/`, { method: 'DELETE' })
      fetchComments()
    } catch (err) {
      console.error('Failed to delete comment:', err)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">Comments ({comments.length})</h3>

      {/* Comment input */}
      <div className="flex gap-2 mb-4">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a comment..."
          className="cyber-textarea flex-1 px-3 py-2 text-sm min-h-[40px] resize-none"
          rows={1}
        />
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || submitting}
          className="cyber-btn cyber-btn-cyan px-4 py-2 text-sm self-end disabled:opacity-50"
        >
          Post
        </button>
      </div>

      {/* Comment list */}
      <div className="space-y-3">
        {comments.map(c => (
          <div key={c.id} className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]
              flex items-center justify-center text-xs text-[var(--cyber-text-dim)] flex-shrink-0 mt-0.5">
              {c.author_username?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-[var(--cyber-cyan)]">{c.author_username}</span>
                <span className="text-[10px] text-[var(--cyber-text-dim)]">
                  {new Date(c.created_at).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                </span>
                {(c.author === user?.id || user?.is_staff) && (
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="text-[10px] text-[var(--cyber-text-dim)] hover:text-red-400 ml-auto"
                  >
                    delete
                  </button>
                )}
              </div>
              <p className="text-sm text-[var(--cyber-text)] mt-0.5 whitespace-pre-wrap">{c.text}</p>
            </div>
          </div>
        ))}
        {comments.length === 0 && (
          <p className="text-sm text-[var(--cyber-text-dim)] text-center py-4">No comments yet</p>
        )}
      </div>
    </div>
  )
}
