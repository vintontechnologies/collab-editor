from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema, extend_schema_view

from .models import Document, Invitation, Membership

User = get_user_model()


class InviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    # The owner role can't be handed out by invite: there is exactly one owner
    role = serializers.ChoiceField(choices=["editor", "viewer"])


class RoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=["editor", "viewer"])


class LinkSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=["off", "viewer", "editor"])


# The serializers below only describe responses, for the API documentation
class MemberSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    email = serializers.EmailField()
    name = serializers.CharField()
    avatar = serializers.CharField(allow_blank=True)
    role = serializers.CharField()


class PendingInviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.CharField()


class MembersResponseSerializer(serializers.Serializer):
    members = MemberSerializer(many=True)
    pending_invites = PendingInviteSerializer(many=True)


class LinkResponseSerializer(serializers.Serializer):
    link_role = serializers.CharField()
    url = serializers.CharField()


class JoinResponseSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    title = serializers.CharField()
    my_role = serializers.CharField()


def get_membership(user, doc_id):
    """The caller's membership, or 404 (non-members can't tell a document exists)."""
    return get_object_or_404(
        Membership.objects.select_related("document", "user"),
        document_id=doc_id, user=user,
    )


def require_owner(user, doc_id):
    membership = get_membership(user, doc_id)
    if membership.role != Membership.Role.OWNER:
        raise PermissionDenied("Only the owner can do this.")
    return membership.document


def member_data(m):
    return {"user_id": m.user_id, "email": m.user.email, "name": m.user.name,
            "avatar": m.user.avatar, "role": m.role}


def send_invite_email(doc, inviter, email, role, has_account):
    if has_account:
        action = f"Open it here: {settings.FRONTEND_URL}/documents/{doc.id}"
    else:
        action = ("Create an account with this email address to get access: "
                  f"{settings.FRONTEND_URL}/register")
    send_mail(
        subject=f'{inviter.name or inviter.email} invited you to "{doc.title}"',
        message=f'You have been invited as {role} on "{doc.title}".\n\n{action}\n',
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=True,  # a mail problem must not break the invite itself
    )


@extend_schema_view(
    get=extend_schema(responses=MembersResponseSerializer, summary="List members and pending invites"),
    post=extend_schema(request=InviteSerializer, responses={201: MemberSerializer},
                       summary="Invite someone by email (owner only)"),
)
class MembersView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, doc_id):
        get_membership(request.user, doc_id)  # any member may see who has access
        members = Membership.objects.filter(document_id=doc_id).select_related("user")
        pending = Invitation.objects.filter(document_id=doc_id)
        return Response({
            "members": [member_data(m) for m in members],
            "pending_invites": [{"email": i.email, "role": i.role} for i in pending],
        })

    @transaction.atomic
    def post(self, request, doc_id):
        doc = require_owner(request.user, doc_id)
        s = InviteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        email = s.validated_data["email"].lower()
        role = s.validated_data["role"]

        user = User.objects.filter(email__iexact=email).first()
        if user:
            if user.pk == doc.owner_id:
                return Response({"detail": "The owner already has full access."},
                                status=status.HTTP_400_BAD_REQUEST)
            m, _ = Membership.objects.update_or_create(
                document=doc, user=user, defaults={"role": role})
            m.user = user
            result = member_data(m)
        else:
            Invitation.objects.update_or_create(
                document=doc, email=email,
                defaults={"role": role, "invited_by": request.user})
            result = {"email": email, "role": role, "pending": True}

        send_invite_email(doc, request.user, email, role, has_account=bool(user))
        return Response(result, status=status.HTTP_201_CREATED)


@extend_schema_view(
    patch=extend_schema(request=RoleSerializer, responses=MemberSerializer,
                        summary="Change a member's role (owner only)"),
    delete=extend_schema(responses={204: None}, summary="Remove a member, or leave the document"),
)
class MemberDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, doc_id, user_id):
        doc = require_owner(request.user, doc_id)
        s = RoleSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        m = get_object_or_404(Membership.objects.select_related("user"),
                              document=doc, user_id=user_id)
        if m.role == Membership.Role.OWNER:
            return Response({"detail": "The owner's role cannot be changed."},
                            status=status.HTTP_400_BAD_REQUEST)
        m.role = s.validated_data["role"]
        m.save(update_fields=["role"])
        return Response(member_data(m))

    def delete(self, request, doc_id, user_id):
        me = get_membership(request.user, doc_id)
        # Owners can remove anyone; everyone else may only remove themselves (leave)
        if user_id != request.user.pk and me.role != Membership.Role.OWNER:
            raise PermissionDenied("Only the owner can remove other members.")
        target = get_object_or_404(Membership, document_id=doc_id, user_id=user_id)
        if target.role == Membership.Role.OWNER:
            return Response({"detail": "The owner cannot be removed."},
                            status=status.HTTP_400_BAD_REQUEST)
        target.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema_view(
    get=extend_schema(responses=LinkResponseSerializer, summary="Share-link settings"),
    put=extend_schema(request=LinkSerializer, responses=LinkResponseSerializer,
                      summary="Turn link sharing on or off (owner only)"),
)
class LinkView(APIView):
    permission_classes = [IsAuthenticated]

    @staticmethod
    def _data(doc):
        return {"link_role": doc.link_role, "url": f"{settings.FRONTEND_URL}/join/{doc.id}"}

    def get(self, request, doc_id):
        return Response(self._data(get_membership(request.user, doc_id).document))

    def put(self, request, doc_id):
        doc = require_owner(request.user, doc_id)
        s = LinkSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        doc.link_role = s.validated_data["role"]
        doc.save(update_fields=["link_role"])
        return Response(self._data(doc))


@extend_schema_view(
    post=extend_schema(request=None, responses=JoinResponseSerializer,
                       summary="Join a document through its share link"),
)
class JoinView(APIView):
    """Join a document through its share link, if link sharing is on."""
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, doc_id):
        doc = Document.objects.filter(pk=doc_id).first()
        if not doc or doc.link_role == "off":
            return Response({"detail": "This link is not active."},
                            status=status.HTTP_404_NOT_FOUND)
        # get_or_create: existing members keep the role they already have
        m, created = Membership.objects.get_or_create(
            document=doc, user=request.user, defaults={"role": doc.link_role})
        return Response({"id": str(doc.id), "title": doc.title, "my_role": m.role},
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
