import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../hooks/useApi'

function timeAgo(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function PostCard({ post, currentUserId, onReact, onDelete }) {
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchComments = useCallback(async () => {
    setLoadingComments(true)
    try {
      const data = await apiFetch(`/social/posts/${post.id}/comments/`)
      setComments(Array.isArray(data) ? data : [])
    } catch { /* ignore */ }
    setLoadingComments(false)
  }, [post.id])

  const toggleComments = () => {
    if (!showComments) fetchComments()
    setShowComments(s => !s)
  }

  const handleReact = async (type) => {
    try {
      if (post.user_reaction === type) {
        await apiFetch(`/social/posts/${post.id}/react/`, { method: 'DELETE' })
      } else {
        await apiFetch(`/social/posts/${post.id}/react/`, {
          method: 'POST',
          body: JSON.stringify({ reaction_type: type }),
        })
      }
      onReact?.()
    } catch { /* ignore */ }
  }

  const handleComment = async (e) => {
    e.preventDefault()
    if (!commentText.trim()) return
    setSubmitting(true)
    try {
      await apiFetch(`/social/posts/${post.id}/comments/`, {
        method: 'POST',
        body: JSON.stringify({ text: commentText.trim() }),
      })
      setCommentText('')
      fetchComments()
      onReact?.() // refresh counts
    } catch { /* ignore */ }
    setSubmitting(false)
  }

  const initials = (post.author_username || '??')
    .split('_').map(w => w[0]?.toUpperCase()).join('').slice(0, 2)

  return (
    <div className="cyber-card p-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
          style={{ background: 'var(--cyber-surface)', color: 'var(--cyber-cyan)', border: '1.5px solid var(--cyber-cyan)' }}
        >
          {initials}
        </div>
        <div className="min-w-0">
          <span className="font-semibold text-[var(--cyber-text)] text-sm">{post.author_username}</span>
          <span className="text-xs text-[var(--cyber-text-dim)] ml-2">{timeAgo(post.created_at)}</span>
        </div>
        {post.visibility !== 'public' && (
          <span
            className="cyber-badge ml-auto text-[10px]"
            style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}
          >
            {post.visibility}
          </span>
        )}
      </div>

      {/* Body */}
      <p className="mt-3 text-sm text-[var(--cyber-text)] whitespace-pre-line">{post.text}</p>

      {/* Image */}
      {post.image && (
        <img
          src={post.image}
          alt=""
          className="mt-3 rounded-lg max-h-80 w-full object-cover"
        />
      )}

      {/* Cave link */}
      {post.cave && (
        <Link
          to={`/caves/${post.cave}`}
          className="inline-block mt-3 cyber-badge text-xs no-underline"
          style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' }}
        >
          {post.cave_name || 'View cave'}
        </Link>
      )}

      {/* Reaction bar */}
      <div className="flex items-center gap-4 mt-4 pt-3" style={{ borderTop: '1px solid var(--cyber-border)' }}>
        <button
          className="flex items-center gap-1.5 text-sm transition-colors"
          style={{ color: post.user_reaction === 'like' ? 'var(--cyber-cyan)' : 'var(--cyber-text-dim)' }}
          onClick={() => handleReact('like')}
        >
          <span className="text-base">{post.user_reaction === 'like' ? '\u25B2' : '\u25B3'}</span>
          {post.like_count > 0 && <span>{post.like_count}</span>}
        </button>

        <button
          className="flex items-center gap-1.5 text-sm transition-colors"
          style={{ color: post.user_reaction === 'dislike' ? 'var(--cyber-magenta)' : 'var(--cyber-text-dim)' }}
          onClick={() => handleReact('dislike')}
        >
          <span className="text-base">{post.user_reaction === 'dislike' ? '\u25BC' : '\u25BD'}</span>
          {post.dislike_count > 0 && <span>{post.dislike_count}</span>}
        </button>

        <button
          className="flex items-center gap-1.5 text-sm text-[var(--cyber-text-dim)] transition-colors hover:text-[var(--cyber-cyan)]"
          onClick={toggleComments}
        >
          <span className="text-base">{'\u{1F4AC}'}</span>
          {post.comment_count > 0 && <span>{post.comment_count}</span>}
        </button>

        {onDelete && post.author === currentUserId && (
          <button
            className="ml-auto text-xs text-[var(--cyber-text-dim)] hover:text-red-400 transition-colors"
            onClick={() => onDelete(post)}
          >
            Delete
          </button>
        )}
      </div>

      {/* Comments section */}
      {showComments && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--cyber-border)' }}>
          {loadingComments ? (
            <p className="text-xs text-[var(--cyber-text-dim)]">Loading comments...</p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-[var(--cyber-text-dim)]">No comments yet</p>
          ) : (
            <div className="space-y-2.5">
              {comments.map(c => (
                <div key={c.id} className="flex gap-2">
                  <span className="font-semibold text-xs text-[var(--cyber-cyan)] shrink-0">{c.author_username}</span>
                  <span className="text-xs text-[var(--cyber-text)]">{c.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Inline composer */}
          <form onSubmit={handleComment} className="flex gap-2 mt-3">
            <input
              type="text"
              placeholder="Write a comment..."
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              className="cyber-input flex-1 px-3 py-1.5 text-xs"
            />
            <button
              type="submit"
              disabled={submitting || !commentText.trim()}
              className="cyber-btn cyber-btn-cyan px-3 py-1.5 text-xs"
            >
              Post
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
