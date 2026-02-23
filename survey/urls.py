from django.urls import path
from . import views

urlpatterns = [
    path('<uuid:cave_id>/surveys/', views.survey_list, name='survey_list'),
    path('<uuid:cave_id>/surveys/<uuid:survey_id>/', views.survey_detail, name='survey_detail'),
    path('<uuid:cave_id>/surveys/<uuid:survey_id>/shots/', views.shot_bulk_create, name='shot_bulk_create'),
    path('<uuid:cave_id>/surveys/<uuid:survey_id>/shots/<uuid:shot_id>/', views.shot_detail, name='shot_detail'),
    path('<uuid:cave_id>/surveys/<uuid:survey_id>/compute/', views.survey_compute, name='survey_compute'),
    path('<uuid:cave_id>/surveys/<uuid:survey_id>/ocr/', views.survey_ocr, name='survey_ocr'),
    path('<uuid:cave_id>/surveys/<uuid:survey_id>/render/', views.survey_render, name='survey_render'),
    path('<uuid:cave_id>/generate-slam-survey/', views.generate_slam_survey, name='generate_slam_survey'),
]
