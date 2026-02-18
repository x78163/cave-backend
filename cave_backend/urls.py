"""URL configuration for cave_backend project."""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.decorators import api_view
from rest_framework.response import Response


@api_view(['GET'])
def api_status(request):
    """API health check endpoint."""
    return Response({
        'status': 'ok',
        'version': '0.1.0',
        'app': 'Cave Backend',
        'endpoints': {
            'caves': '/api/caves/',
            'mapping': '/api/mapping/',
            'sensors': '/api/sensors/',
            'users': '/api/users/',
            'devices': '/api/devices/',
            'sync': '/api/sync/',
            'sync_upload': '/api/sync/upload/',
            'sync_download': '/api/sync/download/<record_id>/',
            'sync_chunked': '/api/sync/chunked/',
            'reconstruction': '/api/reconstruction/',
            'social': '/api/social/',
            'routing': '/api/caves/<cave_id>/routes/',
            'user_routes': '/api/users/<user_id>/routes/',
            'route_export': '/api/caves/<cave_id>/routes/<route_id>/export/',
            'user_ratings': '/api/social/users/<user_id>/ratings/',
        }
    })


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/status/', api_status, name='api_status'),
    path('api/caves/', include('caves.urls')),
    path('api/mapping/', include('mapping.urls')),
    path('api/sensors/', include('sensors.urls')),
    path('api/users/', include('users.urls')),
    path('api/devices/', include('devices.urls')),
    path('api/sync/', include('sync.urls')),
    path('api/reconstruction/', include('reconstruction.urls')),
    path('api/social/', include('social.urls')),
    path('api/', include('routing.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
