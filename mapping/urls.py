from django.urls import path
from . import views

urlpatterns = [
    path('caves/<uuid:cave_id>/pois/', views.poi_list, name='poi_list'),
    path('caves/<uuid:cave_id>/pois/<uuid:poi_id>/', views.poi_detail, name='poi_detail'),
]
