"""
Backfill wiki articles for existing caves with descriptions.

Usage:
    python manage.py backfill_wiki_articles          # dry run
    python manage.py backfill_wiki_articles --apply   # actually create articles
"""

from django.core.management.base import BaseCommand
from caves.models import Cave
from wiki.cave_sync import sync_cave_to_wiki


class Command(BaseCommand):
    help = 'Create Knowledge Center wiki articles for existing caves with descriptions'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Actually create the articles (default is dry run)',
        )

    def handle(self, *args, **options):
        apply = options['apply']

        caves = Cave.objects.filter(
            publish_to_wiki=True,
        ).exclude(description='')

        # Filter out caves that already have a wiki article
        caves_without_article = []
        for cave in caves:
            try:
                if cave.wiki_article:
                    continue
            except Exception:
                pass
            caves_without_article.append(cave)

        self.stdout.write(f'Found {len(caves_without_article)} caves with descriptions but no wiki article')

        if not caves_without_article:
            self.stdout.write(self.style.SUCCESS('Nothing to do.'))
            return

        for cave in caves_without_article:
            desc_preview = cave.description[:80].replace('\n', ' ')
            self.stdout.write(f'  {cave.name} — "{desc_preview}..."')

        if not apply:
            self.stdout.write(self.style.WARNING(
                f'\nDry run complete. Use --apply to create {len(caves_without_article)} wiki articles.'
            ))
            return

        created = 0
        for cave in caves_without_article:
            try:
                sync_cave_to_wiki(cave, editor_user=cave.owner)
                created += 1
                self.stdout.write(self.style.SUCCESS(f'  Created article for: {cave.name}'))
            except Exception as e:
                self.stdout.write(self.style.ERROR(f'  Failed for {cave.name}: {e}'))

        self.stdout.write(self.style.SUCCESS(f'\nDone. Created {created} wiki articles.'))
