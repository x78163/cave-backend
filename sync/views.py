"""
Views for sync app — full sync mechanism.

Six-phase protocol:
1. Start session
2. Push metadata (JSON records)
3. Push files (multipart uploads)
4. Pull metadata (DataDeltas)
5. Pull files (download)
6. Complete session
"""

import os
import shutil
import uuid as uuid_lib

from django.conf import settings
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from .engine import SyncEngine
from .models import SyncSession, ChunkedUpload
from .registry import get_registry_entry
from .serializers import SyncSessionSerializer


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

@api_view(['POST'])
def sync_start(request):
    """
    Initiate a sync session.
    Expects: device (UUID), device_last_sync (ISO timestamp, optional).
    """
    device_id = request.data.get('device')
    if not device_id:
        return Response(
            {'error': 'device ID required'}, status=status.HTTP_400_BAD_REQUEST
        )

    session = SyncSession.objects.create(
        device_id=device_id,
        device_last_sync=request.data.get('device_last_sync'),
    )

    serializer = SyncSessionSerializer(session)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
def sync_complete(request):
    """
    Finalize a sync session.
    Marks session as completed and updates device last_sync_at.
    """
    session_id = request.data.get('session')
    if not session_id:
        return Response(
            {'error': 'session ID required'}, status=status.HTTP_400_BAD_REQUEST
        )

    try:
        session = SyncSession.objects.get(id=session_id)
    except SyncSession.DoesNotExist:
        return Response(
            {'error': 'Sync session not found'}, status=status.HTTP_404_NOT_FOUND
        )

    session.status = SyncSession.Status.COMPLETED
    session.completed_at = timezone.now()
    session.save(update_fields=['status', 'completed_at'])

    device = session.device
    device.last_sync_at = timezone.now()
    device.save(update_fields=['last_sync_at', 'updated_at'])

    serializer = SyncSessionSerializer(session)
    return Response(serializer.data)


# ---------------------------------------------------------------------------
# Push — device sends data to backend
# ---------------------------------------------------------------------------

@api_view(['POST'])
def sync_push(request):
    """
    Push records from device to backend.

    Expects JSON:
    {
        "session": "<uuid>",
        "records": [
            {"model_name": "Cave", "action": "create", "data": {...}},
            {"model_name": "CavePhoto", "action": "update", "data": {...}},
            ...
        ]
    }
    """
    session_id = request.data.get('session')
    records = request.data.get('records', [])

    if not session_id:
        return Response(
            {'error': 'session ID required'}, status=status.HTTP_400_BAD_REQUEST
        )
    if not records:
        return Response(
            {'error': 'records list required'}, status=status.HTTP_400_BAD_REQUEST
        )

    try:
        session = SyncSession.objects.get(id=session_id)
    except SyncSession.DoesNotExist:
        return Response(
            {'error': 'Sync session not found'}, status=status.HTTP_404_NOT_FOUND
        )

    session.status = SyncSession.Status.PUSHING
    session.save(update_fields=['status'])

    engine = SyncEngine(session)
    processed, errors = engine.process_push(records)

    return Response({
        'status': 'push_complete',
        'session': str(session.id),
        'processed': processed,
        'errors': errors,
        'total_pushed': session.records_pushed,
    })


# ---------------------------------------------------------------------------
# Pull — device requests updates from backend
# ---------------------------------------------------------------------------

@api_view(['GET'])
def sync_pull(request):
    """
    Pull updates from backend to device.
    Returns DataDeltas since the device's last sync, excluding
    changes that originated from this device.

    Query params: session=<uuid>
    """
    session_id = request.query_params.get('session')
    if not session_id:
        return Response(
            {'error': 'session ID required'}, status=status.HTTP_400_BAD_REQUEST
        )

    try:
        session = SyncSession.objects.get(id=session_id)
    except SyncSession.DoesNotExist:
        return Response(
            {'error': 'Sync session not found'}, status=status.HTTP_404_NOT_FOUND
        )

    session.status = SyncSession.Status.PULLING
    session.save(update_fields=['status'])

    engine = SyncEngine(session)
    deltas, file_records = engine.process_pull(since_timestamp=session.device_last_sync)

    return Response({
        'status': 'pull_complete',
        'session': str(session.id),
        'deltas': deltas,
        'count': len(deltas),
        'files': file_records,
        'has_files': len(file_records) > 0,
    })


# ---------------------------------------------------------------------------
# File upload — separate from metadata push
# ---------------------------------------------------------------------------

@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def sync_upload(request):
    """
    Upload a file for a synced record.

    Multipart form data:
        session: sync session UUID
        model_name: e.g. "Cave", "CavePhoto"
        record_id: UUID of the target record
        field_name: e.g. "cover_photo", "image", "photo"
        file: the uploaded file
    """
    session_id = request.data.get('session')
    model_name = request.data.get('model_name')
    record_id = request.data.get('record_id')
    field_name = request.data.get('field_name')
    uploaded_file = request.FILES.get('file')

    if not all([session_id, model_name, record_id, field_name, uploaded_file]):
        return Response(
            {'error': 'session, model_name, record_id, field_name, and file are all required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        session = SyncSession.objects.get(id=session_id)
    except SyncSession.DoesNotExist:
        return Response(
            {'error': 'Sync session not found'}, status=status.HTTP_404_NOT_FOUND
        )

    entry = get_registry_entry(model_name)
    if not entry:
        return Response(
            {'error': f'Unknown model: {model_name}'}, status=status.HTTP_400_BAD_REQUEST
        )

    if field_name not in entry.file_fields:
        return Response(
            {'error': f'{field_name} is not a file field on {model_name}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        instance = entry.model.objects.get(pk=record_id)
    except entry.model.DoesNotExist:
        return Response(
            {'error': f'{model_name} {record_id} not found'}, status=status.HTTP_404_NOT_FOUND
        )

    # Set the file field and save
    file_field = getattr(instance, field_name)
    file_field.save(uploaded_file.name, uploaded_file, save=True)

    # Update session counters
    session.files_transferred += 1
    session.bytes_transferred += uploaded_file.size
    session.save(update_fields=['files_transferred', 'bytes_transferred'])

    # Build file URL
    file_url = None
    field_val = getattr(instance, field_name)
    if field_val:
        if hasattr(field_val, 'url'):
            file_url = field_val.url
        else:
            file_url = str(field_val)

    return Response({
        'status': 'uploaded',
        'model_name': model_name,
        'record_id': str(record_id),
        'field_name': field_name,
        'file_url': file_url,
        'bytes': uploaded_file.size,
    }, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# File download — for pull phase
# ---------------------------------------------------------------------------

@api_view(['GET'])
def sync_download(request, record_id):
    """
    Download a file from a synced record.

    URL: /api/sync/download/<record_id>/?model_name=X&field_name=Y
    """
    model_name = request.query_params.get('model_name')
    field_name = request.query_params.get('field_name')

    if not model_name or not field_name:
        return Response(
            {'error': 'model_name and field_name query params required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    entry = get_registry_entry(model_name)
    if not entry:
        return Response(
            {'error': f'Unknown model: {model_name}'}, status=status.HTTP_400_BAD_REQUEST
        )

    try:
        instance = entry.model.objects.get(pk=record_id)
    except entry.model.DoesNotExist:
        return Response(
            {'error': f'{model_name} {record_id} not found'}, status=status.HTTP_404_NOT_FOUND
        )

    file_field = getattr(instance, field_name, None)
    if not file_field:
        return Response(
            {'error': f'No file in {field_name}'}, status=status.HTTP_404_NOT_FOUND
        )

    return FileResponse(file_field.open(), as_attachment=True, filename=os.path.basename(file_field.name))


# ---------------------------------------------------------------------------
# Chunked upload — for large files (PCD, 2GB+)
# ---------------------------------------------------------------------------

@api_view(['POST'])
def chunked_upload_init(request):
    """
    Initialize a chunked file upload.

    JSON body:
        session, model_name, record_id, field_name, filename, total_size
    """
    session_id = request.data.get('session')
    model_name = request.data.get('model_name')
    record_id = request.data.get('record_id')
    field_name = request.data.get('field_name')
    filename = request.data.get('filename')
    total_size = request.data.get('total_size')

    if not all([session_id, model_name, record_id, field_name, filename, total_size]):
        return Response(
            {'error': 'All fields required: session, model_name, record_id, field_name, filename, total_size'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        session = SyncSession.objects.get(id=session_id)
    except SyncSession.DoesNotExist:
        return Response(
            {'error': 'Sync session not found'}, status=status.HTTP_404_NOT_FOUND
        )

    # Create temp chunk directory
    upload_id = uuid_lib.uuid4()
    chunk_dir = os.path.join(
        str(getattr(settings, 'SYNC_CHUNK_DIR', settings.MEDIA_ROOT / 'chunks')),
        str(upload_id),
    )
    os.makedirs(chunk_dir, exist_ok=True)

    chunked = ChunkedUpload.objects.create(
        id=upload_id,
        session=session,
        model_name=model_name,
        record_id=record_id,
        field_name=field_name,
        filename=filename,
        total_size=int(total_size),
        chunk_dir=chunk_dir,
    )

    return Response({
        'upload_id': str(chunked.id),
        'chunk_dir': chunk_dir,
        'total_size': chunked.total_size,
    }, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def chunked_upload_chunk(request):
    """
    Upload a single chunk.

    Multipart form:
        upload_id: UUID of the chunked upload
        chunk_number: integer (0-indexed)
        chunk: the file chunk
    """
    upload_id = request.data.get('upload_id')
    chunk_number = request.data.get('chunk_number')
    chunk_file = request.FILES.get('chunk')

    if not all([upload_id, chunk_number is not None, chunk_file]):
        return Response(
            {'error': 'upload_id, chunk_number, and chunk file required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        chunked = ChunkedUpload.objects.get(id=upload_id)
    except ChunkedUpload.DoesNotExist:
        return Response(
            {'error': 'Chunked upload not found'}, status=status.HTTP_404_NOT_FOUND
        )

    if chunked.is_complete:
        return Response(
            {'error': 'Upload already completed'}, status=status.HTTP_400_BAD_REQUEST
        )

    # Write chunk to temp directory
    chunk_path = os.path.join(chunked.chunk_dir, f'chunk_{int(chunk_number):06d}')
    with open(chunk_path, 'wb') as f:
        for part in chunk_file.chunks():
            f.write(part)

    chunk_size = chunk_file.size
    chunked.bytes_received += chunk_size
    chunked.save(update_fields=['bytes_received'])

    return Response({
        'upload_id': str(chunked.id),
        'chunk_number': int(chunk_number),
        'bytes_received': chunked.bytes_received,
        'total_size': chunked.total_size,
        'progress': chunked.bytes_received / chunked.total_size if chunked.total_size else 0,
    })


@api_view(['POST'])
def chunked_upload_complete(request):
    """
    Assemble all chunks into the final file and attach to the target record.

    JSON body: upload_id
    """
    upload_id = request.data.get('upload_id')
    if not upload_id:
        return Response(
            {'error': 'upload_id required'}, status=status.HTTP_400_BAD_REQUEST
        )

    try:
        chunked = ChunkedUpload.objects.get(id=upload_id)
    except ChunkedUpload.DoesNotExist:
        return Response(
            {'error': 'Chunked upload not found'}, status=status.HTTP_404_NOT_FOUND
        )

    if chunked.is_complete:
        return Response(
            {'error': 'Upload already completed'}, status=status.HTTP_400_BAD_REQUEST
        )

    entry = get_registry_entry(chunked.model_name)
    if not entry:
        return Response(
            {'error': f'Unknown model: {chunked.model_name}'}, status=status.HTTP_400_BAD_REQUEST
        )

    try:
        instance = entry.model.objects.get(pk=chunked.record_id)
    except entry.model.DoesNotExist:
        return Response(
            {'error': f'{chunked.model_name} {chunked.record_id} not found'},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Assemble chunks into final file
    chunk_files = sorted(
        [f for f in os.listdir(chunked.chunk_dir) if f.startswith('chunk_')]
    )

    if not chunk_files:
        return Response(
            {'error': 'No chunks found'}, status=status.HTTP_400_BAD_REQUEST
        )

    # Determine final file path
    upload_subdir = f'sync_uploads/{chunked.model_name.lower()}'
    final_dir = os.path.join(str(settings.MEDIA_ROOT), upload_subdir)
    os.makedirs(final_dir, exist_ok=True)
    final_path = os.path.join(final_dir, chunked.filename)

    # Concatenate chunks
    with open(final_path, 'wb') as out_file:
        for chunk_name in chunk_files:
            chunk_path = os.path.join(chunked.chunk_dir, chunk_name)
            with open(chunk_path, 'rb') as chunk_f:
                shutil.copyfileobj(chunk_f, out_file)

    # For file fields (ImageField, FileField), set the relative path
    relative_path = os.path.join(upload_subdir, chunked.filename)

    # For CharField fields like point_cloud_path, just set the path string
    field = instance._meta.get_field(chunked.field_name)
    if hasattr(field, 'upload_to'):
        # ImageField or FileField
        file_field = getattr(instance, chunked.field_name)
        file_field.name = relative_path
        instance.save(update_fields=[chunked.field_name])
    else:
        # CharField — store the path
        setattr(instance, chunked.field_name, final_path)
        instance.save(update_fields=[chunked.field_name])

    # Clean up chunks
    shutil.rmtree(chunked.chunk_dir, ignore_errors=True)

    # Mark complete
    chunked.is_complete = True
    chunked.save(update_fields=['is_complete'])

    # Update session counters
    session = chunked.session
    session.files_transferred += 1
    session.bytes_transferred += chunked.bytes_received
    session.save(update_fields=['files_transferred', 'bytes_transferred'])

    return Response({
        'status': 'assembled',
        'upload_id': str(chunked.id),
        'model_name': chunked.model_name,
        'record_id': str(chunked.record_id),
        'field_name': chunked.field_name,
        'file_path': relative_path,
        'total_bytes': chunked.bytes_received,
    })


# ---------------------------------------------------------------------------
# Session listing/detail (unchanged)
# ---------------------------------------------------------------------------

@api_view(['GET'])
def sync_sessions(request):
    """List sync sessions, optionally filtered by device."""
    qs = SyncSession.objects.all()
    device = request.query_params.get('device')
    if device:
        qs = qs.filter(device_id=device)
    limit = min(int(request.query_params.get('limit', 20)), 100)
    sessions = qs[:limit]

    serializer = SyncSessionSerializer(sessions, many=True)
    return Response({'sessions': serializer.data, 'count': len(serializer.data)})


@api_view(['GET'])
def sync_session_detail(request, session_id):
    """Get details of a specific sync session."""
    try:
        session = SyncSession.objects.get(id=session_id)
    except SyncSession.DoesNotExist:
        return Response(
            {'error': 'Sync session not found'}, status=status.HTTP_404_NOT_FOUND
        )

    serializer = SyncSessionSerializer(session)
    return Response(serializer.data)
