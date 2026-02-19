import { useState, useRef } from 'react'
import { apiFetch } from '../hooks/useApi'

export default function PostComposer({ grottoId, onPostCreated }) {
  const [text, setText] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [caveSearch, setCaveSearch] = useState('')
  const [caveResults, setCaveResults] = useState([])
  const [selectedCave, setSelectedCave] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef(null)
  const searchTimeout = useRef(null)

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const removeImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(null)
    setImagePreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleCaveSearch = (q) => {
    setCaveSearch(q)
    clearTimeout(searchTimeout.current)
    if (!q.trim()) { setCaveResults([]); return }
    searchTimeout.current = setTimeout(async () => {
      try {
        const data = await apiFetch('/caves/')
        const caves = data?.caves ?? data?.results ?? data ?? []
        setCaveResults(
          caves.filter(c => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5)
        )
      } catch { setCaveResults([]) }
    }, 300)
  }

  const selectCave = (cave) => {
    setSelectedCave(cave)
    setCaveSearch('')
    setCaveResults([])
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setSubmitting(true)
    try {
      if (imageFile) {
        const formData = new FormData()
        formData.append('text', text.trim())
        formData.append('image', imageFile)
        if (selectedCave) formData.append('cave', selectedCave.id)
        if (grottoId) {
          formData.append('grotto', grottoId)
          formData.append('visibility', 'group')
        }
        await apiFetch('/social/posts/', { method: 'POST', body: formData })
      } else {
        const body = {
          text: text.trim(),
          ...(selectedCave && { cave: selectedCave.id }),
          ...(grottoId && { grotto: grottoId, visibility: 'group' }),
        }
        await apiFetch('/social/posts/', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      }
      setText('')
      removeImage()
      setSelectedCave(null)
      onPostCreated?.()
    } catch { /* ignore */ }
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="cyber-card p-4 mb-4">
      <textarea
        placeholder="What's on your mind?"
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        className="cyber-textarea w-full px-3 py-2 text-sm resize-none"
      />

      {imagePreview && (
        <div className="relative mt-2 inline-block">
          <img src={imagePreview} alt="Preview" className="rounded-lg max-h-32 object-cover" />
          <button
            type="button"
            onClick={removeImage}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-xs flex items-center justify-center"
            style={{ background: 'var(--cyber-magenta)', color: '#fff' }}
          >
            x
          </button>
        </div>
      )}

      {selectedCave && (
        <div className="mt-2 flex items-center gap-2">
          <span
            className="cyber-badge text-xs"
            style={{ borderColor: 'var(--cyber-cyan)', color: 'var(--cyber-cyan)' }}
          >
            {selectedCave.name}
          </span>
          <button
            type="button"
            onClick={() => setSelectedCave(null)}
            className="text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-magenta)]"
          >
            remove
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="cyber-btn cyber-btn-ghost px-3 py-1.5 text-xs"
          style={{ borderColor: 'var(--cyber-border)', color: 'var(--cyber-text-dim)' }}
        >
          Image
        </button>

        {!selectedCave && (
          <div className="relative">
            <input
              type="text"
              placeholder="Link a cave..."
              value={caveSearch}
              onChange={e => handleCaveSearch(e.target.value)}
              className="cyber-input px-3 py-1.5 text-xs w-36"
            />
            {caveResults.length > 0 && (
              <div
                className="absolute top-full left-0 mt-1 w-56 rounded-lg z-10 max-h-40 overflow-y-auto"
                style={{ background: 'var(--cyber-surface)', border: '1px solid var(--cyber-border)' }}
              >
                {caveResults.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectCave(c)}
                    className="block w-full text-left px-3 py-2 text-xs text-[var(--cyber-text)] hover:bg-[var(--cyber-bg)] transition-colors"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !text.trim()}
          className="cyber-btn cyber-btn-cyan px-4 py-1.5 text-xs ml-auto"
        >
          {submitting ? 'Posting...' : 'Post'}
        </button>
      </div>
    </form>
  )
}
