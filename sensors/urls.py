from django.urls import path
from . import views

urlpatterns = [
    path('alerts/', views.sensor_alerts, name='sensor_alerts'),
    path('alerts/<uuid:cave_id>/', views.cave_sensor_alerts, name='cave_sensor_alerts'),
]
