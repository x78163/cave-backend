import { useState } from 'react'
import useEditorStore from '../../stores/editorStore'

export default function SaveProjectModal({ onClose }) {
  const projectId = useEditorStore(s => s.projectId)
  const projectName = useEditorStore(s => s.projectName)
  const caveName = useEditorStore(s => s.caveName)
  const saving = useEditorStore(s => s.saving)
  const saveProject = useEditorStore(s => s.saveProject)

  const defaultName = projectName || `${caveName || 'Cave'} — ${new Date().toLocaleDateString()}`
  const [name, setName] = useState(defaultName)
  const [saveAs, setSaveAs] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  const isUpdate = !!projectId && !saveAs

  async function handleSave() {
    if (!name.trim()) return
    setError(null)
    try {
      // If saving as new, clear projectId first
      if (saveAs) {
        useEditorStore.setState({ projectId: null })
      }
      await saveProject(name.trim())
      setSuccess(true)
      setTimeout(onClose, 800)
    } catch (err) {
      setError(err.message || 'Save failed')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-96 rounded-xl p-5"
        style={{ background: 'var(--cyber-surface)', border: '1px solid var(--cyber-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--cyber-text)' }}>
          {isUpdate ? 'Save Project' : 'Save New Project'}
        </h3>

        <label className="block text-xs mb-1" style={{ color: 'var(--cyber-text-dim)' }}>
          Project Name
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          className="w-full px-3 py-2 rounded-lg text-sm mb-3"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid var(--cyber-border)',
            color: 'var(--cyber-text)',
            outline: 'none',
          }}
          autoFocus
          placeholder="Enter project name..."
        />

        {projectId && !saveAs && (
          <button
            onClick={() => setSaveAs(true)}
            className="text-xs mb-3 block"
            style={{ color: 'var(--cyber-cyan)' }}
          >
            Save as new project instead
          </button>
        )}

        {saveAs && (
          <button
            onClick={() => setSaveAs(false)}
            className="text-xs mb-3 block"
            style={{ color: 'var(--cyber-cyan)' }}
          >
            Update existing project instead
          </button>
        )}

        {error && (
          <p className="text-xs mb-3" style={{ color: '#ff6b6b' }}>{error}</p>
        )}

        {success && (
          <p className="text-xs mb-3" style={{ color: '#4ade80' }}>Saved!</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs"
            style={{ color: 'var(--cyber-text-dim)', background: 'rgba(255,255,255,0.05)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || success}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold"
            style={{
              background: saving ? 'rgba(0,229,255,0.3)' : 'linear-gradient(135deg, #00b8d4, #00e5ff)',
              color: '#0a0a12',
              opacity: saving || !name.trim() ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving...' : isUpdate ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
