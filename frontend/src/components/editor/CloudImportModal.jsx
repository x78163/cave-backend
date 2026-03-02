import { useState, useRef, useEffect } from 'react'
import { apiFetch } from '../../hooks/useApi'
import useEditorStore from '../../stores/editorStore'

const ACCEPTED_EXTS = ['glb', 'gltf', 'ply', 'pcd']
const MAX_SIZE = 200 * 1024 * 1024 // 200MB

const EXT_BADGES = {
  glb: { bg: 'rgba(0,229,255,0.15)', border: 'rgba(0,229,255,0.3)', color: '#00e5ff', label: 'GLB' },
  gltf: { bg: 'rgba(0,229,255,0.15)', border: 'rgba(0,229,255,0.3)', color: '#00e5ff', label: 'GLTF' },
  ply: { bg: 'rgba(74,222,128,0.15)', border: 'rgba(74,222,128,0.3)', color: '#4ade80', label: 'PLY' },
  pcd: { bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.3)', color: '#fbbf24', label: 'PCD' },
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export default function CloudImportModal({ onClose, excludeCaveId }) {
  const [tab, setTab] = useState('upload')
  const [file, setFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  // Cave search state
  const [caveSearch, setCaveSearch] = useState('')
  const [caveResults, setCaveResults] = useState([])
  const [caveLoading, setCaveLoading] = useState(false)

  const importing = useEditorStore(s => s.loading)
  const importFile = useEditorStore(s => s.importFile)
  const importFromCave = useEditorStore(s => s.importFromCave)

  const handleFileSelect = (f) => {
    if (!f) return
    const ext = f.name.split('.').pop().toLowerCase()
    if (!ACCEPTED_EXTS.includes(ext)) {
      setError(`Unsupported format. Accepted: ${ACCEPTED_EXTS.join(', ')}`)
      return
    }
    if (f.size > MAX_SIZE) {
      setError(`File too large (max ${formatSize(MAX_SIZE)})`)
      return
    }
    setFile(f)
    setError(null)
  }

  const handleImportFile = async () => {
    if (!file || importing) return
    setError(null)
    const result = await importFile(file)
    if (result) onClose()
    else setError(useEditorStore.getState().error || 'Import failed')
  }

  const handleImportCave = async (cave) => {
    if (importing) return
    setError(null)
    const result = await importFromCave(cave.id, cave.name)
    if (result) onClose()
    else setError(useEditorStore.getState().error || 'Import failed')
  }

  // Debounced cave search
  useEffect(() => {
    if (tab !== 'cave' || caveSearch.length < 2) {
      setCaveResults([])
      return
    }
    const timer = setTimeout(async () => {
      setCaveLoading(true)
      try {
        const data = await apiFetch(`/caves/?search=${encodeURIComponent(caveSearch)}&limit=8`)
        const caves = (data.results || data || [])
          .filter(c => c.has_map && String(c.id) !== String(excludeCaveId))
        setCaveResults(caves)
      } catch {
        setCaveResults([])
      } finally {
        setCaveLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [caveSearch, tab, excludeCaveId])

  const ext = file ? file.name.split('.').pop().toLowerCase() : null
  const badge = ext ? EXT_BADGES[ext] : null

  return (
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center px-4"
      style={{ background: 'rgba(10, 10, 18, 0.92)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="cyber-card w-full max-w-lg p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold">Import Point Cloud</h2>
          <button onClick={onClose} className="text-[var(--cyber-text-dim)] hover:text-white text-lg">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg p-1" style={{ background: 'var(--cyber-surface-2)' }}>
          {[['upload', 'Upload File'], ['cave', 'From Cave']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setTab(id); setError(null) }}
              className="flex-1 py-1.5 rounded-md text-xs font-medium transition-all"
              style={{
                background: tab === id ? 'rgba(0,229,255,0.1)' : 'transparent',
                color: tab === id ? 'var(--cyber-cyan)' : 'var(--cyber-text-dim)',
                border: tab === id ? '1px solid rgba(0,229,255,0.2)' : '1px solid transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Upload tab */}
        {tab === 'upload' && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".glb,.gltf,.ply,.pcd"
              className="hidden"
              onChange={e => handleFileSelect(e.target.files?.[0])}
            />
            {!file ? (
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-cyan-500/50 bg-cyan-500/5' : 'border-[var(--cyber-border)] hover:border-cyan-700/50'
                }`}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault(); e.stopPropagation(); setDragOver(false)
                  handleFileSelect(e.dataTransfer.files?.[0])
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
                  className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--cyber-text-dim)' }}>
                  <path d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" />
                </svg>
                <p className="text-sm" style={{ color: 'var(--cyber-text-dim)' }}>
                  Drag & drop or click to select
                </p>
                <p className="text-[10px] mt-1" style={{ color: '#555570' }}>
                  GLB, PLY, PCD — max {formatSize(MAX_SIZE)}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl p-3"
                style={{ background: 'var(--cyber-surface-2)', border: '1px solid var(--cyber-border)' }}>
                {badge && (
                  <div className="w-10 h-10 flex-shrink-0 rounded-lg flex items-center justify-center text-xs font-bold"
                    style={{ background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color }}>
                    {badge.label}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm truncate">{file.name}</p>
                  <p className="text-xs" style={{ color: 'var(--cyber-text-dim)' }}>{formatSize(file.size)}</p>
                </div>
                <button
                  onClick={() => setFile(null)}
                  className="text-sm hover:text-white" style={{ color: 'var(--cyber-text-dim)' }}
                >&times;</button>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button onClick={onClose}
                className="px-5 py-2 rounded-full text-sm"
                style={{ color: 'var(--cyber-text-dim)', background: 'var(--cyber-surface-2)', border: '1px solid var(--cyber-border)' }}>
                Cancel
              </button>
              <button
                onClick={handleImportFile}
                disabled={!file || importing}
                className="px-5 py-2 rounded-full text-sm font-semibold transition-all"
                style={{
                  background: file ? 'linear-gradient(135deg, #00b8d4, #00e5ff)' : 'var(--cyber-surface-2)',
                  color: file ? '#0a0a12' : '#555570',
                  opacity: importing ? 0.7 : 1,
                }}
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
            </div>
          </>
        )}

        {/* Cave tab */}
        {tab === 'cave' && (
          <>
            <input
              value={caveSearch}
              onChange={e => setCaveSearch(e.target.value)}
              placeholder="Search caves with 3D maps..."
              className="cyber-input w-full px-4 py-2.5 text-sm"
              autoFocus
            />

            <div className="max-h-64 overflow-y-auto space-y-1">
              {caveLoading && (
                <p className="text-xs text-center py-4" style={{ color: 'var(--cyber-text-dim)' }}>
                  Searching...
                </p>
              )}

              {!caveLoading && caveSearch.length >= 2 && caveResults.length === 0 && (
                <p className="text-xs text-center py-4" style={{ color: 'var(--cyber-text-dim)' }}>
                  No caves with 3D maps found
                </p>
              )}

              {caveResults.map(cave => (
                <button
                  key={cave.id}
                  onClick={() => handleImportCave(cave)}
                  disabled={importing}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all hover:bg-[rgba(0,229,255,0.05)]"
                  style={{ border: '1px solid transparent' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--cyber-text)' }}>
                      {cave.name}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>
                      {[cave.city, cave.state].filter(Boolean).join(', ') || 'Unknown location'}
                    </p>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: 'rgba(0,229,255,0.1)', color: 'var(--cyber-cyan)', border: '1px solid rgba(0,229,255,0.2)' }}>
                    3D Map
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>
    </div>
  )
}
