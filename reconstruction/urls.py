from django.urls import path
from . import views

urlpatterns = [
    path('', views.reconstruction_list, name='reconstruction_list'),
    path('<uuid:job_id>/', views.reconstruction_detail, name='reconstruction_detail'),
    path('<uuid:job_id>/start/', views.reconstruction_start, name='reconstruction_start'),
    path('<uuid:job_id>/mesh/', views.reconstruction_mesh, name='reconstruction_mesh'),
    path('cave/<uuid:cave_id>/latest/', views.cave_reconstruction_latest, name='cave_reconstruction_latest'),
]
