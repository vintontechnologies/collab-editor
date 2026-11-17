from django.contrib import admin

from .models import Document, Invitation, Membership

admin.site.register(Document)
admin.site.register(Membership)
admin.site.register(Invitation)
