from django.urls import path
from . import views

urlpatterns = [
    # Session lifecycle
    path('start/', views.sync_start, name='sync_start'),
    path('push/', views.sync_push, name='sync_push'),
    path('pull/', views.sync_pull, name='sync_pull'),
    path('complete/', views.sync_complete, name='sync_complete'),

    # File transfer
    path('upload/', views.sync_upload, name='sync_upload'),
    path('download/<uuid:record_id>/', views.sync_download, name='sync_download'),

    # Chunked upload (for large PCD files)
    path('chunked/init/', views.chunked_upload_init, name='chunked_upload_init'),
    path('chunked/upload/', views.chunked_upload_chunk, name='chunked_upload_chunk'),
    path('chunked/complete/', views.chunked_upload_complete, name='chunked_upload_complete'),

    # Session listing
    path('sessions/', views.sync_sessions, name='sync_sessions'),
    path('sessions/<uuid:session_id>/', views.sync_session_detail, name='sync_session_detail'),
]
