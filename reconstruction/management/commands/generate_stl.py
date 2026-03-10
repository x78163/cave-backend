"""
Generate a 3D-printable STL file from a cave's point cloud.

Usage:
    python manage.py generate_stl --cave "Big Cave"
    python manage.py generate_stl --cave "Big Cave" --wall 0.08 --depth 10
    python manage.py generate_stl --cave "Big Cave" --output /tmp/big_cave.stl
"""

from django.core.management.base import BaseCommand
from caves.models import Cave


class Command(BaseCommand):
    help = 'Generate a 3D-printable STL shell from a cave point cloud'

    def add_arguments(self, parser):
        parser.add_argument('--cave', required=True,
                            help='Cave name or UUID')
        parser.add_argument('--wall', type=float, default=0.05,
                            help='Wall thickness in meters (default: 0.05)')
        parser.add_argument('--depth', type=int, default=10,
                            help='Poisson octree depth, 8-11 (default: 10)')
        parser.add_argument('--trim', type=float, default=0.10,
                            help='Density trim quantile, 0-1 (default: 0.10)')
        parser.add_argument('--voxel', type=float, default=0.02,
                            help='Downsample voxel size in meters (default: 0.02)')
        parser.add_argument('--scale', type=float, default=1.0,
                            help='Scale factor for output (1.0=meters, 1000=mm)')
        parser.add_argument('--poisson-scale', type=float, default=1.0,
                            help='Poisson bounding box scale (1.0=tight, 1.1=padded, default: 1.0)')
        parser.add_argument('--output', type=str, default=None,
                            help='Output file path (default: saves to cave media)')

    def handle(self, *args, **options):
        import uuid as _uuid

        cave_query = options['cave']
        try:
            _uuid.UUID(cave_query)
            cave = Cave.objects.get(id=cave_query)
        except (Cave.DoesNotExist, ValueError):
            cave = Cave.objects.filter(name__iexact=cave_query).first()
        if not cave:
            self.stderr.write(f'Cave not found: {cave_query}')
            return

        self.stdout.write(f'Cave: {cave.name} ({cave.id})')
        self.stdout.write(f'Parameters: wall={options["wall"]}m, depth={options["depth"]}, '
                          f'trim={options["trim"]}, voxel={options["voxel"]}m, '
                          f'scale={options["scale"]}x, poisson_scale={options["poisson_scale"]}')

        from reconstruction.stl_export import generate_stl_for_cave

        try:
            stl_bytes = generate_stl_for_cave(
                str(cave.id),
                wall_thickness=options['wall'],
                poisson_depth=options['depth'],
                density_quantile=options['trim'],
                voxel_size=options['voxel'],
                scale_factor=options['scale'],
                poisson_scale=options['poisson_scale'],
            )
        except Exception as e:
            self.stderr.write(self.style.ERROR(f'STL generation failed: {e}'))
            import traceback
            traceback.print_exc()
            return

        self.stdout.write(f'STL size: {len(stl_bytes) / 1e6:.2f} MB')

        if options['output']:
            with open(options['output'], 'wb') as f:
                f.write(stl_bytes)
            self.stdout.write(f'Saved to: {options["output"]}')
        else:
            from django.core.files.storage import default_storage
            from django.core.files.base import ContentFile

            stl_path = f'caves/{cave.id}/cave_printable.stl'
            if default_storage.exists(stl_path):
                default_storage.delete(stl_path)
            default_storage.save(stl_path, ContentFile(stl_bytes))
            self.stdout.write(f'Saved to media: {stl_path}')

        self.stdout.write(self.style.SUCCESS('Done'))
