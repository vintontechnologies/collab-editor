#!/usr/bin/env bash
# Sharing test: invites, role changes, share link, removal. Server must run on :8001.
# BASE=http://127.0.0.1:8001/api
BASE=https://collab-editor-w8ni.onrender.com/api
PW='StrongPass#2026'
H='Content-Type: application/json'

login() {
  curl -s -X POST $BASE/auth/login/ -H "$H" -d "{\"email\":\"$1\",\"password\":\"$PW\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['access'])"
}
auth() { echo "Authorization: Bearer $1"; }
jget() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }
req() {  # runs curl; sets CODE (status) and BODY (response)
  local out; out=$(curl -s -w "\n%{http_code}" "$@")
  CODE=$(echo "$out" | tail -n 1); BODY=$(echo "$out" | sed '$d')
}
check() {
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; else echo "FAIL  $1 (expected $2, got $3)"; fi
}

for u in viewer outsider; do
  curl -s -X POST $BASE/auth/register/ -H "$H" \
    -d "{\"email\":\"$u@example.com\",\"name\":\"$u\",\"password\":\"$PW\"}" > /dev/null
done
OWNER=$(login test@example.com); VIEWER=$(login viewer@example.com); OUT=$(login outsider@example.com)
[ -z "$OWNER" ] || [ -z "$VIEWER" ] || [ -z "$OUT" ] && { echo "Login failed. Is the server running on 8001?"; exit 1; }

req -X POST $BASE/documents/ -H "$(auth $OWNER)" -H "$H" \
  -d '{"title":"Share test","doc_type":"code","language":"python"}'
DOC=$(echo "$BODY" | jget "['id']"); D=$BASE/documents/$DOC
echo "Created document $DOC"; echo

echo "--- Invites and roles"
req -X POST $D/members/ -H "$(auth $OWNER)" -H "$H" -d '{"email":"viewer@example.com","role":"viewer"}'
check "owner invites existing user as viewer" 201 "$CODE"
VIEWER_ID=$(echo "$BODY" | jget "['user_id']")
req $D/ -H "$(auth $VIEWER)";                                   check "invited viewer can read" 200 "$CODE"
req -X PATCH $D/ -H "$(auth $VIEWER)" -H "$H" -d '{"title":"x"}'; check "viewer cannot rename" 403 "$CODE"
req -X POST $D/members/ -H "$(auth $VIEWER)" -H "$H" -d '{"email":"outsider@example.com","role":"viewer"}'
check "viewer cannot invite" 403 "$CODE"
req $D/members/ -H "$(auth $OUT)";                              check "outsider cannot list members" 404 "$CODE"
req $D/members/ -H "$(auth $VIEWER)";                           check "member can list members" 200 "$CODE"
req -X PATCH $D/members/$VIEWER_ID/ -H "$(auth $OWNER)" -H "$H" -d '{"role":"editor"}'
check "owner promotes viewer to editor" 200 "$CODE"
req -X PATCH $D/ -H "$(auth $VIEWER)" -H "$H" -d '{"language":"java"}'
check "editor can change language" 200 "$CODE"
req -X PATCH $D/ -H "$(auth $VIEWER)" -H "$H" -d '{"title":"x"}'; check "editor cannot rename" 403 "$CODE"
req -X DELETE $D/ -H "$(auth $VIEWER)";                         check "editor cannot delete" 403 "$CODE"
req -X POST $D/members/ -H "$(auth $OWNER)" -H "$H" -d '{"email":"outsider@example.com","role":"owner"}'
check "owner role cannot be handed out" 400 "$CODE"

echo; echo "--- Share link"
req -X POST $BASE/documents/join/$DOC/ -H "$(auth $OUT)";       check "join while link is off" 404 "$CODE"
req -X PUT $D/link/ -H "$(auth $VIEWER)" -H "$H" -d '{"role":"editor"}'
check "editor cannot change link" 403 "$CODE"
req -X PUT $D/link/ -H "$(auth $OWNER)" -H "$H" -d '{"role":"viewer"}'
check "owner turns link on (viewer)" 200 "$CODE"
req -X POST $BASE/documents/join/$DOC/ -H "$(auth $OUT)";       check "outsider joins via link" 201 "$CODE"
req $D/ -H "$(auth $OUT)";                                      check "link member can read" 200 "$CODE"
req -X PATCH $D/ -H "$(auth $OUT)" -H "$H" -d '{"title":"x"}'; check "link viewer cannot rename" 403 "$CODE"
req -X POST $BASE/documents/join/$DOC/ -H "$(auth $OUT)";       check "joining twice is harmless" 200 "$CODE"

echo; echo "--- Invite someone who has no account yet"
NEW="newcomer$(date +%s)@example.com"
req -X POST $D/members/ -H "$(auth $OWNER)" -H "$H" -d "{\"email\":\"$NEW\",\"role\":\"editor\"}"
check "invite unregistered email" 201 "$CODE"
req -X POST $BASE/auth/register/ -H "$H" -d "{\"email\":\"$NEW\",\"name\":\"Newcomer\",\"password\":\"$PW\"}"
check "that person registers" 201 "$CODE"
NEWTOK=$(login $NEW)
req $D/ -H "$(auth $NEWTOK)"
check "new user already has the document" 200 "$CODE"
check "invited role was applied" editor "$(echo "$BODY" | jget "['my_role']")"

echo; echo "--- Removal"
req -X DELETE $D/members/$VIEWER_ID/ -H "$(auth $OWNER)";       check "owner removes a member" 204 "$CODE"
req $D/ -H "$(auth $VIEWER)";                                   check "removed member loses access" 404 "$CODE"
OWNER_ID=$(curl -s $BASE/auth/me/ -H "$(auth $OWNER)" | jget "['id']")
req -X DELETE $D/members/$OWNER_ID/ -H "$(auth $OWNER)";        check "owner cannot be removed" 400 "$CODE"
req -X DELETE $D/ -H "$(auth $OWNER)";                          check "cleanup: owner deletes document" 204 "$CODE"
