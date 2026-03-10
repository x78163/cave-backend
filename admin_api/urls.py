"""Admin API URL configuration."""

from django.urls import path
from . import views

urlpatterns = [
    # Overview
    path('overview/', views.admin_overview, name='admin-overview'),

    # Server monitoring
    path('server/metrics/', views.server_metrics, name='admin-server-metrics'),
    path('server/r2-storage/', views.r2_storage_stats, name='admin-r2-storage'),
    path('server/websockets/', views.websocket_stats, name='admin-websocket-stats'),

    # User management
    path('users/', views.admin_user_list, name='admin-user-list'),
    path('users/create/', views.admin_create_user, name='admin-create-user'),
    path('users/<int:user_id>/', views.admin_user_detail, name='admin-user-detail'),
    path('users/<int:user_id>/reset-password/', views.admin_reset_password, name='admin-reset-password'),

    # Cave management
    path('caves/', views.admin_cave_list, name='admin-cave-list'),
    path('caves/<uuid:cave_id>/', views.admin_cave_detail, name='admin-cave-detail'),

    # Invite code management
    path('invite-codes/', views.admin_invite_codes, name='admin-invite-codes'),
    path('invite-codes/<uuid:code_id>/', views.admin_invite_code_detail, name='admin-invite-code-detail'),

    # Data browser
    path('data/', views.data_browser_models, name='admin-data-models'),
    path('data/<str:model_key>/', views.data_browser_list, name='admin-data-list'),
    path('data/<str:model_key>/<str:pk>/', views.data_browser_detail, name='admin-data-detail'),
]
