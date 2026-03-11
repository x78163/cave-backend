"""
Celery application for cave_backend.

Handles async tasks: email notifications, chat digests, 3D processing (future).
"""

import os

from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cave_backend.settings')

app = Celery('cave_backend')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
