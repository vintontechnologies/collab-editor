#!/usr/bin/env bash
# Role-based access test for the documents API. Needs the server on :8001 and the venv active.
BASE=http://127.0.0.1:8001/api
PW='StrongPass#2026'
H='Content-Type: application/json'
SERVER_DIR="$(cd "$(dirname "$0")/../server" && pwd)"

login() {
  curl -s -X POST $BASE/auth/login/ -H "$H" \
    -d "{\"email\":\"$1\",\"password\":\"$PW\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['access'])"
}
http_code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
check() {  # label expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; else echo "FAIL  $1 (expected $2, got $3)"; fi
}

# users (a repeat registration just returns 400, which is fine)
for u in viewer outsider; do
  curl -s -X POST $BASE/auth/register/ -H "$H" \
    -d "{\"email\":\"$u@example.com\",\"name\":\"$u\",\"password\":\"$PW\"}" > /dev/null
done
OWNER=$(login test@example.com)
VIEWER=$(login viewer@example.com)
OUT=$(login outsider@example.com)
[ -z "$OWNER" ] || [ -z "$VIEWER" ] || [ -z "$OUT" ] && { echo "Login failed. Is the server running on 8001?"; exit 1; }

# owner creates a document
DOC=$(curl -s -X POST $BASE/documents/ -H "Authorization: Bearer $OWNER" -H "$H" \
  -d '{"title":"Role test doc","doc_type":"code","language":"python"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Created document $DOC"

# sharing isn't built yet, so grant the viewer role directly in the database
(cd "$SERVER_DIR" && DOC="$DOC" "$SERVER_DIR/venv/bin/python" manage.py shell << 'PYEOF'
import os
from documents.models import Document, Membership
from users.models import User
d = Document.objects.get(pk=os.environ["DOC"])
u = User.objects.get(email="viewer@example.com")
Membership.objects.get_or_create(document=d, user=u, defaults={"role": "viewer"})
PYEOF
)

D=$BASE/documents/$DOC/
check "viewer reads"       200 "$(http_code $D -H "Authorization: Bearer $VIEWER")"
check "viewer renames"     403 "$(http_code -X PATCH $D -H "Authorization: Bearer $VIEWER" -H "$H" -d '{"title":"hacked"}')"
check "viewer deletes"     403 "$(http_code -X DELETE $D -H "Authorization: Bearer $VIEWER")"
check "viewer duplicates"  201 "$(http_code -X POST ${D}duplicate/ -H "Authorization: Bearer $VIEWER")"
check "outsider reads"     404 "$(http_code $D -H "Authorization: Bearer $OUT")"
check "no token"           401 "$(http_code $BASE/documents/)"
check "owner renames"      200 "$(http_code -X PATCH $D -H "Authorization: Bearer $OWNER" -H "$H" -d '{"title":"Renamed"}')"
check "owner duplicates"   201 "$(http_code -X POST ${D}duplicate/ -H "Authorization: Bearer $OWNER")"
echo; echo "Viewer's document list:"
curl -s $BASE/documents/ -H "Authorization: Bearer $VIEWER" | python3 -m json.tool
check "owner deletes"      204 "$(http_code -X DELETE $D -H "Authorization: Bearer $OWNER")"
