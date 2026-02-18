"""
Run the reconstruction pipeline on a real PCD file + keyframes.

Copies the source data into Django media, creates a ReconstructionJob,
and runs the full Poisson reconstruction + texture projection pipeline.

Usage:
    python manage.py run_reconstruction \\
        --source-dir "/mnt/c/Users/josep/Documents/Code/Data_Dump/cave_maps/keyframes/Lab test good save" \\
        --cave "Mammoth Cave System"

    python manage.py run_reconstruction \\
        --source-dir "/path/to/session" \\
        --cave "Mammoth Cave System" \\
        --quality high \\
        --depth 11
"""

import os
import shutil
import zipfile
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Run 3D reconstruction pipeline on real PCD + keyframes'

    def add_arguments(self, parser):
        parser.add_argument(
            '--source-dir', required=True,
            help='Path to keyframe session directory (contains slam_map.pcd, keyframe_index.json, kf_*.jpg)',
        )
        parser.add_argument(
            '--cave', default='Mammoth Cave System',
            help='Name of the target cave (default: Mammoth Cave System)',
        )
        parser.add_argument(
            '--quality', choices=['draft', 'standard', 'high'], default='standard',
            help='Reconstruction quality preset',
        )
        parser.add_argument(
            '--depth', type=int, default=10,
            help='Poisson reconstruction depth (default: 10)',
        )
        parser.add_argument(
            '--voxel-size', type=float, default=0.02,
            help='Voxel downsample size in meters (default: 0.02)',
        )
        parser.add_argument(
            '--no-textures', action='store_true',
            help='Skip texture projection (faster, rock-colored mesh)',
        )

    def handle(self, *args, **options):
        from caves.models import Cave
        from reconstruction.models import ReconstructionJob
        from reconstruction.engine import ReconstructionEngine

        source_dir = Path(options['source_dir'])
        if not source_dir.exists():
            self.stderr.write(self.style.ERROR(f'Source directory not found: {source_dir}'))
            return

        # Find the PCD file
        pcd_file = source_dir / 'slam_map.pcd'
        if not pcd_file.exists():
            # Try finding any PCD file
            pcd_files = list(source_dir.glob('*.pcd'))
            if pcd_files:
                pcd_file = pcd_files[0]
            else:
                self.stderr.write(self.style.ERROR(f'No PCD file found in {source_dir}'))
                return

        self.stdout.write(f'PCD file: {pcd_file} ({pcd_file.stat().st_size / 1024:.1f} KB)')

        # Check for keyframes
        has_keyframes = (source_dir / 'keyframe_index.json').exists()
        if has_keyframes:
            kf_count = len(list(source_dir.glob('kf_*_forward.jpg')))
            self.stdout.write(f'Keyframes: {kf_count} found')
        else:
            self.stdout.write(self.style.WARNING('No keyframe_index.json — will use rock-colored mesh'))

        # Find target cave
        try:
            cave = Cave.objects.get(name=options['cave'])
        except Cave.DoesNotExist:
            self.stderr.write(self.style.ERROR(
                f'Cave "{options["cave"]}" not found. Run seed_data first.'
            ))
            return

        self.stdout.write(f'Cave: {cave.name} ({cave.id})')

        media_root = Path(settings.MEDIA_ROOT)
        input_dir = media_root / 'reconstruction' / 'input'
        input_dir.mkdir(parents=True, exist_ok=True)

        # ── Copy PCD file ──
        self.stdout.write('Copying PCD file...')
        dest_pcd = input_dir / f'{cave.id}_slam_map.pcd'
        shutil.copy2(str(pcd_file), str(dest_pcd))
        self.stdout.write(f'  Copied to: {dest_pcd}')

        # ── Zip keyframes (if available and textures requested) ──
        dest_zip = None
        if has_keyframes and not options['no_textures']:
            self.stdout.write('Creating keyframe archive...')
            dest_zip = input_dir / f'{cave.id}_keyframes.zip'
            with zipfile.ZipFile(str(dest_zip), 'w', zipfile.ZIP_DEFLATED) as zf:
                for f in source_dir.iterdir():
                    if f.is_file() and (
                        f.name.startswith('kf_') or f.name == 'keyframe_index.json'
                    ):
                        zf.write(str(f), f.name)
            self.stdout.write(f'  Archive: {dest_zip} ({dest_zip.stat().st_size / (1024*1024):.1f} MB)')

        # ── Delete old reconstruction jobs for this cave ──
        old_jobs = ReconstructionJob.objects.filter(cave=cave)
        if old_jobs.exists():
            count = old_jobs.count()
            old_jobs.delete()
            self.stdout.write(f'  Deleted {count} old reconstruction job(s)')

        # ── Create ReconstructionJob ──
        self.stdout.write('Creating reconstruction job...')
        quality_map = {
            'draft': ReconstructionJob.Quality.DRAFT,
            'standard': ReconstructionJob.Quality.STANDARD,
            'high': ReconstructionJob.Quality.HIGH,
        }

        job = ReconstructionJob.objects.create(
            cave=cave,
            quality=quality_map[options['quality']],
            poisson_depth=options['depth'],
            voxel_size=options['voxel_size'],
        )

        # Set file fields using relative paths from MEDIA_ROOT
        job.pcd_file.name = os.path.relpath(str(dest_pcd), str(media_root))
        if dest_zip:
            job.keyframe_archive.name = os.path.relpath(str(dest_zip), str(media_root))
        job.save(update_fields=['pcd_file', 'keyframe_archive'])

        self.stdout.write(f'  Job: {job.id}')
        self.stdout.write(f'  Quality: {options["quality"]}, Depth: {options["depth"]}, Voxel: {options["voxel_size"]}')

        # ── Run reconstruction ──
        self.stdout.write('')
        self.stdout.write(self.style.MIGRATE_HEADING('Running reconstruction pipeline...'))
        self.stdout.write('  This may take a while for large point clouds.')
        self.stdout.write('')

        engine = ReconstructionEngine(job)
        try:
            engine.run()
        except Exception as e:
            self.stderr.write(self.style.ERROR(f'Reconstruction failed: {e}'))
            self.stderr.write(f'  Error: {job.error_message}')
            return

        # Refresh from DB
        job.refresh_from_db()

        # ── Copy spawn.json to per-cave directory ──
        cave_dir = media_root / 'caves' / str(cave.id)
        cave_dir.mkdir(parents=True, exist_ok=True)

        spawn_path = media_root / 'reconstruction' / 'output' / f'{cave.id}_spawn.json'
        if spawn_path.exists():
            shutil.copy2(str(spawn_path), str(cave_dir / 'spawn.json'))
            self.stdout.write(f'  Spawn copied to: {cave_dir / "spawn.json"}')

        # Also copy mesh to per-cave directory
        if job.mesh_file:
            mesh_src = media_root / job.mesh_file.name
            if mesh_src.exists():
                shutil.copy2(str(mesh_src), str(cave_dir / 'mesh.glb'))

        # ── Summary ──
        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS('Reconstruction completed!'))
        self.stdout.write(f'  Points: {job.point_count:,}')
        self.stdout.write(f'  Vertices: {job.vertex_count:,}')
        self.stdout.write(f'  Triangles: {job.triangle_count:,}')
        self.stdout.write(f'  Texture coverage: {job.texture_coverage:.1f}%')
        self.stdout.write(f'  File size: {job.file_size_bytes / 1024:.1f} KB')
        self.stdout.write(f'  Time: {job.processing_time_seconds:.1f}s')
        self.stdout.write(f'  Mesh: {job.mesh_file.name}')
