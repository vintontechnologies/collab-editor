from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """Public profile. Email can't be changed here."""

    class Meta:
        model = User
        fields = ["id", "email", "name", "avatar"]
        read_only_fields = ["id", "email"]


class RegisterSerializer(serializers.ModelSerializer):
    # write_only: the password is accepted but never returned in responses
    password = serializers.CharField(write_only=True, validators=[validate_password])

    class Meta:
        model = User
        fields = ["id", "email", "name", "password"]

    def validate_email(self, value):
        value = value.lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("user with this email already exists.")
        return value

    def create(self, validated_data):
        email = validated_data["email"].lower()
        # create_user hashes the password before saving it
        user = User.objects.create_user(
            username=email,  # Django requires a unique username; reuse the email
            email=email,
            name=validated_data.get("name", ""),
            password=validated_data["password"],
        )
        # Apply invitations that were sent to this email before it had an account
        from documents.models import Invitation, Membership
        for inv in Invitation.objects.filter(email__iexact=email):
            Membership.objects.get_or_create(
                document=inv.document, user=user, defaults={"role": inv.role}
            )
        Invitation.objects.filter(email__iexact=email).delete()
        return user


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Login with email + password; response also includes the user's profile."""

    username_field = "email"

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data
