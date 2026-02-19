import { useNavigate, useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import RichTextEditor from '../components/RichTextEditor'
import { apiFetch } from '../hooks/useApi'
import useAuthStore from '../stores/authStore'
import parseCoordinates from '../utils/parseCoordinates'

const emptyForm = {
  name: '',
  description: '',
  latitude: '',
  longitude: '',
  region: '',
  country: '',
  total_length: '',
  largest_chamber: '',
  smallest_passage: '',
  vertical_extent: '',
  number_of_levels: '',
  hazard_count: '',
  toxic_gas_present: false,
  toxic_gas_types: '',
  max_particulate: '',
  water_present: false,
  water_description: '',
  requires_equipment: '',
  visibility: 'private',
}

export default function CreateCave() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { caveId } = useParams()
  const isEdit = Boolean(caveId)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState(null)

  // Load existing cave data when editing
  useEffect(() => {
    if (!isEdit) return
    apiFetch(`/caves/${caveId}/`)
      .then(data => {
        const loaded = {}
        for (const key of Object.keys(emptyForm)) {
          if (typeof emptyForm[key] === 'boolean') {
            loaded[key] = data[key] || false
          } else {
            loaded[key] = data[key] != null ? String(data[key]) : ''
          }
        }
        loaded.toxic_gas_present = data.toxic_gas_present || false
        loaded.water_present = data.water_present || false
        setForm(loaded)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [caveId, isEdit])

  const update = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    setError(null)

    // Convert empty strings to null for numeric fields
    const payload = { ...form }
    const numericFields = [
      'latitude', 'longitude', 'total_length', 'largest_chamber',
      'smallest_passage', 'vertical_extent', 'number_of_levels',
      'hazard_count', 'max_particulate',
    ]
    for (const field of numericFields) {
      payload[field] = payload[field] === '' ? null : Number(payload[field])
    }

    // Set owner to current user on create
    if (!isEdit && user) {
      payload.owner = user.id
    }

    try {
      const url = isEdit ? `/caves/${caveId}/` : '/caves/'
      const method = isEdit ? 'PUT' : 'POST'
      const data = await apiFetch(url, { method, body: payload })
      navigate(`/caves/${data.id}`)
    } catch (err) {
      setError(err.response?.data || 'Failed to save cave')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--cyber-bg)]">
        <p className="text-[var(--cyber-text-dim)]">Loading cave data...</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(isEdit ? `/caves/${caveId}` : '/explore')}
            className="text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] transition-colors">
            &larr; Back
          </button>
          <h1 className="text-2xl font-bold">{isEdit ? 'Edit Cave' : 'New Cave Entry'}</h1>
        </div>
        <button onClick={handleSubmit} disabled={saving || !form.name.trim()}
          className={`px-6 py-2 rounded-full font-semibold text-sm transition-all
            ${form.name.trim()
              ? 'bg-gradient-to-r from-cyan-600 to-cyan-700 text-white shadow-[0_0_12px_rgba(0,229,255,0.2)] active:scale-[0.97]'
              : 'bg-[var(--cyber-surface-2)] text-[#555570]'}`}>
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Cave'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-900/20 border border-red-800/30 text-red-400 text-sm">
          {typeof error === 'string' ? error : JSON.stringify(error)}
        </div>
      )}

      <div className="space-y-6">
        {/* Basic Info */}
        <Section title="Basic Information">
          <Input label="Cave Name *" value={form.name}
            onChange={v => update('name', v)} placeholder="e.g. Crystal Caverns" />
          <div>
            <label className="block text-[var(--cyber-text-dim)] text-sm mb-1">Description</label>
            <RichTextEditor
              content={form.description}
              onChange={v => update('description', v)}
              placeholder="Describe the cave, its features, history..."
              caveId={caveId}
            />
          </div>
          <div>
            <label className="block text-[var(--cyber-text-dim)] text-sm mb-1">Visibility</label>
            <select value={form.visibility} onChange={e => update('visibility', e.target.value)}
              className="cyber-input w-full px-4 py-2.5 text-sm">
              <option value="private">Private</option>
              <option value="limited_public">Limited Public (coordinates hidden)</option>
              <option value="public">Public</option>
            </select>
          </div>
        </Section>

        {/* Location */}
        <Section title="Location">
          <CoordinateInput
            latitude={form.latitude}
            longitude={form.longitude}
            onChange={(lat, lon) => { update('latitude', lat); update('longitude', lon) }}
          />
          <Input label="Region / State" value={form.region}
            onChange={v => update('region', v)} placeholder="e.g. Tennessee" />
          <Input label="Country" value={form.country}
            onChange={v => update('country', v)} placeholder="e.g. United States" />
        </Section>

        {/* Dimensions */}
        <Section title="Dimensions">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Total Length (m)" value={form.total_length}
              onChange={v => update('total_length', v)} type="number" />
            <Input label="Vertical Extent (m)" value={form.vertical_extent}
              onChange={v => update('vertical_extent', v)} type="number" />
            <Input label="Largest Chamber (m²)" value={form.largest_chamber}
              onChange={v => update('largest_chamber', v)} type="number" />
            <Input label="Smallest Passage (m)" value={form.smallest_passage}
              onChange={v => update('smallest_passage', v)} type="number" />
          </div>
          <Input label="Number of Levels" value={form.number_of_levels}
            onChange={v => update('number_of_levels', v)} type="number" />
        </Section>

        {/* Hazards */}
        <Section title="Hazards & Conditions">
          <Input label="Number of Hazards" value={form.hazard_count}
            onChange={v => update('hazard_count', v)} type="number" />
          <Toggle label="Toxic Gas Present" checked={form.toxic_gas_present}
            onChange={v => update('toxic_gas_present', v)} />
          {form.toxic_gas_present && (
            <Input label="Gas Types" value={form.toxic_gas_types}
              onChange={v => update('toxic_gas_types', v)} placeholder="e.g. CO2, H2S" />
          )}
          <Input label="Max Particulate (PM2.5)" value={form.max_particulate}
            onChange={v => update('max_particulate', v)} type="number" />
          <Toggle label="Water Present" checked={form.water_present}
            onChange={v => update('water_present', v)} />
          {form.water_present && (
            <Input label="Water Description" value={form.water_description}
              onChange={v => update('water_description', v)} placeholder="e.g. Stream, sump" />
          )}
          <TextArea label="Required Equipment" value={form.requires_equipment}
            onChange={v => update('requires_equipment', v)}
            placeholder="e.g. Rope, harness, wetsuit..." />
        </Section>

        <div className="h-8" />
      </div>
    </div>
  )
}

/* --- Coordinate smart input --- */

function CoordinateInput({ latitude, longitude, onChange }) {
  const hasCoords = latitude !== '' && longitude !== ''
  const initial = hasCoords ? `${latitude}, ${longitude}` : ''
  const [raw, setRaw] = useState(initial)
  const [error, setError] = useState(null)
  const [resolving, setResolving] = useState(false)
  const [parsed, setParsed] = useState(
    hasCoords ? { lat: Number(latitude), lon: Number(longitude) } : null
  )

  // Sync from external form state when loading existing cave
  useEffect(() => {
    if (hasCoords && !raw) {
      setRaw(`${latitude}, ${longitude}`)
      setParsed({ lat: Number(latitude), lon: Number(longitude) })
    }
  }, [latitude, longitude])

  const resolveShortUrl = async (url) => {
    setResolving(true)
    setError(null)
    setParsed(null)
    try {
      const data = await apiFetch('/caves/resolve-map-url/', {
        method: 'POST',
        body: { url },
      })
      const result = { lat: data.lat, lon: data.lon }
      setParsed(result)
      setError(null)
      onChange(String(result.lat), String(result.lon))
    } catch (e) {
      setError(e.response?.data?.error || 'Could not resolve map URL')
    } finally {
      setResolving(false)
    }
  }

  const tryParse = (value) => {
    setRaw(value)
    if (!value.trim()) {
      setParsed(null)
      setError(null)
      setResolving(false)
      onChange('', '')
      return
    }
    try {
      const result = parseCoordinates(value)
      setParsed(result)
      setError(null)
      setResolving(false)
      onChange(String(result.lat), String(result.lon))
    } catch (e) {
      if (e.needsBackendResolve) {
        resolveShortUrl(e.url)
      } else {
        setParsed(null)
        setError(e.message)
      }
    }
  }

  return (
    <div>
      <label className="block text-[var(--cyber-text-dim)] text-sm mb-1">Coordinates</label>
      <input
        type="text"
        value={raw}
        onChange={e => tryParse(e.target.value)}
        placeholder="35.658, -85.588 · DMS · UTM · MGRS · Google Maps link"
        className="cyber-input w-full px-4 py-2.5 text-sm"
      />
      <div className="mt-1.5 min-h-[1.25rem]">
        {resolving && (
          <span className="text-[var(--cyber-cyan)] text-xs animate-pulse">
            Resolving map link...
          </span>
        )}
        {!resolving && parsed && (
          <span className="text-emerald-400 text-xs">
            {parsed.lat.toFixed(6)}°, {parsed.lon.toFixed(6)}°
          </span>
        )}
        {!resolving && error && (
          <span className="text-red-400 text-xs">{error}</span>
        )}
      </div>
    </div>
  )
}

/* --- Reusable form components --- */

function Section({ title, children }) {
  return (
    <div className="rounded-2xl bg-[var(--cyber-surface)] border border-[var(--cyber-border)] p-4">
      <h3 className="text-white font-semibold mb-3">{title}</h3>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  )
}

function Input({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <div>
      <label className="block text-[var(--cyber-text-dim)] text-sm mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="cyber-input w-full px-4 py-2.5 text-sm"
      />
    </div>
  )
}

function TextArea({ label, value, onChange, placeholder = '' }) {
  return (
    <div>
      <label className="block text-[var(--cyber-text-dim)] text-sm mb-1">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="cyber-input w-full px-4 py-2.5 text-sm resize-none"
      />
    </div>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--cyber-text)] text-sm">{label}</span>
      <button type="button"
        onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full transition-all relative
          ${checked
            ? 'bg-[var(--cyber-cyan)] shadow-[0_0_10px_rgba(0,229,255,0.3)]'
            : 'bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]'}`}
      >
        <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform
          ${checked ? 'translate-x-5.5' : 'translate-x-0.5'}`}
        />
      </button>
    </div>
  )
}
