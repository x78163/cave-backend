from django.urls import path
from . import views

app_name = 'routing'

urlpatterns = [
    path(
        'caves/<uuid:cave_id>/routes/compute/',
        views.compute_route,
        name='compute_route',
    ),
    path(
        'caves/<uuid:cave_id>/routes/',
        views.route_list,
        name='route_list',
    ),
    path(
        'caves/<uuid:cave_id>/routes/<uuid:route_id>/',
        views.route_detail,
        name='route_detail',
    ),
    path(
        'caves/<uuid:cave_id>/routes/<uuid:route_id>/export-pdf/',
        views.route_export_pdf,
        name='route_export_pdf',
    ),
]
