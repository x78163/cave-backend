"""
Backfill PAD-US public land data for all caves with coordinates.

Usage:
  python3 manage.py backfill_public_land
  python3 manage.py backfill_public_land --force     # Re-check already-filled caves
  python3 manage.py backfill_public_land --dry-run    # Preview without saving
  python3 manage.py backfill_public_land --delay 3.0  # Custom delay between requests
"""

import time

from django.core.management.base import BaseCommand

from caves.models import Cave
from caves.padus_lookup import lookup_public_land


class Command(BaseCommand):
    help = 'Backfill PAD-US public land data for caves with coordinates'

    def add_arguments(self, parser):
        parser.add_argument(
            '--force', action='store_true',
            help='Re-check caves that already have public land data',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Preview lookups without saving to database',
        )
        parser.add_argument(
            '--delay', type=float, default=3.0,
            help='Seconds between API calls (default: 3.0 for ~20/min)',
        )

    def _process_cave(self, cave, dry_run):
        """Query PAD-US for a single cave. Returns 'found', 'not_found', or 'error'."""
        result = lookup_public_land(cave.latitude, cave.longitude)
        if result.get('found'):
            name = result['public_land_name']
            land_type = result['public_land_type']
            owner = result.get('public_land_owner', '')
            self.stdout.write(
                self.style.SUCCESS(f'{name} ({land_type}, {owner})')
            )
            if not dry_run:
                cave.public_land_name = result.get('public_land_name', '')
                cave.public_land_type = result.get('public_land_type', '')
                cave.public_land_owner = result.get('public_land_owner', '')
                cave.public_land_access = result.get('public_land_access', '')
                cave.save(update_fields=[
                    'public_land_name', 'public_land_type',
                    'public_land_owner', 'public_land_access',
                ])
            return 'found'
        else:
            self.stdout.write('Not on public land')
            if not dry_run:
                # Mark as checked so re-runs skip this cave
                cave.public_land_name = 'N/A'
                cave.save(update_fields=['public_land_name'])
            return 'not_found'

    def handle(self, *args, **options):
        force = options['force']
        dry_run = options['dry_run']
        delay = options['delay']

        qs = Cave.objects.filter(
            latitude__isnull=False,
            longitude__isnull=False,
        )
        if not force:
            qs = qs.filter(public_land_name='')

        caves = list(qs.order_by('name'))
        total = len(caves)
        self.stdout.write(f'Found {total} caves to check (delay: {delay}s)')
        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN — no changes will be saved'))

        found = 0
        not_found = 0
        errors = 0
        failed_caves = []
        consecutive_errors = 0

        for i, cave in enumerate(caves, 1):
            self.stdout.write(f'  [{i}/{total}] {cave.name} ... ', ending='')
            try:
                status = self._process_cave(cave, dry_run)
                if status == 'found':
                    found += 1
                else:
                    not_found += 1
                consecutive_errors = 0
            except Exception as e:
                errors += 1
                consecutive_errors += 1
                failed_caves.append(cave)
                self.stdout.write(self.style.ERROR(f'ERROR: {e}'))

                # Adaptive backoff: if we get multiple consecutive errors, slow down
                if consecutive_errors >= 3:
                    pause = 30
                    self.stdout.write(
                        self.style.WARNING(f'  ** {consecutive_errors} consecutive errors — pausing {pause}s **')
                    )
                    time.sleep(pause)
                    consecutive_errors = 0

            if i < total:
                time.sleep(delay)

        # Retry failed caves with longer delay
        if failed_caves and not dry_run:
            self.stdout.write('')
            self.stdout.write(
                self.style.WARNING(f'Retrying {len(failed_caves)} failed caves with 5s delay...')
            )
            time.sleep(10)  # Cool-down before retry pass

            for i, cave in enumerate(failed_caves, 1):
                self.stdout.write(f'  [retry {i}/{len(failed_caves)}] {cave.name} ... ', ending='')
                try:
                    status = self._process_cave(cave, dry_run)
                    if status == 'found':
                        found += 1
                        errors -= 1
                    else:
                        not_found += 1
                        errors -= 1
                except Exception as e:
                    self.stdout.write(self.style.ERROR(f'STILL FAILING: {e}'))

                if i < len(failed_caves):
                    time.sleep(5)

        self.stdout.write('')
        self.stdout.write(
            f'Done! Public land: {found}, '
            f'Private/unknown: {not_found}, '
            f'Errors: {errors}'
        )
