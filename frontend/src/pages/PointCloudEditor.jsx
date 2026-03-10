import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useState, useEffect, useRef, useCallback } from 'react'
import useAuthStore from '../stores/authStore'
import useEditorStore from '../stores/editorStore'
import { apiFetch } from '../hooks/useApi'
import EditorViewportLayout from '../components/editor/EditorViewportLayout'
import EditorToolbar from '../components/editor/EditorToolbar'
import EditorCloudPanel from '../components/editor/EditorCloudPanel'
import AlignmentPanel from '../components/editor/AlignmentPanel'
import SelectionPanel from '../components/editor/SelectionPanel'
import CloudImportModal from '../components/editor/CloudImportModal'
import SaveProjectModal from '../components/editor/SaveProjectModal'
import LoadProjectModal from '../components/editor/LoadProjectModal'
import StlProgressBar from '../components/editor/StlProgressBar'

function MobileGuard() {
  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{ background: 'var(--cyber-bg)' }}
    >
      <div
        className="text-center p-8 rounded-2xl max-w-sm mx-4"
        style={{ background: 'var(--cyber-surface)', border: '1px solid var(--cyber-border)' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
          className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--cyber-text-dim)' }}>
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <line x1="12" y1="18" x2="12" y2="18" strokeLinecap="round" strokeWidth={2} />
        </svg>
        <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--cyber-text)' }}>
          Desktop Required
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--cyber-text-dim)' }}>
          The 3D Point Cloud Editor requires a desktop browser with keyboard and mouse.
        </p>
        <button
          onClick={() => window.history.back()}
          className="px-6 py-2 rounded-full font-semibold text-sm"
          style={{
            background: 'linear-gradient(135deg, #00b8d4, #00e5ff)',
            color: '#0a0a12',
          }}
        >
          Go Back
        </button>
      </div>
    </div>
  )
}

export default function PointCloudEditor() {
  const { caveId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const clouds = useEditorStore(s => s.clouds)
  const loading = useEditorStore(s => s.loading)
  const error = useEditorStore(s => s.error)
  const setCaveId = useEditorStore(s => s.setCaveId)
  const setCaveName = useEditorStore(s => s.setCaveName)
  const loadCaveCloud = useEditorStore(s => s.loadCaveCloud)
  const clearAll = useEditorStore(s => s.clearAll)
  const importModalOpen = useEditorStore(s => s.importModalOpen)
  const setImportModalOpen = useEditorStore(s => s.setImportModalOpen)
  const alignmentMode = useEditorStore(s => s.alignmentMode)
  const pickedPoints = useEditorStore(s => s.pickedPoints)
  const measurePoints = useEditorStore(s => s.measurePoints)
  const selectedIndices = useEditorStore(s => s.selectedIndices)
  const isDirty = useEditorStore(s => s.isDirty)
  const projectName = useEditorStore(s => s.projectName)
  const saving = useEditorStore(s => s.saving)
  const lastSavedAt = useEditorStore(s => s.lastSavedAt)
  const trajectory = useEditorStore(s => s.trajectory)
  const trajectoryCloudId = useEditorStore(s => s.trajectoryCloudId)
  const pois = useEditorStore(s => s.pois)

  const [cave, setCave] = useState(null)
  const [authError, setAuthError] = useState(null)
  const [isMobile, setIsMobile] = useState(false)
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [loadModalOpen, setLoadModalOpen] = useState(false)
  const [stlProgress, setStlProgress] = useState(null) // { status, percent, stage, size, stale, pid }
  const stlPollRef = useRef(null)
  const layoutRef = useRef(null)

  // Mobile detection
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)')
    setIsMobile(mq.matches)
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Fetch cave + permission check
  useEffect(() => {
    if (!caveId) return
    apiFetch(`/caves/${caveId}/`)
      .then(data => {
        setCave(data)
        setCaveId(caveId)
        setCaveName(data.name)

        // Permission check
        const isOwner = user && (user.id === data.owner || user.is_staff)
        if (!isOwner) {
          setAuthError('You do not have permission to edit this cave.')
          return
        }

        // Load from saved project if query param present, otherwise load cave cloud
        const projectParam = searchParams.get('project')
        const alreadyLoaded = useEditorStore.getState().clouds.length > 0
        if (alreadyLoaded) return
        if (projectParam) {
          useEditorStore.getState().loadProject(caveId, projectParam)
        } else if (data.has_map) {
          loadCaveCloud(caveId)
        }
      })
      .catch(() => setAuthError('Cave not found.'))
  }, [caveId, user, setCaveId, setCaveName, loadCaveCloud, searchParams])

  // Cleanup on unmount
  useEffect(() => {
    return () => clearAll()
  }, [clearAll])

  // Fit to view whenever a new cloud is added
  const prevCloudCount = useRef(0)
  useEffect(() => {
    if (clouds.length > prevCloudCount.current) {
      setTimeout(() => layoutRef.current?.fitAllToView(), 100)
    }
    prevCloudCount.current = clouds.length
  }, [clouds.length])

  const handleFitView = useCallback(() => {
    layoutRef.current?.fitAllToView()
  }, [])

  const handleClose = useCallback(() => {
    navigate(`/caves/${caveId}`)
  }, [navigate, caveId])

  // STL status polling
  const checkStlStatus = useCallback(() => {
    if (!caveId || !user?.is_staff) return
    apiFetch(`/caves/${caveId}/stl-status/`)
      .then(data => {
        if (data.available) {
          setStlProgress({ status: 'available', size: data.size })
          if (stlPollRef.current) { clearInterval(stlPollRef.current); stlPollRef.current = null }
        } else if (data.progress) {
          const p = data.progress
          if (p.percent === -1) {
            // Failed or cancelled
            setStlProgress({ status: 'failed', stage: p.stage })
            if (stlPollRef.current) { clearInterval(stlPollRef.current); stlPollRef.current = null }
          } else if (p.percent === 100) {
            // Complete but STL not yet visible — keep polling
            setStlProgress({ status: 'generating', percent: p.percent, stage: p.stage, stale: p.stale, pid: p.pid })
          } else {
            setStlProgress({ status: 'generating', percent: p.percent, stage: p.stage, stale: p.stale, pid: p.pid })
          }
        }
      })
      .catch(() => {})
  }, [caveId, user])

  // Initial STL status check
  useEffect(() => {
    checkStlStatus()
    return () => { if (stlPollRef.current) clearInterval(stlPollRef.current) }
  }, [checkStlStatus])

  // Reset STL status when project is saved (point cloud changed → STL invalidated)
  const prevSavedAt = useRef(lastSavedAt)
  useEffect(() => {
    if (lastSavedAt && lastSavedAt !== prevSavedAt.current) {
      setStlProgress(null)
      if (stlPollRef.current) { clearInterval(stlPollRef.current); stlPollRef.current = null }
    }
    prevSavedAt.current = lastSavedAt
  }, [lastSavedAt])

  const handleStlGenerate = useCallback(() => {
    if (!caveId) return
    setStlProgress({ status: 'generating', percent: 0, stage: 'Starting...' })
    apiFetch(`/caves/${caveId}/generate-stl/`, { method: 'POST' })
      .then(() => {
        // Start polling every 3 seconds
        if (stlPollRef.current) clearInterval(stlPollRef.current)
        stlPollRef.current = setInterval(checkStlStatus, 3000)
        // Stop polling after 15 minutes
        setTimeout(() => { if (stlPollRef.current) { clearInterval(stlPollRef.current); stlPollRef.current = null } }, 900000)
      })
      .catch(() => setStlProgress(null))
  }, [caveId, checkStlStatus])

  const handleStlCancel = useCallback(() => {
    if (!caveId) return
    apiFetch(`/caves/${caveId}/cancel-stl/`, { method: 'POST' })
      .then(() => {
        setStlProgress(null)
        if (stlPollRef.current) { clearInterval(stlPollRef.current); stlPollRef.current = null }
      })
      .catch(() => {})
  }, [caveId])

  const handleStlDownload = useCallback(() => {
    if (!caveId) return
    window.open(`/api/caves/${caveId}/media/cave_printable.stl`, '_blank')
  }, [caveId])

  // Escape key to close (unless a modal is open)
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (useEditorStore.getState().importModalOpen) {
          useEditorStore.getState().setImportModalOpen(false)
          return
        }
        if (saveModalOpen) { setSaveModalOpen(false); return }
        if (loadModalOpen) { setLoadModalOpen(false); return }
        handleClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose, saveModalOpen, loadModalOpen])

  if (isMobile) return <MobileGuard />

  if (authError) {
    return (
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center"
        style={{ background: 'var(--cyber-bg)' }}
      >
        <div
          className="text-center p-8 rounded-2xl max-w-sm"
          style={{ background: 'var(--cyber-surface)', border: '1px solid var(--cyber-border)' }}
        >
          <p className="text-sm mb-4" style={{ color: '#ff6b6b' }}>{authError}</p>
          <button
            onClick={handleClose}
            className="px-6 py-2 rounded-full font-semibold text-sm"
            style={{ background: 'linear-gradient(135deg, #00b8d4, #00e5ff)', color: '#0a0a12' }}
          >
            Back to Cave
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex flex-col"
      style={{ background: 'var(--cyber-bg)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 h-10 flex-shrink-0"
        style={{ background: 'var(--cyber-surface)', borderBottom: '1px solid var(--cyber-border)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={handleClose}
            title="Close Editor (Esc)"
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[rgba(255,255,255,0.05)]"
            style={{ color: 'var(--cyber-text-dim)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-xs truncate" style={{ color: 'var(--cyber-text-dim)' }}>
            {cave?.name || 'Loading...'}
          </span>
          <span className="text-xs" style={{ color: 'var(--cyber-border)' }}>/</span>
          <span className="text-xs font-medium" style={{ color: 'var(--cyber-cyan)' }}>
            Editor
          </span>
          {projectName && (
            <>
              <span className="text-xs" style={{ color: 'var(--cyber-border)' }}>/</span>
              <span className="text-xs truncate" style={{ color: 'var(--cyber-text-dim)' }}>
                {projectName}
              </span>
            </>
          )}
          {isDirty && (
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: '#fbbf24' }}
              title="Unsaved changes"
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>
              Loading...
            </span>
          )}
          {error && (
            <span className="text-[10px]" style={{ color: '#ff6b6b' }}>
              {error}
            </span>
          )}
          {!loading && !error && clouds.length > 0 && (
            <span className="text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>
              {clouds.length > 1 && `${clouds.length} clouds · `}
              {clouds.reduce((sum, c) => sum + c.pointCount, 0).toLocaleString()} points
            </span>
          )}

          <div className="w-px h-4" style={{ background: 'var(--cyber-border)' }} />

          {/* Load Project */}
          <button
            onClick={() => setLoadModalOpen(true)}
            title="Load Project"
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[rgba(255,255,255,0.05)]"
            style={{ color: 'var(--cyber-text-dim)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </button>

          {/* Save Project */}
          <button
            onClick={() => setSaveModalOpen(true)}
            disabled={saving || clouds.length === 0}
            title="Save Project"
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[rgba(255,255,255,0.05)]"
            style={{
              color: isDirty ? 'var(--cyber-cyan)' : 'var(--cyber-text-dim)',
              opacity: clouds.length === 0 ? 0.3 : 1,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
          </button>
        </div>
      </div>

      {/* STL Progress Bar */}
      <StlProgressBar progress={stlProgress} onCancel={handleStlCancel} />

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left toolbar */}
        <EditorToolbar
          onFitView={handleFitView}
          stlProgress={stlProgress}
          onStlGenerate={handleStlGenerate}
          onStlCancel={handleStlCancel}
          onStlDownload={handleStlDownload}
        />

        {/* Center viewport layout */}
        <div className="relative flex-1 flex min-h-0">
          <EditorViewportLayout ref={layoutRef} clouds={clouds} pickedPoints={pickedPoints} measurePoints={measurePoints} selectedIndices={selectedIndices} trajectory={trajectory} trajectoryCloudId={trajectoryCloudId} pois={pois} />
          <SelectionPanel />
        </div>

        {/* Right panel — swap based on alignment mode */}
        {alignmentMode ? <AlignmentPanel /> : <EditorCloudPanel />}
      </div>

      {/* Import modal */}
      {importModalOpen && (
        <CloudImportModal
          onClose={() => setImportModalOpen(false)}
          excludeCaveId={caveId}
        />
      )}

      {/* Save/Load modals */}
      {saveModalOpen && (
        <SaveProjectModal onClose={() => setSaveModalOpen(false)} />
      )}
      {loadModalOpen && (
        <LoadProjectModal caveId={caveId} onClose={() => setLoadModalOpen(false)} />
      )}
    </div>
  )
}
