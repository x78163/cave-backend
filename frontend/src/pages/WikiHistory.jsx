import { useState, useEffect, useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { apiFetch } from '../hooks/useApi'
import useAuthStore from '../stores/authStore'

/**
 * Simple line-by-line diff. Returns array of { type: 'same'|'add'|'remove', text }.
 * Uses longest common subsequence for reasonable results.
 */
function computeDiff(oldText, newText) {
  const oldLines = (oldText || '').split('\n')
  const newLines = (newText || '').split('\n')

  // Build LCS table
  const m = oldLines.length
  const n = newLines.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack to build diff
  const result = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'same', text: oldLines[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', text: newLines[j - 1] })
      j--
    } else {
      result.unshift({ type: 'remove', text: oldLines[i - 1] })
      i--
    }
  }
  return result
}

export default function WikiHistory() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isEditor = user?.is_wiki_editor || user?.is_staff

  const [revisions, setRevisions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedRev, setSelectedRev] = useState(null)
  const [compareRev, setCompareRev] = useState(null)
  const [showDiff, setShowDiff] = useState(false)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    setLoading(true)
    apiFetch(`/wiki/articles/${slug}/history/`)
      .then(setRevisions)
      .catch(err => console.error('Failed to fetch history:', err))
      .finally(() => setLoading(false))
  }, [slug])

  const handleViewRevision = async (revNum) => {
    if (selectedRev?.revision_number === revNum) {
      setSelectedRev(null)
      setShowDiff(false)
      return
    }
    try {
      const data = await apiFetch(`/wiki/articles/${slug}/revisions/${revNum}/`)
      setSelectedRev(data)
      setShowDiff(false)
    } catch (err) {
      console.error('Failed to fetch revision:', err)
    }
  }

  const handleCompare = async () => {
    if (!selectedRev || !compareRev || selectedRev.revision_number === compareRev) return
    try {
      // compareRev is just a revision number — fetch its content
      const other = await apiFetch(`/wiki/articles/${slug}/revisions/${compareRev}/`)
      // Determine older vs newer
      const older = selectedRev.revision_number < other.revision_number ? selectedRev : other
      const newer = selectedRev.revision_number < other.revision_number ? other : selectedRev
      setSelectedRev(newer)
      setCompareRev(older.revision_number)
      // Store older content for diff
      setOlderContent(older.content)
      setShowDiff(true)
    } catch (err) {
      console.error('Failed to fetch comparison revision:', err)
    }
  }

  const [olderContent, setOlderContent] = useState('')

  const diffLines = useMemo(() => {
    if (!showDiff || !selectedRev) return []
    return computeDiff(olderContent, selectedRev.content)
  }, [showDiff, olderContent, selectedRev])

  const handleRestore = async (revNum) => {
    if (!confirm(`Restore revision #${revNum}? This will create a new revision with the old content.`)) return
    setRestoring(true)
    try {
      await apiFetch(`/wiki/articles/${slug}/revisions/${revNum}/`, { method: 'POST' })
      navigate(`/wiki/${slug}`)
    } catch (err) {
      console.error('Failed to restore revision:', err)
      alert('Failed to restore revision.')
    } finally {
      setRestoring(false)
    }
  }

  // Build list of revision numbers for compare dropdown
  const revisionNumbers = revisions.map(r => r.revision_number)

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <nav className="flex items-center gap-2 text-sm mb-2" style={{ color: 'var(--cyber-text-dim)' }}>
            <Link to="/wiki" className="no-underline hover:text-[var(--cyber-cyan)]" style={{ color: 'var(--cyber-text-dim)' }}>
              Knowledge Center
            </Link>
            <span>/</span>
            <Link to={`/wiki/${slug}`} className="no-underline hover:text-[var(--cyber-cyan)]" style={{ color: 'var(--cyber-text-dim)' }}>
              {slug}
            </Link>
            <span>/</span>
            <span style={{ color: 'var(--cyber-text)' }}>History</span>
          </nav>
          <h1 className="text-2xl font-bold">Revision History</h1>
        </div>
        <Link
          to={`/wiki/${slug}`}
          className="no-underline px-3 py-1.5 rounded-full text-sm border border-[var(--cyber-border)]"
          style={{ color: 'var(--cyber-text-dim)' }}
        >
          Back to Article
        </Link>
      </div>

      {loading ? (
        <p style={{ color: 'var(--cyber-text-dim)' }}>Loading history...</p>
      ) : revisions.length === 0 ? (
        <p style={{ color: 'var(--cyber-text-dim)' }}>No revisions found.</p>
      ) : (
        <>
          {/* Compare controls */}
          {selectedRev && revisions.length > 1 && (
            <div
              className="mb-4 p-3 rounded-xl flex items-center gap-3 flex-wrap"
              style={{ background: 'var(--cyber-surface)', border: '1px solid var(--cyber-border)' }}
            >
              <span className="text-sm" style={{ color: 'var(--cyber-text-dim)' }}>
                Viewing #{selectedRev.revision_number}
              </span>
              <span className="text-sm" style={{ color: 'var(--cyber-text-dim)' }}>— Compare with:</span>
              <select
                value={compareRev || ''}
                onChange={e => setCompareRev(Number(e.target.value) || null)}
                className="px-2 py-1 rounded-lg text-sm"
                style={{
                  background: 'var(--cyber-bg)',
                  border: '1px solid var(--cyber-border)',
                  color: 'var(--cyber-text)',
                }}
              >
                <option value="">Select revision</option>
                {revisionNumbers
                  .filter(n => n !== selectedRev.revision_number)
                  .map(n => (
                    <option key={n} value={n}>#{n}</option>
                  ))}
              </select>
              <button
                onClick={handleCompare}
                disabled={!compareRev}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-opacity"
                style={{
                  background: 'var(--cyber-cyan)',
                  color: 'var(--cyber-bg)',
                  opacity: compareRev ? 1 : 0.4,
                }}
              >
                Show Diff
              </button>
              {showDiff && (
                <button
                  onClick={() => setShowDiff(false)}
                  className="px-3 py-1 rounded-full text-xs border border-[var(--cyber-border)]"
                  style={{ color: 'var(--cyber-text-dim)' }}
                >
                  Hide Diff
                </button>
              )}
            </div>
          )}

          {/* Diff view */}
          {showDiff && diffLines.length > 0 && (
            <div
              className="mb-4 p-4 rounded-xl text-sm font-mono overflow-x-auto"
              style={{
                background: 'var(--cyber-bg)',
                border: '1px solid var(--cyber-border)',
                maxHeight: '500px',
                overflowY: 'auto',
              }}
            >
              <div className="mb-2 text-xs" style={{ color: 'var(--cyber-text-dim)' }}>
                <span style={{ color: '#ff6b6b' }}>- Removed</span>
                {' / '}
                <span style={{ color: '#69db7c' }}>+ Added</span>
                {' (comparing #{compareRev} → #{selectedRev.revision_number})'}
              </div>
              {diffLines.map((line, i) => (
                <div
                  key={i}
                  className="whitespace-pre-wrap"
                  style={{
                    color: line.type === 'add' ? '#69db7c'
                      : line.type === 'remove' ? '#ff6b6b'
                      : 'var(--cyber-text-dim)',
                    background: line.type === 'add' ? 'rgba(105, 219, 124, 0.05)'
                      : line.type === 'remove' ? 'rgba(255, 107, 107, 0.05)'
                      : 'transparent',
                    paddingLeft: '1.5rem',
                    textIndent: '-1rem',
                  }}
                >
                  {line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  '}
                  {line.text || '\u00a0'}
                </div>
              ))}
            </div>
          )}

          {/* Revision list */}
          <div className="space-y-2">
            {revisions.map(rev => (
              <div key={rev.id}>
                <button
                  onClick={() => handleViewRevision(rev.revision_number)}
                  className="w-full text-left px-4 py-3 rounded-xl border transition-colors"
                  style={{
                    background: selectedRev?.revision_number === rev.revision_number
                      ? 'rgba(0, 232, 255, 0.05)'
                      : 'var(--cyber-surface)',
                    borderColor: selectedRev?.revision_number === rev.revision_number
                      ? 'var(--cyber-cyan)'
                      : 'var(--cyber-border)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span
                        className="text-xs font-mono px-2 py-0.5 rounded"
                        style={{ background: 'rgba(0, 232, 255, 0.1)', color: 'var(--cyber-cyan)' }}
                      >
                        #{rev.revision_number}
                      </span>
                      <span className="text-sm" style={{ color: 'var(--cyber-text)' }}>
                        {rev.edit_summary || 'No summary'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--cyber-text-dim)' }}>
                      <span>{rev.editor_username || 'Unknown'}</span>
                      <span>{new Date(rev.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </button>

                {/* Expanded revision content */}
                {selectedRev?.revision_number === rev.revision_number && !showDiff && (
                  <div className="mt-1 mx-2">
                    {/* Restore button */}
                    {isEditor && rev.revision_number !== revisions[0]?.revision_number && (
                      <div className="mb-2 flex justify-end">
                        <button
                          onClick={() => handleRestore(rev.revision_number)}
                          disabled={restoring}
                          className="px-3 py-1 rounded-full text-xs font-semibold border transition-colors"
                          style={{
                            borderColor: '#f59e0b',
                            color: '#f59e0b',
                            opacity: restoring ? 0.5 : 1,
                          }}
                        >
                          {restoring ? 'Restoring...' : 'Restore This Version'}
                        </button>
                      </div>
                    )}
                    <div
                      className="p-4 rounded-xl text-sm font-mono whitespace-pre-wrap overflow-x-auto"
                      style={{
                        background: 'var(--cyber-bg)',
                        border: '1px solid var(--cyber-border)',
                        color: 'var(--cyber-text-dim)',
                        maxHeight: '400px',
                        overflowY: 'auto',
                      }}
                    >
                      {selectedRev.content || '(empty)'}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
