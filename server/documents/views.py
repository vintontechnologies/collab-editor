from django.db import transaction
from django.db.models import OuterRef, Subquery
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Document, DocumentUpdate, Membership
from .permissions import DocumentPermission
from .serializers import DocumentSerializer


class DocumentViewSet(viewsets.ModelViewSet):
    serializer_class = DocumentSerializer
    permission_classes = [IsAuthenticated, DocumentPermission]
    # The real queryset is built in get_queryset(); this lets the API docs see the id type
    queryset = Document.objects.none()

    def get_queryset(self):
        # Only documents the user is a member of (owned AND shared with them).
        # Non-members get a 404, so the existence of a document isn't leaked.
        role = Membership.objects.filter(
            document=OuterRef("pk"), user=self.request.user
        ).values("role")[:1]
        return (
            Document.objects.select_related("owner")
            .annotate(my_role=Subquery(role))
            .filter(my_role__isnull=False)
        )

    @transaction.atomic
    def perform_create(self, serializer):
        doc = serializer.save(owner=self.request.user)
        Membership.objects.create(document=doc, user=self.request.user, role=Membership.Role.OWNER)
        doc.my_role = Membership.Role.OWNER

    def perform_update(self, serializer):
        # Editors may only change the language; renaming is for the owner
        if serializer.instance.my_role != "owner" and set(self.request.data) - {"language"}:
            raise PermissionDenied("Only the owner can change this.")
        serializer.save()

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def duplicate(self, request, pk=None):
        src = self.get_object()
        copy = Document.objects.create(
            title=f"{src.title} (copy)",
            doc_type=src.doc_type,
            language=src.language,
            owner=request.user,
            yjs_state=src.yjs_state,
        )
        Membership.objects.create(document=copy, user=request.user, role=Membership.Role.OWNER)
        # The content lives in the update log, so copy that too
        DocumentUpdate.objects.bulk_create(
            DocumentUpdate(document=copy, data=bytes(u.data), author=u.author)
            for u in src.updates.all()
        )
        copy.my_role = Membership.Role.OWNER
        return Response(self.get_serializer(copy).data, status=status.HTTP_201_CREATED)
