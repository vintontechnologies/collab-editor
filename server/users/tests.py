from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

User = get_user_model()
PW = "StrongPass#2026"


class AuthTests(APITestCase):
    def register(self, email="a@example.com", name="Alice", password=PW):
        return self.client.post(
            "/api/auth/register/",
            {"email": email, "name": name, "password": password},
            format="json",
        )

    def login(self, email="a@example.com", password=PW):
        return self.client.post(
            "/api/auth/login/", {"email": email, "password": password}, format="json"
        )

    def test_register_hashes_the_password(self):
        r = self.register()
        self.assertEqual(r.status_code, 201)
        self.assertNotIn("password", r.data)  # never sent back
        user = User.objects.get(email="a@example.com")
        self.assertNotEqual(user.password, PW)  # only a hash is stored
        self.assertTrue(user.check_password(PW))

    def test_duplicate_email_is_rejected_ignoring_case(self):
        self.register()
        self.assertEqual(self.register(email="A@Example.com").status_code, 400)

    def test_weak_password_is_rejected(self):
        self.assertEqual(self.register(password="123").status_code, 400)

    def test_login_returns_tokens_and_profile(self):
        self.register()
        r = self.login()
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)
        self.assertIn("refresh", r.data)
        self.assertEqual(r.data["user"]["email"], "a@example.com")

    def test_login_with_wrong_password_fails(self):
        self.register()
        self.assertEqual(self.login(password="wrong-password").status_code, 401)

    def test_profile_requires_authentication(self):
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_profile_update_changes_name_but_not_email(self):
        self.register()
        token = self.login().data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        r = self.client.patch("/api/auth/me/", {"name": "New Name"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["name"], "New Name")
        self.client.patch("/api/auth/me/", {"email": "evil@example.com"}, format="json")
        self.assertEqual(User.objects.get(name="New Name").email, "a@example.com")

    def test_logout_blacklists_the_refresh_token(self):
        self.register()
        data = self.login().data
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {data['access']}")
        r = self.client.post("/api/auth/logout/", {"refresh": data["refresh"]}, format="json")
        self.assertEqual(r.status_code, 204)
        self.client.credentials()
        r = self.client.post("/api/auth/refresh/", {"refresh": data["refresh"]}, format="json")
        self.assertEqual(r.status_code, 401)  # the token can't be used again
