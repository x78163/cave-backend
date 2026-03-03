import { useParams, useNavigate } from 'react-router-dom'
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
  const selectedIndices = useEditorStore(s => s.selectedIndices)

  const [cave, setCave] = useState(null)
  const [authError, setAuthError] = useState(null)
  const [isMobile, setIsMobile] = useState(false)
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

        // Load the point cloud
        if (data.has_map) {
          loadCaveCloud(caveId)
        }
      })
      .catch(() => setAuthError('Cave not found.'))
  }, [caveId, user, setCaveId, setCaveName, loadCaveCloud])

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

  // Escape key to close (unless import modal is open)
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (useEditorStore.getState().importModalOpen) {
          useEditorStore.getState().setImportModalOpen(false)
          return
        }
        handleClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

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
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left toolbar */}
        <EditorToolbar onFitView={handleFitView} />

        {/* Center viewport layout */}
        <div className="relative flex-1 flex min-h-0">
          <EditorViewportLayout ref={layoutRef} clouds={clouds} pickedPoints={pickedPoints} selectedIndices={selectedIndices} />
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
    </div>
  )
}
