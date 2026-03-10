import { useState, useCallback, useEffect } from 'react'
import { apiFetch } from '../../hooks/useApi'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function InviteCodeManagement() {
  const [codes, setCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [maxUses, setMaxUses] = useState(1)
  const [copied, setCopied] = useState(null)

  const fetchCodes = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/admin/invite-codes/')
      setCodes(data)
    } catch (e) {
      console.error('Failed to fetch codes:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCodes() }, [fetchCodes])

  const generateCode = async () => {
    setGenerating(true)
    try {
      await apiFetch('/admin/invite-codes/', {
        method: 'POST',
        body: JSON.stringify({ max_uses: maxUses }),
      })
      fetchCodes()
    } catch (e) {
      alert('Failed: ' + e.message)
    } finally {
      setGenerating(false)
    }
  }

  const toggleActive = async (code) => {
    try {
      await apiFetch(`/admin/invite-codes/${code.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !code.is_active }),
      })
      fetchCodes()
    } catch (e) {
      alert('Failed: ' + e.message)
    }
  }

  const deleteCode = async (code) => {
    if (!confirm(`Delete invite code ${code.code}?`)) return
    try {
      await apiFetch(`/admin/invite-codes/${code.id}/`, { method: 'DELETE' })
      fetchCodes()
    } catch (e) {
      alert('Failed: ' + e.message)
    }
  }

  const copyCode = (code) => {
    navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-4">
      {/* Generate new code */}
      <div className="cyber-card p-4 flex items-end gap-3 flex-wrap">
        <label className="block">
          <span className="text-[10px] uppercase" style={{ color: 'var(--cyber-text-dim)' }}>Max Uses</span>
          <input
            type="number"
            min={0}
            className="cyber-input w-20 mt-0.5 text-sm"
            value={maxUses}
            onChange={e => setMaxUses(parseInt(e.target.value) || 0)}
          />
        </label>
        <button
          className="cyber-btn px-4 py-1.5 text-xs"
          onClick={generateCode}
          disabled={generating}
        >
          {generating ? 'Generating...' : 'Generate Code'}
        </button>
        <span className="text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>
          0 = unlimited uses
        </span>
      </div>

      {/* Code list */}
      <div className="cyber-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--cyber-border)' }}>
              <th className="text-left p-2" style={{ color: 'var(--cyber-text-dim)' }}>Code</th>
              <th className="text-left p-2" style={{ color: 'var(--cyber-text-dim)' }}>Created By</th>
              <th className="text-left p-2" style={{ color: 'var(--cyber-text-dim)' }}>Created</th>
              <th className="text-center p-2" style={{ color: 'var(--cyber-text-dim)' }}>Uses</th>
              <th className="text-center p-2" style={{ color: 'var(--cyber-text-dim)' }}>Status</th>
              <th className="text-right p-2" style={{ color: 'var(--cyber-text-dim)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>Loading...</td></tr>
            ) : codes.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>No invite codes yet</td></tr>
            ) : codes.map(c => (
              <tr key={c.id} className="hover:bg-[var(--cyber-surface)]" style={{ borderBottom: '1px solid var(--cyber-border)' }}>
                <td className="p-2">
                  <button
                    className="font-mono hover:underline"
                    style={{ color: c.is_active ? 'var(--cyber-cyan)' : 'var(--cyber-text-dim)', textDecoration: c.is_active ? 'none' : 'line-through' }}
                    onClick={() => copyCode(c.code)}
                    title="Click to copy"
                  >
                    {c.code}
                  </button>
                  {copied === c.code && (
                    <span className="ml-2 text-[10px]" style={{ color: 'var(--cyber-green, #00ff88)' }}>Copied!</span>
                  )}
                </td>
                <td className="p-2" style={{ color: 'var(--cyber-text-dim)' }}>{c.created_by.username}</td>
                <td className="p-2" style={{ color: 'var(--cyber-text-dim)' }}>{formatDate(c.created_at)}</td>
                <td className="p-2 text-center">
                  <span style={{ color: 'var(--cyber-text)' }}>{c.use_count}</span>
                  <span style={{ color: 'var(--cyber-text-dim)' }}> / {c.max_uses === 0 ? '∞' : c.max_uses}</span>
                </td>
                <td className="p-2 text-center">
                  <span
                    className="cyber-badge text-[9px]"
                    style={{
                      borderColor: c.is_active ? 'var(--cyber-green, #00ff88)' : 'var(--cyber-red, #ff4444)',
                      color: c.is_active ? 'var(--cyber-green, #00ff88)' : 'var(--cyber-red, #ff4444)',
                    }}
                  >
                    {c.is_active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="p-2 text-right whitespace-nowrap">
                  <button
                    className="cyber-btn cyber-btn-ghost px-2 py-0.5 text-[10px] mr-1"
                    style={{ color: c.is_active ? 'var(--cyber-amber, #ffaa00)' : 'var(--cyber-green, #00ff88)' }}
                    onClick={() => toggleActive(c)}
                  >
                    {c.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    className="cyber-btn cyber-btn-ghost px-2 py-0.5 text-[10px]"
                    style={{ color: 'var(--cyber-red, #ff4444)' }}
                    onClick={() => deleteCode(c)}
                  >Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
