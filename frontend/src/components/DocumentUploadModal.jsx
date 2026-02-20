import { useState, useRef } from 'react'
import { apiFetch } from '../hooks/useApi'

export default function DocumentUploadModal({ caveId, onComplete, onClose }) {
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const handleFileSelect = (f) => {
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are accepted')
      return
    }
    if (f.size > 50 * 1024 * 1024) {
      setError('File too large (max 50MB)')
      return
    }
    setFile(f)
    setError(null)
    if (!title) setTitle(f.name.replace(/\.pdf$/i, ''))
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      if (title) form.append('title', title)
      if (description) form.append('description', description)
      const res = await apiFetch(`/caves/${caveId}/documents/`, {
        method: 'POST',
        body: form,
      })
      onComplete(res)
    } catch (err) {
      setError(err?.response?.data?.error || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center px-4"
      style={{ background: 'rgba(10, 10, 18, 0.92)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="cyber-card w-full max-w-md p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold">Upload Document</h2>
          <button onClick={onClose} className="text-[var(--cyber-text-dim)] hover:text-white text-lg">&times;</button>
        </div>

        {/* File picker */}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={e => handleFileSelect(e.target.files?.[0])}
        />
        {!file ? (
          <div
            className="border-2 border-dashed border-[var(--cyber-border)] rounded-xl p-6 text-center cursor-pointer
              hover:border-cyan-700/50 transition-colors"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFileSelect(e.dataTransfer.files?.[0]) }}
          >
            <p className="text-[var(--cyber-text-dim)]">Click or drag to select PDF</p>
            <p className="text-[#555570] text-xs mt-1">Max 50MB</p>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)] p-3">
            <div className="w-10 h-10 flex-shrink-0 rounded-lg bg-red-900/30 border border-red-800/30
              flex items-center justify-center text-red-400 text-xs font-bold">
              PDF
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm truncate">{file.name}</p>
              <p className="text-[var(--cyber-text-dim)] text-xs">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
            <button
              onClick={() => { setFile(null); setTitle('') }}
              className="text-[var(--cyber-text-dim)] hover:text-white text-sm"
            >
              &times;
            </button>
          </div>
        )}

        {/* Title */}
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Document title"
          className="cyber-input w-full px-4 py-2.5 text-sm"
        />

        {/* Description */}
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Description (optional)..."
          className="cyber-input w-full px-4 py-2.5 text-sm resize-none"
          rows={2}
        />

        {error && <p className="text-red-400 text-xs">{error}</p>}

        {/* Actions */}
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
            onClick={handleUpload}
            disabled={!file || uploading}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all
              ${file
                ? 'bg-gradient-to-r from-cyan-600 to-cyan-700 text-white shadow-[0_0_12px_rgba(0,229,255,0.2)]'
                : 'bg-[var(--cyber-surface-2)] text-[#555570]'}`}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}
