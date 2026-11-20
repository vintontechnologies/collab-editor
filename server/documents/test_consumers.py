from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase, override_settings
from rest_framework_simplejwt.tokens import AccessToken

from .middleware import JWTAuthMiddleware
from .models import Document, DocumentUpdate, Membership, Version
from .routing import websocket_urlpatterns

User = get_user_model()
application = JWTAuthMiddleware(URLRouter(websocket_urlpatterns))

# Message types (the first byte), see consumers.py
UPDATE, SYNCED, ERROR, JOIN, VERSION = 0, 2, 3, 4, 6


async def drain_until_synced(comm):
    """Read the stored updates that the server replays on connect, until 'synced'."""
    got = []
    while True:
        out = await comm.receive_output(timeout=3)
        data = out.get("bytes")
        if data is not None and data[0] == SYNCED:
            return got
        got.append(data)


# The in-memory channel layer lets the tests run without Redis
@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
class ConsumerTests(TransactionTestCase):
    def setUp(self):
        def mk(email):
            return User.objects.create_user(username=email, email=email, name=email, password="x")

        self.owner, self.viewer, self.outsider = mk("o@x.com"), mk("v@x.com"), mk("out@x.com")
        self.doc = Document.objects.create(title="T", doc_type="code", owner=self.owner)
        Membership.objects.create(document=self.doc, user=self.owner, role="owner")
        Membership.objects.create(document=self.doc, user=self.viewer, role="viewer")
        self.tokens = {
            u.email: str(AccessToken.for_user(u)) for u in (self.owner, self.viewer, self.outsider)
        }

    def comm(self, email=None):
        query = f"?token={self.tokens[email]}" if email else ""
        return WebsocketCommunicator(application, f"/ws/documents/{self.doc.id}/{query}")

    async def test_anonymous_connection_is_rejected(self):
        connected, _ = await self.comm().connect()
        self.assertFalse(connected)

    async def test_non_member_connection_is_rejected(self):
        connected, _ = await self.comm("out@x.com").connect()
        self.assertFalse(connected)

    async def test_edit_is_relayed_to_others_and_stored(self):
        owner, viewer = self.comm("o@x.com"), self.comm("v@x.com")
        self.assertTrue((await owner.connect())[0])
        await drain_until_synced(owner)
        self.assertTrue((await viewer.connect())[0])
        await drain_until_synced(viewer)

        join = await owner.receive_output(timeout=2)  # the owner is told the viewer joined
        self.assertEqual(join["bytes"][0], JOIN)

        await owner.send_to(bytes_data=bytes([UPDATE]) + b"hello")
        out = await viewer.receive_output(timeout=2)
        self.assertEqual(out["bytes"], bytes([UPDATE]) + b"hello")

        count = await database_sync_to_async(DocumentUpdate.objects.count)()
        self.assertEqual(count, 1)
        await owner.disconnect()
        await viewer.disconnect()

    async def test_viewer_edit_is_rejected_by_the_server(self):
        owner, viewer = self.comm("o@x.com"), self.comm("v@x.com")
        await owner.connect()
        await drain_until_synced(owner)
        await viewer.connect()
        await drain_until_synced(viewer)
        await owner.receive_output(timeout=2)  # the "viewer joined" message

        await viewer.send_to(bytes_data=bytes([UPDATE]) + b"evil")
        reply = await viewer.receive_output(timeout=2)
        self.assertEqual(reply["bytes"][0], ERROR)  # told it is read-only
        self.assertTrue(await owner.receive_nothing(timeout=0.5))  # never relayed

        count = await database_sync_to_async(DocumentUpdate.objects.count)()
        self.assertEqual(count, 0)  # never stored
        await owner.disconnect()
        await viewer.disconnect()

    async def test_new_connection_receives_the_stored_updates(self):
        await database_sync_to_async(DocumentUpdate.objects.create)(
            document=self.doc, data=b"stored", author=self.owner
        )
        viewer = self.comm("v@x.com")
        await viewer.connect()
        got = await drain_until_synced(viewer)
        self.assertEqual(got, [bytes([UPDATE]) + b"stored"])
        await viewer.disconnect()

    async def test_snapshot_is_taken_after_50_edits(self):
        owner = self.comm("o@x.com")
        await owner.connect()
        await drain_until_synced(owner)
        for i in range(50):
            await owner.send_to(bytes_data=bytes([UPDATE]) + str(i).encode())
        announcement = await owner.receive_output(timeout=10)  # "a new version exists"
        self.assertEqual(announcement["bytes"][0], VERSION)
        count = await database_sync_to_async(Version.objects.count)()
        self.assertEqual(count, 1)
        await owner.disconnect()

    async def test_snapshot_is_taken_when_a_user_leaves_with_unsaved_edits(self):
        owner = self.comm("o@x.com")
        await owner.connect()
        await drain_until_synced(owner)
        await owner.send_to(bytes_data=bytes([UPDATE]) + b"x")
        await owner.disconnect()
        count = await database_sync_to_async(Version.objects.count)()
        self.assertEqual(count, 1)
