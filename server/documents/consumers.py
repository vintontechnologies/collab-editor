import json
import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.utils import timezone

from .models import Document, DocumentUpdate, Membership

# The first byte of every binary message says what it is
MSG_UPDATE = 0     # a Yjs document update (an edit)
MSG_AWARENESS = 1  # cursor / presence state of a client
MSG_SYNCED = 2     # server -> client: every stored update has been sent
MSG_ERROR = 3      # server -> client: reason as text
MSG_JOIN = 4       # server -> client: JSON {user_id, name}
MSG_LEAVE = 5      # server -> client: JSON {user_id, name}

WRITE_ROLES = ("owner", "editor")
MAX_MESSAGE_BYTES = 1_000_000
ROLE_RECHECK_SECONDS = 10  # how often a connected user's role is re-checked


class DocumentConsumer(AsyncWebsocketConsumer):
    """
    One WebSocket per user per open document. The server never parses the Yjs data:
    it authorizes, relays to the other clients through the channel layer (Redis, so it
    works across several server instances) and stores the updates.
    """

    async def connect(self):
        self.joined = False
        self.user = self.scope["user"]
        self.doc_id = self.scope["url_route"]["kwargs"]["doc_id"]
        self.group = f"doc_{self.doc_id}"

        # Closing before accept() rejects the handshake with HTTP 403
        if not self.user.is_authenticated:
            await self.close(code=4401)
            return
        self.role = await self.get_role()
        self.role_checked_at = time.monotonic()
        if self.role is None:  # not a member (or no such document)
            await self.close(code=4403)
            return

        await self.channel_layer.group_add(self.group, self.channel_name)
        self.joined = True
        await self.accept()

        # Replay stored updates so the client can rebuild the document
        for data in await self.load_updates():
            await self.send(bytes_data=bytes([MSG_UPDATE]) + data)
        await self.send(bytes_data=bytes([MSG_SYNCED]))

        await self.broadcast(bytes([MSG_JOIN]) + self.identity())

    async def disconnect(self, code):
        if self.joined:
            await self.channel_layer.group_discard(self.group, self.channel_name)
            await self.broadcast(bytes([MSG_LEAVE]) + self.identity())

    async def receive(self, text_data=None, bytes_data=None):
        if not bytes_data or len(bytes_data) > MAX_MESSAGE_BYTES:
            return
        kind, payload = bytes_data[0], bytes_data[1:]

        if kind == MSG_UPDATE:
            # The viewer restriction is enforced here, on the server
            if (await self.current_role()) not in WRITE_ROLES:
                await self.send(bytes_data=bytes([MSG_ERROR]) + b"read-only")
                return
            if payload:
                await self.save_update(payload)
                await self.broadcast(bytes_data)
        elif kind == MSG_AWARENESS:
            # Cursors are allowed for every member, including viewers
            if await self.current_role() is not None:
                await self.broadcast(bytes_data)

    # --- helpers -------------------------------------------------------------

    def identity(self) -> bytes:
        info = {"user_id": self.user.id, "name": self.user.name or self.user.email}
        return json.dumps(info).encode()

    async def broadcast(self, data: bytes):
        await self.channel_layer.group_send(
            self.group, {"type": "relay", "data": data, "sender": self.channel_name}
        )

    async def relay(self, event):
        # Handler for group messages. Don't echo a message back to its sender.
        if event["sender"] != self.channel_name:
            await self.send(bytes_data=event["data"])

    async def current_role(self):
        """The user's role, re-checked every few seconds so that removing a member or
        changing their role takes effect on sockets that are already open."""
        now = time.monotonic()
        if now - self.role_checked_at > ROLE_RECHECK_SECONDS:
            self.role = await self.get_role()
            self.role_checked_at = now
            if self.role is None:
                await self.close(code=4403)
        return self.role

    @database_sync_to_async
    def get_role(self):
        return (
            Membership.objects.filter(document_id=self.doc_id, user=self.user)
            .values_list("role", flat=True)
            .first()
        )

    @database_sync_to_async
    def load_updates(self):
        rows = DocumentUpdate.objects.filter(document_id=self.doc_id).values_list("data", flat=True)
        return [bytes(row) for row in rows]  # Postgres returns memoryviews

    @database_sync_to_async
    def save_update(self, payload: bytes):
        DocumentUpdate.objects.create(document_id=self.doc_id, data=payload, author=self.user)
        # Keeps "Updated ..." on the dashboard accurate
        Document.objects.filter(pk=self.doc_id).update(updated_at=timezone.now())
