import { useState, useCallback, useEffect } from 'react'
import { apiFetch } from '../../hooks/useApi'

function formatValue(val, type) {
  if (val === null || val === undefined) return '—'
  if (type === 'BooleanField') return val ? 'Yes' : 'No'
  if (type === 'DateTimeField' || type === 'DateField') {
    try {
      return new Date(val).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return String(val) }
  }
  const s = String(val)
  return s.length > 80 ? s.slice(0, 80) + '...' : s
}

// ── Record Detail / Edit Modal ───────────────────────────────

function RecordDetailModal({ modelKey, pk, onClose, onSaved }) {
  const [data, setData] = useState(null)
  const [fields, setFields] = useState([])
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    apiFetch(`/admin/data/${modelKey}/${pk}/`)
      .then(res => {
        setData(res.data)
        setFields(res.fields)
      })
      .catch(e => console.error(e))
      .finally(() => setLoading(false))
  }, [modelKey, pk])

  const handleSave = async () => {
    if (!Object.keys(edits).length) return onClose()
    setSaving(true)
    try {
      await apiFetch(`/admin/data/${modelKey}/${pk}/`, {
        method: 'PATCH',
        body: JSON.stringify(edits),
      })
      onSaved?.()
      onClose()
    } catch (e) {
      alert('Failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Permanently delete this record?')) return
    try {
      await apiFetch(`/admin/data/${modelKey}/${pk}/`, { method: 'DELETE' })
      onSaved?.()
      onClose()
    } catch (e) {
      alert('Failed: ' + e.message)
    }
  }

  const currentVal = (fieldName) => {
    if (fieldName in edits) return edits[fieldName]
    return data?.[fieldName]
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="cyber-card p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--cyber-cyan)' }}>
          Record Detail — {pk}
        </h3>

        {loading ? (
          <p className="text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>Loading...</p>
        ) : (
          <div className="space-y-2">
            {fields.map(f => {
              const val = currentVal(f.name)
              const editable = f.editable
              const isText = ['CharField', 'TextField', 'EmailField', 'URLField'].includes(f.type)
              const isBool = f.type === 'BooleanField'
              const isNum = ['IntegerField', 'FloatField', 'DecimalField', 'BigIntegerField', 'SmallIntegerField', 'PositiveIntegerField'].includes(f.type)

              return (
                <div key={f.name} className="flex items-start gap-2 py-1" style={{ borderBottom: '1px solid var(--cyber-border)' }}>
                  <span className="text-[10px] uppercase w-36 shrink-0 pt-1" style={{ color: 'var(--cyber-text-dim)' }}>
                    {f.name}
                    <span className="block text-[8px]" style={{ color: 'var(--cyber-border)' }}>{f.type}</span>
                  </span>
                  <div className="flex-1 min-w-0">
                    {editable && isText ? (
                      f.type === 'TextField' ? (
                        <textarea
                          className="cyber-input w-full text-xs"
                          rows={2}
                          value={val ?? ''}
                          onChange={e => setEdits(p => ({ ...p, [f.name]: e.target.value }))}
                        />
                      ) : (
                        <input
                          className="cyber-input w-full text-xs"
                          value={val ?? ''}
                          onChange={e => setEdits(p => ({ ...p, [f.name]: e.target.value }))}
                        />
                      )
                    ) : editable && isBool ? (
                      <input
                        type="checkbox"
                        checked={!!val}
                        onChange={e => setEdits(p => ({ ...p, [f.name]: e.target.checked }))}
                        className="accent-[var(--cyber-cyan)]"
                      />
                    ) : editable && isNum ? (
                      <input
                        className="cyber-input w-full text-xs"
                        type="number"
                        value={val ?? ''}
                        onChange={e => setEdits(p => ({ ...p, [f.name]: e.target.value ? Number(e.target.value) : null }))}
                      />
                    ) : (
                      <span className="text-xs break-all" style={{ color: editable ? 'var(--cyber-text)' : 'var(--cyber-text-dim)' }}>
                        {formatValue(val, f.type)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex items-center justify-between mt-6">
          <button
            className="cyber-btn cyber-btn-ghost px-3 py-1.5 text-xs"
            style={{ color: 'var(--cyber-red, #ff4444)' }}
            onClick={handleDelete}
          >
            Delete Record
          </button>
          <div className="flex gap-2">
            <button className="cyber-btn cyber-btn-ghost px-4 py-1.5 text-xs" onClick={onClose}>Cancel</button>
            <button className="cyber-btn px-4 py-1.5 text-xs" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : Object.keys(edits).length ? 'Save Changes' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Record List ──────────────────────────────────────────────

function RecordList({ modelKey, modelName, onBack }) {
  const [records, setRecords] = useState([])
  const [fields, setFields] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailPk, setDetailPk] = useState(null)

  const fetchRecords = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch(
        `/admin/data/${modelKey}/?search=${encodeURIComponent(search)}&page=${page}&per_page=25`
      )
      setRecords(data.results)
      setFields(data.fields)
      setTotal(data.total)
      setPages(data.pages)
    } catch (e) {
      console.error('Failed to fetch records:', e)
    } finally {
      setLoading(false)
    }
  }, [modelKey, search, page])

  useEffect(() => { fetchRecords() }, [fetchRecords])

  // Show max 6 columns in list view
  const displayFields = fields.slice(0, 6)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          className="cyber-btn cyber-btn-ghost px-2 py-1 text-xs"
          onClick={onBack}
        >
          &larr; Back
        </button>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--cyber-cyan)' }}>
          {modelName}
        </h3>
        <input
          className="cyber-input flex-1 text-sm"
          placeholder="Search..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <span className="text-xs whitespace-nowrap" style={{ color: 'var(--cyber-text-dim)' }}>
          {total} records
        </span>
      </div>

      <div className="cyber-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--cyber-border)' }}>
              {displayFields.map(f => (
                <th key={f.name} className="text-left p-2" style={{ color: 'var(--cyber-text-dim)' }}>
                  {f.name}
                </th>
              ))}
              <th className="p-2 text-right" style={{ color: 'var(--cyber-text-dim)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={displayFields.length + 1} className="text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>Loading...</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={displayFields.length + 1} className="text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>No records found</td></tr>
            ) : records.map(r => (
              <tr
                key={r._pk}
                className="hover:bg-[var(--cyber-surface)] cursor-pointer"
                style={{ borderBottom: '1px solid var(--cyber-border)' }}
                onClick={() => setDetailPk(r._pk)}
              >
                {displayFields.map(f => (
                  <td key={f.name} className="p-2 max-w-[200px] truncate" style={{ color: 'var(--cyber-text)' }}>
                    {formatValue(r[f.name], f.type)}
                  </td>
                ))}
                <td className="p-2 text-right">
                  <button
                    className="cyber-btn cyber-btn-ghost px-2 py-0.5 text-[10px]"
                    onClick={e => { e.stopPropagation(); setDetailPk(r._pk) }}
                  >
                    View
                  </button>
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

      {detailPk && (
        <RecordDetailModal
          modelKey={modelKey}
          pk={detailPk}
          onClose={() => setDetailPk(null)}
          onSaved={fetchRecords}
        />
      )}
    </div>
  )
}

// ── Model List (main view) ───────────────────────────────────

export default function DataBrowser() {
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeModel, setActiveModel] = useState(null)

  useEffect(() => {
    apiFetch('/admin/data/')
      .then(data => setModels(data))
      .catch(e => console.error(e))
      .finally(() => setLoading(false))
  }, [])

  if (activeModel) {
    return (
      <RecordList
        modelKey={activeModel.key}
        modelName={activeModel.name}
        onBack={() => setActiveModel(null)}
      />
    )
  }

  if (loading) {
    return <p className="text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>Loading models...</p>
  }

  // Group by app
  const grouped = {}
  for (const m of models) {
    if (!grouped[m.app]) grouped[m.app] = []
    grouped[m.app].push(m)
  }

  const appLabels = {
    users: 'Users',
    caves: 'Caves',
    mapping: 'Mapping',
    survey: 'Surveys',
    social: 'Social',
    chat: 'Chat',
    events: 'Events',
    wiki: 'Wiki',
  }

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([app, items]) => (
        <div key={app}>
          <h3 className="text-xs font-semibold mb-2 uppercase" style={{ color: 'var(--cyber-text-dim)' }}>
            {appLabels[app] || app}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {items.map(m => (
              <button
                key={m.key}
                className="cyber-card p-3 text-left hover:border-[var(--cyber-cyan)] transition-colors cursor-pointer"
                onClick={() => setActiveModel(m)}
              >
                <span className="text-sm font-medium block" style={{ color: 'var(--cyber-text)' }}>
                  {m.name}
                </span>
                <span className="text-lg font-bold" style={{ color: 'var(--cyber-cyan)' }}>
                  {m.count}
                </span>
                <span className="text-[10px] ml-1" style={{ color: 'var(--cyber-text-dim)' }}>records</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
