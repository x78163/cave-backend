from django.urls import path
from . import views

urlpatterns = [
    path('', views.device_list, name='device_list'),
    path('register/', views.device_register, name='device_register'),
    path('<uuid:device_id>/', views.device_detail, name='device_detail'),
]
