import { useState, useRef } from 'react'
import { apiFetch } from '../hooks/useApi'

const ACCEPTED_EXTENSIONS = ['csv', 'xlsx', 'kml', 'kmz']

export default function BulkImportModal({ onClose, onComplete }) {
  const [step, setStep] = useState(0) // 0=Upload, 1=Preview, 2=Results

  // Upload state
  const [importMode, setImportMode] = useState('file') // 'file' or 'url'
  const [importFile, setImportFile] = useState(null)
  const [importUrl, setImportUrl] = useState('')
  const [threshold, setThreshold] = useState(100)
  const [defaultRegion, setDefaultRegion] = useState('')
  const [defaultCountry, setDefaultCountry] = useState('')
  const [defaultVisibility, setDefaultVisibility] = useState('public')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const fileRef = useRef(null)

  // Preview state
  const [previewData, setPreviewData] = useState(null)
  const [resolutions, setResolutions] = useState({})
  const [applying, setApplying] = useState(false)

  // Results state
  const [results, setResults] = useState(null)

  // ── Upload ──

  const handlePreview = async () => {
    if (importMode === 'file' && !importFile) return
    if (importMode === 'url' && !importUrl.trim()) return
    setUploading(true)
    setUploadError(null)
    const formData = new FormData()
    if (importMode === 'url') {
      formData.append('import_url', importUrl.trim())
    } else {
      formData.append('import_file', importFile)
    }
    formData.append('threshold_meters', threshold)
    if (defaultRegion) formData.append('region', defaultRegion)
    if (defaultCountry) formData.append('country', defaultCountry)
    formData.append('visibility', defaultVisibility)

    try {
      const data = await apiFetch('/caves/import/preview/', {
        method: 'POST',
        body: formData,
      })
      setPreviewData(data)
      // Initialize resolutions
      const init = {}
      const intraPrimaries = new Set()
      for (const row of data.parsed_rows) {
        if (row.error) continue
        const hasDbDupes = row.duplicates.length > 0
        const hasIntraDupes = (row.intra_csv_duplicates || []).length > 0

        if (hasDbDupes) {
          const isApproxMatch = row.cave_data?.coordinates_approximate || row.duplicates[0].approximate_match
          init[row.row_number] = {
            resolution: isApproxMatch ? 'create' : 'skip',
            existing_cave_id: row.duplicates[0].id,
            new_name: '',
          }
        } else if (hasIntraDupes) {
          // First row in cluster creates, later rows skip
          const clusterRowNumbers = row.intra_csv_duplicates.map(d => d.row_number)
          const earliest = Math.min(row.row_number, ...clusterRowNumbers)
          if (earliest === row.row_number && !intraPrimaries.has(earliest)) {
            intraPrimaries.add(row.row_number)
            init[row.row_number] = { resolution: 'create', existing_cave_id: null, new_name: '' }
          } else {
            init[row.row_number] = { resolution: 'skip', existing_cave_id: null, new_name: '' }
          }
        } else {
          init[row.row_number] = {
            resolution: 'create',
            existing_cave_id: null,
            new_name: '',
          }
        }
      }
      setResolutions(init)
      setStep(1)
    } catch (err) {
      setUploadError(err?.response?.data?.error || 'Preview failed')
    } finally {
      setUploading(false)
    }
  }

  // ── Resolve ──

  const setRowResolution = (rowNum, resolution, opts = {}) => {
    setResolutions(prev => ({
      ...prev,
      [rowNum]: { ...prev[rowNum], resolution, ...opts },
    }))
  }

  const importCounts = previewData ? (() => {
    let creates = 0, updates = 0, skips = 0
    for (const row of previewData.parsed_rows) {
      if (row.error) continue
      const r = resolutions[row.row_number]
      if (!r) continue
      if (r.resolution === 'create') creates++
      else if (r.resolution === 'update') updates++
      else skips++
    }
    return { creates, updates, skips }
  })() : { creates: 0, updates: 0, skips: 0 }

  // ── Apply ──

  const handleApply = async () => {
    setApplying(true)
    setUploadError(null)
    const rows = previewData.parsed_rows
      .filter(row => !row.error && resolutions[row.row_number])
      .map(row => {
        const r = resolutions[row.row_number]
        return {
          name: row.name,
          cave_data: row.cave_data,
          extra_entrances: row.extra_entrances || [],
          resolution: r.resolution,
          existing_cave_id: r.existing_cave_id || null,
          new_name: r.resolution === 'create' && r.new_name ? r.new_name : null,
        }
      })

    try {
      const data = await apiFetch('/caves/import/apply/', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      })
      setResults(data)
      setStep(2)
    } catch (err) {
      setUploadError(err?.response?.data?.error || 'Import failed')
    } finally {
      setApplying(false)
    }
  }

  // ── Partition rows for preview ──
  const hasAnyDuplicate = r => !r.error && (r.duplicates.length > 0 || (r.intra_csv_duplicates || []).length > 0)
  const conflictRows = previewData?.parsed_rows.filter(hasAnyDuplicate) || []
  const cleanRows = previewData?.parsed_rows.filter(r => !r.error && !hasAnyDuplicate(r)) || []
  const errorRows = previewData?.parsed_rows.filter(r => r.error) || []

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: 'rgba(10, 10, 18, 0.92)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="cyber-card w-full max-w-3xl max-h-[85vh] flex flex-col p-6"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--cyber-text)]">
            {step === 0 ? 'Bulk Import Caves' : step === 1 ? 'Review Import' : 'Import Complete'}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--cyber-text-dim)] hover:text-[var(--cyber-text)] text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex gap-2 mb-5">
          {['Upload', 'Review', 'Done'].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                i < step ? 'bg-[var(--cyber-cyan)] text-[var(--cyber-bg)]'
                : i === step ? 'border-2 border-[var(--cyber-cyan)] text-[var(--cyber-cyan)]'
                : 'border border-[var(--cyber-border)] text-[var(--cyber-text-dim)]'
              }`}>
                {i < step ? '\u2713' : i + 1}
              </span>
              <span className={`text-xs ${i === step ? 'text-[var(--cyber-text)]' : 'text-[var(--cyber-text-dim)]'}`}>
                {label}
              </span>
              {i < 2 && <span className="text-[var(--cyber-border)] mx-1">&mdash;</span>}
            </div>
          ))}
        </div>

        {/* Error banner */}
        {uploadError && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {uploadError}
          </div>
        )}

        {/* ── Step 0: Upload ── */}
        {step === 0 && (
          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Mode tabs */}
            <div className="flex gap-1 p-1 rounded-lg bg-[var(--cyber-bg)]">
              <button
                onClick={() => setImportMode('file')}
                className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  importMode === 'file'
                    ? 'bg-[var(--cyber-surface)] text-[var(--cyber-cyan)] shadow-sm'
                    : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-text)]'
                }`}
              >
                Upload File
              </button>
              <button
                onClick={() => setImportMode('url')}
                className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  importMode === 'url'
                    ? 'bg-[var(--cyber-surface)] text-[var(--cyber-cyan)] shadow-sm'
                    : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-text)]'
                }`}
              >
                Paste URL
              </button>
            </div>

            {importMode === 'file' ? (
              /* File input */
              <div
                className="border-2 border-dashed border-[var(--cyber-border)] rounded-xl p-8 text-center cursor-pointer hover:border-[var(--cyber-cyan)] transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                onDrop={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  const f = e.dataTransfer.files[0]
                  if (f) {
                    const ext = f.name.toLowerCase().split('.').pop()
                    if (ACCEPTED_EXTENSIONS.includes(ext)) setImportFile(f)
                  }
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.kml,.kmz"
                  className="hidden"
                  onChange={e => setImportFile(e.target.files[0] || null)}
                />
                {importFile ? (
                  <div>
                    <p className="text-[var(--cyber-cyan)] font-semibold">{importFile.name}</p>
                    <div className="flex items-center justify-center gap-2 mt-1">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        importFile.name.toLowerCase().endsWith('.csv') ? 'bg-green-500/20 text-green-400'
                        : importFile.name.toLowerCase().endsWith('.xlsx') ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-amber-500/20 text-amber-400'
                      }`}>
                        {importFile.name.split('.').pop().toUpperCase()}
                      </span>
                      <span className="text-xs text-[var(--cyber-text-dim)]">
                        {(importFile.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-[var(--cyber-text-dim)]">Drop file here or click to browse</p>
                    <p className="text-xs text-[var(--cyber-text-dim)] mt-1">CSV, Excel, KML, or KMZ (max 10MB)</p>
                  </div>
                )}
              </div>
            ) : (
              /* URL input */
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Google Maps List URL</label>
                  <input
                    type="url"
                    value={importUrl}
                    onChange={e => setImportUrl(e.target.value)}
                    placeholder="https://maps.app.goo.gl/..."
                    className="cyber-input w-full px-3 py-2.5 text-sm"
                    autoFocus
                  />
                </div>
                <p className="text-[10px] text-[var(--cyber-text-dim)] leading-relaxed">
                  Paste a shared Google Maps list link. The list must be publicly shared.
                  Open the list in Google Maps, tap the share button, and copy the link.
                </p>
              </div>
            )}

            {/* Advanced options toggle */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] transition-colors"
            >
              {showAdvanced ? '\u25BE' : '\u25B8'} Advanced Options
            </button>

            {showAdvanced && (
              <div className="space-y-3 pl-2 border-l-2 border-[var(--cyber-border)]">
                {/* Proximity threshold */}
                <div>
                  <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">
                    Duplicate proximity threshold: {threshold}m
                  </label>
                  <input
                    type="range"
                    min={10}
                    max={500}
                    step={10}
                    value={threshold}
                    onChange={e => setThreshold(Number(e.target.value))}
                    className="w-full accent-[var(--cyber-cyan)]"
                  />
                  <div className="flex justify-between text-[10px] text-[var(--cyber-text-dim)]">
                    <span>10m</span><span>500m</span>
                  </div>
                </div>

                {/* Default region/country */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Default Region</label>
                    <input
                      type="text"
                      value={defaultRegion}
                      onChange={e => setDefaultRegion(e.target.value)}
                      placeholder="e.g. Tennessee"
                      className="cyber-input w-full px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Default Country</label>
                    <input
                      type="text"
                      value={defaultCountry}
                      onChange={e => setDefaultCountry(e.target.value)}
                      placeholder="e.g. United States"
                      className="cyber-input w-full px-3 py-1.5 text-sm"
                    />
                  </div>
                </div>

                {/* Default visibility */}
                <div>
                  <label className="text-xs text-[var(--cyber-text-dim)] block mb-1">Default Visibility</label>
                  <select
                    value={defaultVisibility}
                    onChange={e => setDefaultVisibility(e.target.value)}
                    className="cyber-input px-3 py-1.5 text-sm"
                  >
                    <option value="public">Public</option>
                    <option value="limited_public">Limited Public</option>
                    <option value="private">Private</option>
                  </select>
                </div>
              </div>
            )}

            {/* Preview button */}
            <div className="pt-2">
              <button
                onClick={handlePreview}
                disabled={(importMode === 'file' ? !importFile : !importUrl.trim()) || uploading}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold
                  bg-gradient-to-r from-cyan-600 to-cyan-700 text-white
                  shadow-[0_0_12px_rgba(0,229,255,0.2)]
                  disabled:opacity-40 disabled:cursor-not-allowed
                  active:scale-[0.98] transition-all"
              >
                {uploading ? (importMode === 'url' ? 'Fetching list...' : 'Parsing...') : 'Preview Import'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1: Preview & Resolve ── */}
        {step === 1 && previewData && (
          <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
            {/* Summary bar */}
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="text-[var(--cyber-text-dim)]">
                {previewData.total_rows} rows:
              </span>
              <span className="text-green-400">{previewData.summary.valid} valid</span>
              {previewData.summary.with_duplicates > 0 && (
                <span className="text-amber-400">{previewData.summary.with_duplicates} DB duplicates</span>
              )}
              {previewData.summary.intra_csv_duplicates > 0 && (
                <span className="text-purple-400">{previewData.summary.intra_csv_duplicates} internal duplicates</span>
              )}
              {previewData.parsed_rows.filter(r => r.cave_data?.coordinates_approximate).length > 0 && (
                <span className="text-red-400">
                  {previewData.parsed_rows.filter(r => r.cave_data?.coordinates_approximate).length} approximate
                </span>
              )}
              {previewData.summary.errors > 0 && (
                <span className="text-red-400">{previewData.summary.errors} errors</span>
              )}
              {previewData.summary.without_coordinates > 0 && (
                <span className="text-[var(--cyber-text-dim)]">{previewData.summary.without_coordinates} no coords</span>
              )}
            </div>

            {/* Conflicts section */}
            {conflictRows.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-amber-400 mb-2">
                  Potential Duplicates ({conflictRows.length})
                </h3>
                <div className="space-y-3">
                  {conflictRows.map(row => {
                    const r = resolutions[row.row_number] || {}
                    const dbMatch = row.duplicates[0] || null
                    const intraDupes = row.intra_csv_duplicates || []
                    const hasDbDupes = row.duplicates.length > 0
                    const hasIntraDupes = intraDupes.length > 0
                    const isApprox = row.cave_data?.coordinates_approximate
                    const isApproxDbMatch = hasDbDupes && (isApprox || dbMatch.approximate_match)

                    return (
                      <div key={row.row_number}
                        className={`rounded-lg p-3 space-y-2 ${
                          isApproxDbMatch && !hasIntraDupes
                            ? 'border border-[var(--cyber-border)] bg-[var(--cyber-surface)]/30'
                            : 'border border-amber-500/30 bg-amber-500/5'
                        }`}>
                        {/* Row header */}
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--cyber-text)] truncate">
                              <span className="text-[var(--cyber-text-dim)] text-xs mr-1">Row {row.row_number}:</span>
                              {row.name}
                              {isApprox && (
                                <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-400">approx</span>
                              )}
                              {row.extra_entrances?.length > 0 && (
                                <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-500/20 text-green-400">+{row.extra_entrances.length} entrance{row.extra_entrances.length > 1 ? 's' : ''}</span>
                              )}
                            </p>
                            <p className="text-[10px] text-[var(--cyber-text-dim)]">
                              {row.latitude?.toFixed(4)}, {row.longitude?.toFixed(4)}
                              {row.total_length ? ` \u2022 ${row.total_length}m` : ''}
                            </p>
                          </div>
                        </div>

                        {/* DB duplicate match */}
                        {hasDbDupes && (
                          <div className="flex items-center gap-2 text-xs flex-wrap">
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-semibold">DB</span>
                            <span className="text-[var(--cyber-text-dim)]">
                              Matches existing: <span className="text-[var(--cyber-text)]">{dbMatch.name}</span>
                              {dbMatch.coordinates_approximate && (
                                <span className="ml-1 text-red-400 italic">(approx)</span>
                              )}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-400">
                              {dbMatch.distance_m}m away
                            </span>
                            {isApproxDbMatch && (
                              <span className="text-[10px] text-[var(--cyber-text-dim)] italic">approximate match</span>
                            )}
                          </div>
                        )}

                        {/* Intra-CSV duplicate matches */}
                        {hasIntraDupes && intraDupes.map(dup => (
                          <div key={dup.row_number} className="flex items-center gap-2 text-xs flex-wrap">
                            <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 text-[10px] font-semibold">FILE</span>
                            <span className="text-[var(--cyber-text-dim)]">
                              Matches row {dup.row_number}: <span className="text-[var(--cyber-text)]">{dup.name}</span>
                            </span>
                            {dup.distance_m != null && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/20 text-purple-400">
                                {dup.distance_m}m away
                              </span>
                            )}
                            <span className="text-[10px] text-[var(--cyber-text-dim)] italic">
                              {dup.match_type === 'both' ? 'name + proximity'
                                : dup.match_type === 'approximate_proximity' ? 'approx proximity'
                                : dup.match_type}
                            </span>
                          </div>
                        ))}

                        {/* Resolution options */}
                        <div className="flex flex-wrap gap-2">
                          <label className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer border transition-all ${
                            r.resolution === 'skip'
                              ? 'border-[var(--cyber-cyan)] bg-[var(--cyber-cyan)]/10 text-[var(--cyber-cyan)]'
                              : 'border-[var(--cyber-border)] text-[var(--cyber-text-dim)] hover:border-[var(--cyber-text-dim)]'
                          }`}>
                            <input
                              type="radio"
                              name={`res-${row.row_number}`}
                              checked={r.resolution === 'skip'}
                              onChange={() => setRowResolution(row.row_number, 'skip')}
                              className="hidden"
                            />
                            {hasDbDupes ? 'Keep Original' : 'Skip'}
                          </label>

                          {hasDbDupes && (
                            <label className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer border transition-all ${
                              r.resolution === 'update'
                                ? 'border-[var(--cyber-cyan)] bg-[var(--cyber-cyan)]/10 text-[var(--cyber-cyan)]'
                                : 'border-[var(--cyber-border)] text-[var(--cyber-text-dim)] hover:border-[var(--cyber-text-dim)]'
                            }`}>
                              <input
                                type="radio"
                                name={`res-${row.row_number}`}
                                checked={r.resolution === 'update'}
                                onChange={() => setRowResolution(row.row_number, 'update', {
                                  existing_cave_id: dbMatch.id,
                                })}
                                className="hidden"
                              />
                              Replace
                            </label>
                          )}

                          <label className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer border transition-all ${
                            r.resolution === 'create'
                              ? 'border-[var(--cyber-cyan)] bg-[var(--cyber-cyan)]/10 text-[var(--cyber-cyan)]'
                              : 'border-[var(--cyber-border)] text-[var(--cyber-text-dim)] hover:border-[var(--cyber-text-dim)]'
                          }`}>
                            <input
                              type="radio"
                              name={`res-${row.row_number}`}
                              checked={r.resolution === 'create'}
                              onChange={() => setRowResolution(row.row_number, 'create')}
                              className="hidden"
                            />
                            {hasDbDupes ? 'Rename & Import' : 'Import Anyway'}
                          </label>
                        </div>

                        {/* Rename input (for DB duplicate rename) */}
                        {r.resolution === 'create' && hasDbDupes && (
                          <input
                            type="text"
                            value={r.new_name || ''}
                            onChange={e => setRowResolution(row.row_number, 'create', { new_name: e.target.value })}
                            placeholder={`New name (leave blank to use "${row.name}")`}
                            className="cyber-input w-full px-3 py-1.5 text-sm"
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Clean rows */}
            {cleanRows.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-green-400 mb-2">
                  New Caves ({cleanRows.length})
                </h3>
                <div className="rounded-lg border border-[var(--cyber-border)] divide-y divide-[var(--cyber-border)]">
                  {cleanRows.map(row => (
                    <div key={row.row_number} className="px-3 py-2 flex items-center justify-between">
                      <div>
                        <span className="text-sm text-[var(--cyber-text)]">{row.name}</span>
                        {row.cave_data?.coordinates_approximate && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-400">approx</span>
                        )}
                        {row.extra_entrances?.length > 0 && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-500/20 text-green-400">+{row.extra_entrances.length} entrance{row.extra_entrances.length > 1 ? 's' : ''}</span>
                        )}
                        <span className="text-[10px] text-[var(--cyber-text-dim)] ml-2">
                          {row.region}{row.region && row.country ? ', ' : ''}{row.country}
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--cyber-text-dim)]">
                        {row.latitude != null ? `${row.latitude.toFixed(4)}, ${row.longitude.toFixed(4)}` : 'no coords'}
                        {row.total_length ? ` \u2022 ${row.total_length}m` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error rows */}
            {errorRows.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-red-400 mb-2">
                  Errors ({errorRows.length}) — will be skipped
                </h3>
                <div className="rounded-lg border border-red-500/30 divide-y divide-red-500/20">
                  {errorRows.map((row, i) => (
                    <div key={i} className="px-3 py-2 text-sm">
                      <span className="text-red-400">Row {row.row_number}</span>
                      <span className="text-[var(--cyber-text-dim)] ml-2">
                        {row.name || '(unnamed)'}: {row.error}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--cyber-border)]">
              <button
                onClick={() => { setStep(0); setPreviewData(null) }}
                className="px-4 py-2 rounded-xl text-sm text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
                  hover:border-[var(--cyber-text-dim)] transition-colors"
              >
                Back
              </button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--cyber-text-dim)]">
                  {importCounts.creates} new, {importCounts.updates} updates, {importCounts.skips} skipped
                </span>
                <button
                  onClick={handleApply}
                  disabled={applying || (importCounts.creates + importCounts.updates === 0)}
                  className="px-5 py-2 rounded-xl text-sm font-semibold
                    bg-gradient-to-r from-cyan-600 to-cyan-700 text-white
                    shadow-[0_0_12px_rgba(0,229,255,0.2)]
                    disabled:opacity-40 disabled:cursor-not-allowed
                    active:scale-[0.98] transition-all"
                >
                  {applying ? 'Importing...' : `Import ${importCounts.creates + importCounts.updates} Caves`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Results ── */}
        {step === 2 && results && (
          <div className="flex-1 space-y-4">
            <div className="rounded-xl border border-[var(--cyber-border)] p-5 space-y-3">
              <div className="flex items-center gap-2 text-green-400">
                <span className="text-2xl">{results.created}</span>
                <span className="text-sm">caves created</span>
              </div>
              {results.updated > 0 && (
                <div className="flex items-center gap-2 text-[var(--cyber-cyan)]">
                  <span className="text-2xl">{results.updated}</span>
                  <span className="text-sm">caves updated</span>
                </div>
              )}
              {results.skipped > 0 && (
                <div className="flex items-center gap-2 text-[var(--cyber-text-dim)]">
                  <span className="text-2xl">{results.skipped}</span>
                  <span className="text-sm">skipped</span>
                </div>
              )}
              {results.errors?.length > 0 && (
                <div>
                  <p className="text-sm text-red-400 mb-1">Errors:</p>
                  {results.errors.map((err, i) => (
                    <p key={i} className="text-xs text-red-400/80 pl-2">
                      {err.row_name}: {err.error}
                    </p>
                  ))}
                </div>
              )}
              <p className="text-xs text-[var(--cyber-text-dim)] pt-2 border-t border-[var(--cyber-border)]">
                Total caves in database: {results.total_in_database}
              </p>
            </div>

            <button
              onClick={() => { onComplete?.(); onClose() }}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold
                bg-gradient-to-r from-cyan-600 to-cyan-700 text-white
                shadow-[0_0_12px_rgba(0,229,255,0.2)]
                active:scale-[0.98] transition-all"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
