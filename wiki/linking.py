"""
Auto-linking engine for wiki articles.

On article save, scans markdown content for:
1. Cave names (+ aliases) → creates ArticleLink with target_cave
2. Other article titles → creates ArticleLink with target_article
3. Encodes matches as wiki link tokens in content:
   [[cave:uuid|Display Text]], [[article:slug|Display Text]]

Uses a cached lookup dict for performance. Cache is rebuilt on first
call per process and invalidated when caves/articles change.
"""

import re
import logging
from functools import lru_cache

from django.db.models import Q

logger = logging.getLogger(__name__)

# Token patterns for wiki links already in content
CAVE_LINK_RE = re.compile(r'\[\[cave:[a-f0-9-]+\|[^\]]+\]\]')
ARTICLE_LINK_RE = re.compile(r'\[\[article:[a-z0-9-]+\|[^\]]+\]\]')


def _is_coordinate_name(name):
    """Filter out cave names that look like coordinate strings."""
    # DMS patterns: 36°18'28.0"N, N36°...
    if '°' in name or "'" in name and '"' in name:
        return True
    # Decimal degrees: 36.307, -86.5
    if re.match(r'^-?\d+\.\d+', name):
        return True
    return False


def _build_cave_lookup():
    """Build a case-insensitive name → (cave_id, display_name) lookup dict.
    Includes primary names and all aliases. Filters out coordinate-format names."""
    from caves.models import Cave

    lookup = {}
    caves = Cave.objects.filter(
        Q(visibility__in=['public', 'limited_public'])
        | Q(publish_to_wiki=True),  # Include wiki-published unlisted caves
    ).values_list('id', 'name', 'aliases')

    for cave_id, name, aliases in caves:
        # Primary name
        key = name.strip().lower()
        if key and len(key) > 2 and not _is_coordinate_name(key):
            lookup[key] = (str(cave_id), name.strip())

        # Aliases
        if aliases:
            for alias in aliases.split(','):
                alias = alias.strip()
                akey = alias.lower()
                if akey and len(akey) > 2 and not _is_coordinate_name(akey):
                    lookup[akey] = (str(cave_id), alias)

    return lookup


def _build_article_lookup(exclude_id=None):
    """Build a case-insensitive title → (slug, display_title) lookup dict."""
    from wiki.models import Article

    qs = Article.objects.filter(status='published').values_list('id', 'title', 'slug')
    if exclude_id:
        qs = qs.exclude(id=exclude_id)

    lookup = {}
    for art_id, title, slug in qs:
        key = title.strip().lower()
        if key and len(key) > 2:
            lookup[key] = (slug, title.strip())

    return lookup


def _strip_existing_tokens(content):
    """Remove existing wiki link tokens so we can re-scan cleanly."""
    # Replace [[cave:uuid|text]] with just the text
    content = re.sub(
        r'\[\[cave:[a-f0-9-]+\|([^\]]+)\]\]',
        r'\1',
        content,
    )
    # Replace [[article:slug|text]] with just the text
    content = re.sub(
        r'\[\[article:[a-z0-9-]+\|([^\]]+)\]\]',
        r'\1',
        content,
    )
    return content


def _find_matches(content, lookup):
    """Find all occurrences of lookup keys in content.
    Returns list of (start, end, key, value) sorted by position, longest match first."""
    matches = []
    content_lower = content.lower()

    # Sort keys by length descending so longer names match first
    # (e.g., "Watauga Bluffs Cave" before "Watauga")
    sorted_keys = sorted(lookup.keys(), key=len, reverse=True)

    # Track matched ranges to avoid overlaps
    matched_ranges = set()

    for key in sorted_keys:
        # Use word boundary matching to avoid partial matches
        # Escape special regex chars in the key
        pattern = re.compile(
            r'\b' + re.escape(key) + r'\b',
            re.IGNORECASE,
        )

        for m in pattern.finditer(content):
            start, end = m.start(), m.end()

            # Skip if overlaps with an already-matched range
            if any(start < mr_end and end > mr_start
                   for mr_start, mr_end in matched_ranges):
                continue

            matched_ranges.add((start, end))
            matches.append((start, end, key, lookup[key]))

    # Sort by position
    matches.sort(key=lambda x: x[0])
    return matches


def _tokenize_text(text, cave_lookup, article_lookup):
    """Tokenize a text string by finding and replacing matches with wiki link tokens.
    Returns (tokenized_text, cave_matches, article_matches)."""
    if not text or not text.strip():
        return text, [], []

    clean = _strip_existing_tokens(text)
    cave_matches = _find_matches(clean, cave_lookup)
    article_matches = _find_matches(clean, article_lookup)

    # Collect ranges already claimed by cave matches (caves take priority)
    cave_ranges = {(start, end) for start, end, _k, _v in cave_matches}

    # Build replacements — caves first (higher priority)
    all_matches = []
    for start, end, key, (cave_id, display_name) in cave_matches:
        original_text = clean[start:end]
        token = f'[[cave:{cave_id}|{original_text}]]'
        all_matches.append((start, end, token))

    for start, end, key, (slug, display_title) in article_matches:
        # Skip article matches that overlap with a cave match
        if any(start < cr_end and end > cr_start
               for cr_start, cr_end in cave_ranges):
            continue
        original_text = clean[start:end]
        token = f'[[article:{slug}|{original_text}]]'
        all_matches.append((start, end, token))

    # Sort descending so replacements don't shift indices
    all_matches.sort(key=lambda x: x[0], reverse=True)

    tokenized = clean
    for start, end, token in all_matches:
        tokenized = tokenized[:start] + token + tokenized[end:]

    return tokenized, cave_matches, article_matches


def process_article_links(article):
    """Main entry point: scan article content AND cave_description,
    create ArticleLink records, and inject wiki link tokens.

    Returns the updated content string with tokens inserted.
    Also updates cave_description in-place if it contains matches.
    """
    from wiki.models import ArticleLink

    content = article.content or ''
    cave_desc = article.cave_description or ''

    if not content.strip() and not cave_desc.strip():
        ArticleLink.objects.filter(
            source_article=article, auto_generated=True,
        ).delete()
        return content

    # Build lookups once for both fields
    cave_lookup = _build_cave_lookup()
    article_lookup = _build_article_lookup(exclude_id=article.pk)

    # Tokenize both fields
    tokenized_content, content_cave_matches, content_article_matches = \
        _tokenize_text(content, cave_lookup, article_lookup)
    tokenized_cave_desc, desc_cave_matches, desc_article_matches = \
        _tokenize_text(cave_desc, cave_lookup, article_lookup)

    # Collect all unique links from both fields
    new_cave_links = {}
    new_article_links = {}

    for matches in [content_cave_matches, desc_cave_matches]:
        for _start, _end, _key, (cave_id, display_name) in matches:
            if cave_id not in new_cave_links:
                new_cave_links[cave_id] = display_name

    for matches in [content_article_matches, desc_article_matches]:
        for _start, _end, _key, (slug, display_title) in matches:
            if slug not in new_article_links:
                new_article_links[slug] = display_title

    # Save tokenized cave_description if changed
    if tokenized_cave_desc != article.cave_description:
        article.cave_description = tokenized_cave_desc
        article.save(update_fields=['cave_description'])

    # Update ArticleLink records
    ArticleLink.objects.filter(
        source_article=article, auto_generated=True,
    ).delete()

    from caves.models import Cave
    for cave_id, link_text in new_cave_links.items():
        try:
            cave = Cave.objects.get(id=cave_id)
            ArticleLink.objects.create(
                source_article=article,
                target_cave=cave,
                link_text=link_text,
                auto_generated=True,
            )
        except Cave.DoesNotExist:
            pass

    from wiki.models import Article
    for slug, link_text in new_article_links.items():
        try:
            target = Article.objects.get(slug=slug)
            ArticleLink.objects.create(
                source_article=article,
                target_article=target,
                link_text=link_text,
                auto_generated=True,
            )
        except Article.DoesNotExist:
            pass

    logger.info(
        'Auto-linked article "%s": %d cave refs, %d article refs',
        article.title, len(new_cave_links), len(new_article_links),
    )

    return tokenized_content


def relink_articles_for_new_title(new_article):
    """Re-run auto-linking on existing articles that mention the new article's title.

    Called after a new article is created (or title changed) so that existing
    articles retroactively gain links to it. Only processes articles whose
    content actually contains the title (DB-level icontains filter).
    """
    title = new_article.title.strip()
    if not title or len(title) <= 2:
        return 0

    from wiki.models import Article

    # Find published articles (excluding the new one) that contain the title
    candidates = Article.objects.filter(
        status='published',
    ).exclude(
        id=new_article.id,
    ).filter(
        Q(content__icontains=title) | Q(cave_description__icontains=title),
    )

    updated = 0
    for article in candidates:
        has_content = article.content and article.content.strip()
        has_cave_desc = article.cave_description and article.cave_description.strip()
        if not has_content and not has_cave_desc:
            continue
        old_content = article.content
        old_cave_desc = article.cave_description
        tokenized = process_article_links(article)
        # process_article_links saves cave_description internally if changed
        if tokenized != old_content:
            article.content = tokenized
            article.save(update_fields=['content'])
        # Refresh to check if cave_description was updated
        article.refresh_from_db(fields=['cave_description'])
        if article.content != old_content or article.cave_description != old_cave_desc:
            updated += 1

    if updated:
        logger.info(
            'Re-linked %d existing articles after new article "%s" created',
            updated, title,
        )
    return updated
