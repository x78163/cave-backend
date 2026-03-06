"""
Import wiki articles from frontmatter markdown files.

Place .md files in wiki/import/ directory, then run:
    python manage.py import_wiki_articles          # dry run
    python manage.py import_wiki_articles --apply   # actually import

Each file can contain ONE or MANY articles. Multiple articles are separated
by a line containing only '===' (three or more equals signs):

---
title: Limestone
summary: A sedimentary rock that forms most cave systems.
category: geology
tags: geology, karst, minerals
---

# Limestone

Content here...

===

---
title: Stalactites
summary: Mineral formations hanging from cave ceilings.
category: geology
tags: speleothems, formations
---

# Stalactites

More content...

Images referenced as URLs are downloaded and stored as ArticleImages.
Processed files are moved to wiki/import/done/.
"""

import re
import hashlib
import logging
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from wiki.models import Article, ArticleRevision, ArticleTag, ArticleImage, Category
from wiki.linking import process_article_links, relink_articles_for_new_title

logger = logging.getLogger(__name__)

IMPORT_DIR = Path(settings.BASE_DIR) / 'wiki' / 'import'
DONE_DIR = IMPORT_DIR / 'done'

# Match image URLs in markdown: ![alt](url)
IMAGE_RE = re.compile(r'!\[([^\]]*)\]\((https?://[^)]+)\)')

# Split delimiter: line with 3+ equals signs (optionally with whitespace)
ARTICLE_SPLIT_RE = re.compile(r'\n={3,}\s*\n')


def parse_frontmatter(text):
    """Parse YAML-like frontmatter from markdown text.
    Returns (metadata_dict, content_body)."""
    text = text.strip()
    if not text.startswith('---'):
        return {}, text

    # Find closing ---
    end = text.find('---', 3)
    if end == -1:
        return {}, text

    frontmatter = text[3:end].strip()
    body = text[end + 3:].strip()

    meta = {}
    for line in frontmatter.split('\n'):
        line = line.strip()
        if not line or ':' not in line:
            continue
        key, _, value = line.partition(':')
        key = key.strip().lower()
        value = value.strip()
        # Strip quotes
        if value and value[0] in ('"', "'") and value[-1] == value[0]:
            value = value[1:-1]
        meta[key] = value

    return meta, body


def split_articles(text):
    """Split a file into individual article chunks using === delimiter."""
    chunks = ARTICLE_SPLIT_RE.split(text)
    return [c.strip() for c in chunks if c.strip()]


def download_image(url, timeout=15):
    """Download an image from URL. Returns (filename, content_bytes) or None."""
    import requests
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/*,*/*;q=0.8',
        }
        resp = requests.get(url, timeout=timeout, stream=True, headers=headers)
        resp.raise_for_status()

        content_type = resp.headers.get('content-type', '')
        if not content_type.startswith('image/'):
            return None

        content = resp.content
        if len(content) < 100:
            return None

        ext = '.jpg'
        if 'png' in content_type:
            ext = '.png'
        elif 'gif' in content_type:
            ext = '.gif'
        elif 'webp' in content_type:
            ext = '.webp'
        elif 'svg' in content_type:
            ext = '.svg'

        url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
        filename = f'wiki_import_{url_hash}{ext}'

        return filename, content
    except Exception as e:
        logger.warning('Failed to download image %s: %s', url, e)
        return None


class Command(BaseCommand):
    help = 'Import wiki articles from frontmatter markdown files in wiki/import/'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Actually import (default is dry run)',
        )
        parser.add_argument(
            '--skip-images', action='store_true',
            help='Skip downloading images from URLs',
        )
        parser.add_argument(
            '--skip-relink', action='store_true',
            help='Skip re-linking existing articles (faster for large batches, run relink_wiki separately)',
        )

    def handle(self, *args, **options):
        apply = options['apply']
        skip_images = options['skip_images']
        skip_relink = options['skip_relink']

        if not IMPORT_DIR.exists():
            IMPORT_DIR.mkdir(parents=True)
            self.stdout.write(f'Created import directory: {IMPORT_DIR}')
            self.stdout.write('Place .md files there and run again.')
            return

        md_files = sorted(IMPORT_DIR.glob('*.md'))
        if not md_files:
            self.stdout.write(self.style.WARNING(f'No .md files found in {IMPORT_DIR}'))
            return

        # Pre-load categories
        categories = {c.slug: c for c in Category.objects.all()}

        results = {'created': 0, 'skipped': 0, 'errors': 0, 'images': 0}
        total_chunks = 0

        for md_file in md_files:
            try:
                text = md_file.read_text(encoding='utf-8')
            except UnicodeDecodeError:
                text = md_file.read_text(encoding='utf-8-sig')

            chunks = split_articles(text)
            total_chunks += len(chunks)
            self.stdout.write(
                f'\n{md_file.name}: {len(chunks)} article{"s" if len(chunks) != 1 else ""}'
            )

            for chunk in chunks:
                self._import_article(chunk, md_file.name, categories, apply, skip_images, skip_relink, results)

            # Move processed file to done/
            if apply:
                DONE_DIR.mkdir(exist_ok=True)
                md_file.rename(DONE_DIR / md_file.name)

        self.stdout.write('')
        if apply:
            self.stdout.write(self.style.SUCCESS(
                f'Done. Created {results["created"]} articles from {total_chunks} chunks, '
                f'{results["images"]} images downloaded, '
                f'{results["skipped"]} skipped, '
                f'{results["errors"]} errors.'
            ))
        else:
            self.stdout.write(self.style.WARNING(
                f'Dry run. {results["created"]} of {total_chunks} articles would be created, '
                f'{results["skipped"]} skipped. Use --apply to import.'
            ))

    def _import_article(self, chunk, filename, categories, apply, skip_images, skip_relink, results):
        meta, body = parse_frontmatter(chunk)

        title = meta.get('title', '').strip()
        if not title:
            self.stdout.write(self.style.ERROR(f'  SKIP: No title in frontmatter'))
            results['errors'] += 1
            return

        if not body.strip():
            self.stdout.write(self.style.ERROR(f'  SKIP "{title}": No content body'))
            results['errors'] += 1
            return

        # Duplicate check
        existing = Article.objects.filter(title__iexact=title, status='published').first()
        if existing:
            self.stdout.write(self.style.WARNING(
                f'  SKIP "{title}": already exists (slug: {existing.slug})'
            ))
            results['skipped'] += 1
            return

        summary = meta.get('summary', f'Knowledge Center article about {title}.')
        category_slug = meta.get('category', '').strip()
        tag_string = meta.get('tags', '')

        category = categories.get(category_slug) if category_slug else None
        if category_slug and not category:
            self.stdout.write(self.style.WARNING(
                f'  WARN "{title}": unknown category "{category_slug}"'
            ))

        tag_names = [t.strip() for t in tag_string.split(',') if t.strip()] if tag_string else []
        image_urls = IMAGE_RE.findall(body)

        self.stdout.write(
            f'  {"CREATE" if apply else "WOULD CREATE"}: "{title}" '
            f'[{category_slug or "—"}] '
            f'{len(tag_names)} tags, {len(image_urls)} imgs '
            f'({len(body)} chars)'
        )

        if not apply:
            results['created'] += 1
            return

        # Create article
        article = Article(
            title=title,
            content=body,
            summary=summary,
            category=category,
            status='published',
            visibility='public',
        )
        article.save()

        # Tags
        for tag_name in tag_names:
            tag_slug = tag_name.lower().replace(' ', '-').replace('_', '-')
            tag, _ = ArticleTag.objects.get_or_create(
                slug=tag_slug,
                defaults={'name': tag_name},
            )
            article.tags.add(tag)

        # Download images
        if not skip_images and image_urls:
            updated_content = body
            for alt_text, url in image_urls:
                result = download_image(url)
                if result:
                    img_filename, content_bytes = result
                    img = ArticleImage(article=article, caption=alt_text)
                    img.image.save(img_filename, ContentFile(content_bytes), save=True)
                    updated_content = updated_content.replace(url, img.image.url)
                    results['images'] += 1
                    self.stdout.write(f'    Image: {alt_text or img_filename}')

            if updated_content != body:
                article.content = updated_content
                article.save(update_fields=['content'])

        # Auto-link
        tokenized = process_article_links(article)
        if tokenized != article.content:
            article.content = tokenized
            article.save(update_fields=['content'])

        # Initial revision
        ArticleRevision.objects.create(
            article=article,
            content=article.content,
            edit_summary='Imported from markdown',
            revision_number=1,
        )

        # Re-link existing articles
        if not skip_relink:
            relink_articles_for_new_title(article)

        results['created'] += 1
        self.stdout.write(self.style.SUCCESS(f'    → {article.slug}'))
