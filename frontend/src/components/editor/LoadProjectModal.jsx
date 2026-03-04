import { useState, useEffect } from 'react'
import { apiFetch } from '../../hooks/useApi'
import useEditorStore from '../../stores/editorStore'

export default function LoadProjectModal({ caveId, onClose }) {
  const loading = useEditorStore(s => s.loading)
  const loadProject = useEditorStore(s => s.loadProject)
  const currentProjectId = useEditorStore(s => s.projectId)

  const [projects, setProjects] = useState([])
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => {
    if (!caveId) return
    setFetching(true)
    apiFetch(`/caves/${caveId}/editor-projects/`)
      .then(data => {
        setProjects(data)
        setFetching(false)
      })
      .catch(err => {
        setError(err.message || 'Failed to load projects')
        setFetching(false)
      })
  }, [caveId])

  async function handleLoad(projectId) {
    setError(null)
    try {
      await loadProject(caveId, projectId)
      onClose()
    } catch (err) {
      setError(err.message || 'Load failed')
    }
  }

  async function handleDelete(projectId) {
    if (confirmDelete !== projectId) {
      setConfirmDelete(projectId)
      return
    }
    try {
      await apiFetch(`/caves/${caveId}/editor-projects/${projectId}/`, { method: 'DELETE' })
      setProjects(prev => prev.filter(p => p.id !== projectId))
      setConfirmDelete(null)
      // If we deleted the current project, clear projectId
      if (currentProjectId === projectId) {
        useEditorStore.setState({ projectId: null, projectName: '', lastSavedAt: null })
      }
    } catch (err) {
      setError(err.message || 'Delete failed')
    }
  }

  function formatDate(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-[480px] max-h-[70vh] rounded-xl flex flex-col"
        style={{ background: 'var(--cyber-surface)', border: '1px solid var(--cyber-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--cyber-border)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--cyber-text)' }}>
            Load Project
          </h3>
          <button onClick={onClose} className="text-xs" style={{ color: 'var(--cyber-text-dim)' }}>
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {fetching && (
            <p className="text-xs text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>
              Loading projects...
            </p>
          )}

          {!fetching && projects.length === 0 && (
            <p className="text-xs text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>
              No saved projects for this cave.
            </p>
          )}

          {error && (
            <p className="text-xs mb-3" style={{ color: '#ff6b6b' }}>{error}</p>
          )}

          {!fetching && projects.map(project => (
            <div
              key={project.id}
              className="flex items-center justify-between py-2.5 px-3 rounded-lg mb-1"
              style={{
                background: project.id === currentProjectId ? 'rgba(0,229,255,0.08)' : 'transparent',
                border: project.id === currentProjectId ? '1px solid rgba(0,229,255,0.2)' : '1px solid transparent',
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--cyber-text)' }}>
                    {project.name}
                  </span>
                  {project.id === currentProjectId && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,229,255,0.15)', color: 'var(--cyber-cyan)' }}>
                      current
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>
                    {project.cloud_count} cloud{project.cloud_count !== 1 ? 's' : ''}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>
                    {formatDate(project.updated_at)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 ml-3">
                <button
                  onClick={() => handleLoad(project.id)}
                  disabled={loading}
                  className="px-3 py-1 rounded-md text-xs font-semibold"
                  style={{
                    background: 'linear-gradient(135deg, #00b8d4, #00e5ff)',
                    color: '#0a0a12',
                    opacity: loading ? 0.5 : 1,
                  }}
                >
                  {loading ? '...' : 'Load'}
                </button>
                <button
                  onClick={() => handleDelete(project.id)}
                  onMouseLeave={() => setConfirmDelete(null)}
                  className="px-2 py-1 rounded-md text-xs"
                  style={{
                    background: confirmDelete === project.id ? '#ff4444' : 'rgba(255,107,107,0.1)',
                    color: confirmDelete === project.id ? 'white' : '#ff6b6b',
                    border: `1px solid ${confirmDelete === project.id ? '#ff4444' : 'rgba(255,107,107,0.2)'}`,
                  }}
                >
                  {confirmDelete === project.id ? 'Confirm' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
