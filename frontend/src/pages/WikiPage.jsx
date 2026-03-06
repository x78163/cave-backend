import { useState, useEffect, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { apiFetch } from '../hooks/useApi'
import useAuthStore from '../stores/authStore'
import WikiArticleCard from '../components/WikiArticleCard'

export default function WikiPage() {
  const { categorySlug } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isEditor = user?.is_wiki_editor || user?.is_staff

  const [categories, setCategories] = useState([])
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState(categorySlug || '')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Fetch categories
  useEffect(() => {
    apiFetch('/wiki/categories/')
      .then(setCategories)
      .catch(err => console.error('Failed to fetch categories:', err))
  }, [])

  // Fetch articles
  const fetchArticles = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      if (activeCategory) params.set('category', activeCategory)
      const data = await apiFetch(`/wiki/articles/?${params}`)
      setArticles(data)
    } catch (err) {
      console.error('Failed to fetch articles:', err)
    } finally {
      setLoading(false)
    }
  }, [search, activeCategory])

  useEffect(() => {
    fetchArticles()
  }, [fetchArticles])

  // Sync URL param with active category
  useEffect(() => {
    if (categorySlug && categorySlug !== activeCategory) {
      setActiveCategory(categorySlug)
    }
  }, [categorySlug])

  const handleCategoryClick = (slug) => {
    const newSlug = slug === activeCategory ? '' : slug
    setActiveCategory(newSlug)
    if (newSlug) {
      navigate(`/wiki/category/${newSlug}`, { replace: true })
    } else {
      navigate('/wiki', { replace: true })
    }
    setSidebarOpen(false)
  }

  const activeCategoryName = categories.find(c => c.slug === activeCategory)?.name

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Knowledge Center</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--cyber-text-dim)' }}>
            Community encyclopedia for all things caving
          </p>
        </div>
        {isEditor && (
          <Link
            to="/wiki/new"
            className="no-underline px-4 py-2 rounded-full text-sm font-semibold"
            style={{
              background: 'linear-gradient(135deg, #00b8d4, #00e5ff)',
              color: 'var(--cyber-bg)',
            }}
          >
            New Article
          </Link>
        )}
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search articles..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl text-sm"
          style={{
            background: 'var(--cyber-bg)',
            border: '1px solid var(--cyber-border)',
            color: 'var(--cyber-text)',
          }}
        />
      </div>

      {/* Mobile category toggle */}
      <button
        className="md:hidden mb-4 text-sm px-3 py-1.5 rounded-full border border-[var(--cyber-border)]"
        style={{ color: 'var(--cyber-cyan)' }}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {activeCategoryName || 'All Categories'} ▾
      </button>

      <div className="flex gap-6">
        {/* Sidebar — category tree */}
        <aside className={`shrink-0 w-56 ${sidebarOpen ? 'block' : 'hidden'} md:block`}>
          <nav className="sticky top-20">
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--cyber-text-dim)' }}>
              Categories
            </h3>
            <button
              onClick={() => handleCategoryClick('')}
              className={`block w-full text-left text-sm px-3 py-1.5 rounded-lg mb-1 transition-colors ${
                !activeCategory
                  ? 'text-[var(--cyber-bg)] bg-[var(--cyber-cyan)]'
                  : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]'
              }`}
            >
              All Articles
            </button>
            {categories.map(cat => (
              <div key={cat.id}>
                <button
                  onClick={() => handleCategoryClick(cat.slug)}
                  className={`block w-full text-left text-sm px-3 py-1.5 rounded-lg mb-0.5 transition-colors ${
                    activeCategory === cat.slug
                      ? 'text-[var(--cyber-bg)] bg-[var(--cyber-cyan)]'
                      : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]'
                  }`}
                >
                  {cat.icon && <span className="mr-1.5">{cat.icon}</span>}
                  {cat.name}
                  {cat.article_count > 0 && (
                    <span className="ml-1 opacity-50">({cat.article_count})</span>
                  )}
                </button>
                {/* Sub-categories */}
                {cat.children?.length > 0 && cat.children.map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => handleCategoryClick(sub.slug)}
                    className={`block w-full text-left text-sm pl-6 pr-3 py-1 rounded-lg mb-0.5 transition-colors ${
                      activeCategory === sub.slug
                        ? 'text-[var(--cyber-bg)] bg-[var(--cyber-cyan)]'
                        : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]'
                    }`}
                  >
                    {sub.name}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        {/* Article grid */}
        <div className="flex-1 min-w-0">
          {activeCategoryName && (
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--cyber-text)' }}>
              {activeCategoryName}
            </h2>
          )}

          {loading ? (
            <p className="text-sm" style={{ color: 'var(--cyber-text-dim)' }}>Loading articles...</p>
          ) : articles.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-lg mb-2" style={{ color: 'var(--cyber-text-dim)' }}>
                {search ? 'No articles match your search.' : 'No articles yet.'}
              </p>
              {isEditor && !search && (
                <Link
                  to="/wiki/new"
                  className="no-underline text-sm"
                  style={{ color: 'var(--cyber-cyan)' }}
                >
                  Write the first article
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {articles.map(article => (
                <WikiArticleCard key={article.id} article={article} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
