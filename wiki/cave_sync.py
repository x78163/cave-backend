"""
One-way sync from cave descriptions to Knowledge Center wiki articles.

When a cave description is saved and publish_to_wiki is True:
- Creates a wiki Article if none exists (title = cave name)
- Updates the article's cave_description field
- Creates an ArticleRevision for the change

The article's `content` field is independently editable by wiki editors
(community knowledge). Only `cave_description` is managed by this sync.
"""

import logging

logger = logging.getLogger(__name__)


def sync_cave_to_wiki(cave, editor_user=None):
    """Sync a cave's description to its linked wiki article.

    Args:
        cave: Cave instance (must have publish_to_wiki, description, name)
        editor_user: User performing the edit (for revision tracking)
    """
    from wiki.models import Article, ArticleRevision

    # Check if article already exists for this cave
    try:
        article = Article.objects.get(source_cave=cave)
    except Article.DoesNotExist:
        article = None

    # If publishing is off, clear cave_description but keep the article
    if not cave.publish_to_wiki:
        if article and article.cave_description:
            article.cave_description = ''
            article.save(update_fields=['cave_description', 'updated_at'])
            _create_revision(article, editor_user, 'Cave description unpublished from Knowledge Center')
            logger.info('Cleared cave_description for article "%s" (publish_to_wiki=False)', article.title)
        return

    # Nothing to sync if description is empty
    if not cave.description.strip():
        return

    if article:
        # Update existing article's cave_description
        # Compare raw text (strip existing tokens from stored version)
        from wiki.linking import _strip_existing_tokens
        stored_raw = _strip_existing_tokens(article.cave_description or '')
        if stored_raw != cave.description:
            article.cave_description = cave.description
            article.last_edited_by = editor_user
            article.save(update_fields=['cave_description', 'last_edited_by', 'updated_at'])
            _create_revision(article, editor_user, 'Cave description updated (auto-sync)')
            logger.info('Synced cave description to article "%s"', article.title)
    else:
        # Create new article linked to this cave
        from wiki.models import Category
        caves_category = Category.objects.filter(slug='caves').first()

        article = Article(
            title=cave.name,
            content='',
            cave_description=cave.description,
            summary=f'Knowledge Center article for {cave.name}.',
            source_cave=cave,
            category=caves_category,
            status='published',
            visibility='public',
            created_by=editor_user,
            last_edited_by=editor_user,
        )
        article.save()  # slug auto-generated in Article.save()

        _create_revision(article, editor_user, 'Auto-created from cave description')
        logger.info('Created wiki article "%s" for cave "%s"', article.title, cave.name)

    # Run auto-linking to tokenize cave_description (and content if present)
    from wiki.linking import process_article_links
    process_article_links(article)


def _create_revision(article, editor_user, edit_summary):
    """Create an ArticleRevision for the current state."""
    from wiki.models import ArticleRevision

    last_rev = article.revisions.order_by('-revision_number').first()
    rev_num = (last_rev.revision_number + 1) if last_rev else 1

    # Store both cave_description and content in revision for full snapshot
    combined = article.cave_description
    if article.content:
        combined += '\n\n---\n\n' + article.content

    ArticleRevision.objects.create(
        article=article,
        content=combined,
        edit_summary=edit_summary,
        editor=editor_user,
        revision_number=rev_num,
    )
