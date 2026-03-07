"""Management command to generate 2D map data from mesh GLB + trajectory.

Designed to be called via subprocess.Popen from the web server so that
CPU-intensive map generation runs in a separate process.
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Generate 2D map data (map_data.json) from cave mesh and trajectory'

    def add_arguments(self, parser):
        parser.add_argument('cave_id', type=str, help='UUID of the cave')

    def handle(self, *args, **options):
        cave_id = options['cave_id']
        from reconstruction.map_from_mesh import generate_map_data
        result = generate_map_data(cave_id)
        if result:
            self.stdout.write(self.style.SUCCESS(
                f'Generated map_data.json for cave {cave_id} '
                f'({len(result.get("levels", [{}])[0].get("walls", []))} wall polylines)'
            ))
        else:
            self.stderr.write(self.style.ERROR(
                f'Failed to generate map data for cave {cave_id}'
            ))
