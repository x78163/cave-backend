"""Admin API views — all endpoints require is_staff."""

import logging
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

logger = logging.getLogger(__name__)
User = get_user_model()


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_overview(request):
    """Aggregate stats for the admin dashboard."""
    from caves.models import Cave, CavePhoto, CaveDocument, CaveVideoLink
    from mapping.models import PointOfInterest
    from survey.models import CaveSurvey
    from social.models import Post
    from chat.models import Channel, Message
    from events.models import Event
    from wiki.models import Article
    from users.models import InviteCode

    now = timezone.now()
    seven_days = now - timedelta(days=7)
    thirty_days = now - timedelta(days=30)

    # User stats
    total_users = User.objects.count()
    active_users_7d = User.objects.filter(last_login__gte=seven_days).count()
    active_users_30d = User.objects.filter(last_login__gte=thirty_days).count()
    new_users_7d = User.objects.filter(date_joined__gte=seven_days).count()
    new_users_30d = User.objects.filter(date_joined__gte=thirty_days).count()
    staff_count = User.objects.filter(is_staff=True).count()

    # Content stats
    total_caves = Cave.objects.count()
    mapped_caves = Cave.objects.filter(has_map=True).count()
    total_photos = CavePhoto.objects.count()
    total_documents = CaveDocument.objects.count()
    total_videos = CaveVideoLink.objects.count()
    total_pois = PointOfInterest.objects.count()
    total_surveys = CaveSurvey.objects.count()
    total_posts = Post.objects.filter(is_deleted=False).count()
    total_events = Event.objects.count()
    total_articles = Article.objects.count()

    # Chat stats
    total_channels = Channel.objects.count()
    total_messages = Message.objects.filter(is_deleted=False).count()
    messages_7d = Message.objects.filter(
        is_deleted=False, created_at__gte=seven_days
    ).count()

    # Invite code stats
    total_codes = InviteCode.objects.count()
    active_codes = InviteCode.objects.filter(is_active=True).count()

    # Cave visibility breakdown
    visibility_counts = dict(
        Cave.objects.values_list('visibility')
        .annotate(c=Count('id'))
        .values_list('visibility', 'c')
    )

    return Response({
        'users': {
            'total': total_users,
            'staff': staff_count,
            'active_7d': active_users_7d,
            'active_30d': active_users_30d,
            'new_7d': new_users_7d,
            'new_30d': new_users_30d,
        },
        'caves': {
            'total': total_caves,
            'mapped': mapped_caves,
            'visibility': visibility_counts,
        },
        'content': {
            'photos': total_photos,
            'documents': total_documents,
            'videos': total_videos,
            'pois': total_pois,
            'surveys': total_surveys,
            'posts': total_posts,
            'events': total_events,
            'articles': total_articles,
        },
        'chat': {
            'channels': total_channels,
            'messages_total': total_messages,
            'messages_7d': messages_7d,
        },
        'invite_codes': {
            'total': total_codes,
            'active': active_codes,
        },
    })


# ---------------------------------------------------------------------------
# Server Monitoring
# ---------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsAdminUser])
def server_metrics(request):
    """VPS system metrics via psutil."""
    try:
        import psutil
    except ImportError:
        return Response(
            {'error': 'psutil not installed on this server'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )

    import os
    import time

    # CPU
    cpu_percent = psutil.cpu_percent(interval=0.5)
    cpu_count = psutil.cpu_count()
    load_avg = list(psutil.getloadavg())

    # Memory
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()

    # Disk
    disk = psutil.disk_usage('/')

    # Process info
    pid = os.getpid()
    proc = psutil.Process(pid)
    proc_mem = proc.memory_info()

    # Uptime
    boot_time = psutil.boot_time()
    uptime_seconds = time.time() - boot_time

    return Response({
        'cpu': {
            'percent': cpu_percent,
            'count': cpu_count,
            'load_avg_1m': load_avg[0],
            'load_avg_5m': load_avg[1],
            'load_avg_15m': load_avg[2],
        },
        'memory': {
            'total_mb': round(mem.total / 1e6, 1),
            'used_mb': round(mem.used / 1e6, 1),
            'available_mb': round(mem.available / 1e6, 1),
            'percent': mem.percent,
        },
        'swap': {
            'total_mb': round(swap.total / 1e6, 1),
            'used_mb': round(swap.used / 1e6, 1),
            'percent': swap.percent,
        },
        'disk': {
            'total_gb': round(disk.total / 1e9, 1),
            'used_gb': round(disk.used / 1e9, 1),
            'free_gb': round(disk.free / 1e9, 1),
            'percent': disk.percent,
        },
        'process': {
            'pid': pid,
            'memory_rss_mb': round(proc_mem.rss / 1e6, 1),
            'memory_vms_mb': round(proc_mem.vms / 1e6, 1),
            'threads': proc.num_threads(),
        },
        'uptime_seconds': round(uptime_seconds),
    })


@api_view(['GET'])
@permission_classes([IsAdminUser])
def r2_storage_stats(request):
    """Cloudflare R2 bucket stats — total and per-cave breakdown."""
    import boto3

    endpoint_url = getattr(settings, 'AWS_S3_ENDPOINT_URL', None)
    bucket_name = getattr(settings, 'AWS_STORAGE_BUCKET_NAME', None)

    if not endpoint_url or not bucket_name:
        # Dev mode — report local media/ stats
        import os
        media_root = str(settings.MEDIA_ROOT)
        total_size = 0
        total_files = 0
        cave_breakdown = {}

        caves_dir = os.path.join(media_root, 'caves')
        if os.path.isdir(caves_dir):
            for cave_id in os.listdir(caves_dir):
                cave_path = os.path.join(caves_dir, cave_id)
                if not os.path.isdir(cave_path):
                    continue
                cave_size = 0
                cave_files = 0
                for root, dirs, files in os.walk(cave_path):
                    for f in files:
                        fp = os.path.join(root, f)
                        sz = os.path.getsize(fp)
                        cave_size += sz
                        cave_files += 1
                        total_size += sz
                        total_files += 1
                cave_breakdown[cave_id] = {
                    'size_mb': round(cave_size / 1e6, 2),
                    'files': cave_files,
                }

        # Resolve cave names from database
        from caves.models import Cave
        import uuid as uuid_mod
        valid_ids = []
        for cid in cave_breakdown:
            try:
                valid_ids.append(uuid_mod.UUID(cid))
            except ValueError:
                pass
        cave_names = dict(
            Cave.objects.filter(id__in=valid_ids).values_list('id', 'name')
        )
        for cave_id in cave_breakdown:
            try:
                uid = uuid_mod.UUID(cave_id)
                cave_breakdown[cave_id]['name'] = cave_names.get(uid, 'Unknown')
            except ValueError:
                cave_breakdown[cave_id]['name'] = 'Unknown'

        return Response({
            'source': 'local',
            'total_size_mb': round(total_size / 1e6, 2),
            'total_files': total_files,
            'caves': cave_breakdown,
        })

    # Production — query R2
    s3 = boto3.client(
        's3',
        endpoint_url=endpoint_url,
        aws_access_key_id=getattr(settings, 'AWS_ACCESS_KEY_ID', ''),
        aws_secret_access_key=getattr(settings, 'AWS_SECRET_ACCESS_KEY', ''),
    )

    total_size = 0
    total_files = 0
    cave_breakdown = {}
    other_size = 0
    other_files = 0

    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=bucket_name):
        for obj in page.get('Contents', []):
            key = obj['Key']
            size = obj['Size']
            total_size += size
            total_files += 1

            # Group by cave UUID
            parts = key.split('/')
            if len(parts) >= 2 and parts[0] == 'caves':
                cave_id = parts[1]
                if cave_id not in cave_breakdown:
                    cave_breakdown[cave_id] = {'size_mb': 0, 'files': 0}
                cave_breakdown[cave_id]['size_mb'] += size
                cave_breakdown[cave_id]['files'] += 1
            else:
                other_size += size
                other_files += 1

    # Convert bytes to MB
    for cave_id in cave_breakdown:
        cave_breakdown[cave_id]['size_mb'] = round(
            cave_breakdown[cave_id]['size_mb'] / 1e6, 2
        )

    # Resolve cave names
    from caves.models import Cave
    import uuid as uuid_mod
    valid_ids = []
    for cid in cave_breakdown:
        try:
            valid_ids.append(uuid_mod.UUID(cid))
        except ValueError:
            pass
    cave_names = dict(
        Cave.objects.filter(id__in=valid_ids).values_list('id', 'name')
    )
    for cave_id in cave_breakdown:
        try:
            uid = uuid_mod.UUID(cave_id)
            cave_breakdown[cave_id]['name'] = cave_names.get(uid, 'Unknown')
        except ValueError:
            cave_breakdown[cave_id]['name'] = 'Unknown'

    return Response({
        'source': 'r2',
        'total_size_mb': round(total_size / 1e6, 2),
        'total_files': total_files,
        'caves': cave_breakdown,
        'other': {
            'size_mb': round(other_size / 1e6, 2),
            'files': other_files,
        },
    })


@api_view(['GET'])
@permission_classes([IsAdminUser])
def websocket_stats(request):
    """Active WebSocket connection stats from the channel layer."""
    try:
        redis_hosts = getattr(settings, 'CHANNEL_LAYERS', {}).get(
            'default', {}
        ).get('CONFIG', {}).get('hosts', [None])
        redis_url = redis_hosts[0] if redis_hosts else None

        info = {}
        if redis_url:
            import redis as redis_lib
            r = redis_lib.from_url(redis_url)
            redis_info = r.info('memory')
            redis_clients = r.info('clients')
            # Count user_ groups as proxy for connected users
            keys = r.keys('asgi:group:user_*')
            info = {
                'estimated_connected_users': len(keys),
                'redis_memory_mb': round(
                    redis_info.get('used_memory', 0) / 1e6, 2
                ),
                'redis_connected_clients': redis_clients.get(
                    'connected_clients', 0
                ),
                'channel_layer': 'redis',
                'healthy': True,
            }
        else:
            info = {
                'estimated_connected_users': 0,
                'channel_layer': 'in-memory',
                'healthy': True,
            }
    except Exception as e:
        info = {
            'estimated_connected_users': 0,
            'channel_layer': 'unknown',
            'healthy': False,
            'error': str(e),
        }

    return Response(info)


# ---------------------------------------------------------------------------
# User Management
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_create_user(request):
    """Create a new user account."""
    username = request.data.get('username', '').strip()
    email = request.data.get('email', '').strip()
    password = request.data.get('password', '').strip()
    first_name = request.data.get('first_name', '').strip()
    last_name = request.data.get('last_name', '').strip()

    if not username:
        return Response({'error': 'Username is required'}, status=400)

    if User.objects.filter(username=username).exists():
        return Response({'error': 'Username already taken'}, status=400)
    if email and User.objects.filter(email=email).exists():
        return Response({'error': 'Email already in use'}, status=400)

    import secrets
    if not password:
        password = secrets.token_urlsafe(12)

    user = User.objects.create_user(
        username=username,
        email=email,
        password=password,
        first_name=first_name,
        last_name=last_name,
    )

    # Set optional flags
    if request.data.get('is_staff'):
        user.is_staff = True
    if request.data.get('is_wiki_editor'):
        user.is_wiki_editor = True
    user.save()

    return Response({
        'status': 'created',
        'id': user.id,
        'username': user.username,
        'temporary_password': password,
    }, status=201)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_user_list(request):
    """List all users with search, sort, and pagination."""
    search = request.query_params.get('search', '')
    sort_by = request.query_params.get('sort', '-date_joined')
    page = int(request.query_params.get('page', 1))
    per_page = int(request.query_params.get('per_page', 25))

    qs = User.objects.all()

    if search:
        qs = qs.filter(
            Q(username__icontains=search) |
            Q(email__icontains=search) |
            Q(first_name__icontains=search) |
            Q(last_name__icontains=search)
        )

    # Annotate with counts
    qs = qs.annotate(
        cave_count=Count('owned_caves', distinct=True),
        post_count=Count('posts', distinct=True),
    )

    allowed_sorts = {
        'username', '-username', 'email', '-email',
        'date_joined', '-date_joined', 'last_login', '-last_login',
        'cave_count', '-cave_count',
    }
    if sort_by not in allowed_sorts:
        sort_by = '-date_joined'
    qs = qs.order_by(sort_by)

    total = qs.count()
    start = (page - 1) * per_page
    users = qs[start:start + per_page]

    results = []
    for u in users:
        results.append({
            'id': u.id,
            'username': u.username,
            'email': u.email,
            'first_name': u.first_name,
            'last_name': u.last_name,
            'avatar_preset': u.avatar_preset,
            'is_staff': u.is_staff,
            'is_active': u.is_active,
            'is_wiki_editor': u.is_wiki_editor,
            'date_joined': u.date_joined.isoformat(),
            'last_login': u.last_login.isoformat() if u.last_login else None,
            'cave_count': u.cave_count,
            'post_count': u.post_count,
        })

    return Response({
        'results': results,
        'total': total,
        'page': page,
        'per_page': per_page,
        'pages': (total + per_page - 1) // per_page,
    })


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAdminUser])
def admin_user_detail(request, user_id):
    """Edit or delete a user."""
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=404)

    if request.method == 'PATCH':
        allowed = {
            'is_staff', 'is_active', 'is_wiki_editor',
            'username', 'email', 'first_name', 'last_name',
        }
        for field in allowed:
            if field in request.data:
                setattr(user, field, request.data[field])
        user.save()
        return Response({'status': 'updated', 'id': user.id})

    if request.method == 'DELETE':
        if user.is_superuser:
            return Response(
                {'error': 'Cannot delete superuser'},
                status=status.HTTP_403_FORBIDDEN
            )

        action = request.query_params.get('action', 'inherit')

        if action == 'inherit':
            admin_user = request.user
            _inherit_user_content(user, admin_user)
            username = user.username
            user.delete()
            return Response({
                'status': 'deleted',
                'action': 'inherit',
                'username': username,
                'inherited_by': admin_user.username,
            })
        elif action == 'delete':
            username = user.username
            user.delete()
            return Response({
                'status': 'deleted',
                'action': 'cascade',
                'username': username,
            })
        else:
            return Response(
                {'error': 'action must be "inherit" or "delete"'},
                status=400
            )


def _inherit_user_content(user, admin_user):
    """Transfer all of a user's content to admin before deletion."""
    from caves.models import Cave, CavePhoto, CaveDocument, CaveVideoLink
    from social.models import Post

    Cave.objects.filter(owner=user).update(owner=admin_user)
    CavePhoto.objects.filter(uploaded_by=user).update(uploaded_by=admin_user)
    CaveDocument.objects.filter(uploaded_by=user).update(uploaded_by=admin_user)
    CaveVideoLink.objects.filter(uploaded_by=user).update(uploaded_by=admin_user)
    Post.objects.filter(author=user).update(author=admin_user)


@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_reset_password(request, user_id):
    """Reset a user's password. Returns the new temporary password."""
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=404)

    new_password = request.data.get('password')
    if not new_password:
        import secrets
        new_password = secrets.token_urlsafe(12)

    user.set_password(new_password)
    user.save()

    return Response({
        'status': 'password_reset',
        'user': user.username,
        'temporary_password': new_password,
    })


# ---------------------------------------------------------------------------
# Cave Management
# ---------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_cave_list(request):
    """List all caves regardless of visibility, with search and pagination."""
    from caves.models import Cave

    search = request.query_params.get('search', '')
    sort_by = request.query_params.get('sort', '-created_at')
    page = int(request.query_params.get('page', 1))
    per_page = int(request.query_params.get('per_page', 25))

    qs = Cave.objects.select_related('owner').all()

    if search:
        qs = qs.filter(
            Q(name__icontains=search) |
            Q(city__icontains=search) |
            Q(region__icontains=search) |
            Q(country__icontains=search)
        )

    allowed_sorts = {
        'name', '-name', 'created_at', '-created_at',
        'updated_at', '-updated_at', 'visibility', '-visibility',
    }
    if sort_by not in allowed_sorts:
        sort_by = '-created_at'
    qs = qs.order_by(sort_by)

    total = qs.count()
    start = (page - 1) * per_page
    caves = qs[start:start + per_page]

    results = []
    for c in caves:
        results.append({
            'id': str(c.id),
            'name': c.name,
            'city': c.city or '',
            'state': c.region or '',
            'country': c.country or '',
            'visibility': c.visibility,
            'has_map': c.has_map,
            'owner': {
                'id': c.owner.id,
                'username': c.owner.username,
            } if c.owner else None,
            'created_at': c.created_at.isoformat() if c.created_at else None,
            'updated_at': c.updated_at.isoformat() if c.updated_at else None,
        })

    return Response({
        'results': results,
        'total': total,
        'page': page,
        'per_page': per_page,
        'pages': (total + per_page - 1) // per_page,
    })


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAdminUser])
def admin_cave_detail(request, cave_id):
    """Edit or delete a cave (admin override)."""
    from caves.models import Cave

    try:
        cave = Cave.objects.get(id=cave_id)
    except Cave.DoesNotExist:
        return Response({'error': 'Cave not found'}, status=404)

    if request.method == 'PATCH':
        allowed = {
            'name', 'visibility', 'collaboration',
            'city', 'region', 'country', 'zip_code',
            'has_map',
        }
        # Map 'state' from frontend to 'region' model field
        data = request.data.copy()
        if 'state' in data and 'region' not in data:
            data['region'] = data.pop('state')
        for field in allowed:
            if field in data:
                setattr(cave, field, data[field])
        cave.save()
        return Response({'status': 'updated', 'id': str(cave.id)})

    if request.method == 'DELETE':
        name = cave.name
        cave.delete()
        return Response({'status': 'deleted', 'name': name})


# ---------------------------------------------------------------------------
# Invite Code Management
# ---------------------------------------------------------------------------

@api_view(['GET', 'POST'])
@permission_classes([IsAdminUser])
def admin_invite_codes(request):
    """List all invite codes or generate a new one."""
    from users.models import InviteCode

    if request.method == 'GET':
        codes = InviteCode.objects.select_related('created_by').order_by(
            '-created_at'
        )
        results = []
        for c in codes:
            results.append({
                'id': str(c.id),
                'code': c.code,
                'created_by': {
                    'id': c.created_by.id,
                    'username': c.created_by.username,
                },
                'created_at': c.created_at.isoformat(),
                'max_uses': c.max_uses,
                'use_count': c.use_count,
                'is_active': c.is_active,
            })
        return Response(results)

    if request.method == 'POST':
        max_uses = request.data.get('max_uses', 1)
        code = InviteCode.objects.create(
            created_by=request.user,
            max_uses=max_uses,
        )
        return Response({
            'id': str(code.id),
            'code': code.code,
            'max_uses': code.max_uses,
            'is_active': code.is_active,
        }, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAdminUser])
def admin_invite_code_detail(request, code_id):
    """Toggle or delete an invite code."""
    from users.models import InviteCode

    try:
        code = InviteCode.objects.get(id=code_id)
    except InviteCode.DoesNotExist:
        return Response({'error': 'Code not found'}, status=404)

    if request.method == 'PATCH':
        if 'is_active' in request.data:
            code.is_active = request.data['is_active']
        if 'max_uses' in request.data:
            code.max_uses = request.data['max_uses']
        code.save()
        return Response({'status': 'updated', 'code': code.code})

    if request.method == 'DELETE':
        code_str = code.code
        code.delete()
        return Response({'status': 'deleted', 'code': code_str})


# ---------------------------------------------------------------------------
# Data Browser — generic model browsing like Django admin
# ---------------------------------------------------------------------------

# Registry of browsable models: {key: (app_label, model_name, display_name)}
_MODEL_REGISTRY = {
    'users': ('users', 'UserProfile', 'Users'),
    'caves': ('caves', 'Cave', 'Caves'),
    'pois': ('mapping', 'PointOfInterest', 'Points of Interest'),
    'photos': ('caves', 'CavePhoto', 'Cave Photos'),
    'documents': ('caves', 'CaveDocument', 'Documents'),
    'videos': ('caves', 'CaveVideoLink', 'Video Links'),
    'landowners': ('caves', 'LandOwner', 'Land Owners'),
    'cave_requests': ('caves', 'CaveRequest', 'Cave Requests'),
    'survey_maps': ('caves', 'SurveyMap', 'Survey Maps'),
    'annotations': ('caves', 'SurfaceAnnotation', 'Surface Annotations'),
    'surveys': ('survey', 'CaveSurvey', 'Surveys'),
    'survey_stations': ('survey', 'SurveyStation', 'Survey Stations'),
    'survey_shots': ('survey', 'SurveyShot', 'Survey Shots'),
    'posts': ('social', 'Post', 'Wall Posts'),
    'comments': ('social', 'Comment', 'Comments'),
    'ratings': ('social', 'CaveRating', 'Ratings'),
    'channels': ('chat', 'Channel', 'Chat Channels'),
    'messages': ('chat', 'Message', 'Chat Messages'),
    'events': ('events', 'Event', 'Events'),
    'event_rsvps': ('events', 'EventRSVP', 'Event RSVPs'),
    'invite_codes': ('users', 'InviteCode', 'Invite Codes'),
    'articles': ('wiki', 'Article', 'Wiki Articles'),
    'description_revisions': ('caves', 'DescriptionRevision', 'Description Revisions'),
}


@api_view(['GET'])
@permission_classes([IsAdminUser])
def data_browser_models(request):
    """List all browsable models with record counts."""
    from django.apps import apps

    result = []
    for key, (app_label, model_name, display) in _MODEL_REGISTRY.items():
        try:
            model = apps.get_model(app_label, model_name)
            count = model.objects.count()
        except Exception:
            count = 0
        result.append({
            'key': key,
            'name': display,
            'app': app_label,
            'count': count,
        })
    return Response(result)


def _serialize_value(val):
    """Convert a model field value to JSON-safe representation."""
    import uuid as uuid_mod
    from datetime import datetime, date
    from decimal import Decimal

    if val is None:
        return None
    if isinstance(val, (str, int, float, bool)):
        return val
    if isinstance(val, uuid_mod.UUID):
        return str(val)
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, Decimal):
        return float(val)
    return str(val)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def data_browser_list(request, model_key):
    """List records for a model with pagination and search."""
    from django.apps import apps

    if model_key not in _MODEL_REGISTRY:
        return Response({'error': 'Unknown model'}, status=404)

    app_label, model_name, display = _MODEL_REGISTRY[model_key]
    model = apps.get_model(app_label, model_name)

    search = request.query_params.get('search', '')
    page = int(request.query_params.get('page', 1))
    per_page = int(request.query_params.get('per_page', 25))

    qs = model.objects.all()

    # Auto-detect searchable text fields (concrete only)
    if search:
        text_fields = []
        for f in model._meta.concrete_fields:
            if f.get_internal_type() in ('CharField', 'TextField', 'EmailField'):
                text_fields.append(f.name)
        if text_fields:
            q = Q()
            for fname in text_fields[:5]:  # Limit to 5 to avoid huge queries
                q |= Q(**{f'{fname}__icontains': search})
            qs = qs.filter(q)

    # Order by PK descending (newest first for auto-increment, or UUID)
    pk_field = model._meta.pk
    if pk_field:
        qs = qs.order_by(f'-{pk_field.name}')

    total = qs.count()
    start = (page - 1) * per_page
    records = qs[start:start + per_page]

    # Get concrete fields only (exclude reverse relations and JSON blobs in list)
    fields = []
    for f in model._meta.concrete_fields:
        internal = f.get_internal_type()
        if internal in ('JSONField',):
            continue
        # For FK fields, use the attname (e.g. owner_id) for data, but display name
        if internal == 'ForeignKey':
            fields.append({'name': f.name, 'type': internal, 'attname': f.attname})
        else:
            fields.append({'name': f.name, 'type': internal})

    rows = []
    for obj in records:
        row = {}
        for f in fields:
            try:
                val = getattr(obj, f['name'])
                # Resolve FK to string
                if hasattr(val, 'pk'):
                    row[f['name']] = str(val)
                else:
                    row[f['name']] = _serialize_value(val)
            except Exception:
                row[f['name']] = None
        # Also include pk
        row['_pk'] = _serialize_value(obj.pk)
        rows.append(row)

    return Response({
        'model': display,
        'model_key': model_key,
        'fields': fields,
        'results': rows,
        'total': total,
        'page': page,
        'per_page': per_page,
        'pages': (total + per_page - 1) // per_page,
    })


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAdminUser])
def data_browser_detail(request, model_key, pk):
    """View, edit, or delete a single record."""
    from django.apps import apps

    if model_key not in _MODEL_REGISTRY:
        return Response({'error': 'Unknown model'}, status=404)

    app_label, model_name, display = _MODEL_REGISTRY[model_key]
    model = apps.get_model(app_label, model_name)

    try:
        obj = model.objects.get(pk=pk)
    except model.DoesNotExist:
        return Response({'error': 'Record not found'}, status=404)

    if request.method == 'GET':
        # Full record with all concrete fields including JSON
        fields = []
        data = {}
        for f in model._meta.concrete_fields:
            fields.append({
                'name': f.name,
                'type': f.get_internal_type(),
                'editable': f.editable and f.name != model._meta.pk.name,
            })
            try:
                val = getattr(obj, f.name)
                if hasattr(val, 'pk'):
                    data[f.name] = str(val)
                else:
                    data[f.name] = _serialize_value(val)
            except Exception:
                data[f.name] = None
        return Response({
            'model': display,
            'model_key': model_key,
            'pk': _serialize_value(obj.pk),
            'fields': fields,
            'data': data,
        })

    if request.method == 'PATCH':
        editable_fields = set()
        for f in model._meta.concrete_fields:
            if f.editable and f.name != model._meta.pk.name:
                editable_fields.add(f.name)

        changed = []
        for field_name, value in request.data.items():
            if field_name in editable_fields:
                setattr(obj, field_name, value)
                changed.append(field_name)
        if changed:
            obj.save(update_fields=changed)
        return Response({'status': 'updated', 'changed': changed})

    if request.method == 'DELETE':
        obj.delete()
        return Response({'status': 'deleted'})
