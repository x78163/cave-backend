"""
Background STL generation — called via subprocess from the API.
Runs at lowest CPU priority (nice 19) to avoid impacting other requests.
Writes progress to stl_progress.json for frontend polling.

Usage (internal):
    python manage.py generate_stl_bg <cave_uuid>
"""

import json
import os
import time

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Generate a 3D-printable STL shell (background, low priority)'

    def add_arguments(self, parser):
        parser.add_argument('cave_id', type=str, help='Cave UUID')

    def handle(self, *args, **options):
        # Drop to lowest CPU priority
        try:
            os.nice(19)
        except (OSError, AttributeError):
            pass

        cave_id = options['cave_id']

        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile

        progress_path = f'caves/{cave_id}/stl_progress.json'

        def write_progress(stage, percent):
            data = json.dumps({
                'stage': stage,
                'percent': percent,
                'pid': os.getpid(),
                'updated_at': time.time(),
            })
            try:
                if default_storage.exists(progress_path):
                    default_storage.delete(progress_path)
                default_storage.save(progress_path, ContentFile(data.encode()))
            except Exception:
                pass

        write_progress('Starting', 0)

        from reconstruction.stl_export import generate_stl_for_cave

        try:
            stl_bytes = generate_stl_for_cave(
                cave_id,
                wall_thickness=0.05,
                poisson_depth=10,
                density_quantile=0.10,
                voxel_size=0.02,
                scale_factor=1.0,
                poisson_scale=1.0,
                on_progress=write_progress,
            )
        except Exception as e:
            write_progress(f'Failed: {e}', -1)
            self.stderr.write(self.style.ERROR(f'STL generation failed: {e}'))
            import traceback
            traceback.print_exc()
            return

        write_progress('Saving', 98)

        stl_path = f'caves/{cave_id}/cave_printable.stl'
        if default_storage.exists(stl_path):
            default_storage.delete(stl_path)
        default_storage.save(stl_path, ContentFile(stl_bytes))

        write_progress('Complete', 100)
        self.stdout.write(self.style.SUCCESS(
            f'STL saved: {stl_path} ({len(stl_bytes) / 1e6:.1f} MB)'
        ))
