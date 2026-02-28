from django.urls import path

from . import views

urlpatterns = [
    path('', views.event_list, name='event_list'),
    path('calendar/', views.event_calendar, name='event_calendar'),
    path('my-events/', views.my_events, name='my_events'),
    path('user/<int:user_id>/', views.user_events, name='user_events'),
    path('<uuid:event_id>/', views.event_detail, name='event_detail'),
    path('<uuid:event_id>/rsvp/', views.event_rsvp, name='event_rsvp'),
    path('<uuid:event_id>/rsvps/', views.event_rsvps, name='event_rsvps'),
    path('<uuid:event_id>/invitations/', views.event_invite, name='event_invite'),
    path('invitations/<uuid:invitation_id>/', views.invitation_respond, name='invitation_respond'),
    path('<uuid:event_id>/comments/', views.event_comments, name='event_comments'),
    path('<uuid:event_id>/comments/<uuid:comment_id>/', views.event_comment_delete, name='event_comment_delete'),
]
