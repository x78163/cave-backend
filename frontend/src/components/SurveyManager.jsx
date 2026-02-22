import { useState, useCallback, useRef, useEffect } from 'react'
import { useApi, apiFetch } from '../hooks/useApi'
import SurveyTopologyGraph from './SurveyTopologyGraph'
import { BRANCH_COLORS } from '../utils/surveyColors'

// ── Create Survey Form ──────────────────────────────────────

function CreateSurveyForm({ caveId, onCreated, onCancel }) {
  const [name, setName] = useState('')
  const [dateSurveyed, setDateSurveyed] = useState('')
  const [surveyors, setSurveyors] = useState('')
  const [unit, setUnit] = useState('feet')
  const [declination, setDeclination] = useState('0')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        name,
        unit,
        declination: parseFloat(declination) || 0,
      }
      if (dateSurveyed) body.date_surveyed = dateSurveyed
      if (surveyors) body.surveyors = surveyors

      await apiFetch(`/caves/${caveId}/surveys/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      onCreated()
    } catch (err) {
      console.error('Create survey failed:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="cyber-card p-5 mb-4">
      <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--cyber-cyan)' }}>New Survey</h3>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-[var(--cyber-text-dim)] mb-1">Name *</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            className="cyber-input w-full px-3 py-2 text-sm" placeholder="Main Passage Survey"
            required
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--cyber-text-dim)] mb-1">Date Surveyed</label>
          <input
            type="date" value={dateSurveyed} onChange={e => setDateSurveyed(e.target.value)}
            className="cyber-input w-full px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-xs text-[var(--cyber-text-dim)] mb-1">Surveyors</label>
          <input
            type="text" value={surveyors} onChange={e => setSurveyors(e.target.value)}
            className="cyber-input w-full px-3 py-2 text-sm" placeholder="Names"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--cyber-text-dim)] mb-1">Unit</label>
          <select
            value={unit} onChange={e => setUnit(e.target.value)}
            className="cyber-input w-full px-3 py-2 text-sm"
          >
            <option value="feet">Feet</option>
            <option value="meters">Meters</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-[var(--cyber-text-dim)] mb-1">Declination</label>
          <input
            type="number" step="0.1" value={declination}
            onChange={e => setDeclination(e.target.value)}
            className="cyber-input w-full px-3 py-2 text-sm" placeholder="0.0"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="cyber-btn cyber-btn-ghost px-3 py-1.5 text-xs">
          Cancel
        </button>
        <button type="submit" disabled={saving || !name}
          className="cyber-btn cyber-btn-cyan px-3 py-1.5 text-xs disabled:opacity-50">
          {saving ? 'Creating...' : 'Create Survey'}
        </button>
      </div>
    </form>
  )
}

// ── Shot Entry Table ────────────────────────────────────────

const EMPTY_ROW = {
  from_station: '', to_station: '', azimuth: '', distance: '',
  inclination: '', left: '', right: '', up: '', down: '', comment: '',
}

const COLUMNS = [
  { key: 'from_station', label: 'From', width: 'w-16' },
  { key: 'to_station', label: 'To', width: 'w-16' },
  { key: 'azimuth', label: 'Az', width: 'w-16', type: 'number' },
  { key: 'distance', label: 'Dist', width: 'w-16', type: 'number' },
  { key: 'inclination', label: 'Inc', width: 'w-14', type: 'number' },
  { key: 'left', label: 'L', width: 'w-12', type: 'number' },
  { key: 'right', label: 'R', width: 'w-12', type: 'number' },
  { key: 'up', label: 'U', width: 'w-12', type: 'number' },
  { key: 'down', label: 'D', width: 'w-12', type: 'number' },
  { key: 'comment', label: 'Notes', width: 'w-24' },
]

function nextStation(name) {
  if (!name) return 'A1'
  const match = name.match(/^([A-Za-z]*)(\d+)$/)
  if (match) return match[1] + (parseInt(match[2]) + 1)
  return name + '1'
}

function suggestBranchPrefix(stationNames) {
  const used = new Set()
  for (const name of stationNames) {
    const match = name.match(/^([A-Za-z]+)/)
    if (match) used.add(match[1].toUpperCase())
  }
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (!used.has(c)) return c
  }
  return 'AA'
}

function ShotEntryTable({ caveId, survey, onCompute, onSave, renderData, branchFromStation, onBranchHandled }) {
  const [rows, setRows] = useState([{ ...EMPTY_ROW }])
  const [saving, setSaving] = useState(false)
  const tableRef = useRef(null)
  const prevSurveyId = useRef(null)

  // Handle branch-from action: add a new row pre-filled with the junction station
  useEffect(() => {
    if (!branchFromStation) return
    const newRow = {
      ...EMPTY_ROW,
      from_station: branchFromStation.from,
      to_station: branchFromStation.suggestedTo,
    }
    setRows(prev => [...prev.filter(r => r.from_station || r.to_station), newRow, { ...EMPTY_ROW }])
    onBranchHandled?.()
    // Focus the azimuth field since stations are pre-filled
    setTimeout(() => {
      const allRows = tableRef.current?.querySelectorAll('tr')
      if (allRows) {
        const targetRow = allRows[allRows.length - 2] // second to last (before empty)
        targetRow?.querySelectorAll('input')?.[2]?.focus()
      }
    }, 50)
  }, [branchFromStation])

  // Load existing shots into rows — clear and rebuild when survey changes or shots reload
  useEffect(() => {
    const currentId = survey?.id
    if (currentId !== prevSurveyId.current) {
      // Survey changed — reset rows completely
      prevSurveyId.current = currentId
      if (!survey?.shots?.length) {
        setRows([{ ...EMPTY_ROW }])
        return
      }
    }
    if (survey?.shots?.length > 0) {
      const existing = survey.shots.map(s => ({
        from_station: s.from_station_name,
        to_station: s.to_station_name,
        azimuth: s.azimuth?.toString() ?? '',
        distance: s.distance?.toString() ?? '',
        inclination: s.inclination?.toString() ?? '',
        left: s.left?.toString() ?? '',
        right: s.right?.toString() ?? '',
        up: s.up?.toString() ?? '',
        down: s.down?.toString() ?? '',
        comment: s.comment ?? '',
        _id: s.id,
        _saved: true,
      }))
      // Add empty row at end for new entry
      existing.push({ ...EMPTY_ROW })
      setRows(existing)
    } else if (!survey?.shots?.length) {
      setRows([{ ...EMPTY_ROW }])
    }
  }, [survey?.id, survey?.shots])

  const updateRow = useCallback((idx, key, value) => {
    setRows(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], [key]: value, _saved: false }

      // Auto-fill station names
      if (key === 'from_station' && !updated[idx].to_station) {
        updated[idx].to_station = nextStation(value)
      }

      // Auto-compute azimuth/distance/inclination when reconnecting to a known station
      if (key === 'to_station' && renderData?.stations?.length > 0) {
        const fromName = updated[idx].from_station
        const toName = value
        const fromSt = renderData.stations.find(s => s.name === fromName)
        const toSt = renderData.stations.find(s => s.name === toName)
        if (fromSt && toSt && !updated[idx].azimuth && !updated[idx].distance) {
          const dx = toSt.x - fromSt.x
          const dy = toSt.y - fromSt.y
          const dz = (toSt.z || 0) - (fromSt.z || 0)
          const horizDist = Math.sqrt(dx * dx + dy * dy)
          const dist3d = Math.sqrt(dx * dx + dy * dy + dz * dz)
          // Azimuth: atan2(dx, dy) → degrees, convert to 0-360
          // dx = East component (sin), dy = North component (cos)
          let az = Math.atan2(dx, dy) * (180 / Math.PI)
          if (az < 0) az += 360
          // Subtract declination to get magnetic bearing
          const decl = survey?.declination || 0
          az = ((az - decl) % 360 + 360) % 360
          // Convert distance back to survey units
          const unitScale = survey?.unit === 'feet' ? 0.3048 : 1.0
          const distInUnits = dist3d / unitScale
          const inc = horizDist > 0.001 ? Math.atan2(dz, horizDist) * (180 / Math.PI) : 0
          updated[idx].azimuth = az.toFixed(1)
          updated[idx].distance = distInUnits.toFixed(1)
          updated[idx].inclination = inc.toFixed(1)
          updated[idx]._autoFilled = true
        }
      }

      return updated
    })
  }, [renderData, survey])

  const handleKeyDown = useCallback((e, rowIdx, colIdx) => {
    if (e.key === 'Tab' && !e.shiftKey && colIdx === COLUMNS.length - 1) {
      // Tab on last column → add new row if this is the last row
      if (rowIdx === rows.length - 1) {
        e.preventDefault()
        const lastRow = rows[rowIdx]
        const newRow = {
          ...EMPTY_ROW,
          from_station: lastRow.to_station,
          to_station: nextStation(lastRow.to_station),
        }
        setRows(prev => [...prev, newRow])
        // Focus first cell of new row after render
        setTimeout(() => {
          const inputs = tableRef.current?.querySelectorAll(`tr:last-child input`)
          inputs?.[0]?.focus()
        }, 50)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // Move to same column in next row
      const nextRow = tableRef.current?.querySelectorAll(
        `tbody tr:nth-child(${rowIdx + 2}) input`,
      )
      if (nextRow?.[colIdx]) {
        nextRow[colIdx].focus()
      } else {
        // Add new row
        const lastRow = rows[rowIdx]
        const newRow = {
          ...EMPTY_ROW,
          from_station: lastRow.to_station,
          to_station: nextStation(lastRow.to_station),
        }
        setRows(prev => [...prev, newRow])
        setTimeout(() => {
          const inputs = tableRef.current?.querySelectorAll(`tr:last-child input`)
          inputs?.[colIdx]?.focus()
        }, 50)
      }
    }
  }, [rows])

  const handlePaste = useCallback((e) => {
    const text = e.clipboardData?.getData('text')
    if (!text || !text.includes('\t')) return

    e.preventDefault()
    const lines = text.trim().split('\n')
    const newRows = lines.map(line => {
      const cells = line.split('\t')
      return {
        from_station: cells[0] || '',
        to_station: cells[1] || '',
        azimuth: cells[2] || '',
        distance: cells[3] || '',
        inclination: cells[4] || '',
        left: cells[5] || '',
        right: cells[6] || '',
        up: cells[7] || '',
        down: cells[8] || '',
        comment: cells[9] || '',
      }
    }).filter(r => r.from_station && r.to_station)

    if (newRows.length > 0) {
      setRows(prev => [...prev.filter(r => r.from_station), ...newRows, { ...EMPTY_ROW }])
    }
  }, [])

  const deleteRow = useCallback((idx) => {
    setRows(prev => {
      if (prev.length <= 1) return [{ ...EMPTY_ROW }]
      return prev.filter((_, i) => i !== idx)
    })
  }, [])

  const handleSave = async () => {
    const unsaved = rows.filter(r =>
      r.from_station && r.to_station && r.distance && r.azimuth && !r._saved,
    )
    if (unsaved.length === 0) return

    setSaving(true)
    try {
      const payload = unsaved.map(r => ({
        from_station: r.from_station,
        to_station: r.to_station,
        distance: parseFloat(r.distance),
        azimuth: parseFloat(r.azimuth),
        inclination: parseFloat(r.inclination) || 0,
        left: r.left ? parseFloat(r.left) : null,
        right: r.right ? parseFloat(r.right) : null,
        up: r.up ? parseFloat(r.up) : null,
        down: r.down ? parseFloat(r.down) : null,
        comment: r.comment || '',
      }))

      await apiFetch(`/caves/${caveId}/surveys/${survey.id}/shots/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      // Mark saved
      setRows(prev => prev.map(r => ({
        ...r,
        _saved: (r.from_station && r.to_station && r.distance && r.azimuth) ? true : r._saved,
      })))

      if (onSave) onSave()
    } catch (err) {
      console.error('Save shots failed:', err)
    } finally {
      setSaving(false)
    }
  }

  const unsavedCount = rows.filter(r =>
    r.from_station && r.to_station && r.distance && r.azimuth && !r._saved,
  ).length

  const totalShots = rows.filter(r => r.from_station && r.to_station && r.distance && r.azimuth).length

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--cyber-text-dim)]">
            {rows.filter(r => r.from_station).length} shots
          </span>
          {unsavedCount > 0 && (
            <span className="text-xs" style={{ color: 'var(--cyber-magenta)' }}>
              {unsavedCount} unsaved
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {unsavedCount > 0 && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="cyber-btn cyber-btn-cyan px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {saving ? 'Saving...' : `Save (${unsavedCount})`}
            </button>
          )}
          <button
            onClick={onCompute}
            disabled={saving || totalShots === 0}
            className="cyber-btn cyber-btn-ghost px-3 py-1.5 text-xs disabled:opacity-50"
            style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' }}
          >
            Compute
          </button>
        </div>
      </div>

      <div className="overflow-x-auto" onPaste={handlePaste}>
        <table ref={tableRef} className="w-full text-xs">
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  className={`${col.width} px-1 py-1.5 text-left font-medium`}
                  style={{ color: 'var(--cyber-text-dim)' }}
                >
                  {col.label}
                </th>
              ))}
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => {
              const branchId = renderData?.station_branches?.[row.from_station]
              const branchColor = branchId != null ? BRANCH_COLORS[branchId % BRANCH_COLORS.length] : null
              return (
              <tr
                key={rowIdx}
                className={row._saved ? 'opacity-70' : ''}
                style={branchColor ? { borderLeft: `3px solid ${branchColor}` } : undefined}
              >
                {COLUMNS.map((col, colIdx) => (
                  <td key={col.key} className="px-0.5 py-0.5">
                    <input
                      type={col.type || 'text'}
                      step={col.type === 'number' ? 'any' : undefined}
                      value={row[col.key]}
                      onChange={e => updateRow(rowIdx, col.key, e.target.value)}
                      onKeyDown={e => handleKeyDown(e, rowIdx, colIdx)}
                      className="cyber-input w-full px-1.5 py-1 text-xs"
                      style={{ minWidth: '40px' }}
                    />
                  </td>
                ))}
                <td className="px-0.5 py-0.5">
                  <button
                    onClick={() => deleteRow(rowIdx)}
                    className="text-[var(--cyber-text-dim)] hover:text-red-400 text-xs px-1"
                    title="Delete row"
                  >
                    x
                  </button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[var(--cyber-text-dim)] mt-2">
        Tab to advance cells. Enter to move down. Paste TSV data from a spreadsheet.
      </p>
    </div>
  )
}

// ── Survey Manager (main component) ─────────────────────────

export default function SurveyManager({ caveId, onRenderData }) {
  const { data, loading, refetch } = useApi(`/caves/${caveId}/surveys/`)
  const surveys = data ?? []
  const [selectedId, setSelectedId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [renderData, setRenderData] = useState(null)
  const [computing, setComputing] = useState(false)
  const [branchFromStation, setBranchFromStation] = useState(null)

  // Fetch detail for selected survey
  const { data: detail, refetch: refetchDetail } = useApi(
    selectedId ? `/caves/${caveId}/surveys/${selectedId}/` : null,
  )

  // Clear render data when switching surveys, then auto-load persisted data
  useEffect(() => {
    setRenderData(null)
    if (onRenderData) onRenderData(null)
  }, [selectedId])

  useEffect(() => {
    if (detail?.render_data) {
      setRenderData(detail.render_data)
      if (onRenderData) onRenderData(detail.render_data)
    }
  }, [detail?.id])

  const handleCompute = useCallback(async () => {
    if (!selectedId) return
    setComputing(true)
    try {
      const data = await apiFetch(`/caves/${caveId}/surveys/${selectedId}/compute/`, {
        method: 'POST',
      })
      setRenderData(data)
      if (onRenderData) onRenderData(data)
      refetchDetail()
    } catch (err) {
      console.error('Compute failed:', err)
    } finally {
      setComputing(false)
    }
  }, [selectedId, caveId, onRenderData, refetchDetail])

  const handleDelete = useCallback(async (surveyId) => {
    if (!confirm('Delete this survey and all its shots?')) return
    try {
      await apiFetch(`/caves/${caveId}/surveys/${surveyId}/`, { method: 'DELETE' })
      if (selectedId === surveyId) {
        setSelectedId(null)
        setRenderData(null)
        if (onRenderData) onRenderData(null)
      }
      refetch()
    } catch { /* ignore */ }
  }, [caveId, selectedId, refetch, onRenderData])

  const handleBranchFrom = useCallback((stationName) => {
    const existingStations = renderData?.stations?.map(s => s.name) || []
    const nextPrefix = suggestBranchPrefix(existingStations)
    setBranchFromStation({ from: stationName, suggestedTo: nextPrefix + '1' })
  }, [renderData])

  if (loading) {
    return <p className="text-center text-[var(--cyber-text-dim)] py-6">Loading surveys...</p>
  }

  return (
    <div>
      {/* Survey list */}
      {!selectedId && !creating && (
        <>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold" style={{ color: 'var(--cyber-cyan)' }}>
              Surveys ({surveys.length})
            </h3>
            <button
              onClick={() => setCreating(true)}
              className="cyber-btn cyber-btn-cyan px-3 py-1.5 text-xs"
            >
              + New Survey
            </button>
          </div>

          {surveys.length === 0 ? (
            <p className="text-center text-[var(--cyber-text-dim)] py-8">
              No surveys yet. Create one to start mapping.
            </p>
          ) : (
            <div className="space-y-2">
              {surveys.map(s => (
                <div key={s.id} className="cyber-card p-4 flex items-center justify-between">
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => setSelectedId(s.id)}
                  >
                    <h4 className="text-sm font-medium text-[var(--cyber-text)]">{s.name}</h4>
                    <div className="flex gap-3 mt-1 text-[10px] text-[var(--cyber-text-dim)]">
                      {s.date_surveyed && <span>{s.date_surveyed}</span>}
                      {s.surveyors && <span>{s.surveyors}</span>}
                      <span>{s.station_count} stations</span>
                      {s.total_length != null && (
                        <span>{s.total_length.toFixed(1)}m total</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedId(s.id)}
                      className="cyber-btn cyber-btn-ghost px-2 py-1 text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="cyber-btn cyber-btn-ghost px-2 py-1 text-xs"
                      style={{ borderColor: '#ef4444', color: '#ef4444' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Create form */}
      {creating && (
        <CreateSurveyForm
          caveId={caveId}
          onCreated={() => { setCreating(false); refetch() }}
          onCancel={() => setCreating(false)}
        />
      )}

      {/* Survey detail + shot entry */}
      {selectedId && detail && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <button
                onClick={() => { setSelectedId(null); setRenderData(null) }}
                className="text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] mb-1"
              >
                &larr; Back to surveys
              </button>
              <h3 className="text-sm font-bold" style={{ color: 'var(--cyber-cyan)' }}>
                {detail.name}
              </h3>
              <div className="flex gap-3 text-[10px] text-[var(--cyber-text-dim)] mt-0.5">
                <span>{detail.unit}</span>
                <span>decl: {detail.declination}&deg;</span>
                {detail.station_count > 0 && <span>{detail.station_count} stations</span>}
                {detail.total_length != null && <span>{detail.total_length.toFixed(1)}m</span>}
                {detail.total_depth != null && <span>depth: {detail.total_depth.toFixed(1)}m</span>}
              </div>
            </div>
            {computing && (
              <span className="text-xs" style={{ color: 'var(--cyber-cyan)' }}>Computing...</span>
            )}
          </div>

          {/* Stats from last compute */}
          {renderData && renderData.loops_closed > 0 && (
            <div className="cyber-card p-3 mb-3">
              <span className="text-xs" style={{ color: 'var(--cyber-cyan)' }}>
                {renderData.loops_closed} loop{renderData.loops_closed > 1 ? 's' : ''} closed
              </span>
              {renderData.closure_errors.map((err, i) => (
                <span key={i} className="text-[10px] text-[var(--cyber-text-dim)] ml-3">
                  {err.from}&rarr;{err.to}: {err.error_m.toFixed(3)}m error
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            {/* Topology sidebar — only shown when 2+ branches */}
            {renderData?.branches?.length > 1 && (
              <div className="shrink-0" style={{ width: 180 }}>
                <SurveyTopologyGraph
                  renderData={renderData}
                  onBranchFrom={handleBranchFrom}
                  height={400}
                />
                <p className="text-[9px] text-[var(--cyber-text-dim)] mt-1 px-1">
                  Click a station to branch from it
                </p>
              </div>
            )}

            {/* Shot entry table */}
            <div className="flex-1 min-w-0">
              <ShotEntryTable
                caveId={caveId}
                survey={detail}
                onCompute={handleCompute}
                onSave={() => refetchDetail()}
                renderData={renderData}
                branchFromStation={branchFromStation}
                onBranchHandled={() => setBranchFromStation(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
