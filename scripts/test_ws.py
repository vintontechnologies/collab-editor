#!/usr/bin/env python3
"""WebSocket test: auth, roles, relay, persistence. Server must run on :8001."""
import asyncio
import json
import sys
import urllib.error
import urllib.request

import websockets

HTTP = "http://127.0.0.1:8001/api"
WS = "ws://127.0.0.1:8001/ws/documents"
PW = "StrongPass#2026"
ORIGIN = "http://localhost:5173"
failures = 0


def call(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(HTTP + path, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, None


def login(email):
    return call("POST", "/auth/login/", {"email": email, "password": PW})[1]["access"]


def check(label, ok):
    global failures
    print(("PASS  " if ok else "FAIL  ") + label)
    if not ok:
        failures += 1


async def connect(doc_id, token):
    return await websockets.connect(f"{WS}/{doc_id}/?token={token}", origin=ORIGIN)


async def recv(ws, timeout=2.0):
    try:
        return await asyncio.wait_for(ws.recv(), timeout)
    except asyncio.TimeoutError:
        return None


async def drain_until_synced(ws):
    """Collect stored updates until the 'synced' message (type 2) arrives."""
    got = []
    while True:
        m = await recv(ws, 3)
        if m is None:
            return got, False
        if m[:1] == b"\x02":
            return got, True
        got.append(m)


async def rejected(url):
    """True if the server refuses the connection (handshake error or immediate close)."""
    try:
        ws = await websockets.connect(url, origin=ORIGIN)
    except Exception:
        return True
    try:
        await asyncio.wait_for(ws.recv(), 2)
        await ws.close()
        return False
    except websockets.exceptions.ConnectionClosed:
        return True
    except asyncio.TimeoutError:
        await ws.close()
        return False


async def main():
    for u in ("viewer", "outsider"):
        call("POST", "/auth/register/", {"email": f"{u}@example.com", "name": u, "password": PW})
    owner, viewer, outsider = (
        login("test@example.com"), login("viewer@example.com"), login("outsider@example.com"))

    _, doc = call("POST", "/documents/", {"title": "WS test", "doc_type": "code",
                                           "language": "python"}, owner)
    doc_id = doc["id"]
    call("POST", f"/documents/{doc_id}/members/", {"email": "viewer@example.com",
                                                   "role": "viewer"}, owner)

    print("--- Authentication")
    check("no token is rejected", await rejected(f"{WS}/{doc_id}/"))
    check("invalid token is rejected", await rejected(f"{WS}/{doc_id}/?token=garbage"))
    check("non-member is rejected", await rejected(f"{WS}/{doc_id}/?token={outsider}"))

    print("--- Real-time relay")
    ws_owner = await connect(doc_id, owner)
    got, synced = await drain_until_synced(ws_owner)
    check("owner connects, empty document, gets 'synced'", synced and not got)

    ws_viewer = await connect(doc_id, viewer)
    got, synced = await drain_until_synced(ws_viewer)
    check("viewer connects and gets 'synced'", synced)
    join = await recv(ws_owner)
    check("owner is told that the viewer joined", join is not None and join[0] == 4)

    await ws_owner.send(b"\x00update-from-owner")
    check("viewer receives the owner's edit", await recv(ws_viewer) == b"\x00update-from-owner")

    print("--- Server-side viewer restriction")
    await ws_viewer.send(b"\x00evil-update")
    reply = await recv(ws_viewer)
    check("viewer's edit is rejected with an error", reply is not None and reply[0] == 3)
    check("owner never receives the viewer's edit", await recv(ws_owner, 1) is None)
    await ws_viewer.send(b"\x01cursor-state")
    check("viewer's cursor reaches the owner", await recv(ws_owner) == b"\x01cursor-state")

    print("--- Presence and persistence")
    await ws_viewer.close()
    leave = await recv(ws_owner)
    check("owner is told that the viewer left", leave is not None and leave[0] == 5)

    ws_again = await connect(doc_id, viewer)
    got, synced = await drain_until_synced(ws_again)
    check("a new connection receives only the stored (accepted) edit",
          got == [b"\x00update-from-owner"] and synced)

    for ws in (ws_owner, ws_again):
        await ws.close()
    check("cleanup: owner deletes the document",
          call("DELETE", f"/documents/{doc_id}/", token=owner)[0] == 204)


asyncio.run(main())
sys.exit(1 if failures else 0)
