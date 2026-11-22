# Real-Time Collaborative Code & Whiteboard Editor

Multiple people edit the same code file or whiteboard at once. Every change appears on
everyone's screen immediately, with live cursors, an online-users panel, role-based
sharing (Owner / Editor / Viewer) and a version history you can preview and restore.

Built for the IT-Simplera Solutions Full Stack Development Internship (Batch 02, Project 01).

- **Live demo:** https://collab-editor-w8ni.onrender.com
  (free hosting: after a long idle period the first load can take up to a minute while the service wakes)
- **API docs (Swagger):** https://collab-editor-w8ni.onrender.com/api/docs/

## Features

- **Authentication:** register, login, logout; hashed passwords; JWT access and refresh tokens;
  logout blacklists the refresh token.
- **Documents:** create, rename, delete, duplicate; code or whiteboard; dashboard of owned and shared documents.
- **Sharing:** invite by email with a role, change or remove members, or share a link. Roles are
  enforced on the server, including on the WebSocket.
- **Real-time collaboration:** CRDT-based (Yjs), so simultaneous edits merge without data loss.
  Live cursors with names and colors, online users panel, offline edits sync on reconnect.
- **Code editor:** CodeMirror with syntax highlighting (JavaScript, Python, Java, C++, HTML),
  line numbers, auto-indent, bracket matching, language switcher, automatic saving.
- **Whiteboard:** pen, rectangle, circle, arrow and text; color and stroke width; move, resize,
  delete; zoom and pan; undo and redo; real-time sync and persistence.
- **Version history:** automatic snapshots every 30 seconds or 50 changes; timeline with author and
  time; read-only preview; restore creates a new version, so history is never lost.
- **Deployment:** Docker and Docker Compose; also deployed as a single container on Render.

## Architecture

```
Browser (React + TypeScript + Yjs)
   |  HTTPS: REST API (/api)            WebSocket: Yjs updates and cursors (/ws)
   v
Nginx (serves the React build, proxies /api and /ws)
   v
Django + Django Channels (Daphne)  --- Redis (pub/sub between server instances)
   v
PostgreSQL (users, documents, members, edit log, versions)
```

The server never interprets document contents. It authorizes each message, relays it to the other
users through Redis, and stores it in an append-only edit log. A version is a bookmark in that log,
so restoring one never deletes anything. The first byte of each binary WebSocket message says what
it is (edit, cursor, synced, error, join, leave, version).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, CodeMirror 6, Yjs |
| Backend | Django, Django REST Framework, Django Channels, SimpleJWT |
| Real-time | WebSockets, Yjs (CRDT), Redis channel layer |
| Database | PostgreSQL |
| DevOps | Docker, Docker Compose, Nginx, Render |
| Testing | Django test runner (33 tests, 91% coverage), k6 load test |

## Project structure

```
client/                 React app (components/, pages/, context/, services/, data/, assets/)
server/
  config/               settings, URLs, ASGI routing
  users/                authentication and profile
  documents/            documents, sharing, versions, WebSocket consumer
scripts/                end-to-end test scripts (roles, sharing, WebSocket)
loadtest/               k6 load test and recorded results
docker-compose.yml      database, Redis, backend, Nginx
render.yaml             Render deployment Blueprint
```

## Run it locally

Requires Docker.

```bash
git clone https://github.com/vintontechnologies/collab-editor.git
cd collab-editor
cp .env.example .env
# put a long random value in SECRET_KEY:   openssl rand -hex 32
docker compose up -d --build
```

Open http://localhost:8080 (change `WEB_PORT` in `.env` if that port is taken).
Swagger docs are at `/api/docs/`.

### Development without Docker for the app

```bash
docker compose up -d db redis               # database and Redis only
cd server && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
echo "DB_PORT=5433" > .env
python manage.py migrate && python manage.py runserver 8001
# in another terminal
cd client && npm install && npm run dev      # http://localhost:5173
```

## Tests

```bash
cd server
python manage.py test                        # 33 tests: auth, roles, sharing, versions, WebSocket
coverage run --source=users,documents manage.py test && coverage report
```

Result: 33 tests pass, 91% coverage. The scripts in `scripts/` also test roles, sharing and the
WebSocket against a running server (for example `HOST=127.0.0.1:8080 python scripts/test_ws.py`).

## Load test (k6)

```bash
docker run --rm --network host -v "$PWD/loadtest:/loadtest" -e USERS=20 -e HOST=127.0.0.1:8080 \
  grafana/k6 run /loadtest/ws_load.js
```

Many users edit one document; each edit carries its send time, so the test measures how long an
edit takes to reach the other users. Target from the brief: under 200 ms.
Measured on one laptop that also ran the load generator, Docker, Postgres and Redis:

| Run | Median | p(95) |
|---|---|---|
| 5 users, first version (edit saved to the database before it was relayed) | 166 ms | 315 ms |
| 5 users, after relaying first and saving second | 76 ms | 198 ms |
| 20 users, before reusing database connections | 274 ms | 15.7 s |
| 20 users, after reusing database connections | FILL IN | FILL IN |

Full outputs are in `loadtest/`.

## Deploy

- **Any server with Docker:** `docker compose up -d --build` as above (put a TLS proxy such as Caddy in front).
- **Render (free):** the `render.yaml` Blueprint creates the web service, database and Redis;
  `Dockerfile.render` builds one image that serves both the API and the React app.

## API

Interactive documentation: `/api/docs/` (Swagger UI). Summary:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register/` `/login/` `/refresh/` `/logout/` | Authentication |
| GET, PATCH | `/api/auth/me/` | Profile (name, avatar) |
| GET, POST | `/api/documents/` | List and create documents |
| GET, PATCH, DELETE | `/api/documents/{id}/` | Read, rename, delete |
| POST | `/api/documents/{id}/duplicate/` | Duplicate |
| GET, POST | `/api/documents/{id}/members/` | List members, invite by email |
| PATCH, DELETE | `/api/documents/{id}/members/{user_id}/` | Change role, remove or leave |
| GET, PUT | `/api/documents/{id}/link/` | Share-link settings |
| POST | `/api/documents/join/{id}/` | Join through a share link |
| GET | `/api/documents/{id}/versions/` and `/{number}/` | Timeline, one version |
| WebSocket | `/ws/documents/{id}/?token=<access token>` | Real-time collaboration |

## Known limitations

- Forgot-password by email and a profile page in the UI are not implemented (the profile API exists).
- Per-document chat and join/leave toast notifications are not implemented.
- Edits made while offline are queued in memory: they sync on reconnect, but are lost if the page
  is closed while offline.
- The edit log grows without limit; compacting old edits into snapshots would be the next step.
- If two people change the same whiteboard shape at the same instant, the last write wins for that
  shape (different shapes always merge).
- On the free Render plan the service sleeps when idle, the free database expires after 30 days,
  and invitation emails are printed in the server log instead of being delivered.
