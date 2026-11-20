import base64

from django.contrib.auth import get_user_model
from django.core import mail
from rest_framework.test import APITestCase

from .models import Document, DocumentUpdate, Invitation, Membership, Version

User = get_user_model()
PW = "StrongPass#2026"


def make_user(email, name):
    return User.objects.create_user(username=email, email=email, name=name, password=PW)


class DocumentApiTests(APITestCase):
    """Documents, roles, sharing and versions through the REST API."""

    def setUp(self):
        self.owner = make_user("owner@example.com", "Owner")
        self.editor = make_user("editor@example.com", "Editor")
        self.viewer = make_user("viewer@example.com", "Viewer")
        self.outsider = make_user("outsider@example.com", "Outsider")

        self.client.force_authenticate(self.owner)
        r = self.client.post(
            "/api/documents/",
            {"title": "Doc", "doc_type": "code", "language": "python"},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        self.id = r.data["id"]
        self.url = f"/api/documents/{self.id}/"
        Membership.objects.create(document_id=self.id, user=self.editor, role="editor")
        Membership.objects.create(document_id=self.id, user=self.viewer, role="viewer")

    def as_user(self, user):
        self.client.force_authenticate(user)

    # --- documents and roles ------------------------------------------------

    def test_creator_becomes_owner(self):
        self.assertEqual(self.client.get(self.url).data["my_role"], "owner")

    def test_anonymous_gets_401(self):
        self.as_user(None)
        self.assertEqual(self.client.get("/api/documents/").status_code, 401)

    def test_outsider_gets_404_and_does_not_see_it_listed(self):
        self.as_user(self.outsider)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.get("/api/documents/").data, [])

    def test_viewer_can_read_but_not_change(self):
        self.as_user(self.viewer)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertEqual(self.client.patch(self.url, {"title": "x"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(self.url).status_code, 403)

    def test_editor_can_only_change_the_language(self):
        self.as_user(self.editor)
        self.assertEqual(self.client.patch(self.url, {"language": "java"}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(self.url, {"title": "x"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(self.url).status_code, 403)

    def test_document_type_cannot_change(self):
        r = self.client.patch(self.url, {"doc_type": "whiteboard"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_owner_can_rename_and_delete(self):
        self.assertEqual(self.client.patch(self.url, {"title": "New"}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(self.url).status_code, 204)
        self.assertFalse(Document.objects.filter(pk=self.id).exists())

    def test_duplicate_copies_the_content(self):
        DocumentUpdate.objects.create(document_id=self.id, data=b"one", author=self.owner)
        DocumentUpdate.objects.create(document_id=self.id, data=b"two", author=self.owner)
        self.as_user(self.viewer)  # any member may duplicate
        r = self.client.post(f"{self.url}duplicate/")
        self.assertEqual(r.status_code, 201)
        self.assertNotEqual(r.data["id"], self.id)
        self.assertEqual(r.data["my_role"], "owner")  # the copy belongs to whoever copied it
        self.assertEqual(DocumentUpdate.objects.filter(document_id=r.data["id"]).count(), 2)

    # --- sharing ------------------------------------------------------------

    def test_owner_invites_an_existing_user_and_an_email_is_sent(self):
        r = self.client.post(
            f"{self.url}members/",
            {"email": "outsider@example.com", "role": "editor"},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        self.assertTrue(
            Membership.objects.filter(document_id=self.id, user=self.outsider, role="editor").exists()
        )
        self.assertEqual(len(mail.outbox), 1)

    def test_non_owner_cannot_invite(self):
        self.as_user(self.editor)
        r = self.client.post(
            f"{self.url}members/", {"email": "outsider@example.com", "role": "viewer"}, format="json"
        )
        self.assertEqual(r.status_code, 403)

    def test_owner_role_cannot_be_handed_out(self):
        r = self.client.post(
            f"{self.url}members/", {"email": "outsider@example.com", "role": "owner"}, format="json"
        )
        self.assertEqual(r.status_code, 400)

    def test_owner_can_change_a_members_role(self):
        r = self.client.patch(
            f"{self.url}members/{self.viewer.id}/", {"role": "editor"}, format="json"
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Membership.objects.get(document_id=self.id, user=self.viewer).role, "editor")

    def test_invite_for_unregistered_email_is_applied_on_register(self):
        r = self.client.post(
            f"{self.url}members/", {"email": "new@example.com", "role": "editor"}, format="json"
        )
        self.assertEqual(r.status_code, 201)
        self.assertTrue(Invitation.objects.filter(email="new@example.com").exists())

        self.as_user(None)
        r = self.client.post(
            "/api/auth/register/",
            {"email": "new@example.com", "name": "New", "password": PW},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        member = Membership.objects.get(document_id=self.id, user__email="new@example.com")
        self.assertEqual(member.role, "editor")
        self.assertFalse(Invitation.objects.filter(email="new@example.com").exists())

    def test_share_link_joins_with_the_chosen_role(self):
        self.as_user(self.outsider)
        self.assertEqual(self.client.post(f"/api/documents/join/{self.id}/").status_code, 404)  # link is off

        self.as_user(self.owner)
        r = self.client.put(f"{self.url}link/", {"role": "viewer"}, format="json")
        self.assertEqual(r.status_code, 200)

        self.as_user(self.outsider)
        r = self.client.post(f"/api/documents/join/{self.id}/")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["my_role"], "viewer")

    def test_joining_by_link_never_changes_an_existing_role(self):
        self.client.put(f"{self.url}link/", {"role": "editor"}, format="json")
        self.as_user(self.viewer)
        self.client.post(f"/api/documents/join/{self.id}/")
        self.assertEqual(Membership.objects.get(document_id=self.id, user=self.viewer).role, "viewer")

    def test_owner_cannot_be_removed(self):
        r = self.client.delete(f"{self.url}members/{self.owner.id}/")
        self.assertEqual(r.status_code, 400)

    def test_member_can_leave_but_not_remove_others(self):
        self.as_user(self.viewer)
        self.assertEqual(self.client.delete(f"{self.url}members/{self.editor.id}/").status_code, 403)
        self.assertEqual(self.client.delete(f"{self.url}members/{self.viewer.id}/").status_code, 204)
        self.assertFalse(Membership.objects.filter(document_id=self.id, user=self.viewer).exists())

    # --- versions -----------------------------------------------------------

    def test_version_detail_returns_the_stored_updates(self):
        u = DocumentUpdate.objects.create(document_id=self.id, data=b"abc", author=self.owner)
        Version.objects.create(document_id=self.id, number=1, last_update_id=u.id, author=self.owner)

        r = self.client.get(f"{self.url}versions/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data), 1)

        r = self.client.get(f"{self.url}versions/1/")
        self.assertEqual(r.data["updates"], [base64.b64encode(b"abc").decode()])

        self.as_user(self.outsider)
        self.assertEqual(self.client.get(f"{self.url}versions/1/").status_code, 404)
