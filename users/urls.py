from django.urls import path
from rest_framework_simplejwt.views import (
    TokenObtainPairView, TokenRefreshView, TokenVerifyView,
)
from . import views
from caves.views import user_media, user_media_update

urlpatterns = [
    # Auth
    path('auth/register/', views.register_view, name='auth_register'),
    path('auth/login/', TokenObtainPairView.as_view(), name='auth_login'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='auth_refresh'),
    path('auth/verify/', TokenVerifyView.as_view(), name='auth_verify'),

    # Profile
    path('me/', views.me_view, name='user_me'),
    path('profile/<int:user_id>/', views.user_profile_detail, name='user_profile_detail'),
    path('profile/<int:user_id>/media/', user_media, name='user_media'),
    path('media/<str:media_type>/<uuid:media_id>/', user_media_update, name='user_media_update'),

    # Grottos
    path('grottos/', views.grotto_list, name='grotto_list'),
    path('grottos/<uuid:grotto_id>/', views.grotto_detail, name='grotto_detail'),
    path('grottos/<uuid:grotto_id>/members/', views.grotto_members, name='grotto_members'),
    path('grottos/<uuid:grotto_id>/apply/', views.grotto_apply, name='grotto_apply'),
    path('grottos/<uuid:grotto_id>/invite/', views.grotto_invite, name='grotto_invite'),
    path(
        'grottos/<uuid:grotto_id>/members/<uuid:membership_id>/',
        views.grotto_member_update, name='grotto_member_update',
    ),
]
