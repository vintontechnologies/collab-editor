import base64

from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import DocumentUpdate, Version
from .sharing import get_membership


def version_data(v):
    return {
        "number": v.number,
        "author_name": (v.author.name or v.author.email) if v.author else "Unknown",
        "kind": v.kind,
        "label": v.label,
        "created_at": v.created_at.isoformat(),
    }


class VersionListView(APIView):
    """Timeline: newest first. Any member can see it."""
    permission_classes = [IsAuthenticated]

    def get(self, request, doc_id):
        get_membership(request.user, doc_id)  # 404 for non-members
        versions = Version.objects.filter(document_id=doc_id).select_related("author")
        return Response([version_data(v) for v in versions])


class VersionDetailView(APIView):
    """
    The edits up to this version (base64). The browser rebuilds the old document from
    them to preview it, or to restore it. Read-only: restoring goes through the WebSocket,
    where the server checks the role.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, doc_id, number):
        get_membership(request.user, doc_id)
        version = get_object_or_404(
            Version.objects.select_related("author"), document_id=doc_id, number=number
        )
        rows = DocumentUpdate.objects.filter(
            document_id=doc_id, id__lte=version.last_update_id
        ).values_list("data", flat=True)
        data = version_data(version)
        data["updates"] = [base64.b64encode(bytes(row)).decode() for row in rows]
        return Response(data)
