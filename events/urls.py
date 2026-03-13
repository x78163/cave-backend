from django.urls import path

from . import views, tracking_views

urlpatterns = [
    path('', views.event_list, name='event_list'),
    path('calendar/', views.event_calendar, name='event_calendar'),
    path('my-events/', views.my_events, name='my_events'),
    path('live/', tracking_views.live_expeditions, name='live_expeditions'),
    path('user/<int:user_id>/', views.user_events, name='user_events'),
    path('<uuid:event_id>/', views.event_detail, name='event_detail'),
    path('<uuid:event_id>/rsvp/', views.event_rsvp, name='event_rsvp'),
    path('<uuid:event_id>/rsvps/', views.event_rsvps, name='event_rsvps'),
    path('<uuid:event_id>/invitations/', views.event_invite, name='event_invite'),
    path('invitations/<uuid:invitation_id>/', views.invitation_respond, name='invitation_respond'),
    path('<uuid:event_id>/comments/', views.event_comments, name='event_comments'),
    path('<uuid:event_id>/comments/<uuid:comment_id>/', views.event_comment_delete, name='event_comment_delete'),

    # Expedition safety tracking
    path('<uuid:event_id>/tracking/enable/', tracking_views.tracking_enable, name='tracking_enable'),
    path('<uuid:event_id>/tracking/', tracking_views.tracking_detail, name='tracking_detail'),
    path('<uuid:event_id>/tracking/start/', tracking_views.tracking_start, name='tracking_start'),
    path('<uuid:event_id>/tracking/complete/', tracking_views.tracking_complete, name='tracking_complete'),
    path('<uuid:event_id>/tracking/extend/', tracking_views.tracking_extend, name='tracking_extend'),
    path('<uuid:event_id>/tracking/resolve/', tracking_views.tracking_resolve, name='tracking_resolve'),
    path('<uuid:event_id>/tracking/trigger-emergency/', tracking_views.tracking_trigger_emergency, name='tracking_trigger_emergency'),
    path('<uuid:event_id>/tracking/checkin/', tracking_views.tracking_checkin, name='tracking_checkin'),
    path('<uuid:event_id>/tracking/checkout/', tracking_views.tracking_checkout, name='tracking_checkout'),
    path('<uuid:event_id>/tracking/gps/', tracking_views.tracking_gps_submit, name='tracking_gps_submit'),
    path('<uuid:event_id>/tracking/gps/trail/', tracking_views.tracking_gps_trail, name='tracking_gps_trail'),
    path('<uuid:event_id>/tracking/surrogates/', tracking_views.tracking_surrogate_add, name='tracking_surrogate_add'),
    path('<uuid:event_id>/tracking/surrogates/<uuid:surrogate_id>/', tracking_views.tracking_surrogate_remove, name='tracking_surrogate_remove'),
]
