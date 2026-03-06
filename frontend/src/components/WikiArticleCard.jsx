import { Link } from 'react-router-dom'

const STATUS_COLORS = {
  published: 'var(--cyber-cyan)',
  draft: 'var(--cyber-text-dim)',
  under_review: '#f59e0b',
  archived: '#6b7280',
}

export default function WikiArticleCard({ article }) {
  const statusColor = STATUS_COLORS[article.status] || 'var(--cyber-text-dim)'

  return (
    <Link
      to={`/wiki/${article.slug}`}
      className="block no-underline rounded-2xl border border-[var(--cyber-border)] p-4 hover:border-[var(--cyber-cyan)] transition-colors"
      style={{ background: 'var(--cyber-surface)' }}
    >
      {/* Featured image */}
      {article.featured_image && (
        <div className="mb-3 rounded-xl overflow-hidden h-36">
          <img
            src={article.featured_image}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Category badge */}
      {article.category_name && (
        <span
          className="inline-block text-xs px-2 py-0.5 rounded-full mb-2"
          style={{
            background: 'rgba(0, 232, 255, 0.1)',
            color: 'var(--cyber-cyan)',
            border: '1px solid rgba(0, 232, 255, 0.2)',
          }}
        >
          {article.category_name}
        </span>
      )}

      {/* Title */}
      <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--cyber-text)' }}>
        {article.title}
      </h3>

      {/* Summary */}
      {article.summary && (
        <p className="text-sm mb-2 line-clamp-2" style={{ color: 'var(--cyber-text-dim)' }}>
          {article.summary}
        </p>
      )}

      {/* Tags */}
      {article.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {article.tags.slice(0, 4).map(tag => (
            <span
              key={tag.id}
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--cyber-text-dim)',
              }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--cyber-text-dim)' }}>
        <span>
          {article.last_edited_by_username
            ? `Edited by ${article.last_edited_by_username}`
            : article.created_by_username
              ? `By ${article.created_by_username}`
              : ''}
        </span>
        <div className="flex items-center gap-2">
          {article.revision_count > 1 && (
            <span>{article.revision_count} revisions</span>
          )}
          <span style={{ color: statusColor }}>
            {article.status !== 'published' ? article.status : ''}
          </span>
        </div>
      </div>
    </Link>
  )
}
