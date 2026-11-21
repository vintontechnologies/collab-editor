#!/bin/sh
set -e
# Runs every time the container starts
python manage.py migrate --noinput
python manage.py collectstatic --noinput
# Daphne serves both normal HTTP requests and WebSockets
exec daphne -b 0.0.0.0 -p 8000 config.asgi:application
