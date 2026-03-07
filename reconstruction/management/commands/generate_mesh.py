"""Management command to generate BPA mesh + wireframe for a cave.

Designed to be called via subprocess.Popen from the web server so that
CPU-intensive mesh generation runs in a separate process (no GIL contention).
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Generate BPA mesh and wireframe GLB for a cave from its point cloud'

    def add_arguments(self, parser):
        parser.add_argument('cave_id', type=str, help='UUID of the cave')

    def handle(self, *args, **options):
        cave_id = options['cave_id']
        from reconstruction.mesh_from_glb import generate_mesh_for_cave
        generate_mesh_for_cave(cave_id)
