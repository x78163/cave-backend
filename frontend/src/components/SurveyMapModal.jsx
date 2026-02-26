import { useState, useRef } from 'react'
import { apiFetch } from '../hooks/useApi'

const CLASSIC_STEPS = ['Upload', 'Pin Entrance', 'Set Scale', 'Orient & Confirm']
const TWOPOINT_STEPS = ['Upload', 'Pin Entrances', 'Confirm']

// ── Geo utilities ──

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6_371_000
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function gpsBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180
  const dLon = toRad(lon2 - lon1)
  const y = Math.sin(dLon) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon)
  return Math.atan2(y, x) // radians, CW from north
}

/**
 * Multi-step modal for adding a survey map to a cave.
 *
 * Classic flow (< 2 entrances):
 *   Step 0: Upload image + optional name
 *   Step 1: Click on cave entrance to pin anchor
 *   Step 2: Click two scale bar endpoints + enter distance
 *   Step 3: Rotate until north arrow points up, then confirm
 *
 * Two-point flow (2+ entrances):
 *   Step 0: Upload image + optional name
 *   Step 1: Pin two known entrances on the image
 *   Step 2: Confirm (auto-computed scale & heading, adjustable)
 *
 * Props:
 *   caveId      UUID of the cave
 *   entrances   Array of {label, lat, lon} — primary entrance + POI entrances
 *   onComplete  (survey) => void — called after confirm with saved survey object
 *   onClose     () => void — close without saving
 */
export default function SurveyMapModal({ caveId, entrances = [], onComplete, onClose }) {
  const [step, setStep] = useState(0)
  const twoPoint = entrances.length >= 2

  const STEPS = twoPoint ? TWOPOINT_STEPS : CLASSIC_STEPS
  // In two-point mode, the confirm step is 2; in classic it's 3
  const CONFIRM_STEP = twoPoint ? 2 : 3

  // Step 0: Upload
  const [imageFile, setImageFile] = useState(null)
  const [name, setName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const fileRef = useRef(null)

  // Server response after upload
  const [survey, setSurvey] = useState(null)

  // Classic step 1: Pin single entrance
  const [anchor, setAnchor] = useState(null) // {x, y} fractional

  // Two-point step 1: Pin two entrances
  const [activeEntIdx, setActiveEntIdx] = useState(0) // which entrance is being pinned
  const [pins, setPins] = useState([]) // array of {x, y} fractional, indexed by entrance

  // Classic step 2: Scale
  const [scalePoints, setScalePoints] = useState([])
  const [scaleDist, setScaleDist] = useState('')
  const [scaleUnit, setScaleUnit] = useState('ft')
  const [computedScale, setComputedScale] = useState(0.1)

  // Confirm step: Orient
  const [heading, setHeading] = useState(0)
  const [opacity, setOpacity] = useState(0.75)
  const [saving, setSaving] = useState(false)
  const [autoCalibrated, setAutoCalibrated] = useState(false)

  // ── Step 0: Upload ──
  const handleUpload = async () => {
    if (!imageFile) return
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('image', imageFile)
      if (name) form.append('name', name)
      const res = await apiFetch(`/caves/${caveId}/survey-maps/`, {
        method: 'POST',
        body: form,
      })
      setSurvey(res)
      setStep(1)
    } catch (err) {
      setUploadError(err?.response?.data?.error || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // ── Classic step 2: Compute scale from two points + distance ──
  const applyScale = () => {
    const dist = parseFloat(scaleDist)
    if (!dist || dist <= 0 || scalePoints.length < 2 || !survey) return
    const realMeters = scaleUnit === 'ft' ? dist * 0.3048 : dist
    const dx = (scalePoints[1].x - scalePoints[0].x) * survey.image_width
    const dy = (scalePoints[1].y - scalePoints[0].y) * survey.image_height
    const pixelDist = Math.sqrt(dx * dx + dy * dy)
    if (pixelDist > 0) {
      setComputedScale(realMeters / pixelDist)
      setStep(CONFIRM_STEP)
    }
  }

  // ── Two-point: auto-compute scale & heading from two pinned entrances ──
  const applyTwoPoint = () => {
    if (pins.length < 2 || !survey) return
    const ent1 = entrances[0], ent2 = entrances[1]
    const p1 = pins[0], p2 = pins[1]

    // Pixel distance
    const dx = (p2.x - p1.x) * survey.image_width
    const dy = (p2.y - p1.y) * survey.image_height
    const pixelDist = Math.sqrt(dx * dx + dy * dy)
    if (pixelDist < 1) return

    // GPS distance and bearing
    const gpsDist = haversineMeters(ent1.lat, ent1.lon, ent2.lat, ent2.lon)
    const bearing = gpsBearing(ent1.lat, ent1.lon, ent2.lat, ent2.lon)

    // Image angle: atan2 with Y inverted (image Y increases downward)
    const pixelAngle = Math.atan2(-dy, dx)

    // Scale and heading
    const scale = gpsDist / pixelDist
    let hdg = (bearing - pixelAngle) * 180 / Math.PI
    // Normalize to [-180, 180]
    while (hdg > 180) hdg -= 360
    while (hdg < -180) hdg += 360

    setAnchor(p1) // Primary entrance pin = anchor
    setComputedScale(scale)
    setHeading(Math.round(hdg))
    setAutoCalibrated(true)
    setStep(CONFIRM_STEP)
  }

  // ── Confirm: save calibration to backend ──
  const handleConfirm = async () => {
    if (!survey) return
    setSaving(true)
    try {
      const updated = await apiFetch(`/caves/${caveId}/survey-maps/${survey.id}/`, {
        method: 'PATCH',
        body: {
          anchor_x: anchor?.x ?? 0.5,
          anchor_y: anchor?.y ?? 0.5,
          scale: computedScale,
          heading,
          opacity,
          name: name || survey.name,
          is_locked: true,
        },
      })
      onComplete(updated)
    } catch (err) {
      console.error('Failed to save survey calibration:', err)
    } finally {
      setSaving(false)
    }
  }

  const overlayUrl = survey?.overlay_url

  // Pin colors: first entrance = amber, second = green
  const PIN_COLORS = [
    { border: 'border-amber-400', bg: 'bg-amber-400/30', fill: '#f59e0b' },
    { border: 'border-green-400', bg: 'bg-green-400/30', fill: '#4ade80' },
  ]

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center px-4"
      style={{ background: 'rgba(10, 10, 18, 0.92)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="cyber-card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">Add Survey Map</h2>
          <button onClick={onClose} className="text-[var(--cyber-text-dim)] hover:text-white text-lg">&times;</button>
        </div>

        {/* Step indicators */}
        <div className="flex justify-center gap-2 mb-6">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === step ? 32 : 16,
                background: i <= step ? 'var(--cyber-cyan)' : 'var(--cyber-surface-2)',
              }}
            />
          ))}
        </div>

        <p className="text-[10px] text-[var(--cyber-text-dim)] text-center mb-4 uppercase tracking-wider">
          {STEPS[step]}
        </p>

        {/* ── Step 0: Upload ── */}
        {step === 0 && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-[var(--cyber-border)] rounded-xl p-6 text-center cursor-pointer
                hover:border-cyan-700/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              {imageFile ? (
                <div>
                  <p className="text-[var(--cyber-cyan)] text-sm font-medium">{imageFile.name}</p>
                  <p className="text-[var(--cyber-text-dim)] text-xs mt-1">
                    {(imageFile.size / 1024 / 1024).toFixed(1)} MB — click to change
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-[var(--cyber-text-dim)] text-sm">Click to select survey map image</p>
                  <p className="text-[var(--cyber-text-dim)] text-xs mt-1">PNG, JPG, or TIFF</p>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={e => setImageFile(e.target.files?.[0] || null)}
              className="hidden"
            />
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Survey name (optional, e.g. '1972 NSS Survey')"
              className="w-full px-3 py-2 rounded-lg text-sm bg-[#111] border border-[var(--cyber-border)]
                text-white placeholder-gray-500 focus:border-cyan-600 focus:outline-none"
            />
            {uploadError && (
              <p className="text-red-400 text-xs">{uploadError}</p>
            )}
            <button
              onClick={handleUpload}
              disabled={!imageFile || uploading}
              className="w-full py-2 rounded-lg text-sm font-medium transition-all
                bg-[var(--cyber-cyan)]/20 text-[var(--cyber-cyan)] border border-cyan-700/50
                hover:bg-[var(--cyber-cyan)]/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading ? 'Processing...' : 'Upload & Process'}
            </button>
          </div>
        )}

        {/* ── Step 1 (Two-Point): Pin Two Entrances ── */}
        {step === 1 && twoPoint && overlayUrl && (
          <div className="space-y-3">
            <p className="text-xs text-[var(--cyber-text-dim)]">
              Click each entrance location on the survey image. Scale and orientation will be computed automatically.
            </p>

            {/* Entrance selector chips */}
            <div className="flex gap-2">
              {entrances.slice(0, 2).map((ent, i) => {
                const pinned = pins[i] != null
                const active = activeEntIdx === i
                return (
                  <button
                    key={i}
                    onClick={() => setActiveEntIdx(i)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5 ${
                      active
                        ? 'border-[var(--cyber-cyan)] bg-[var(--cyber-cyan)]/10 text-[var(--cyber-cyan)]'
                        : pinned
                          ? `border-[var(--cyber-border)] text-[var(--cyber-text)]`
                          : 'border-[var(--cyber-border)] text-[var(--cyber-text-dim)]'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: pinned ? PIN_COLORS[i].fill : 'var(--cyber-surface-2)' }}
                    />
                    {ent.label || `Entrance ${i + 1}`}
                    {pinned && <span className="text-[9px] opacity-60">pinned</span>}
                  </button>
                )
              })}
            </div>

            {/* Image with click-to-pin */}
            <div
              className="relative inline-block cursor-crosshair border border-[var(--cyber-border)] rounded-lg overflow-hidden"
              style={{ maxWidth: '100%', maxHeight: '500px' }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const img = e.currentTarget.querySelector('img')
                const x = (e.clientX - rect.left) / img.offsetWidth
                const y = (e.clientY - rect.top) / img.offsetHeight
                setPins(prev => {
                  const next = [...prev]
                  next[activeEntIdx] = { x, y }
                  return next
                })
                // Auto-advance to next unpinned entrance
                if (activeEntIdx === 0 && !pins[1]) {
                  setActiveEntIdx(1)
                }
              }}
            >
              <img
                src={overlayUrl}
                alt="Click to pin entrances"
                className="block"
                style={{ maxHeight: '500px', background: '#111' }}
              />
              {/* SVG overlay for pins and connecting line */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                {pins[0] && pins[1] && (
                  <line
                    x1={`${pins[0].x * 100}%`} y1={`${pins[0].y * 100}%`}
                    x2={`${pins[1].x * 100}%`} y2={`${pins[1].y * 100}%`}
                    stroke="#00e5ff" strokeWidth="1.5" strokeDasharray="6 3" opacity="0.5"
                  />
                )}
              </svg>
              {/* Pin markers */}
              {pins.map((pin, i) => pin && (
                <div
                  key={i}
                  className={`absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 ${PIN_COLORS[i].border} ${PIN_COLORS[i].bg}`}
                  style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                >
                  <span
                    className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-medium whitespace-nowrap"
                    style={{ color: PIN_COLORS[i].fill }}
                  >
                    {i + 1}
                  </span>
                </div>
              ))}
            </div>

            {/* GPS distance readout */}
            {pins[0] && pins[1] && (
              <div className="text-center text-[10px] text-[var(--cyber-text-dim)]">
                GPS distance: <span className="text-[var(--cyber-cyan)] font-mono">
                  {Math.round(haversineMeters(entrances[0].lat, entrances[0].lon, entrances[1].lat, entrances[1].lon))}m
                </span>
              </div>
            )}

            <div className="flex justify-between">
              <button
                onClick={() => { setStep(0); setPins([]); setActiveEntIdx(0) }}
                className="px-4 py-2 rounded-lg text-xs text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] hover:text-white transition-all"
              >
                Back
              </button>
              <button
                onClick={applyTwoPoint}
                disabled={!pins[0] || !pins[1]}
                className="px-4 py-2 rounded-lg text-xs font-medium transition-all
                  bg-[var(--cyber-cyan)]/20 text-[var(--cyber-cyan)] border border-cyan-700/50
                  hover:bg-[var(--cyber-cyan)]/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1 (Classic): Pin Single Entrance ── */}
        {step === 1 && !twoPoint && overlayUrl && (
          <div className="space-y-3">
            <p className="text-xs text-[var(--cyber-text-dim)]">
              Click on the cave entrance. This point will align with the GPS coordinates.
            </p>
            <div
              className="relative inline-block cursor-crosshair border border-[var(--cyber-border)] rounded-lg overflow-hidden"
              style={{ maxWidth: '100%', maxHeight: '500px' }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const img = e.currentTarget.querySelector('img')
                const x = (e.clientX - rect.left) / img.offsetWidth
                const y = (e.clientY - rect.top) / img.offsetHeight
                setAnchor({ x, y })
              }}
            >
              <img
                src={overlayUrl}
                alt="Click to set entrance"
                className="block"
                style={{ maxHeight: '500px', background: '#111' }}
              />
              {anchor && (
                <div
                  className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-amber-400 bg-amber-400/30"
                  style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
                />
              )}
            </div>
            <div className="flex justify-between">
              <button
                onClick={() => setStep(0)}
                className="px-4 py-2 rounded-lg text-xs text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] hover:text-white transition-all"
              >
                Back
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={!anchor}
                className="px-4 py-2 rounded-lg text-xs font-medium transition-all
                  bg-[var(--cyber-cyan)]/20 text-[var(--cyber-cyan)] border border-cyan-700/50
                  hover:bg-[var(--cyber-cyan)]/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2 (Classic only): Set Scale ── */}
        {step === 2 && !twoPoint && overlayUrl && (
          <div className="space-y-3">
            <p className="text-xs text-[var(--cyber-text-dim)]">
              {scalePoints.length === 0
                ? 'Click the first endpoint of the scale bar.'
                : scalePoints.length === 1
                  ? 'Now click the second endpoint.'
                  : 'Enter the real-world distance between the two points.'}
            </p>
            <div
              className="relative inline-block cursor-crosshair border border-[var(--cyber-border)] rounded-lg overflow-hidden"
              style={{ maxWidth: '100%', maxHeight: '500px' }}
              onClick={(e) => {
                if (scalePoints.length >= 2) return
                const rect = e.currentTarget.getBoundingClientRect()
                const img = e.currentTarget.querySelector('img')
                const x = (e.clientX - rect.left) / img.offsetWidth
                const y = (e.clientY - rect.top) / img.offsetHeight
                setScalePoints(prev => [...prev, { x, y }])
              }}
            >
              <img
                src={overlayUrl}
                alt="Click scale bar endpoints"
                className="block"
                style={{ maxHeight: '500px', background: '#111' }}
              />
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                {scalePoints.length === 2 && (
                  <line
                    x1={`${scalePoints[0].x * 100}%`} y1={`${scalePoints[0].y * 100}%`}
                    x2={`${scalePoints[1].x * 100}%`} y2={`${scalePoints[1].y * 100}%`}
                    stroke="#00e5ff" strokeWidth="2" strokeDasharray="4 2"
                  />
                )}
                {scalePoints.map((pt, i) => (
                  <circle
                    key={i}
                    cx={`${pt.x * 100}%`} cy={`${pt.y * 100}%`}
                    r="5" fill="#00e5ff" stroke="#0a0a12" strokeWidth="1.5"
                  />
                ))}
              </svg>
            </div>
            {scalePoints.length === 2 && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={scaleDist}
                  onChange={e => setScaleDist(e.target.value)}
                  placeholder="Distance"
                  className="w-24 px-2 py-1.5 rounded text-xs bg-[#111] border border-[var(--cyber-border)]
                    text-white placeholder-gray-500 focus:border-cyan-600 focus:outline-none"
                />
                <select
                  value={scaleUnit}
                  onChange={e => setScaleUnit(e.target.value)}
                  className="px-2 py-1.5 rounded text-xs bg-[#111] border border-[var(--cyber-border)] text-white"
                >
                  <option value="ft">feet</option>
                  <option value="m">meters</option>
                </select>
                <button
                  onClick={() => { setScalePoints([]); setScaleDist('') }}
                  className="px-2 py-1.5 rounded text-[10px] text-[var(--cyber-text-dim)]
                    border border-[var(--cyber-border)] hover:text-white transition-all"
                >
                  Reset
                </button>
              </div>
            )}
            <div className="flex justify-between">
              <button
                onClick={() => { setStep(1); setScalePoints([]); setScaleDist('') }}
                className="px-4 py-2 rounded-lg text-xs text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] hover:text-white transition-all"
              >
                Back
              </button>
              <button
                onClick={applyScale}
                disabled={scalePoints.length < 2 || !scaleDist || parseFloat(scaleDist) <= 0}
                className="px-4 py-2 rounded-lg text-xs font-medium transition-all
                  bg-[var(--cyber-cyan)]/20 text-[var(--cyber-cyan)] border border-cyan-700/50
                  hover:bg-[var(--cyber-cyan)]/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* ── Confirm Step (both flows) ── */}
        {step === CONFIRM_STEP && overlayUrl && (
          <div className="space-y-4">
            <p className="text-xs text-[var(--cyber-text-dim)]">
              {autoCalibrated
                ? 'Scale and rotation auto-computed from entrance positions. Fine-tune if needed.'
                : 'Rotate until the north arrow points up. Adjust opacity for visibility.'}
            </p>

            {autoCalibrated && (
              <div className="text-center">
                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/20 text-green-400 border border-green-500/30">
                  auto-calibrated
                </span>
              </div>
            )}

            {/* Rotated preview — auto-scales to keep image visible at any angle */}
            <div className="flex justify-center">
              <div
                className="relative border border-[var(--cyber-border)] rounded-lg overflow-hidden bg-[#111]"
                style={{ width: '300px', height: '300px' }}
              >
                {(() => {
                  const w = survey?.image_width || 300
                  const h = survey?.image_height || 300
                  const rad = Math.abs(heading) * Math.PI / 180
                  const cosA = Math.abs(Math.cos(rad))
                  const sinA = Math.abs(Math.sin(rad))
                  const rotW = w * cosA + h * sinA
                  const rotH = w * sinA + h * cosA
                  const baseScale = Math.min(300 / w, 300 / h)
                  const rotScale = Math.min(300 / (rotW * baseScale), 300 / (rotH * baseScale))
                  const finalScale = baseScale * rotScale
                  const ax = anchor?.x ?? 0.5
                  const ay = anchor?.y ?? 0.5
                  const imgLeft = 150 - ax * w * finalScale
                  const imgTop = 150 - ay * h * finalScale

                  return (
                    <>
                      <img
                        src={overlayUrl}
                        alt="Oriented preview"
                        style={{
                          position: 'absolute',
                          left: imgLeft,
                          top: imgTop,
                          width: w * finalScale,
                          height: h * finalScale,
                          opacity: opacity,
                          transform: `rotate(${heading}deg)`,
                          transformOrigin: `${ax * 100}% ${ay * 100}%`,
                        }}
                      />
                      {anchor && (
                        <div
                          className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-amber-400 bg-amber-400/30 pointer-events-none"
                          style={{ left: 150, top: 150 }}
                        />
                      )}
                    </>
                  )
                })()}
              </div>
            </div>

            {/* Rotation slider */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-[var(--cyber-text-dim)] uppercase tracking-wide">Rotation</label>
                <span className="text-[10px] text-[var(--cyber-cyan)] font-mono">{heading}&deg;</span>
              </div>
              <input
                type="range" min={-180} max={180} step={1}
                value={heading}
                onChange={e => setHeading(Number(e.target.value))}
                className="w-full accent-[var(--cyber-cyan)] h-1"
              />
              <div className="flex justify-between text-[8px] text-[var(--cyber-text-dim)] mt-0.5">
                <span>-180&deg;</span>
                <button onClick={() => setHeading(0)} className="text-[var(--cyber-cyan)] hover:underline">Reset</button>
                <span>180&deg;</span>
              </div>
            </div>

            {/* Opacity slider */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-[var(--cyber-text-dim)] uppercase tracking-wide">Opacity</label>
                <span className="text-[10px] text-[var(--cyber-cyan)] font-mono">{Math.round(opacity * 100)}%</span>
              </div>
              <input
                type="range" min={0.1} max={1.0} step={0.05}
                value={opacity}
                onChange={e => setOpacity(Number(e.target.value))}
                className="w-full accent-[var(--cyber-cyan)] h-1"
              />
            </div>

            {/* Scale readout */}
            <div className="text-center text-[10px] text-[var(--cyber-text-dim)]">
              Scale: <span className="text-[var(--cyber-cyan)] font-mono">{computedScale.toFixed(3)} m/px</span>
              &nbsp;&mdash;&nbsp;~{Math.round(survey.image_width * computedScale)}m wide
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => {
                  if (twoPoint) {
                    setStep(1)
                    setAutoCalibrated(false)
                  } else {
                    setStep(2)
                  }
                }}
                className="px-4 py-2 rounded-lg text-xs text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] hover:text-white transition-all"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-xs font-medium transition-all
                  bg-[var(--cyber-cyan)]/20 text-[var(--cyber-cyan)] border border-cyan-700/50
                  hover:bg-[var(--cyber-cyan)]/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Confirm & Lock'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
