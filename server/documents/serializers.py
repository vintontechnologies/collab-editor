from rest_framework import serializers

from .models import Document

LANGUAGES = ["javascript", "python", "java", "cpp", "html"]


class DocumentSerializer(serializers.ModelSerializer):
    # The current user's role on this document (annotated in the view)
    my_role = serializers.CharField(read_only=True)
    owner_name = serializers.CharField(source="owner.name", read_only=True)
    language = serializers.ChoiceField(choices=LANGUAGES, required=False)

    class Meta:
        model = Document
        fields = ["id", "title", "doc_type", "language", "my_role",
                  "owner_name", "link_role", "created_at", "updated_at"]
        read_only_fields = ["id", "link_role", "created_at", "updated_at"]

    def validate_doc_type(self, value):
        # A code document can't be turned into a whiteboard (or the reverse)
        if self.instance and value != self.instance.doc_type:
            raise serializers.ValidationError("Document type cannot be changed.")
        return value
