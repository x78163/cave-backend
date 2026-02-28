import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '../hooks/useApi'
import AvatarDisplay from './AvatarDisplay'

export default function MentionAutocomplete({ query, anchorRect, onSelect, onClose }) {
  const [results, setResults] = useState([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)
  const debounceRef = useRef(null)

  // Search on query change (debounced)
  useEffect(() => {
    if (!query) {
      setResults([])
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await apiFetch(`/users/search/?q=${encodeURIComponent(query)}`)
        setResults(data.slice(0, 8))
        setSelectedIndex(0)
      } catch { setResults([]) }
      setLoading(false)
    }, 150)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      onSelect(results[selectedIndex])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }, [results, selectedIndex, onSelect, onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!anchorRect || (results.length === 0 && !loading)) return null

  const style = {
    position: 'fixed',
    zIndex: 9999,
    bottom: (window.innerHeight - anchorRect.top + 4) + 'px',
    left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - 280)) + 'px',
    width: '260px',
  }

  return createPortal(
    <div ref={ref} style={style} className="bg-[var(--cyber-surface)] border border-[var(--cyber-border)] rounded-lg shadow-lg overflow-hidden">
      {loading && results.length === 0 && (
        <div className="px-3 py-2 text-xs text-[var(--cyber-text-dim)]">Searching...</div>
      )}
      {results.map((user, i) => (
        <button
          key={user.id}
          onClick={() => onSelect(user)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors
            ${i === selectedIndex ? 'bg-[var(--cyber-surface-2)] text-[var(--cyber-cyan)]' : 'text-[var(--cyber-text)] hover:bg-[var(--cyber-surface-2)]'}`}
        >
          <AvatarDisplay
            user={user}
            size="w-6 h-6"
            textSize="text-[10px]"
          />
          <span>{user.username}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}
