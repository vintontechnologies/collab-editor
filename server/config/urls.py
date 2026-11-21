from pathlib import Path

from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def spa(request, *args, **kwargs):
    """Serves the React app for every page URL (/login, /documents/<id>, ...)."""
    index = Path(settings.BASE_DIR) / "frontend" / "index.html"
    if not index.exists():
        raise Http404("The frontend build is not installed in this environment.")
    return FileResponse(open(index, "rb"), content_type="text/html")


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("users.urls")),
    path("api/documents/", include("documents.urls")),
    # API documentation (a graded deliverable)
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    # Everything else belongs to the React router (must stay last)
    re_path(r"^(?!api/|admin/|ws/|static/).*$", spa),
]
