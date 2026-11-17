from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Custom user: unique email (used to log in), display name and avatar."""
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=150, blank=True)
    avatar = models.URLField(blank=True)

    def __str__(self):
        return self.email
