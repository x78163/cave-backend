import { useState } from 'react'
import { useApi } from '../../hooks/useApi'
import ServerMonitoring from './ServerMonitoring'
import UserManagement from './UserManagement'
import CaveManagement from './CaveManagement'
import InviteCodeManagement from './InviteCodeManagement'
import DataBrowser from './DataBrowser'

// ── Stat Card ─────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'var(--cyber-cyan)' }) {
  return (
    <div className="cyber-card p-4 flex flex-col items-center justify-center min-w-[120px]">
      <span className="text-2xl font-bold" style={{ color }}>{value}</span>
      <span className="text-xs mt-1" style={{ color: 'var(--cyber-text-dim)' }}>{label}</span>
      {sub && <span className="text-[10px] mt-0.5" style={{ color: 'var(--cyber-text-dim)' }}>{sub}</span>}
    </div>
  )
}

function MiniBar({ percent, color = 'var(--cyber-cyan)', label }) {
  const barColor = percent > 80 ? 'var(--cyber-red, #ff4444)' : percent > 60 ? 'var(--cyber-amber, #ffaa00)' : color
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-right" style={{ color: 'var(--cyber-text-dim)' }}>{label}</span>
      <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--cyber-surface)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(percent, 100)}%`, background: barColor }} />
      </div>
      <span className="w-10 text-right" style={{ color: barColor }}>{percent}%</span>
    </div>
  )
}

// ── Sub-sections ──────────────────────────────────────────────

const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'server', label: 'Server' },
  { key: 'users', label: 'Users' },
  { key: 'caves', label: 'Caves' },
  { key: 'invites', label: 'Invite Codes' },
  { key: 'data', label: 'Data Browser' },
]

// ── Overview Section ──────────────────────────────────────────

function OverviewSection() {
  const { data, loading, error } = useApi('/admin/overview/')

  if (loading) return <p className="text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>Loading stats...</p>
  if (error) return <p className="text-center py-8 text-red-400">Failed to load overview</p>
  if (!data) return null

  const { users, caves, content, chat, invite_codes } = data

  return (
    <div className="space-y-6">
      {/* User Stats */}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--cyber-cyan)' }}>Users</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          <StatCard label="Total Users" value={users.total} />
          <StatCard label="Staff" value={users.staff} color="var(--cyber-magenta)" />
          <StatCard label="Active (7d)" value={users.active_7d} />
          <StatCard label="Active (30d)" value={users.active_30d} />
          <StatCard label="New (7d)" value={users.new_7d} color="var(--cyber-green, #00ff88)" />
          <StatCard label="New (30d)" value={users.new_30d} color="var(--cyber-green, #00ff88)" />
        </div>
      </div>

      {/* Cave Stats */}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--cyber-cyan)' }}>Caves</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <StatCard label="Total Caves" value={caves.total} />
          <StatCard label="Mapped" value={caves.mapped} color="var(--cyber-green, #00ff88)" />
          <StatCard label="Public" value={caves.visibility?.public || 0} />
          <StatCard label="Private" value={caves.visibility?.private || 0} color="var(--cyber-magenta)" />
          <StatCard label="Unlisted" value={caves.visibility?.unlisted || 0} color="var(--cyber-amber, #ffaa00)" />
        </div>
      </div>

      {/* Content Stats */}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--cyber-cyan)' }}>Content</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3">
          <StatCard label="Photos" value={content.photos} />
          <StatCard label="Documents" value={content.documents} />
          <StatCard label="Videos" value={content.videos} />
          <StatCard label="POIs" value={content.pois} />
          <StatCard label="Surveys" value={content.surveys} />
          <StatCard label="Posts" value={content.posts} />
          <StatCard label="Events" value={content.events} />
          <StatCard label="Articles" value={content.articles} />
        </div>
      </div>

      {/* Chat Stats */}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--cyber-cyan)' }}>Chat</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label="Channels" value={chat.channels} />
          <StatCard label="Messages" value={chat.messages_total} />
          <StatCard label="Messages (7d)" value={chat.messages_7d} />
        </div>
      </div>

      {/* Invite Codes */}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--cyber-cyan)' }}>Invite Codes</h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Total Codes" value={invite_codes.total} />
          <StatCard label="Active Codes" value={invite_codes.active} color="var(--cyber-green, #00ff88)" />
        </div>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────

export default function AdminDashboard() {
  const [section, setSection] = useState('overview')

  return (
    <div>
      {/* Section nav */}
      <div className="flex gap-1 mb-6 flex-wrap">
        {SECTIONS.map(s => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              section === s.key
                ? 'text-[var(--cyber-bg)] bg-[var(--cyber-cyan)]'
                : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] border border-[var(--cyber-border)]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'overview' && <OverviewSection />}
      {section === 'server' && <ServerMonitoring />}
      {section === 'users' && <UserManagement />}
      {section === 'caves' && <CaveManagement />}
      {section === 'invites' && <InviteCodeManagement />}
      {section === 'data' && <DataBrowser />}
    </div>
  )
}

export { StatCard, MiniBar }
