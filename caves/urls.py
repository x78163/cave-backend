from django.urls import path
from . import views

urlpatterns = [
    path('resolve-map-url/', views.resolve_map_url, name='resolve_map_url'),
    path('', views.cave_list, name='cave_list'),
    path('<uuid:cave_id>/', views.cave_detail, name='cave_detail'),
    path('<uuid:cave_id>/photos/', views.cave_photo_upload, name='cave_photo_upload'),
    path('<uuid:cave_id>/photos/<uuid:photo_id>/', views.cave_photo_detail, name='cave_photo_detail'),
    path('<uuid:cave_id>/comments/', views.cave_comment_add, name='cave_comment_add'),
    path('<uuid:cave_id>/description/', views.cave_description, name='cave_description'),
    path('<uuid:cave_id>/permissions/', views.cave_permissions, name='cave_permissions'),
    path('<uuid:cave_id>/share/', views.cave_share, name='cave_share'),
    path('<uuid:cave_id>/map-data/', views.cave_map_data, name='cave_map_data'),
    path('<uuid:cave_id>/land-owner/', views.cave_land_owner, name='cave_land_owner'),
    path('<uuid:cave_id>/land-owner/gis-lookup/', views.cave_land_owner_gis_lookup, name='cave_land_owner_gis_lookup'),
    path('<uuid:cave_id>/requests/', views.cave_requests, name='cave_requests'),
    path('<uuid:cave_id>/requests/<uuid:request_id>/resolve/', views.cave_request_resolve, name='cave_request_resolve'),
    path('<uuid:cave_id>/requests/<uuid:request_id>/', views.cave_request_delete, name='cave_request_delete'),
]
