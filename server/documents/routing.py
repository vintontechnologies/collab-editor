from django.urls import re_path

from .consumers import DocumentConsumer

websocket_urlpatterns = [
    re_path(r"^ws/documents/(?P<doc_id>[0-9a-f-]{36})/$", DocumentConsumer.as_asgi()),
]
