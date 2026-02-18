import uuid
from django.db import models


class ReconstructionJob(models.Model):
    """
    Tracks a 3D reconstruction processing job for a cave.
    Takes raw PCD + keyframes and produces a viewable glTF mesh.
    """

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        PROCESSING = 'processing', 'Processing'
        COMPLETED = 'completed', 'Completed'
        FAILED = 'failed', 'Failed'

    class Quality(models.TextChoices):
        DRAFT = 'draft', 'Draft (fast, no textures)'
        STANDARD = 'standard', 'Standard (textured)'
        HIGH = 'high', 'High (dense mesh, full textures)'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cave = models.ForeignKey(
        'caves.Cave', on_delete=models.CASCADE, related_name='reconstructions'
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    quality = models.CharField(
        max_length=20, choices=Quality.choices, default=Quality.STANDARD
    )

    # Input files
    pcd_file = models.FileField(
        upload_to='reconstruction/input/', null=True, blank=True,
        help_text='Dense PCD point cloud file'
    )
    keyframe_archive = models.FileField(
        upload_to='reconstruction/input/', null=True, blank=True,
        help_text='ZIP archive of keyframe directory'
    )

    # Output files
    mesh_file = models.FileField(
        upload_to='reconstruction/output/', null=True, blank=True,
        help_text='Reconstructed glTF/GLB mesh'
    )
    mesh_preview = models.ImageField(
        upload_to='reconstruction/previews/', null=True, blank=True,
        help_text='Preview thumbnail of the reconstruction'
    )

    # Processing metadata
    point_count = models.IntegerField(null=True, blank=True)
    vertex_count = models.IntegerField(null=True, blank=True)
    triangle_count = models.IntegerField(null=True, blank=True)
    texture_coverage = models.FloatField(
        null=True, blank=True, help_text='Percentage of vertices with camera texture (0-100)'
    )
    file_size_bytes = models.BigIntegerField(null=True, blank=True)

    # Reconstruction parameters
    poisson_depth = models.IntegerField(default=10)
    voxel_size = models.FloatField(default=0.02, help_text='Voxel downsample size in meters')
    camera_hfov = models.FloatField(default=90.0, help_text='Camera horizontal FOV in degrees')

    # Timing
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    processing_time_seconds = models.FloatField(null=True, blank=True)

    error_message = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Reconstruction {self.id} - {self.cave.name} ({self.status})"
