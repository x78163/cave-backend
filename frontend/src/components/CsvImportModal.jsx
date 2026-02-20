import { useState, useRef } from 'react'
import { apiFetch } from '../hooks/useApi'

export default function CsvImportModal({ onClose, onComplete }) {
  const [step, setStep] = useState(0) // 0=Upload, 1=Preview, 2=Results

  // Upload state
  const [csvFile, setCsvFile] = useState(null)
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
    if (!csvFile) return
    setUploading(true)
    setUploadError(null)
    const formData = new FormData()
    formData.append('csv_file', csvFile)
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
      for (const row of data.parsed_rows) {
        if (row.error) continue
        if (row.duplicates.length > 0) {
          init[row.row_number] = {
            resolution: 'skip',
            existing_cave_id: row.duplicates[0].id,
            new_name: '',
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
  const conflictRows = previewData?.parsed_rows.filter(r => !r.error && r.duplicates.length > 0) || []
  const cleanRows = previewData?.parsed_rows.filter(r => !r.error && r.duplicates.length === 0) || []
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
            {step === 0 ? 'Import Caves from CSV' : step === 1 ? 'Review Import' : 'Import Complete'}
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
            {/* File input */}
            <div
              className="border-2 border-dashed border-[var(--cyber-border)] rounded-xl p-8 text-center cursor-pointer hover:border-[var(--cyber-cyan)] transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
              onDrop={e => {
                e.preventDefault()
                e.stopPropagation()
                const f = e.dataTransfer.files[0]
                if (f && (f.name.endsWith('.csv') || f.type === 'text/csv')) {
                  setCsvFile(f)
                }
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={e => setCsvFile(e.target.files[0] || null)}
              />
              {csvFile ? (
                <div>
                  <p className="text-[var(--cyber-cyan)] font-semibold">{csvFile.name}</p>
                  <p className="text-xs text-[var(--cyber-text-dim)] mt-1">
                    {(csvFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-[var(--cyber-text-dim)]">Drop CSV file here or click to browse</p>
                  <p className="text-xs text-[var(--cyber-text-dim)] mt-1">Max 5MB</p>
                </div>
              )}
            </div>

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
                disabled={!csvFile || uploading}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold
                  bg-gradient-to-r from-cyan-600 to-cyan-700 text-white
                  shadow-[0_0_12px_rgba(0,229,255,0.2)]
                  disabled:opacity-40 disabled:cursor-not-allowed
                  active:scale-[0.98] transition-all"
              >
                {uploading ? 'Parsing...' : 'Preview Import'}
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
                <span className="text-amber-400">{previewData.summary.with_duplicates} potential duplicates</span>
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
                    const match = row.duplicates[0]
                    return (
                      <div key={row.row_number}
                        className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                        {/* Import row vs matched cave */}
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--cyber-text)] truncate">
                              CSV: {row.name}
                            </p>
                            <p className="text-[10px] text-[var(--cyber-text-dim)]">
                              {row.latitude?.toFixed(4)}, {row.longitude?.toFixed(4)}
                              {row.total_length ? ` \u2022 ${row.total_length}m` : ''}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm text-[var(--cyber-text-dim)]">
                              Matches: <span className="text-[var(--cyber-text)]">{match.name}</span>
                            </p>
                            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-400">
                              {match.distance_m}m away
                            </span>
                          </div>
                        </div>

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
                            Keep Original
                          </label>

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
                                existing_cave_id: match.id,
                              })}
                              className="hidden"
                            />
                            Replace
                          </label>

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
                            Rename & Import
                          </label>
                        </div>

                        {/* Rename input */}
                        {r.resolution === 'create' && (
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
