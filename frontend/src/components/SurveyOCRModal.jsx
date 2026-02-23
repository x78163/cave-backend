import { useState, useRef } from 'react'
import { apiFetch } from '../hooks/useApi'

const SHOT_FIELDS = [
  { key: 'from_station', label: 'From', type: 'text' },
  { key: 'to_station', label: 'To', type: 'text' },
  { key: 'distance', label: 'Dist', type: 'number' },
  { key: 'azimuth', label: 'Az', type: 'number' },
  { key: 'inclination', label: 'Inc', type: 'number' },
  { key: 'left', label: 'L', type: 'number' },
  { key: 'right', label: 'R', type: 'number' },
  { key: 'up', label: 'U', type: 'number' },
  { key: 'down', label: 'D', type: 'number' },
  { key: 'comment', label: 'Notes', type: 'text' },
]

export default function SurveyOCRModal({ caveId, surveyId, onImport, onClose }) {
  const [step, setStep] = useState(0) // 0=upload, 1=review
  const [file, setFile] = useState(null)
  const [expectedRows, setExpectedRows] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState(null)
  const [shots, setShots] = useState([])
  const [rawText, setRawText] = useState('')
  const [warnings, setWarnings] = useState([])
  const [showRaw, setShowRaw] = useState(false)
  const fileRef = useRef(null)

  const handleFileSelect = (f) => {
    if (!f) return
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
    if (!allowed.includes(f.type) && !f.name.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i)) {
      setError('Only image files are accepted (JPG, PNG, WebP, HEIC)')
      return
    }
    if (f.size > 20 * 1024 * 1024) {
      setError('File too large (max 20MB)')
      return
    }
    setFile(f)
    setError(null)
  }

  const handleOCR = async () => {
    if (!file) return
    setProcessing(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('image', file)
      if (expectedRows) form.append('expected_rows', expectedRows)
      const res = await apiFetch(`/caves/${caveId}/surveys/${surveyId}/ocr/`, {
        method: 'POST',
        body: form,
      })
      setShots(res.shots || [])
      setRawText(res.raw_text || '')
      setWarnings(res.warnings || [])
      setStep(1)
    } catch (err) {
      setError(err?.message || err?.error || 'OCR processing failed')
    } finally {
      setProcessing(false)
    }
  }

  const updateShot = (idx, field, value) => {
    setShots(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  const removeShot = (idx) => {
    setShots(prev => prev.filter((_, i) => i !== idx))
  }

  // Insert blank at fieldIdx, shift everything from there rightward
  const shiftRight = (rowIdx, fieldIdx) => {
    setShots(prev => prev.map((shot, i) => {
      if (i !== rowIdx) return shot
      const s = { ...shot }
      for (let j = SHOT_FIELDS.length - 1; j > fieldIdx; j--) {
        s[SHOT_FIELDS[j].key] = shot[SHOT_FIELDS[j - 1].key]
      }
      const f = SHOT_FIELDS[fieldIdx]
      s[f.key] = f.type === 'number' ? null : ''
      return s
    }))
  }

  // Remove value at fieldIdx, shift everything after it leftward
  const shiftLeft = (rowIdx, fieldIdx) => {
    setShots(prev => prev.map((shot, i) => {
      if (i !== rowIdx) return shot
      const s = { ...shot }
      for (let j = fieldIdx; j < SHOT_FIELDS.length - 1; j++) {
        s[SHOT_FIELDS[j].key] = shot[SHOT_FIELDS[j + 1].key]
      }
      const last = SHOT_FIELDS[SHOT_FIELDS.length - 1]
      s[last.key] = last.type === 'number' ? null : ''
      return s
    }))
  }

  const handleImport = () => {
    // Clean shots: convert string numbers to actual numbers, strip _warnings
    const cleaned = shots.map(s => {
      const shot = {}
      for (const f of SHOT_FIELDS) {
        let val = s[f.key]
        if (f.type === 'number' && typeof val === 'string') {
          val = parseFloat(val)
          if (isNaN(val)) val = null
        }
        shot[f.key] = val ?? (f.type === 'number' ? null : '')
      }
      return shot
    }).filter(s => s.from_station && s.to_station && s.distance > 0)

    onImport(cleaned)
    onClose()
  }

  const validCount = shots.filter(s =>
    s.from_station && s.to_station && s.distance != null && s.azimuth != null
  ).length

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center px-4"
      style={{ background: 'rgba(10, 10, 18, 0.92)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="cyber-card w-full max-w-4xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold">
            {step === 0 ? 'Scan Survey Sheet' : 'Review Parsed Data'}
          </h2>
          <button onClick={onClose} className="text-[var(--cyber-text-dim)] hover:text-white text-lg">
            &times;
          </button>
        </div>

        {/* Step 0: Upload */}
        {step === 0 && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => handleFileSelect(e.target.files?.[0])}
            />
            {!file ? (
              <div
                className="border-2 border-dashed border-[var(--cyber-border)] rounded-xl p-8 text-center cursor-pointer
                  hover:border-cyan-700/50 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFileSelect(e.dataTransfer.files?.[0]) }}
              >
                <p className="text-[var(--cyber-text-dim)]">
                  Click or drag to upload a photo of a survey sheet
                </p>
                <p className="text-[#555570] text-xs mt-1">JPG, PNG, WebP, HEIC — max 20MB</p>
                <p className="text-[#555570] text-xs mt-1">
                  On mobile, tap to use camera
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)] p-3">
                <div className="w-10 h-10 flex-shrink-0 rounded-lg bg-cyan-900/30 border border-cyan-800/30
                  flex items-center justify-center text-cyan-400 text-xs font-bold">
                  IMG
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm truncate">{file.name}</p>
                  <p className="text-[var(--cyber-text-dim)] text-xs">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
                <button
                  onClick={() => { setFile(null); setError(null) }}
                  className="text-[var(--cyber-text-dim)] hover:text-white text-sm"
                >
                  &times;
                </button>
              </div>
            )}

            {error && <p className="text-red-400 text-xs">{error}</p>}

            {/* Row count estimate */}
            <div className="flex items-center gap-2">
              <label className="text-[var(--cyber-text-dim)] text-xs">Approx. rows on sheet:</label>
              <select
                value={expectedRows}
                onChange={e => setExpectedRows(e.target.value)}
                className="cyber-input px-2 py-1 text-xs rounded-lg"
              >
                <option value="">Auto</option>
                {[2, 3, 5, 10, 15, 20, 30, 40, 50].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span className="text-[#555570] text-xs">Helps prevent hallucinated rows</span>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="px-5 py-2 rounded-full text-sm text-[var(--cyber-text-dim)]
                  bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]
                  hover:border-[var(--cyber-text-dim)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleOCR}
                disabled={!file || processing}
                className={`px-5 py-2 rounded-full text-sm font-semibold transition-all
                  ${file
                    ? 'bg-gradient-to-r from-cyan-600 to-cyan-700 text-white shadow-[0_0_12px_rgba(0,229,255,0.2)]'
                    : 'bg-[var(--cyber-surface-2)] text-[#555570]'}`}
              >
                {processing ? 'Processing OCR...' : 'Scan'}
              </button>
            </div>
          </>
        )}

        {/* Step 1: Review */}
        {step === 1 && (
          <>
            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="rounded-lg border border-yellow-800/40 bg-yellow-900/10 p-3">
                <p className="text-yellow-400 text-xs font-semibold mb-1">
                  Warnings ({warnings.length})
                </p>
                {warnings.map((w, i) => (
                  <p key={i} className="text-yellow-300/70 text-xs">{w}</p>
                ))}
              </div>
            )}

            {/* Editable shot table */}
            {shots.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="text-[var(--cyber-text-dim)] text-left px-1 py-1 font-medium">#</th>
                      {SHOT_FIELDS.map(f => (
                        <th key={f.key} className="text-[var(--cyber-text-dim)] text-left px-1 py-1 font-medium">
                          {f.label}
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shots.map((shot, idx) => {
                      const hasWarning = shot._warnings?.length > 0
                      return (
                        <tr
                          key={idx}
                          className={hasWarning ? 'bg-yellow-900/10' : ''}
                        >
                          <td className="text-[var(--cyber-text-dim)] px-1 py-0.5">
                            {idx + 1}
                          </td>
                          {SHOT_FIELDS.map((f, fIdx) => (
                            <td key={f.key} className="px-0.5 py-0.5">
                              <div className="flex items-center gap-0 group/cell">
                                <button
                                  onClick={() => shiftLeft(idx, fIdx)}
                                  className="opacity-0 group-hover/cell:opacity-100 text-[9px] leading-none
                                    text-cyan-400/40 hover:text-cyan-400 px-0.5 flex-shrink-0 transition-opacity"
                                  title="Remove this cell, shift left"
                                >&#9664;</button>
                                <input
                                  type="text"
                                  value={shot[f.key] ?? ''}
                                  onChange={e => updateShot(idx, f.key, e.target.value)}
                                  className="cyber-input w-full px-1.5 py-1 text-xs"
                                  style={{
                                    minWidth: f.key === 'comment' ? 80 : f.type === 'text' ? 50 : 36,
                                  }}
                                />
                                <button
                                  onClick={() => shiftRight(idx, fIdx)}
                                  className="opacity-0 group-hover/cell:opacity-100 text-[9px] leading-none
                                    text-cyan-400/40 hover:text-cyan-400 px-0.5 flex-shrink-0 transition-opacity"
                                  title="Insert blank here, shift right"
                                >&#9654;</button>
                              </div>
                            </td>
                          ))}
                          <td className="px-1">
                            <button
                              onClick={() => removeShot(idx)}
                              className="text-red-400/60 hover:text-red-400 text-sm"
                              title="Remove row"
                            >
                              &times;
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[var(--cyber-text-dim)] text-sm text-center py-4">
                No shots were detected. Check the raw OCR output below.
              </p>
            )}

            {/* Raw OCR text (collapsible) */}
            <div>
              <button
                onClick={() => setShowRaw(!showRaw)}
                className="text-[var(--cyber-text-dim)] text-xs hover:text-[var(--cyber-cyan)]"
              >
                {showRaw ? 'Hide' : 'Show'} raw OCR output
              </button>
              {showRaw && (
                <pre className="mt-2 p-3 rounded-lg bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]
                  text-[var(--cyber-text-dim)] text-xs overflow-x-auto max-h-48 whitespace-pre-wrap">
                  {rawText || '(empty)'}
                </pre>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => { setStep(0); setShots([]); setWarnings([]) }}
                className="text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]"
              >
                &larr; Re-scan
              </button>
              <div className="flex gap-2 items-center">
                <span className="text-[var(--cyber-text-dim)] text-xs">
                  {validCount}/{shots.length} valid shots
                </span>
                <button
                  onClick={onClose}
                  className="px-5 py-2 rounded-full text-sm text-[var(--cyber-text-dim)]
                    bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]
                    hover:border-[var(--cyber-text-dim)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={validCount === 0}
                  className={`px-5 py-2 rounded-full text-sm font-semibold transition-all
                    ${validCount > 0
                      ? 'bg-gradient-to-r from-cyan-600 to-cyan-700 text-white shadow-[0_0_12px_rgba(0,229,255,0.2)]'
                      : 'bg-[var(--cyber-surface-2)] text-[#555570]'}`}
                >
                  Import {validCount} Shot{validCount !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
