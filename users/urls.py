from django.urls import path
from rest_framework_simplejwt.views import (
    TokenRefreshView, TokenVerifyView,
)
from . import views
from caves.views import user_media, user_media_update

urlpatterns = [
    # Auth
    path('auth/register/', views.register_view, name='auth_register'),
    path('auth/login/', views.login_view, name='auth_login'),
    path('auth/google/', views.google_auth_view, name='auth_google'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='auth_refresh'),
    path('auth/verify/', TokenVerifyView.as_view(), name='auth_verify'),
    path('auth/send-verification/', views.send_verification_email_view, name='auth_send_verification'),
    path('auth/verify-email/', views.verify_email_view, name='auth_verify_email'),

    # Site settings (public GET, admin PATCH)
    path('site-settings/', views.site_settings_view, name='site_settings'),

    # Search
    path('search/', views.user_search, name='user_search'),

    # Notification preferences
    path('notification-prefs/', views.notification_prefs_view, name='notification_prefs'),

    # Profile
    path('me/', views.me_view, name='user_me'),
    path('profile/<int:user_id>/', views.user_profile_detail, name='user_profile_detail'),
    path('profile/<int:user_id>/media/', user_media, name='user_media'),
    path('media/<str:media_type>/<uuid:media_id>/', user_media_update, name='user_media_update'),

    # Invite codes
    path('invite-codes/', views.invite_code_list_create, name='invite_code_list_create'),
    path('invite-codes/<uuid:code_id>/', views.invite_code_detail, name='invite_code_detail'),

    # Grottos
    path('grottos/', views.grotto_list, name='grotto_list'),
    path('grottos/<uuid:grotto_id>/', views.grotto_detail, name='grotto_detail'),
    path('grottos/<uuid:grotto_id>/members/', views.grotto_members, name='grotto_members'),
    path('grottos/<uuid:grotto_id>/apply/', views.grotto_apply, name='grotto_apply'),
    path('grottos/<uuid:grotto_id>/invite/', views.grotto_invite, name='grotto_invite'),
    path('grottos/<uuid:grotto_id>/leave/', views.grotto_leave, name='grotto_leave'),
    path(
        'grottos/<uuid:grotto_id>/members/<uuid:membership_id>/',
        views.grotto_member_update, name='grotto_member_update',
    ),

    # Grotto profile tabs
    path('grottos/<uuid:grotto_id>/caves/', views.grotto_caves, name='grotto_caves'),
    path('grottos/<uuid:grotto_id>/events/', views.grotto_events, name='grotto_events'),
    path('grottos/<uuid:grotto_id>/media/', views.grotto_media, name='grotto_media'),
]
