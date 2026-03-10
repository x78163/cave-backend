import { useState, useCallback, useEffect } from 'react'
import { apiFetch } from '../../hooks/useApi'
import { Link } from 'react-router-dom'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

const VIS_COLORS = {
  public: 'var(--cyber-cyan)',
  limited_public: 'var(--cyber-amber, #ffaa00)',
  unlisted: 'var(--cyber-magenta)',
  private: 'var(--cyber-red, #ff4444)',
}

function CaveEditModal({ cave, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: cave.name,
    visibility: cave.visibility,
    city: cave.city,
    state: cave.state,
    country: cave.country,
    has_map: cave.has_map,
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await apiFetch(`/admin/caves/${cave.id}/`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      })
      onSaved()
      onClose()
    } catch (e) {
      alert('Failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="cyber-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--cyber-cyan)' }}>Edit Cave: {cave.name}</h3>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[10px] uppercase" style={{ color: 'var(--cyber-text-dim)' }}>Name</span>
            <input className="cyber-input w-full mt-0.5 text-sm" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </label>

          <label className="block">
            <span className="text-[10px] uppercase" style={{ color: 'var(--cyber-text-dim)' }}>Visibility</span>
            <select className="cyber-input w-full mt-0.5 text-sm" value={form.visibility}
              onChange={e => setForm(f => ({ ...f, visibility: e.target.value }))}>
              <option value="public">Public</option>
              <option value="limited_public">Limited Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </label>

          {['city', 'state', 'country'].map(field => (
            <label key={field} className="block">
              <span className="text-[10px] uppercase" style={{ color: 'var(--cyber-text-dim)' }}>{field}</span>
              <input className="cyber-input w-full mt-0.5 text-sm" value={form[field]}
                onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} />
            </label>
          ))}

          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={form.has_map}
              onChange={e => setForm(f => ({ ...f, has_map: e.target.checked }))}
              className="accent-[var(--cyber-cyan)]" />
            <span style={{ color: 'var(--cyber-text)' }}>Has Map</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button className="cyber-btn cyber-btn-ghost px-4 py-1.5 text-xs" onClick={onClose}>Cancel</button>
          <button className="cyber-btn px-4 py-1.5 text-xs" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CaveManagement() {
  const [caves, setCaves] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('-created_at')
  const [loading, setLoading] = useState(true)
  const [editCave, setEditCave] = useState(null)

  const fetchCaves = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch(`/admin/caves/?search=${encodeURIComponent(search)}&sort=${sort}&page=${page}&per_page=20`)
      setCaves(data.results)
      setTotal(data.total)
      setPages(data.pages)
    } catch (e) {
      console.error('Failed to fetch caves:', e)
    } finally {
      setLoading(false)
    }
  }, [search, sort, page])

  useEffect(() => { fetchCaves() }, [fetchCaves])

  const handleDelete = async (cave) => {
    if (!confirm(`Permanently delete "${cave.name}"? This cannot be undone.`)) return
    try {
      await apiFetch(`/admin/caves/${cave.id}/`, { method: 'DELETE' })
      fetchCaves()
    } catch (e) {
      alert('Failed: ' + e.message)
    }
  }

  const handleSort = (col) => {
    setSort(s => s === col ? `-${col}` : s === `-${col}` ? col : col)
    setPage(1)
  }

  const SortIcon = ({ col }) => {
    if (sort === col) return <span className="ml-0.5">▲</span>
    if (sort === `-${col}`) return <span className="ml-0.5">▼</span>
    return null
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          className="cyber-input flex-1 text-sm"
          placeholder="Search caves..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <span className="text-xs whitespace-nowrap" style={{ color: 'var(--cyber-text-dim)' }}>
          {total} caves
        </span>
      </div>

      <div className="cyber-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--cyber-border)' }}>
              {[
                { key: 'name', label: 'Cave' },
                { key: 'visibility', label: 'Vis' },
                { key: 'created_at', label: 'Created' },
              ].map(col => (
                <th key={col.key}
                  className="text-left p-2 cursor-pointer hover:text-[var(--cyber-cyan)]"
                  style={{ color: 'var(--cyber-text-dim)' }}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}<SortIcon col={col.key} />
                </th>
              ))}
              <th className="p-2 text-left" style={{ color: 'var(--cyber-text-dim)' }}>Location</th>
              <th className="p-2 text-left" style={{ color: 'var(--cyber-text-dim)' }}>Owner</th>
              <th className="p-2 text-center" style={{ color: 'var(--cyber-text-dim)' }}>Map</th>
              <th className="p-2 text-right" style={{ color: 'var(--cyber-text-dim)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>Loading...</td></tr>
            ) : caves.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>No caves found</td></tr>
            ) : caves.map(c => (
              <tr key={c.id} className="hover:bg-[var(--cyber-surface)]" style={{ borderBottom: '1px solid var(--cyber-border)' }}>
                <td className="p-2">
                  <Link to={`/caves/${c.id}`} className="hover:underline" style={{ color: 'var(--cyber-cyan)' }}>
                    {c.name}
                  </Link>
                </td>
                <td className="p-2">
                  <span className="cyber-badge text-[9px]" style={{ borderColor: VIS_COLORS[c.visibility], color: VIS_COLORS[c.visibility] }}>
                    {c.visibility}
                  </span>
                </td>
                <td className="p-2" style={{ color: 'var(--cyber-text-dim)' }}>{formatDate(c.created_at)}</td>
                <td className="p-2" style={{ color: 'var(--cyber-text-dim)' }}>
                  {[c.city, c.state, c.country].filter(Boolean).join(', ') || '—'}
                </td>
                <td className="p-2" style={{ color: 'var(--cyber-text-dim)' }}>
                  {c.owner ? c.owner.username : '—'}
                </td>
                <td className="p-2 text-center">
                  {c.has_map ? (
                    <span style={{ color: 'var(--cyber-green, #00ff88)' }}>Yes</span>
                  ) : (
                    <span style={{ color: 'var(--cyber-text-dim)' }}>—</span>
                  )}
                </td>
                <td className="p-2 text-right whitespace-nowrap">
                  <button
                    className="cyber-btn cyber-btn-ghost px-2 py-0.5 text-[10px] mr-1"
                    onClick={() => setEditCave(c)}
                  >Edit</button>
                  <button
                    className="cyber-btn cyber-btn-ghost px-2 py-0.5 text-[10px]"
                    style={{ color: 'var(--cyber-red, #ff4444)' }}
                    onClick={() => handleDelete(c)}
                  >Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button className="cyber-btn cyber-btn-ghost px-2 py-1 text-xs" disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}>Prev</button>
          <span className="text-xs" style={{ color: 'var(--cyber-text-dim)' }}>Page {page} of {pages}</span>
          <button className="cyber-btn cyber-btn-ghost px-2 py-1 text-xs" disabled={page >= pages}
            onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}

      {editCave && <CaveEditModal cave={editCave} onClose={() => setEditCave(null)} onSaved={fetchCaves} />}
    </div>
  )
}
