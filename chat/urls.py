from django.urls import path
from . import views

app_name = 'chat'

urlpatterns = [
    path('channels/', views.channel_list, name='channel_list'),
    path('channels/<uuid:channel_id>/', views.channel_detail, name='channel_detail'),
    path('channels/<uuid:channel_id>/messages/', views.channel_messages, name='channel_messages'),
    path('channels/<uuid:channel_id>/send/', views.send_message_with_attachment, name='send_message'),
    path('channels/<uuid:channel_id>/mark-read/', views.mark_read, name='mark_read'),
    path('channels/<uuid:channel_id>/members/', views.channel_add_member, name='channel_add_member'),
    path('channels/<uuid:channel_id>/members/<int:user_id>/', views.channel_remove_member, name='channel_remove_member'),
    path('channels/<uuid:channel_id>/leave/', views.channel_leave, name='channel_leave'),
    path('channels/<uuid:channel_id>/join/', views.join_public_channel, name='join_public_channel'),
    path('channels/<uuid:channel_id>/messages/<uuid:message_id>/react/', views.message_react, name='message_react'),
    path('channels/<uuid:channel_id>/messages/<uuid:message_id>/reactors/', views.message_reaction_users, name='message_reaction_users'),
    path('browse/', views.browse_channels, name='browse_channels'),
    path('dm/', views.dm_get_or_create, name='dm_get_or_create'),
    path('unread-count/', views.unread_count, name='unread_count'),
]
