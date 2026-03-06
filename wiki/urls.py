"""URL patterns for the wiki app."""

from django.urls import path
from . import views

urlpatterns = [
    # Categories & Tags
    path('categories/', views.category_list, name='wiki_categories'),
    path('tags/', views.tag_list, name='wiki_tags'),

    # Search
    path('search/', views.article_search, name='wiki_search'),

    # Articles
    path('articles/', views.article_list, name='wiki_article_list'),
    path('articles/<slug:slug>/', views.article_detail, name='wiki_article_detail'),
    path('articles/<slug:slug>/history/', views.article_history, name='wiki_article_history'),
    path('articles/<slug:slug>/revisions/<int:rev_num>/', views.article_revision, name='wiki_article_revision'),
    path('articles/<slug:slug>/images/', views.article_image_upload, name='wiki_article_image_upload'),
    path('articles/<slug:slug>/links/', views.article_links, name='wiki_article_links'),

    # Cave reverse lookup
    path('cave/<uuid:cave_id>/articles/', views.cave_articles, name='wiki_cave_articles'),
]
