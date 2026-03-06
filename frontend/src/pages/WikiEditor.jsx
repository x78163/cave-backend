import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { apiFetch } from '../hooks/useApi'
import useAuthStore from '../stores/authStore'
import RichTextEditor from '../components/RichTextEditor'

/** Simple markdown→HTML for preview (mirrors WikiArticle renderer) */
function previewMarkdownToHtml(md) {
  if (!md) return ''
  let html = md
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:1rem 0" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr />')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br />')
  html = html.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>')
  html = html.replace(/<\/ul><br \/><ul>/g, '')
  // Render wiki link tokens
  html = html.replace(/\[\[cave:([a-f0-9-]+)\|([^\]]+)\]\]/g,
    '<a class="wiki-link wiki-cave-link" style="color:var(--cyber-cyan);text-decoration:underline">$2</a>')
  html = html.replace(/\[\[article:([a-z0-9-]+)\|([^\]]+)\]\]/g,
    '<a class="wiki-link wiki-article-link" style="color:var(--cyber-cyan);text-decoration:underline">$2</a>')
  return `<p>${html}</p>`
}

export default function WikiEditor() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isEditing = Boolean(slug)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [summary, setSummary] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState('published')
  const [visibility, setVisibility] = useState('public')
  const [editSummary, setEditSummary] = useState('')
  const [categories, setCategories] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(isEditing)

  // Tag management
  const [allTags, setAllTags] = useState([])
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const [tagSearch, setTagSearch] = useState('')

  // Cave description (read-only, synced from cave)
  const [caveDescription, setCaveDescription] = useState('')
  const [sourceCaveName, setSourceCaveName] = useState(null)

  // Preview toggle
  const [showPreview, setShowPreview] = useState(false)

  // Flatten categories for select dropdown
  const flatCategories = useCallback(() => {
    const flat = []
    const flatten = (cats, depth = 0) => {
      for (const cat of cats) {
        flat.push({ ...cat, depth })
        if (cat.children?.length) flatten(cat.children, depth + 1)
      }
    }
    flatten(categories)
    return flat
  }, [categories])

  // Fetch categories + tags
  useEffect(() => {
    apiFetch('/wiki/categories/')
      .then(setCategories)
      .catch(err => console.error('Failed to fetch categories:', err))
    apiFetch('/wiki/tags/')
      .then(setAllTags)
      .catch(err => console.error('Failed to fetch tags:', err))
  }, [])

  // Load existing article if editing
  useEffect(() => {
    if (!isEditing) return
    setLoading(true)
    apiFetch(`/wiki/articles/${slug}/`)
      .then(article => {
        setTitle(article.title)
        setContent(article.content || '')
        setSummary(article.summary || '')
        setCategoryId(article.category || '')
        setStatus(article.status)
        setVisibility(article.visibility)
        if (article.tags?.length) {
          setSelectedTagIds(article.tags.map(t => t.id))
        }
        if (article.cave_description) {
          setCaveDescription(article.cave_description)
          setSourceCaveName(article.source_cave_name)
        }
      })
      .catch(err => {
        console.error('Failed to load article:', err)
        setError('Failed to load article.')
      })
      .finally(() => setLoading(false))
  }, [slug, isEditing])

  // Filtered tags for dropdown
  const filteredTags = useMemo(() => {
    if (!tagSearch.trim()) return allTags.filter(t => !selectedTagIds.includes(t.id))
    const q = tagSearch.toLowerCase()
    return allTags.filter(t => !selectedTagIds.includes(t.id) && t.name.toLowerCase().includes(q))
  }, [allTags, selectedTagIds, tagSearch])

  const selectedTags = useMemo(
    () => allTags.filter(t => selectedTagIds.includes(t.id)),
    [allTags, selectedTagIds],
  )

  const addTag = (tagId) => {
    setSelectedTagIds(prev => [...prev, tagId])
    setTagSearch('')
  }

  const removeTag = (tagId) => {
    setSelectedTagIds(prev => prev.filter(id => id !== tagId))
  }

  const previewHtml = useMemo(() => previewMarkdownToHtml(content), [content])

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const body = {
        title: title.trim(),
        content,
        summary: summary.trim(),
        status,
        visibility,
        tag_ids: selectedTagIds,
      }
      if (categoryId) body.category = categoryId
      else body.category = null

      let result
      if (isEditing) {
        result = await apiFetch(`/wiki/articles/${slug}/`, {
          method: 'PATCH',
          body: { ...body, edit_summary: editSummary },
        })
      } else {
        result = await apiFetch('/wiki/articles/', {
          method: 'POST',
          body,
        })
      }

      navigate(`/wiki/${result.slug}`)
    } catch (err) {
      console.error('Failed to save article:', err)
      setError(err.message || 'Failed to save article.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <p style={{ color: 'var(--cyber-text-dim)' }}>Loading...</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">
          {isEditing ? 'Edit Article' : 'New Article'}
        </h1>
        <Link
          to={isEditing ? `/wiki/${slug}` : '/wiki'}
          className="no-underline text-sm"
          style={{ color: 'var(--cyber-text-dim)' }}
        >
          Cancel
        </Link>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 rounded-xl text-sm" style={{ background: 'rgba(255, 107, 107, 0.1)', color: '#ff6b6b' }}>
          {error}
        </div>
      )}

      {/* Title */}
      <div className="mb-4">
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--cyber-text-dim)' }}>
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Article title"
          className="w-full px-4 py-2.5 rounded-xl text-lg font-semibold"
          style={{
            background: 'var(--cyber-bg)',
            border: '1px solid var(--cyber-border)',
            color: 'var(--cyber-text)',
          }}
        />
      </div>

      {/* Summary */}
      <div className="mb-4">
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--cyber-text-dim)' }}>
          Summary
        </label>
        <textarea
          value={summary}
          onChange={e => setSummary(e.target.value)}
          placeholder="Brief description of the article (shown in search results)"
          rows={2}
          className="w-full px-4 py-2 rounded-xl text-sm resize-none"
          style={{
            background: 'var(--cyber-bg)',
            border: '1px solid var(--cyber-border)',
            color: 'var(--cyber-text)',
          }}
        />
      </div>

      {/* Metadata row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        {/* Category */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--cyber-text-dim)' }}>
            Category
          </label>
          <select
            value={categoryId}
            onChange={e => setCategoryId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm"
            style={{
              background: 'var(--cyber-bg)',
              border: '1px solid var(--cyber-border)',
              color: 'var(--cyber-text)',
            }}
          >
            <option value="">None</option>
            {flatCategories().map(cat => (
              <option key={cat.id} value={cat.id}>
                {'  '.repeat(cat.depth)}{cat.name}
              </option>
            ))}
          </select>
        </div>

        {/* Status */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--cyber-text-dim)' }}>
            Status
          </label>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm"
            style={{
              background: 'var(--cyber-bg)',
              border: '1px solid var(--cyber-border)',
              color: 'var(--cyber-text)',
            }}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            {user?.is_staff && <option value="under_review">Under Review</option>}
          </select>
        </div>

        {/* Visibility */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--cyber-text-dim)' }}>
            Visibility
          </label>
          <select
            value={visibility}
            onChange={e => setVisibility(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm"
            style={{
              background: 'var(--cyber-bg)',
              border: '1px solid var(--cyber-border)',
              color: 'var(--cyber-text)',
            }}
          >
            <option value="public">Public</option>
            <option value="members_only">Members Only</option>
          </select>
        </div>
      </div>

      {/* Tags */}
      <div className="mb-6">
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--cyber-text-dim)' }}>
          Tags
        </label>
        {/* Selected tags */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedTags.map(tag => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{
                background: 'rgba(0, 232, 255, 0.1)',
                color: 'var(--cyber-cyan)',
                border: '1px solid rgba(0, 232, 255, 0.2)',
              }}
            >
              {tag.name}
              <button
                type="button"
                onClick={() => removeTag(tag.id)}
                className="ml-0.5 hover:text-white"
                style={{ color: 'var(--cyber-text-dim)' }}
              >
                x
              </button>
            </span>
          ))}
        </div>
        {/* Tag search/add */}
        <div className="relative">
          <input
            type="text"
            value={tagSearch}
            onChange={e => setTagSearch(e.target.value)}
            placeholder="Search tags..."
            className="w-full px-3 py-1.5 rounded-xl text-sm"
            style={{
              background: 'var(--cyber-bg)',
              border: '1px solid var(--cyber-border)',
              color: 'var(--cyber-text)',
            }}
          />
          {tagSearch && filteredTags.length > 0 && (
            <div
              className="absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden z-10 max-h-40 overflow-y-auto"
              style={{
                background: 'var(--cyber-surface)',
                border: '1px solid var(--cyber-border)',
              }}
            >
              {filteredTags.slice(0, 10).map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => addTag(tag.id)}
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-[rgba(0,232,255,0.05)]"
                  style={{ color: 'var(--cyber-text)' }}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cave description — read-only synced section */}
      {caveDescription && (
        <div className="mb-4">
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--cyber-text-dim)' }}>
            Cave Description {sourceCaveName && `(${sourceCaveName})`} — synced from cave profile
          </label>
          <div
            className="wiki-content prose-cave rounded-2xl px-4 py-3 min-h-[80px]"
            dangerouslySetInnerHTML={{ __html: previewMarkdownToHtml(caveDescription) }}
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px dashed var(--cyber-border)',
              color: 'var(--cyber-text-dim)',
              opacity: 0.7,
              lineHeight: 1.7,
              fontSize: '0.9rem',
            }}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--cyber-text-dim)' }}>
            This content syncs from the cave profile and cannot be edited here.
          </p>
        </div>
      )}

      {/* Content editor with preview toggle */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--cyber-text-dim)' }}>
            Content
          </label>
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="text-xs px-2.5 py-1 rounded-full border transition-colors"
            style={{
              borderColor: showPreview ? 'var(--cyber-cyan)' : 'var(--cyber-border)',
              color: showPreview ? 'var(--cyber-cyan)' : 'var(--cyber-text-dim)',
              background: showPreview ? 'rgba(0, 232, 255, 0.05)' : 'transparent',
            }}
          >
            {showPreview ? 'Edit' : 'Preview'}
          </button>
        </div>

        {showPreview ? (
          <div
            className="wiki-content prose-cave rounded-2xl px-4 py-3 min-h-[200px]"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
            style={{
              background: 'var(--cyber-bg)',
              border: '1px solid var(--cyber-border)',
              color: 'var(--cyber-text)',
              lineHeight: 1.7,
              fontSize: '0.95rem',
            }}
          />
        ) : (
          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: '1px solid var(--cyber-border)' }}
          >
            <RichTextEditor
              content={content}
              onChange={setContent}
              placeholder="Write your article content here..."
              articleSlug={isEditing ? slug : undefined}
            />
          </div>
        )}
      </div>

      {/* Edit summary (only when editing) */}
      {isEditing && (
        <div className="mb-6">
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--cyber-text-dim)' }}>
            Edit Summary
          </label>
          <input
            type="text"
            value={editSummary}
            onChange={e => setEditSummary(e.target.value)}
            placeholder="Briefly describe your changes"
            className="w-full px-4 py-2 rounded-xl text-sm"
            style={{
              background: 'var(--cyber-bg)',
              border: '1px solid var(--cyber-border)',
              color: 'var(--cyber-text)',
            }}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !title.trim()}
          className="px-6 py-2.5 rounded-full text-sm font-semibold transition-opacity"
          style={{
            background: 'linear-gradient(135deg, #00b8d4, #00e5ff)',
            color: 'var(--cyber-bg)',
            opacity: saving || !title.trim() ? 0.5 : 1,
          }}
        >
          {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Publish Article'}
        </button>
        <Link
          to={isEditing ? `/wiki/${slug}` : '/wiki'}
          className="no-underline px-4 py-2 rounded-full text-sm border border-[var(--cyber-border)]"
          style={{ color: 'var(--cyber-text-dim)' }}
        >
          Cancel
        </Link>
      </div>
    </div>
  )
}
