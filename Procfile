web: daphne cave_backend.asgi:application --port $PORT --bind 0.0.0.0 --proxy-headers
worker: celery -A cave_backend worker --loglevel=info --concurrency=2 --beat
