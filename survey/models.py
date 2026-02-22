import uuid
from django.conf import settings
from django.db import models


class CaveSurvey(models.Model):
    """A named survey session for a cave — collection of station-to-station shots."""

    UNIT_CHOICES = [
        ('feet', 'Feet'),
        ('meters', 'Meters'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(
        'caves.Cave', on_delete=models.CASCADE, related_name='surveys',
    )
    name = models.CharField(max_length=200)
    date_surveyed = models.DateField(null=True, blank=True)
    surveyors = models.CharField(max_length=500, blank=True, default='')
    unit = models.CharField(max_length=10, choices=UNIT_CHOICES, default='feet')
    declination = models.FloatField(default=0.0, help_text='Magnetic declination in degrees')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='created_surveys',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Computed summary fields (updated by compute engine)
    total_length = models.FloatField(null=True, blank=True)
    total_depth = models.FloatField(null=True, blank=True)
    station_count = models.IntegerField(default=0)

    # Persisted render data (centerlines, walls, stations, branches)
    render_data = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} ({self.cave.name})"


class SurveyStation(models.Model):
    """A survey station — a named point in the cave where measurements are taken."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    survey = models.ForeignKey(
        CaveSurvey, on_delete=models.CASCADE, related_name='stations',
    )
    name = models.CharField(max_length=50)

    # Computed coordinates (meters, relative to first station as origin)
    x = models.FloatField(null=True, blank=True)
    y = models.FloatField(null=True, blank=True)
    z = models.FloatField(null=True, blank=True)

    # Optional fixed coordinates (for tying to GPS / known points)
    is_fixed = models.BooleanField(default=False)
    fixed_lat = models.FloatField(null=True, blank=True)
    fixed_lon = models.FloatField(null=True, blank=True)
    fixed_elev = models.FloatField(null=True, blank=True)

    class Meta:
        unique_together = [('survey', 'name')]
        ordering = ['name']

    def __str__(self):
        return f"Station {self.name} ({self.survey.name})"


class SurveyShot(models.Model):
    """A single survey shot — measurement from one station to another."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    survey = models.ForeignKey(
        CaveSurvey, on_delete=models.CASCADE, related_name='shots',
    )
    from_station = models.ForeignKey(
        SurveyStation, on_delete=models.CASCADE, related_name='shots_from',
    )
    to_station = models.ForeignKey(
        SurveyStation, on_delete=models.CASCADE, related_name='shots_to',
    )
    distance = models.FloatField(help_text='Distance in survey units')
    azimuth = models.FloatField(help_text='Magnetic bearing 0-360 degrees')
    inclination = models.FloatField(
        default=0.0, help_text='Vertical angle -90 to +90 degrees',
    )

    # LRUD passage dimensions at from_station (in survey units)
    left = models.FloatField(null=True, blank=True)
    right = models.FloatField(null=True, blank=True)
    up = models.FloatField(null=True, blank=True)
    down = models.FloatField(null=True, blank=True)

    shot_order = models.IntegerField(default=0)
    comment = models.CharField(max_length=500, blank=True, default='')

    class Meta:
        ordering = ['shot_order']

    def __str__(self):
        return f"{self.from_station.name} → {self.to_station.name} ({self.distance})"
