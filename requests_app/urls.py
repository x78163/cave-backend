from django.urls import path
from . import views

urlpatterns = [
    path('inbox/', views.request_inbox, name='request_inbox'),
    path('outgoing/', views.request_outgoing, name='request_outgoing'),
    path('counts/', views.request_counts, name='request_counts'),
    path('', views.request_create, name='request_create'),
    path('<uuid:request_id>/resolve/', views.request_resolve, name='request_resolve'),
    path('<uuid:request_id>/', views.request_cancel, name='request_cancel'),
]
