import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useApi, apiFetch } from '../hooks/useApi'
import PostCard from '../components/PostCard'
import PostComposer from '../components/PostComposer'
import useAuthStore from '../stores/authStore'

export default function Home() {
  const { user } = useAuthStore()
  const [offset, setOffset] = useState(0)
  const limit = 20
  const { data, loading, refetch } = useApi(
    `/social/posts/?limit=${limit}&offset=${offset}`
  )
  const posts = data?.results ?? []
  const total = data?.total ?? 0

  const handleDelete = useCallback(async (post) => {
    if (!confirm('Delete this post?')) return
    try {
      await apiFetch(`/social/posts/${post.id}/`, { method: 'DELETE' })
      refetch()
    } catch { /* ignore */ }
  }, [refetch])

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Compact hero */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ color: 'var(--cyber-cyan)' }}
          >
            Cave Backend
          </h1>
          <p className="text-sm text-[var(--cyber-text-dim)]">
            Your caving community feed
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/explore"
            className="cyber-btn cyber-btn-ghost px-3 py-1.5 text-xs no-underline"
            style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}
          >
            Explore
          </Link>
          <Link
            to="/groups"
            className="cyber-btn cyber-btn-ghost px-3 py-1.5 text-xs no-underline"
            style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}
          >
            Groups
          </Link>
        </div>
      </div>

      {/* Post composer */}
      <PostComposer onPostCreated={refetch} />

      {/* Feed */}
      {loading ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading feed...</p>
      ) : posts.length === 0 ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">
          No posts yet. Follow some users or create a post!
        </p>
      ) : (
        <div className="space-y-4">
          {posts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={user?.id}
              onReact={refetch}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex justify-center gap-4 mt-6">
          <button
            className="cyber-btn cyber-btn-ghost px-4 py-2 text-sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            Previous
          </button>
          <span className="text-sm text-[var(--cyber-text-dim)] flex items-center">
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
