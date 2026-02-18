import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'

export default function Explore() {
  const [search, setSearch] = useState('')
  const { data, loading } = useApi('/caves/')
  const caves = data?.caves ?? data?.results ?? data ?? []

  const filtered = search
    ? caves.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.region || '').toLowerCase().includes(search.toLowerCase()) ||
        (c.country || '').toLowerCase().includes(search.toLowerCase())
      )
    : caves

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Explore Caves</h1>
        <span className="text-sm text-[var(--cyber-text-dim)]">
          {filtered.length} cave{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <input
        type="text"
        placeholder="Search caves..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="cyber-input w-full px-4 py-2.5 mb-6"
      />

      {loading ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">Loading caves...</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-[var(--cyber-text-dim)] py-12">No caves found</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(cave => (
            <Link
              key={cave.id}
              to={`/caves/${cave.id}`}
              className="cyber-card p-5 no-underline block"
            >
              {cave.cover_photo && (
                <img
                  src={cave.cover_photo}
                  alt={cave.name}
                  className="w-full h-36 object-cover rounded-lg mb-3"
                />
              )}
              <h3 className="font-semibold text-[var(--cyber-text)]">{cave.name}</h3>
              <p className="text-xs text-[var(--cyber-text-dim)] mt-1">
                {cave.region && `${cave.region}, `}{cave.country || 'Unknown location'}
              </p>

              <div className="flex flex-wrap gap-2 mt-3">
                {cave.total_length && (
                  <span
                    className="cyber-badge"
                    style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}
                  >
                    {cave.total_length}m
                  </span>
                )}
                {cave.has_map && (
                  <span
                    className="cyber-badge"
                    style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' }}
                  >
                    3D Map
                  </span>
                )}
                {cave.rating_count > 0 && (
                  <span
                    className="cyber-badge"
                    style={{ borderColor: '#fbbf24', color: '#fbbf24' }}
                  >
                    ★ {Number(cave.average_rating).toFixed(1)} ({cave.rating_count})
                  </span>
                )}
              </div>

              <p className="text-xs text-[var(--cyber-text-dim)] mt-3 line-clamp-2">
                {cave.description || 'No description yet'}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
