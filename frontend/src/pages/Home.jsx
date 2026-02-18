import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'

export default function Home() {
  const { data: status } = useApi('/status/')
  const { data: feed } = useApi('/social/feed/?limit=5')
  const { data: caves } = useApi('/caves/')

  const recentCaves = caves?.caves ?? caves?.results ?? caves ?? []

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Hero */}
      <div className="text-center mb-10">
        <h1
          className="text-4xl font-bold mb-2"
          style={{ color: 'var(--cyber-cyan)' }}
        >
          Cave Backend
        </h1>
        <p className="text-[var(--cyber-text-dim)]">
          Cloud platform for cave mapping, exploration &amp; community
        </p>
        {status && (
          <span
            className="cyber-badge mt-3"
            style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' }}
          >
            API {status.version} — {status.status}
          </span>
        )}
      </div>

      {/* Quick nav cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <Link to="/explore" className="cyber-card p-5 no-underline block text-center">
          <div className="text-2xl mb-2">🗺️</div>
          <h3 className="font-semibold text-[var(--cyber-text)]">Explore Caves</h3>
          <p className="text-sm text-[var(--cyber-text-dim)] mt-1">
            Browse and search the cave database
          </p>
        </Link>
        <Link to="/expeditions" className="cyber-card p-5 no-underline block text-center">
          <div className="text-2xl mb-2">⛏️</div>
          <h3 className="font-semibold text-[var(--cyber-text)]">Expeditions</h3>
          <p className="text-sm text-[var(--cyber-text-dim)] mt-1">
            Plan group caving trips
          </p>
        </Link>
        <Link to="/feed" className="cyber-card p-5 no-underline block text-center">
          <div className="text-2xl mb-2">📡</div>
          <h3 className="font-semibold text-[var(--cyber-text)]">Activity Feed</h3>
          <p className="text-sm text-[var(--cyber-text-dim)] mt-1">
            See what the community is up to
          </p>
        </Link>
      </div>

      {/* Recent caves */}
      {recentCaves.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4">Recent Caves</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentCaves.slice(0, 6).map(cave => (
              <Link
                key={cave.id}
                to={`/caves/${cave.id}`}
                className="cyber-card p-4 no-underline block"
              >
                <h3 className="font-semibold text-[var(--cyber-text)]">{cave.name}</h3>
                <p className="text-xs text-[var(--cyber-text-dim)] mt-1">
                  {cave.region && `${cave.region}, `}{cave.country || 'Unknown location'}
                </p>
                <div className="flex gap-3 mt-2 text-xs text-[var(--cyber-text-dim)]">
                  {cave.total_length && <span>{cave.total_length}m</span>}
                  {cave.photo_count > 0 && <span>{cave.photo_count} photos</span>}
                  {cave.rating_count > 0 && (
                    <span>★ {Number(cave.average_rating).toFixed(1)}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recent activity */}
      {feed?.results?.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          <div className="space-y-2">
            {feed.results.map(activity => (
              <div
                key={activity.id}
                className="cyber-card p-3 flex items-center gap-3"
              >
                <span className="text-sm">{activity.message}</span>
                <span className="ml-auto text-xs text-[var(--cyber-text-dim)]">
                  {new Date(activity.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
          <Link
            to="/feed"
            className="inline-block mt-3 text-sm no-underline"
            style={{ color: 'var(--cyber-cyan)' }}
          >
            View all activity →
          </Link>
        </section>
      )}
    </div>
  )
}
