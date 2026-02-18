import uuid
from django.db import models


class PointOfInterest(models.Model):
    """
    A point of interest associated with a cave.
    Mirrors cave-server PointOfInterest exactly + device tracking.
    """

    class PoiType(models.TextChoices):
        ENTRANCE = 'entrance', 'Entrance'
        JUNCTION = 'junction', 'Junction'
        SQUEEZE = 'squeeze', 'Squeeze'
        WATER = 'water', 'Water'
        FORMATION = 'formation', 'Formation'
        HAZARD = 'hazard', 'Hazard'
        BIOLOGY = 'biology', 'Biology'
        CAMP = 'camp', 'Camp'
        SURVEY_STATION = 'survey_station', 'Survey Station'
        TRANSITION = 'transition', 'Level Transition'
        MARKER = 'marker', 'Marker'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(
        'caves.Cave', on_delete=models.CASCADE, related_name='pois'
    )
    label = models.CharField(max_length=200, blank=True, default='')
    description = models.TextField(blank=True, default='')
    poi_type = models.CharField(
        max_length=20, choices=PoiType.choices, default=PoiType.MARKER
    )

    # Photo — either a direct upload or a reference to a cave gallery photo
    photo = models.ImageField(upload_to='pois/photos/', null=True, blank=True)
    photo_source = models.CharField(
        max_length=20, blank=True, default='',
        help_text='webcam, thermal, upload, gallery'
    )
    cave_photo = models.ForeignKey(
        'caves.CavePhoto', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='pois',
        help_text='Reference to a photo in the cave gallery'
    )

    # GPS coordinates (for surface POIs)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)

    # LiDAR/SLAM coordinates (for in-cave POIs)
    slam_x = models.FloatField(null=True, blank=True)
    slam_y = models.FloatField(null=True, blank=True)
    slam_z = models.FloatField(null=True, blank=True)

    # Where the POI was created from
    source = models.CharField(
        max_length=20, default='profile', help_text='mapping, surface, profile'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    # Cloud-specific
    origin_device = models.ForeignKey(
        'devices.Device', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='synced_pois'
    )

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"POI: {self.label or 'Unnamed'} at {self.cave.name}"
