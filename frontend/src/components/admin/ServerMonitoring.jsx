import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../../hooks/useApi'
import { MiniBar, StatCard } from './AdminDashboard'

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatMB(mb) {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}

export default function ServerMonitoring() {
  const [metrics, setMetrics] = useState(null)
  const [r2Data, setR2Data] = useState(null)
  const [wsData, setWsData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchAll = useCallback(async () => {
    try {
      const [m, r, w] = await Promise.all([
        apiFetch('/admin/server/metrics/'),
        apiFetch('/admin/server/r2-storage/'),
        apiFetch('/admin/server/websockets/'),
      ])
      setMetrics(m)
      setR2Data(r)
      setWsData(w)
    } catch (e) {
      console.error('Failed to fetch server metrics:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    if (!autoRefresh) return
    const interval = setInterval(fetchAll, 30000)
    return () => clearInterval(interval)
  }, [fetchAll, autoRefresh])

  if (loading) return <p className="text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>Loading server metrics...</p>

  return (
    <div className="space-y-6">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--cyber-cyan)' }}>Server Health</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--cyber-text-dim)' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="accent-[var(--cyber-cyan)]"
            />
            Auto-refresh (30s)
          </label>
          <button
            onClick={fetchAll}
            className="cyber-btn cyber-btn-ghost px-2 py-1 text-xs"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* VPS Metrics */}
      {metrics && (
        <div className="cyber-card p-4 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold" style={{ color: 'var(--cyber-text-dim)' }}>VPS METRICS</h4>
            <span className="text-xs" style={{ color: 'var(--cyber-text-dim)' }}>
              Uptime: {formatUptime(metrics.uptime_seconds)}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* CPU */}
            <div className="space-y-2">
              <MiniBar percent={metrics.cpu.percent} label="CPU" />
              <div className="text-[10px] pl-[72px]" style={{ color: 'var(--cyber-text-dim)' }}>
                {metrics.cpu.count} cores | Load: {metrics.cpu.load_avg_1m.toFixed(2)} / {metrics.cpu.load_avg_5m.toFixed(2)} / {metrics.cpu.load_avg_15m.toFixed(2)}
              </div>
            </div>

            {/* Memory */}
            <div className="space-y-2">
              <MiniBar percent={metrics.memory.percent} label="RAM" />
              <div className="text-[10px] pl-[72px]" style={{ color: 'var(--cyber-text-dim)' }}>
                {formatMB(metrics.memory.used_mb)} / {formatMB(metrics.memory.total_mb)}
              </div>
            </div>

            {/* Swap */}
            <div className="space-y-2">
              <MiniBar percent={metrics.swap.percent} label="Swap" />
              <div className="text-[10px] pl-[72px]" style={{ color: 'var(--cyber-text-dim)' }}>
                {formatMB(metrics.swap.used_mb)} / {formatMB(metrics.swap.total_mb)}
              </div>
            </div>

            {/* Disk */}
            <div className="space-y-2">
              <MiniBar percent={metrics.disk.percent} label="Disk" />
              <div className="text-[10px] pl-[72px]" style={{ color: 'var(--cyber-text-dim)' }}>
                {metrics.disk.used_gb.toFixed(1)} GB / {metrics.disk.total_gb.toFixed(1)} GB
              </div>
            </div>
          </div>

          {/* Process */}
          <div className="border-t pt-3" style={{ borderColor: 'var(--cyber-border)' }}>
            <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--cyber-text-dim)' }}>DJANGO PROCESS (PID {metrics.process.pid})</h4>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="RSS Memory" value={formatMB(metrics.process.memory_rss_mb)} />
              <StatCard label="VMS Memory" value={formatMB(metrics.process.memory_vms_mb)} />
              <StatCard label="Threads" value={metrics.process.threads} />
            </div>
          </div>
        </div>
      )}

      {/* WebSocket / Redis */}
      {wsData && (
        <div className="cyber-card p-4">
          <h4 className="text-xs font-semibold mb-3" style={{ color: 'var(--cyber-text-dim)' }}>WEBSOCKET / REDIS</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Connected Users"
              value={wsData.estimated_connected_users}
            />
            <StatCard
              label="Channel Layer"
              value={wsData.channel_layer}
              color={wsData.healthy ? 'var(--cyber-green, #00ff88)' : 'var(--cyber-red, #ff4444)'}
            />
            {wsData.redis_memory_mb != null && (
              <StatCard label="Redis Memory" value={`${wsData.redis_memory_mb} MB`} />
            )}
            {wsData.redis_connected_clients != null && (
              <StatCard label="Redis Clients" value={wsData.redis_connected_clients} />
            )}
          </div>
          {wsData.error && (
            <p className="text-xs mt-2 text-red-400">Error: {wsData.error}</p>
          )}
        </div>
      )}

      {/* R2 / Storage */}
      {r2Data && (
        <div className="cyber-card p-4">
          <h4 className="text-xs font-semibold mb-3" style={{ color: 'var(--cyber-text-dim)' }}>
            STORAGE ({r2Data.source === 'r2' ? 'Cloudflare R2' : 'Local'})
          </h4>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <StatCard label="Total Size" value={r2Data.total_size_mb >= 1000 ? `${(r2Data.total_size_mb / 1000).toFixed(1)} GB` : `${r2Data.total_size_mb} MB`} />
            <StatCard label="Total Files" value={r2Data.total_files} />
          </div>

          {/* Per-cave breakdown */}
          {r2Data.caves && Object.keys(r2Data.caves).length > 0 && (
            <div>
              <h5 className="text-[10px] font-semibold mb-2" style={{ color: 'var(--cyber-text-dim)' }}>PER-CAVE BREAKDOWN</h5>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {Object.entries(r2Data.caves)
                  .sort((a, b) => b[1].size_mb - a[1].size_mb)
                  .map(([caveId, info]) => (
                    <div key={caveId} className="flex items-center justify-between text-xs px-2 py-1 rounded" style={{ background: 'var(--cyber-surface)' }}>
                      <span className="truncate flex-1 mr-2" style={{ color: 'var(--cyber-text)' }}>
                        {info.name || caveId.slice(0, 8)}
                      </span>
                      <span className="whitespace-nowrap" style={{ color: 'var(--cyber-text-dim)' }}>
                        {info.size_mb >= 1000 ? `${(info.size_mb / 1000).toFixed(1)} GB` : `${info.size_mb} MB`} ({info.files} files)
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {r2Data.other && r2Data.other.files > 0 && (
            <div className="mt-2 text-xs" style={{ color: 'var(--cyber-text-dim)' }}>
              Other: {r2Data.other.size_mb} MB ({r2Data.other.files} files)
            </div>
          )}
        </div>
      )}
    </div>
  )
}
