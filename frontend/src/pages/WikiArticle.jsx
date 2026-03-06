import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { apiFetch } from '../hooks/useApi'
import useAuthStore from '../stores/authStore'

/**
 * Simple markdown→HTML converter for article display.
 * Handles headings, bold, italic, links, images, lists, code blocks, blockquotes, hr.
 */
function markdownToHtml(md) {
  if (!md) return ''
  let html = md
    // Code blocks (fenced)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:1rem 0" />')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Headings — use slugified IDs for anchor links
    .replace(/^#### (.+)$/gm, (_, t) => `<h4 id="${slugify(t)}">${t}</h4>`)
    .replace(/^### (.+)$/gm, (_, t) => `<h3 id="${slugify(t)}">${t}</h3>`)
    .replace(/^## (.+)$/gm, (_, t) => `<h2 id="${slugify(t)}">${t}</h2>`)
    .replace(/^# (.+)$/gm, (_, t) => `<h1 id="${slugify(t)}">${t}</h1>`)
    // Bold & italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr />')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered lists
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p>')
    // Single newlines to <br>
    .replace(/\n/g, '<br />')

  // Wrap loose <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>')
  // Remove duplicate <ul> wrappers
  html = html.replace(/<\/ul><br \/><ul>/g, '')

  return `<p>${html}</p>`
}

/** Slugify a heading text for stable anchor IDs. */
function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim()
}

/**
 * Extract headings from markdown for TOC generation.
 */
function extractHeadings(md) {
  if (!md) return []
  const headings = []
  const regex = /^(#{1,4}) (.+)$/gm
  let match
  while ((match = regex.exec(md)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2],
      id: slugify(match[2]),
    })
  }
  return headings
}

/**
 * Render wiki link tokens as clickable SPA links.
 * Tokens: [[cave:uuid|Display Text]], [[article:slug|Display Text]]
 * Uses data-wiki-link attributes so we can intercept clicks for SPA navigation.
 */
function renderWikiLinks(html) {
  // Cave links
  html = html.replace(
    /\[\[cave:([a-f0-9-]+)\|([^\]]+)\]\]/g,
    '<a href="/caves/$1" data-wiki-link="cave" class="wiki-link wiki-cave-link">$2</a>',
  )
  // Article links
  html = html.replace(
    /\[\[article:([a-z0-9-]+)\|([^\]]+)\]\]/g,
    '<a href="/wiki/$1" data-wiki-link="article" class="wiki-link wiki-article-link">$2</a>',
  )
  return html
}

export default function WikiArticle() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTocId, setActiveTocId] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiFetch(`/wiki/articles/${slug}/`)
      .then(setArticle)
      .catch(err => {
        console.error('Failed to fetch article:', err)
        setError('Article not found.')
      })
      .finally(() => setLoading(false))
  }, [slug])

  const headings = useMemo(() => {
    if (!article) return []
    const combined = [article.cave_description, article.content].filter(Boolean).join('\n\n')
    return extractHeadings(combined)
  }, [article?.cave_description, article?.content])

  const renderedCaveDescription = useMemo(() => {
    if (!article?.cave_description) return ''
    let html = markdownToHtml(article.cave_description)
    html = renderWikiLinks(html)
    return html
  }, [article?.cave_description])

  const renderedContent = useMemo(() => {
    if (!article?.content) return ''
    let html = markdownToHtml(article.content)
    html = renderWikiLinks(html)
    return html
  }, [article?.content])

  // Intercept clicks on wiki links for SPA navigation
  const handleContentClick = useCallback((e) => {
    const link = e.target.closest('a[data-wiki-link]')
    if (link) {
      e.preventDefault()
      navigate(link.getAttribute('href'))
    }
  }, [navigate])

  // Track active heading for TOC highlight
  useEffect(() => {
    if (headings.length < 3) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveTocId(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -70% 0px' },
    )
    for (const h of headings) {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [headings])

  // Smooth scroll for TOC clicks
  const scrollToHeading = useCallback((e, id) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Caves mentioned (from outgoing_links)
  const caveLinks = article?.outgoing_links?.filter(l => l.target_cave) || []
  // Related articles (from outgoing_links)
  const articleLinks = article?.outgoing_links?.filter(l => l.target_article) || []
  // Referenced by (incoming_links)
  const incomingLinks = article?.incoming_links || []

  const canEdit = article?.can_edit
  const isEditor = user?.is_wiki_editor || user?.is_staff
  const isAdmin = user?.is_staff

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await apiFetch(`/wiki/articles/${article.slug}/`, { method: 'DELETE' })
      navigate('/wiki')
    } catch (err) {
      console.error('Failed to delete article:', err)
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <p style={{ color: 'var(--cyber-text-dim)' }}>Loading article...</p>
      </div>
    )
  }

  if (error || !article) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <p className="text-lg mb-4" style={{ color: 'var(--cyber-text-dim)' }}>
          {error || 'Article not found.'}
        </p>
        <Link to="/wiki" className="no-underline" style={{ color: 'var(--cyber-cyan)' }}>
          Back to Knowledge Center
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm mb-6" style={{ color: 'var(--cyber-text-dim)' }}>
        <Link to="/wiki" className="no-underline hover:text-[var(--cyber-cyan)]" style={{ color: 'var(--cyber-text-dim)' }}>
          Knowledge Center
        </Link>
        {article.category_name && (
          <>
            <span>/</span>
            <Link
              to={`/wiki/category/${article.category_slug}`}
              className="no-underline hover:text-[var(--cyber-cyan)]"
              style={{ color: 'var(--cyber-text-dim)' }}
            >
              {article.category_name}
            </Link>
          </>
        )}
        <span>/</span>
        <span style={{ color: 'var(--cyber-text)' }}>{article.title}</span>
      </nav>

      <div className="flex gap-8">
        {/* Main content */}
        <article className="flex-1 min-w-0">
          {/* Title + actions */}
          <div className="flex items-start justify-between mb-4">
            <h1 className="text-3xl font-bold" style={{ color: 'var(--cyber-text)' }}>
              {article.title}
            </h1>
            <div className="flex items-center gap-2 shrink-0 ml-4">
              {canEdit && isEditor && (
                <Link
                  to={`/wiki/${article.slug}/edit`}
                  className="no-underline px-3 py-1.5 rounded-full text-xs font-semibold border border-[var(--cyber-cyan)]"
                  style={{ color: 'var(--cyber-cyan)' }}
                >
                  Edit
                </Link>
              )}
              <Link
                to={`/wiki/${article.slug}/history`}
                className="no-underline px-3 py-1.5 rounded-full text-xs border border-[var(--cyber-border)]"
                style={{ color: 'var(--cyber-text-dim)' }}
              >
                History ({article.revision_count})
              </Link>
              {isAdmin && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer"
                  style={{
                    color: '#ff4444',
                    borderColor: '#ff4444',
                    background: 'transparent',
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>

          {/* Tags */}
          {article.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {article.tags.map(tag => (
                <Link
                  key={tag.id}
                  to={`/wiki?tag=${tag.slug}`}
                  className="no-underline text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: 'var(--cyber-text-dim)',
                    border: '1px solid var(--cyber-border)',
                  }}
                >
                  {tag.name}
                </Link>
              ))}
            </div>
          )}

          {/* Cave description — synced from cave profile */}
          {renderedCaveDescription && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{
                    background: 'rgba(0, 232, 255, 0.1)',
                    color: 'var(--cyber-cyan)',
                    border: '1px solid rgba(0, 232, 255, 0.2)',
                  }}
                >
                  From Cave Profile
                </span>
                {article.source_cave_id && (
                  <Link
                    to={`/caves/${article.source_cave_id}`}
                    className="text-xs no-underline hover:text-[var(--cyber-cyan)]"
                    style={{ color: 'var(--cyber-text-dim)' }}
                  >
                    View Cave
                  </Link>
                )}
              </div>
              <div
                className="wiki-content prose-cave"
                dangerouslySetInnerHTML={{ __html: renderedCaveDescription }}
                onClick={handleContentClick}
                style={{
                  color: 'var(--cyber-text)',
                  lineHeight: 1.7,
                  fontSize: '0.95rem',
                }}
              />
              {renderedContent && (
                <hr className="my-6" style={{ borderColor: 'var(--cyber-border)' }} />
              )}
            </div>
          )}

          {/* Community wiki content */}
          {renderedContent && (
            <div
              className="wiki-content prose-cave"
              dangerouslySetInnerHTML={{ __html: renderedContent }}
              onClick={handleContentClick}
              style={{
                color: 'var(--cyber-text)',
                lineHeight: 1.7,
                fontSize: '0.95rem',
              }}
            />
          )}

          {/* Cross-reference sections */}
          {caveLinks.length > 0 && (
            <section className="mt-8 pt-6 border-t border-[var(--cyber-border)]">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--cyber-text-dim)' }}>
                Caves Mentioned
              </h3>
              <div className="flex flex-wrap gap-2">
                {caveLinks.map(link => (
                  <Link
                    key={link.id}
                    to={`/caves/${link.target_cave_id}`}
                    className="no-underline text-sm px-3 py-1 rounded-full border border-[var(--cyber-cyan)]"
                    style={{ color: 'var(--cyber-cyan)' }}
                  >
                    {link.target_cave_name || link.link_text}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {articleLinks.length > 0 && (
            <section className="mt-6">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--cyber-text-dim)' }}>
                See Also
              </h3>
              <div className="flex flex-wrap gap-2">
                {articleLinks.map(link => (
                  <Link
                    key={link.id}
                    to={`/wiki/${link.target_article_slug}`}
                    className="no-underline text-sm px-3 py-1 rounded-full border border-[var(--cyber-border)]"
                    style={{ color: 'var(--cyber-text)' }}
                  >
                    {link.target_article_title || link.link_text}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Footer meta */}
          <div className="mt-8 pt-4 border-t border-[var(--cyber-border)] text-xs" style={{ color: 'var(--cyber-text-dim)' }}>
            <span>Last edited by {article.last_edited_by_username || 'Unknown'}</span>
            <span className="mx-2">·</span>
            <span>{new Date(article.updated_at).toLocaleDateString()}</span>
            <span className="mx-2">·</span>
            <span>{article.revision_count} revision{article.revision_count !== 1 ? 's' : ''}</span>
          </div>

          {/* Referenced By — at bottom since common terms can have long lists */}
          {incomingLinks.length > 0 && (
            <section className="mt-6 pt-4 border-t border-[var(--cyber-border)]">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--cyber-text-dim)' }}>
                Referenced By ({incomingLinks.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {incomingLinks.map((link, i) => (
                  <Link
                    key={i}
                    to={`/wiki/${link.article_slug}`}
                    className="no-underline text-sm px-3 py-1 rounded-full border border-[var(--cyber-border)]"
                    style={{ color: 'var(--cyber-text)' }}
                  >
                    {link.article_title}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </article>

        {/* TOC sidebar */}
        {headings.length > 2 && (
          <aside className="hidden lg:block w-56 shrink-0">
            <nav className="sticky top-20">
              <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--cyber-text-dim)' }}>
                Contents
              </h4>
              <ul className="space-y-1" style={{ borderLeft: '2px solid var(--cyber-border)' }}>
                {headings.map((h, i) => (
                  <li key={i} style={{ paddingLeft: `${(h.level - 1) * 0.75 + 0.5}rem` }}>
                    <a
                      href={`#${h.id}`}
                      onClick={(e) => scrollToHeading(e, h.id)}
                      className="text-sm no-underline transition-colors block py-0.5"
                      style={{
                        color: activeTocId === h.id ? 'var(--cyber-cyan)' : 'var(--cyber-text-dim)',
                        borderLeft: activeTocId === h.id ? '2px solid var(--cyber-cyan)' : '2px solid transparent',
                        marginLeft: '-2px',
                        paddingLeft: '0.5rem',
                      }}
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        )}
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="rounded-xl p-6 max-w-sm w-full mx-4"
            style={{ background: 'var(--cyber-bg)', border: '1px solid var(--cyber-border)' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--cyber-text)' }}>
              Delete Article
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--cyber-text-dim)' }}>
              Are you sure you want to delete <strong>"{article.title}"</strong>? This will archive the article and remove it from the Knowledge Center.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm cursor-pointer"
                style={{ background: 'var(--cyber-card)', color: 'var(--cyber-text)', border: '1px solid var(--cyber-border)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer"
                style={{ background: '#ff4444', color: '#fff', border: 'none', opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
