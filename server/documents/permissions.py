from rest_framework.permissions import SAFE_METHODS, BasePermission


class DocumentPermission(BasePermission):
    """
    Role rules, enforced on the server:
      - any member can read and duplicate
      - owner and editor can update (editors: language only, checked in the view)
      - only the owner can delete
    """

    def has_object_permission(self, request, view, obj):
        role = obj.my_role  # annotated by the view's queryset
        if request.method in SAFE_METHODS or view.action == "duplicate":
            return True
        if view.action in ("update", "partial_update"):
            return role in ("owner", "editor")
        if view.action == "destroy":
            return role == "owner"
        return False
