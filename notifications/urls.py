from django.urls import path
from . import views

urlpatterns = [
    path('action', views.handle_email_action, name='email_action'),
]
