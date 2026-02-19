"""
Import caves from a CSV file.

Reads a CSV with columns matching historical cave survey data and creates
Cave records in the database. Handles DMS coordinate parsing, feet-to-meters
conversion, and markdown description formatting automatically.

Usage:
  python manage.py import_caves caves.csv
  python manage.py import_caves caves.csv --owner admin
  python manage.py import_caves caves.csv --dry-run
  python manage.py import_caves caves.csv --update

Required CSV column:
  name                 Cave name (must be unique)

Optional CSV columns:
  latitude             DMS or decimal (e.g. 35°33'20" N. or 35.5556)
  longitude            DMS or decimal (e.g. 86°35'18" W. or -86.5883)
  coordinates          Single field with both lat/lon (alternative to separate fields)
  region               State or region (e.g. Tennessee)
  country              Country (e.g. United States)
  location_description Prose description of location
  quadrangle           USGS quadrangle name and code
  geologic_horizon     Geological formation
  cave_description     Detailed cave description
  total_length_ft      Total passage length in feet (converted to meters)
  total_length_m       Total passage length in meters (takes precedence over _ft)
  vertical_extent_ft   Vertical extent in feet (converted to meters)
  vertical_extent_m    Vertical extent in meters
  water_present        true/false/yes/no (auto-detected from water_description if blank)
  water_description    Description of water features
  hazard_count         Number of hazards
  toxic_gas_present    true/false/yes/no
  toxic_gas_types      Types of toxic gases
  requires_equipment   Required equipment description
  visibility           public/private/limited_public (default: public)

Notes:
  - The first row must be a header row
  - Duplicate cave names are skipped (unless --update is used)
  - Empty rows are skipped
  - Descriptions are auto-formatted into markdown with location/quadrangle/geology sections
"""

import csv
import sys
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from caves.coord_parser import parse_coordinates
from caves.models import Cave
from users.models import UserProfile


FT_TO_M = 0.3048

TRUTHY = {'true', 'yes', '1', 'y', 't'}
FALSY = {'false', 'no', '0', 'n', 'f', ''}


def to_bool(value):
    """Convert a string to bool, or None if ambiguous."""
    if value is None:
        return None
    v = str(value).strip().lower()
    if v in TRUTHY:
        return True
    if v in FALSY:
        return False
    return None


def to_float(value):
    """Convert a string to float, or None if empty/invalid."""
    if value is None:
        return None
    v = str(value).strip().replace(',', '')
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def format_description(row):
    """
    Build a markdown-formatted description from CSV columns.

    Combines location_description, quadrangle, geologic_horizon, and
    cave_description into a structured markdown string.
    """
    parts = []

    loc = (row.get('location_description') or '').strip()
    if loc:
        parts.append(f'**Location:** {loc}')

    quad = (row.get('quadrangle') or '').strip()
    if quad:
        parts.append(f'**Quadrangle:** {quad}')

    geo = (row.get('geologic_horizon') or '').strip()
    if geo:
        parts.append(f'**Geologic Horizon:** {geo}')

    desc = (row.get('cave_description') or '').strip()
    if desc:
        if parts:
            parts.append('')  # blank line before main description
        parts.append(desc)

    return '\n\n'.join(parts)


class Command(BaseCommand):
    help = 'Import caves from a CSV file'

    def add_arguments(self, parser):
        parser.add_argument(
            'csv_file', type=str,
            help='Path to the CSV file to import',
        )
        parser.add_argument(
            '--owner', type=str, default=None,
            help='Username to set as cave owner (defaults to first superuser)',
        )
        parser.add_argument(
            '--region', type=str, default=None,
            help='Default region for all caves (overridden by CSV region column)',
        )
        parser.add_argument(
            '--country', type=str, default=None,
            help='Default country for all caves (overridden by CSV country column)',
        )
        parser.add_argument(
            '--visibility', type=str, default='public',
            choices=['public', 'private', 'limited_public'],
            help='Default visibility for imported caves (default: public)',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Parse and validate without saving to database',
        )
        parser.add_argument(
            '--update', action='store_true',
            help='Update existing caves instead of skipping duplicates',
        )

    def handle(self, *args, **options):
        csv_path = Path(options['csv_file'])
        if not csv_path.exists():
            raise CommandError(f'CSV file not found: {csv_path}')

        # Resolve owner
        owner = None
        if options['owner']:
            try:
                owner = UserProfile.objects.get(username=options['owner'])
            except UserProfile.DoesNotExist:
                raise CommandError(f'User "{options["owner"]}" not found')
        else:
            owner = UserProfile.objects.filter(is_superuser=True).first()

        if owner:
            self.stdout.write(f'Owner: {owner.username}')
        else:
            self.stdout.write(self.style.WARNING('No owner set'))

        dry_run = options['dry_run']
        update = options['update']
        default_region = options['region']
        default_country = options['country']
        default_visibility = options['visibility']

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN — no data will be saved\n'))

        # Read CSV
        try:
            with open(csv_path, newline='', encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)
                rows = list(reader)
        except Exception as e:
            raise CommandError(f'Error reading CSV: {e}')

        if not rows:
            raise CommandError('CSV file is empty (no data rows)')

        # Normalize header names (lowercase, strip whitespace)
        normalized_rows = []
        for row in rows:
            normalized_rows.append({
                k.strip().lower().replace(' ', '_'): v.strip() if v else ''
                for k, v in row.items()
            })
        rows = normalized_rows

        self.stdout.write(f'Found {len(rows)} rows in CSV\n')

        # Process rows
        created = 0
        updated = 0
        skipped = 0
        errors = 0

        for i, row in enumerate(rows, start=2):  # start=2 because row 1 is header
            name = (row.get('name') or '').strip()
            if not name:
                self.stdout.write(f'  Row {i}: SKIP (no name)')
                skipped += 1
                continue

            # Parse coordinates
            lat = None
            lon = None
            coord_raw = (row.get('coordinates') or '').strip()
            lat_raw = (row.get('latitude') or '').strip()
            lon_raw = (row.get('longitude') or '').strip()

            if coord_raw:
                # Single coordinates field
                try:
                    lat, lon = parse_coordinates(coord_raw)
                except ValueError as e:
                    self.stderr.write(
                        self.style.ERROR(f'  Row {i} ({name}): coordinate error — {e}')
                    )
                    errors += 1
                    continue
            elif lat_raw and lon_raw:
                # Separate lat/lon fields — try parsing together first
                combined = f'{lat_raw}, {lon_raw}'
                try:
                    lat, lon = parse_coordinates(combined)
                except ValueError:
                    # Try parsing individually (might be plain decimals)
                    try:
                        lat = float(lat_raw.replace('°', '').strip())
                        lon = float(lon_raw.replace('°', '').strip())
                    except ValueError as e:
                        self.stderr.write(
                            self.style.ERROR(f'  Row {i} ({name}): coordinate error — {e}')
                        )
                        errors += 1
                        continue
            elif lat_raw or lon_raw:
                self.stderr.write(
                    self.style.ERROR(f'  Row {i} ({name}): only one of lat/lon provided')
                )
                errors += 1
                continue

            # Build description
            description = format_description(row)

            # If the CSV has a plain 'description' column and no survey-style columns,
            # use that instead
            if not description and row.get('description'):
                description = row['description'].strip()

            # Parse numeric fields (feet → meters conversion)
            total_length = to_float(row.get('total_length_m'))
            if total_length is None:
                ft = to_float(row.get('total_length_ft'))
                if ft is not None:
                    total_length = round(ft * FT_TO_M, 1)

            vertical_extent = to_float(row.get('vertical_extent_m'))
            if vertical_extent is None:
                ft = to_float(row.get('vertical_extent_ft'))
                if ft is not None:
                    vertical_extent = round(ft * FT_TO_M, 1)

            largest_chamber = to_float(row.get('largest_chamber'))
            smallest_passage = to_float(row.get('smallest_passage'))
            number_of_levels = to_float(row.get('number_of_levels'))
            if number_of_levels is not None:
                number_of_levels = int(number_of_levels)

            # Parse boolean fields
            water_desc = (row.get('water_description') or '').strip()
            water_present = to_bool(row.get('water_present'))
            if water_present is None and water_desc:
                water_present = True  # infer from description

            toxic_gas = to_bool(row.get('toxic_gas_present'))
            toxic_gas_types = (row.get('toxic_gas_types') or '').strip()
            if toxic_gas is None and toxic_gas_types:
                toxic_gas = True

            hazard_count = to_float(row.get('hazard_count'))
            if hazard_count is not None:
                hazard_count = int(hazard_count)

            max_particulate = to_float(row.get('max_particulate'))
            requires_equipment = (row.get('requires_equipment') or '').strip()

            # Region / country
            region = (row.get('region') or '').strip() or default_region or ''
            country = (row.get('country') or '').strip() or default_country or ''
            visibility = (row.get('visibility') or '').strip() or default_visibility

            # Build cave data dict
            cave_data = {
                'description': description,
                'latitude': lat,
                'longitude': lon,
                'region': region,
                'country': country,
                'total_length': total_length,
                'vertical_extent': vertical_extent,
                'largest_chamber': largest_chamber,
                'smallest_passage': smallest_passage,
                'number_of_levels': number_of_levels,
                'hazard_count': hazard_count or 0,
                'toxic_gas_present': toxic_gas or False,
                'toxic_gas_types': toxic_gas_types,
                'max_particulate': max_particulate,
                'water_present': water_present or False,
                'water_description': water_desc,
                'requires_equipment': requires_equipment,
                'visibility': visibility,
                'source': 'imported',
                'owner': owner,
            }

            # Coordinate display
            coord_str = f'({lat:.4f}, {lon:.4f})' if lat is not None else '(no coords)'

            if dry_run:
                self.stdout.write(
                    f'  Row {i}: {name:<30} {coord_str:<22} '
                    f'{f"{total_length:.0f}m" if total_length else "?":>8}'
                )
                created += 1
                continue

            # Check for existing
            existing = Cave.objects.filter(name=name).first()
            if existing:
                if update:
                    for field, value in cave_data.items():
                        if value is not None and value != '' and value != 0:
                            setattr(existing, field, value)
                    existing.save()
                    updated += 1
                    self.stdout.write(
                        f'  ~ {name:<30} {coord_str:<22} (updated)'
                    )
                else:
                    skipped += 1
                    self.stdout.write(
                        f'  = {name:<30} {coord_str:<22} (exists, skipped)'
                    )
                continue

            # Create
            try:
                Cave.objects.create(name=name, **cave_data)
                created += 1
                self.stdout.write(
                    f'  + {name:<30} {coord_str:<22} '
                    f'{f"{total_length:.0f}m" if total_length else "":>8}'
                )
            except Exception as e:
                errors += 1
                self.stderr.write(
                    self.style.ERROR(f'  Row {i} ({name}): save error — {e}')
                )

        # Summary
        self.stdout.write('')
        action = 'Would create' if dry_run else 'Created'
        self.stdout.write(self.style.SUCCESS(f'{action}: {created}'))
        if updated:
            self.stdout.write(self.style.SUCCESS(f'Updated: {updated}'))
        if skipped:
            self.stdout.write(self.style.WARNING(f'Skipped: {skipped}'))
        if errors:
            self.stdout.write(self.style.ERROR(f'Errors:  {errors}'))
        self.stdout.write(f'Total caves in database: {Cave.objects.count()}')
