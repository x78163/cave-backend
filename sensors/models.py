import uuid
from django.db import models


class SensorAlert(models.Model):
    """
    Logged sensor alert events — mirrors cave-server SensorAlert exactly + cloud tracking.
    Timestamp is NOT auto_now_add so synced data preserves original device timestamps.
    """

    class Level(models.TextChoices):
        INFO = 'info', 'Info'
        WARNING = 'warning', 'Warning'
        DANGER = 'danger', 'Danger'
        RECOVERY = 'recovery', 'Recovery'

    class SensorType(models.TextChoices):
        GPS = 'gps', 'GPS'
        TEMPERATURE = 'temperature', 'Temperature'
        HUMIDITY = 'humidity', 'Humidity'
        PRESSURE = 'pressure', 'Pressure'
        COMPASS = 'compass', 'Compass'
        GAS_VOC = 'gas_voc', 'Gas/VOC'
        PARTICULATE = 'particulate', 'Particulate'
        THERMAL = 'thermal', 'Thermal Camera'
        IMU = 'imu', 'IMU'
        CONNECTION = 'connection', 'Sensor Hub Connection'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    timestamp = models.DateTimeField(db_index=True)
    sensor_type = models.CharField(max_length=20, choices=SensorType.choices)
    level = models.CharField(max_length=10, choices=Level.choices)
    value = models.FloatField(null=True, blank=True)
    message = models.CharField(max_length=500)

    # Cloud-specific
    cave = models.ForeignKey(
        'caves.Cave', on_delete=models.CASCADE,
        null=True, blank=True, related_name='sensor_alerts',
        help_text='Cave this alert was recorded in'
    )
    origin_device = models.ForeignKey(
        'devices.Device', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='synced_alerts'
    )
    synced_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['sensor_type', '-timestamp']),
        ]

    def __str__(self):
        return f'{self.get_level_display()} - {self.get_sensor_type_display()}: {self.message}'
