import uuid

from django.conf import settings
from django.db import models


class Document(models.Model):
    class Type(models.TextChoices):
        CODE = "code", "Code"
        WHITEBOARD = "whiteboard", "Whiteboard"

    # UUIDs make document links hard to guess
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200, default="Untitled")
    doc_type = models.CharField(max_length=12, choices=Type.choices)
    language = models.CharField(max_length=20, blank=True, default="javascript")
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_documents"
    )
    # Link sharing: anyone signed in who opens the link joins with this role
    link_role = models.CharField(
        max_length=10,
        choices=[("off", "Off"), ("viewer", "Viewer"), ("editor", "Editor")],
        default="off",
    )
    # Yjs (CRDT) state; the real-time layer fills this in later
    yjs_state = models.BinaryField(blank=True, default=b"")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title


class Membership(models.Model):
    """Who can access a document, and with which role."""

    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        EDITOR = "editor", "Editor"
        VIEWER = "viewer", "Viewer"

    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    role = models.CharField(max_length=10, choices=Role.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["document", "user"], name="one_role_per_user_per_document")
        ]

    def __str__(self):
        return f"{self.user} - {self.role} - {self.document}"


class Invitation(models.Model):
    """Pending invite for an email without an account yet; applied when they register."""
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="invitations")
    email = models.EmailField()
    role = models.CharField(max_length=10, choices=Membership.Role.choices)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["document", "email"], name="one_invite_per_email_per_document")
        ]


class DocumentUpdate(models.Model):
    """Append-only log of Yjs updates. New clients replay it to load the document."""
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="updates")
    data = models.BinaryField()
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        indexes = [models.Index(fields=["document", "id"])]


class Version(models.Model):
    """A bookmark in the update log: the document as it was after update `last_update_id`."""
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField()
    last_update_id = models.BigIntegerField()
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    kind = models.CharField(max_length=10, default="auto")  # "auto" or "restore"
    label = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-number"]
        constraints = [
            models.UniqueConstraint(fields=["document", "number"], name="unique_version_number")
        ]
