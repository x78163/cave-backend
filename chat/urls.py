from django.urls import path
from . import views

app_name = 'chat'

urlpatterns = [
    path('channels/', views.channel_list, name='channel_list'),
    path('channels/<uuid:channel_id>/', views.channel_detail, name='channel_detail'),
    path('channels/<uuid:channel_id>/messages/', views.channel_messages, name='channel_messages'),
    path('channels/<uuid:channel_id>/mark-read/', views.mark_read, name='mark_read'),
    path('channels/<uuid:channel_id>/members/', views.channel_add_member, name='channel_add_member'),
    path('channels/<uuid:channel_id>/leave/', views.channel_leave, name='channel_leave'),
    path('dm/', views.dm_get_or_create, name='dm_get_or_create'),
    path('unread-count/', views.unread_count, name='unread_count'),
]
