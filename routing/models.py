"""Route/itinerary models for cave navigation."""

import uuid

from django.conf import settings
from django.db import models


class CaveRoute(models.Model):
    """A saved route/itinerary through a cave.

    Stores waypoints (user-selected) and the full computed route
    (A* path, turn-by-turn instructions, stats) as JSON.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(
        'caves.Cave', on_delete=models.CASCADE, related_name='routes'
    )
    name = models.CharField(max_length=200)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='cave_routes'
    )
    waypoints = models.JSONField(
        default=list,
        help_text='Ordered list of {slam_x, slam_y, level, label, poi_id?}'
    )
    computed_route = models.JSONField(
        default=dict,
        help_text='Full engine output: path, instructions, stats, junctions'
    )
    speed_kmh = models.FloatField(default=1.0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} — {self.cave.name}'
