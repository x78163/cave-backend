"""
Views for the reconstruction app.
Manages 3D reconstruction jobs and serves the cave explorer viewer.
"""

import threading

from django.http import FileResponse
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from .models import ReconstructionJob
from .serializers import ReconstructionJobSerializer


@api_view(['GET', 'POST'])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def reconstruction_list(request):
    """
    GET: List reconstruction jobs, optionally filtered by cave.
    POST: Create a new reconstruction job.
    """
    if request.method == 'GET':
        qs = ReconstructionJob.objects.all()
        cave_id = request.query_params.get('cave')
        if cave_id:
            qs = qs.filter(cave_id=cave_id)
        serializer = ReconstructionJobSerializer(qs, many=True, context={'request': request})
        return Response({'jobs': serializer.data, 'count': len(serializer.data)})

    elif request.method == 'POST':
        serializer = ReconstructionJobSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            job = serializer.save()
            return Response(
                ReconstructionJobSerializer(job, context={'request': request}).data,
                status=status.HTTP_201_CREATED,
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
def reconstruction_detail(request, job_id):
    """Get details of a reconstruction job."""
    try:
        job = ReconstructionJob.objects.get(id=job_id)
    except ReconstructionJob.DoesNotExist:
        return Response({'error': 'Job not found'}, status=status.HTTP_404_NOT_FOUND)

    serializer = ReconstructionJobSerializer(job, context={'request': request})
    return Response(serializer.data)


@api_view(['POST'])
def reconstruction_start(request, job_id):
    """
    Trigger processing of a reconstruction job.
    Runs in a background thread (will be replaced with Celery in production).
    """
    try:
        job = ReconstructionJob.objects.get(id=job_id)
    except ReconstructionJob.DoesNotExist:
        return Response({'error': 'Job not found'}, status=status.HTTP_404_NOT_FOUND)

    if job.status == ReconstructionJob.Status.PROCESSING:
        return Response(
            {'error': 'Job is already processing'}, status=status.HTTP_400_BAD_REQUEST
        )

    if job.status == ReconstructionJob.Status.COMPLETED:
        return Response(
            {'error': 'Job already completed. Create a new job to re-process.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Run in background thread (dev only — use Celery in production)
    def run_reconstruction():
        from .engine import ReconstructionEngine
        engine = ReconstructionEngine(job)
        engine.run()

    thread = threading.Thread(target=run_reconstruction, daemon=True)
    thread.start()

    return Response({
        'status': 'started',
        'job_id': str(job.id),
        'message': 'Reconstruction started in background. Poll job detail for status.',
    })


@api_view(['GET'])
def reconstruction_mesh(request, job_id):
    """Download the reconstructed mesh file."""
    try:
        job = ReconstructionJob.objects.get(id=job_id)
    except ReconstructionJob.DoesNotExist:
        return Response({'error': 'Job not found'}, status=status.HTTP_404_NOT_FOUND)

    if not job.mesh_file:
        return Response(
            {'error': 'No mesh available. Job may not be completed yet.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    return FileResponse(
        job.mesh_file.open(),
        as_attachment=False,
        content_type='model/gltf-binary',
        filename=f'{job.cave.name.replace(" ", "_")}.glb',
    )


@api_view(['GET'])
def cave_reconstruction_latest(request, cave_id):
    """
    Get the latest completed reconstruction for a cave.
    Returns the job details including mesh URL.
    """
    job = (
        ReconstructionJob.objects
        .filter(cave_id=cave_id, status=ReconstructionJob.Status.COMPLETED)
        .first()
    )

    if not job:
        return Response(
            {'error': 'No completed reconstruction for this cave'},
            status=status.HTTP_404_NOT_FOUND,
        )

    serializer = ReconstructionJobSerializer(job, context={'request': request})
    return Response(serializer.data)
