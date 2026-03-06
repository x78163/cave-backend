"""
Re-run auto-linking on all published wiki articles.

Useful after bulk imports to cross-reference everything.

Usage:
    python manage.py relink_wiki          # dry run (show what would change)
    python manage.py relink_wiki --apply  # actually update
"""

from django.core.management.base import BaseCommand

from wiki.models import Article
from wiki.linking import process_article_links


class Command(BaseCommand):
    help = 'Re-run auto-linking engine on all published wiki articles'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Actually update articles (default is dry run)',
        )

    def handle(self, *args, **options):
        apply = options['apply']

        articles = Article.objects.filter(status='published')
        total = articles.count()
        self.stdout.write(f'Processing {total} published articles...\n')

        updated = 0
        for i, article in enumerate(articles.iterator(), 1):
            has_content = article.content and article.content.strip()
            has_cave_desc = article.cave_description and article.cave_description.strip()
            if not has_content and not has_cave_desc:
                continue

            old_content = article.content
            old_cave_desc = article.cave_description

            tokenized = process_article_links(article)

            content_changed = tokenized != old_content
            # cave_description may have been saved internally by process_article_links
            article.refresh_from_db(fields=['cave_description'])
            desc_changed = article.cave_description != old_cave_desc

            if content_changed or desc_changed:
                if apply and content_changed:
                    article.content = tokenized
                    article.save(update_fields=['content'])
                updated += 1
                if updated <= 20:  # Show first 20
                    self.stdout.write(f'  {"Updated" if apply else "Would update"}: {article.title}')

            if i % 100 == 0:
                self.stdout.write(f'  ...processed {i}/{total}')

        self.stdout.write('')
        if apply:
            self.stdout.write(self.style.SUCCESS(f'Done. Updated {updated} of {total} articles.'))
        else:
            self.stdout.write(self.style.WARNING(
                f'Dry run. {updated} of {total} articles would be updated. Use --apply to execute.'
            ))
