from django.urls import path
from rest_framework.routers import DefaultRouter

from .sharing import JoinView, LinkView, MemberDetailView, MembersView
from .views import DocumentViewSet

router = DefaultRouter()
router.register("", DocumentViewSet, basename="document")

# Explicit sharing routes first, then the router's CRUD routes
urlpatterns = [
    path("join/<uuid:doc_id>/", JoinView.as_view()),
    path("<uuid:doc_id>/members/", MembersView.as_view()),
    path("<uuid:doc_id>/members/<int:user_id>/", MemberDetailView.as_view()),
    path("<uuid:doc_id>/link/", LinkView.as_view()),
] + router.urls
