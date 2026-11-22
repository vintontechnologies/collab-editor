# Real-Time Collaborative Code & Whiteboard Editor

A full-stack real-time collaboration platform that allows multiple users to work together on code files and digital whiteboards simultaneously. Changes are synchronized instantly across connected users, with live cursors, presence indicators, role-based permissions, and version history.

Developed for the **IT-Simplera Solutions Full Stack Development Internship – Batch 02, Project 01**.

<p align="center">
  <a href="https://collab-editor-w8ni.onrender.com"><strong>Live Demo</strong></a> •
  <a href="https://collab-editor-w8ni.onrender.com/api/docs/"><strong>API Documentation</strong></a>
</p>

---

## Overview

The application provides a shared workspace where users can create code documents or whiteboards, invite collaborators, and work together in real time.

It uses **Yjs CRDT technology** to synchronize concurrent changes while minimizing conflicts and preventing data loss during simultaneous editing.

The backend handles authentication, document management, access control, collaboration events, and persistent storage. Redis supports real-time communication, while PostgreSQL stores application data and document history.

**Deployment:** https://collab-editor-w8ni.onrender.com

> **Deployment note:** The application is hosted on Render's free infrastructure. After a period of inactivity, the first request may take up to a minute while the service starts.

## Key Features

### 1. Authentication and User Management
- User registration and login.
- Secure password hashing.
- JWT access and refresh token authentication.
- Token refresh functionality.
- Logout with refresh-token blacklisting.
- User profile management through the API.

### 2. Document Management
- Create code documents and whiteboards.
- Rename, delete, and duplicate documents.
- View documents owned by the user.
- Access documents shared by other users.
- Organize collaborative workspaces.

### 3. Role-Based Sharing and Permissions

Documents support three permission levels:

| Role | Permissions |
|---|---|
| Owner | Full document control, including sharing and member management |
| Editor | View and modify document content |
| Viewer | View document content without making changes |

Additional sharing capabilities:
- Invite collaborators using their email addresses.
- Change a collaborator's role.
- Remove collaborators.
- Configure shareable document links.
- Join documents through sharing links.
- Enforce permissions on both REST API endpoints and WebSocket connections.

### 4. Real-Time Collaboration
- Simultaneous editing by multiple users.
- Instant synchronization using WebSockets.
- Conflict-resistant editing using Yjs CRDTs.
- Live collaborator cursors with names and colors.
- Online users panel.
- Synchronization of queued offline edits after reconnecting.
- Redis-backed communication between server instances.

### 5. Collaborative Code Editor

The code editor is powered by CodeMirror 6.

Features include:
- Syntax highlighting.
- JavaScript, Python, Java, C++, and HTML support.
- Line numbering.
- Automatic indentation.
- Bracket matching.
- Programming language selection.
- Automatic saving.
- Real-time collaborative editing.

### 6. Interactive Whiteboard

The whiteboard provides a shared visual workspace.

Supported functionality:
- Freehand drawing.
- Rectangle and circle tools.
- Arrow and text tools.
- Custom colors and stroke widths.
- Move and resize objects.
- Delete selected objects.
- Zoom and pan.
- Undo and redo.
- Real-time synchronization.
- Persistent whiteboard content.

### 7. Version History and Recovery

The application maintains document history through automatic snapshots.

- Automatic snapshots every 30 seconds or after 50 changes.
- Version timeline.
- Author and timestamp information.
- Read-only version previews.
- Restore previous versions.
- Restoring a version creates a new version rather than deleting existing history.

This allows users to review previous work and recover earlier document states.

---

## Technology Stack

| Component | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite |
| Code Editor | CodeMirror 6 |
| Real-Time Synchronization | Yjs, CRDT |
| Backend | Python, Django, Django REST Framework |
| Authentication | SimpleJWT |
| WebSocket | Django Channels, Daphne |
| Messaging | Redis |
| Database | PostgreSQL |
| Web Server | Nginx |
| Containerization | Docker, Docker Compose |
| Deployment | Render |
| Testing | Django Test Framework, Coverage.py, k6 |

## System Architecture

```text
                  CLIENT APPLICATION
              React + TypeScript + Yjs
                         |
             HTTPS REST API / WebSocket
                         |
                         v
                  NGINX REVERSE PROXY
                  /              \
                 /                \
                v                  v
          REST API              WebSocket
                \                  /
                 \                /
                  v              v
                DJANGO + DJANGO CHANNELS
                         |
              +----------+----------+
              |                     |
              v                     v
            REDIS               POSTGRESQL
         Channel Layer       Persistent Storage
              |                     |
              v                     v
       Real-Time Events       Users, Documents,
       and Collaboration      Members, Edit Logs,
                              and Version History
```

### How Collaboration Works

1. A user authenticates and opens a document.
2. The backend verifies the user's document permissions.
3. The client establishes a WebSocket connection.
4. Yjs generates and synchronizes document updates.
5. Django Channels receives collaboration events.
6. Redis distributes events to connected collaborators.
7. Connected clients apply updates and display changes immediately.
8. The backend records document changes for persistence and version history.

The backend does not interpret the contents of code documents. It handles authorization, synchronization, event distribution, and persistence.

---

## Project Structure

```text
collab-editor/
│
├── client/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── context/
│   │   ├── services/
│   │   ├── data/
│   │   └── assets/
│   └── package.json
│
├── server/
│   ├── config/
│   │   ├── settings.py
│   │   ├── urls.py
│   │   └── ASGI routing
│   │
│   ├── users/
│   │   └── Authentication and user management
│   │
│   ├── documents/
│   │   ├── Document management
│   │   ├── Sharing and permissions
│   │   ├── Version history
│   │   └── WebSocket consumer
│   │
│   ├── manage.py
│   └── requirements.txt
│
├── scripts/
│   ├── test_roles.sh
│   ├── test_sharing.sh
│   └── test_ws.py
│
├── loadtest/
│   ├── ws_load.js
│   └── Recorded test results
│
├── docker-compose.yml
├── Dockerfile.render
├── render.yaml
├── .env.example
└── README.md
```

---

## Getting Started

### Prerequisites

To run the project locally, you need:

- Git
- Docker
- Docker Compose
- A Linux environment or compatible operating system

### 1. Clone the Repository

```bash
git clone https://github.com/vintontechnologies/collab-editor.git
cd collab-editor
```

### 2. Configure Environment Variables

Create your environment file:

```bash
cp .env.example .env
```

Generate a secure Django secret key:

```bash
openssl rand -hex 32
```

Configure the generated value as `SECRET_KEY` in your `.env` file. Ensure that the required database, Redis, and application settings are configured according to `.env.example`.

### 3. Build and Start the Application

```bash
docker compose up -d --build
```

Check running containers:

```bash
docker compose ps
```

View application logs:

```bash
docker compose logs -f
```

### 4. Access the Application

| Service | URL |
|---|---|
| Frontend | http://localhost:8080 |
| Backend API | http://localhost:8080/api/ |
| Swagger API Docs | http://localhost:8080/api/docs/ |

The default web port is `8080`. It can be changed through the `WEB_PORT` environment variable.

---

## Running Tests

The project includes backend unit tests, HTTP end-to-end tests, WebSocket integration tests, and load testing.

### 1. Backend Unit Tests

From the project root:

```bash
cd server
python manage.py test
```

The backend test suite covers authentication, document permissions, sharing, version history, and WebSocket functionality.

**Recorded test results:** 33 tests passed.

### 2. Code Coverage

```bash
coverage run --source=users,documents manage.py test
coverage report
```

**Recorded coverage:** 91%.

### 3. End-to-End Testing

The `scripts/` directory contains three independent test scripts designed to communicate with a running application.

| Script | Description |
|---|---|
| `test_roles.sh` | Tests role-based permissions over HTTP |
| `test_sharing.sh` | Runs 26 sharing functionality checks |
| `test_ws.py` | Runs 13 WebSocket functionality checks |

Run the role permission tests:

```bash
bash scripts/test_roles.sh
```

Run the sharing tests:

```bash
bash scripts/test_sharing.sh
```

Run the WebSocket tests:

```bash
python3 scripts/test_ws.py
```

The WebSocket tests can also be executed through Nginx in the Docker deployment.

**Important:** The application must be running before executing the end-to-end tests. The scripts must target the correct server address and port. For local Docker testing, use the local Nginx endpoint; for deployed testing, use the Render endpoint.

### 4. Load Testing with k6

The project includes a WebSocket load-testing script built with k6.

Run the test using Docker:

```bash
docker run --rm --network host \
  -v "$PWD/loadtest:/loadtest" \
  -e USERS=20 \
  -e HOST=127.0.0.1:8080 \
  grafana/k6 run /loadtest/ws_load.js
```

The test simulates multiple users editing the same document and measures the time taken for changes to reach other connected users.

The target performance specified in the project brief is under 200 milliseconds.

#### Recorded Performance Results

| Scenario | Median | 95th Percentile |
|---|---:|---:|
| 5 users – initial implementation | 166 ms | 315 ms |
| 5 users – optimized event relay | 76 ms | 198 ms |
| 20 users – before database connection reuse | 274 ms | 15.7 s |

The 20-user optimized result is not included in the recorded results presented here.

---

## API Documentation

Interactive API documentation is available through Swagger UI:

**[Open API Documentation](https://collab-editor-w8ni.onrender.com/api/docs/)**

### Main API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register/` | Register a user |
| POST | `/api/auth/login/` | Authenticate a user |
| POST | `/api/auth/refresh/` | Refresh JWT token |
| POST | `/api/auth/logout/` | Logout and blacklist refresh token |
| GET, PATCH | `/api/auth/me/` | Retrieve or update user profile |
| GET, POST | `/api/documents/` | List or create documents |
| GET, PATCH, DELETE | `/api/documents/{id}/` | Retrieve, update, or delete a document |
| POST | `/api/documents/{id}/duplicate/` | Duplicate a document |
| GET, POST | `/api/documents/{id}/members/` | List or invite collaborators |
| PATCH, DELETE | `/api/documents/{id}/members/{user_id}/` | Update role or remove collaborator |
| GET, PUT | `/api/documents/{id}/link/` | Retrieve or configure sharing link |
| POST | `/api/documents/join/{id}/` | Join through a sharing link |
| GET | `/api/documents/{id}/versions/` | Retrieve document versions |
| GET | `/api/documents/{id}/versions/{number}/` | Retrieve a specific version |

### WebSocket Endpoint

```text
/ws/documents/{id}/?token=<access_token>
```

The WebSocket connection supports real-time document updates, cursor synchronization, presence events, and collaboration status messages.

---

## Deployment

The project supports Docker-based deployment and hosted deployment through Render.

### Docker Deployment

The application can be deployed on a server that supports Docker and Docker Compose:

```bash
docker compose up -d --build
```

For production environments, configure HTTPS using a reverse proxy such as Nginx or Caddy, secure environment variables, and persistent database and Redis storage.

### Render Deployment

The project includes:

- `render.yaml` – Render deployment Blueprint.
- `Dockerfile.render` – Container configuration for the deployed application.

The deployment uses a single container to serve the React frontend and Django backend.

**Live Application:** https://collab-editor-w8ni.onrender.com

**API Documentation:** https://collab-editor-w8ni.onrender.com/api/docs/

---

## Known Limitations

The following limitations are currently identified:

1. Password recovery through email is not implemented.
2. A dedicated profile page is not implemented in the frontend, although the profile API is available.
3. Per-document chat and join/leave toast notifications are not implemented.
4. Offline edits are queued in memory and synchronized after reconnection. Closing the page while offline can result in losing unsynchronized edits.
5. The edit log grows over time. Log compaction and snapshot-based cleanup would improve long-term storage efficiency.
6. Simultaneous changes to the same whiteboard shape use last-write-wins behavior. Changes to different shapes can merge independently.
7. On the free Render plan, services may sleep after inactivity, the free database has a limited lifetime, and invitation emails are logged on the server rather than delivered.

---

## Future Improvements

Potential improvements include:

- Email-based password recovery.
- Persistent offline editing using IndexedDB.
- Document chat and collaboration notifications.
- More advanced whiteboard collaboration conflict resolution.
- Edit-log compaction and database optimization.
- Automated invitation email delivery.
- Expanded load testing and performance monitoring.
- Additional programming languages and editor features.

---

## Security Considerations

The application incorporates several security measures:

- Password hashing through Django authentication.
- JWT-based authentication.
- Refresh-token blacklisting on logout.
- Server-side role and permission enforcement.
- WebSocket authorization.
- Environment-based configuration for sensitive credentials.
- Database-backed document and user management.

Users must have the appropriate permissions before accessing or modifying shared documents.

---

## Project Information

| Detail | Information |
|---|---|
| Project | Real-Time Collaborative Code & Whiteboard Editor |
| Organization | IT-Simplera Solutions |
| Internship | Full Stack Development Internship |
| Batch | Batch 02 |
| Project Number | Project 01 |
| Frontend | React and TypeScript |
| Backend | Django REST Framework |
| Real-Time Engine | WebSockets and Yjs |
| Database | PostgreSQL |
| Deployment | Render and Docker |

## Author

**Vinton Technologies**

GitHub Repository: https://github.com/vintontechnologies/collab-editor

Live Application: https://collab-editor-w8ni.onrender.com

---

<p align="center">
  <strong>Real-Time Collaboration. Seamless Synchronization. Shared Productivity.</strong>
</p>
