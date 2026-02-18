from django.urls import path
from . import views

app_name = 'social'

urlpatterns = [
    # Ratings
    path(
        'caves/<uuid:cave_id>/ratings/',
        views.cave_ratings, name='cave_ratings',
    ),
    path(
        'caves/<uuid:cave_id>/ratings/<uuid:rating_id>/',
        views.cave_rating_detail, name='cave_rating_detail',
    ),
    # Follows
    path(
        'users/<int:user_id>/follow/',
        views.user_follow, name='user_follow',
    ),
    path(
        'users/<int:user_id>/followers/',
        views.user_followers, name='user_followers',
    ),
    path(
        'users/<int:user_id>/following/',
        views.user_following, name='user_following',
    ),
    # Feed
    path('feed/', views.activity_feed, name='activity_feed'),
    # Expeditions
    path('expeditions/', views.expedition_list, name='expedition_list'),
    path(
        'expeditions/<uuid:expedition_id>/',
        views.expedition_detail, name='expedition_detail',
    ),
    path(
        'expeditions/<uuid:expedition_id>/members/',
        views.expedition_members, name='expedition_members',
    ),
    path(
        'expeditions/<uuid:expedition_id>/members/<uuid:member_id>/',
        views.expedition_member_respond, name='expedition_member_respond',
    ),
]
