from django.urls import path
from . import views

urlpatterns = [
    path('profile/', views.user_profile, name='user_profile'),
    path('profile/<int:user_id>/', views.user_profile_detail, name='user_profile_detail'),
    path('grottos/', views.grotto_list, name='grotto_list'),
    path('grottos/<uuid:grotto_id>/', views.grotto_detail, name='grotto_detail'),
    path('grottos/<uuid:grotto_id>/members/', views.grotto_members, name='grotto_members'),
]
