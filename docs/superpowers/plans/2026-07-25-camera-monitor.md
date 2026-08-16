# Camera Monitor (« Veille bébé ») Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an old phone into a live baby monitor: it streams video+audio over WebRTC to any other device already logged into the app on the same wifi, and viewers can freeze a snapshot saved as a souvenir photo.

**Architecture:** Media travels peer-to-peer (WebRTC); the FastAPI backend is only a signaling relay over a WebSocket at `/rtc`, gated by the existing `bm_auth` cookie. Signaling state is a pure in-memory `CameraHub` object with no I/O, so every rule (single camera, takeover, viewer cap, message size) is unit-testable without a server or DB. Snapshots are captured client-side and stored as `bytea` rows in Postgres so the existing `pg_dump` deploy backup covers them.

**Tech Stack:** FastAPI + Starlette WebSockets, asyncpg raw SQL, Next.js 16 (App Router, `frontend/`), React 19, TanStack Query v5, next-intl v4, Tailwind 4 semantic tokens, native WebRTC/`getUserMedia`/Wake Lock (no new npm or Python dependency).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-25-camera-monitor-design.md`. Repo path contains a space — always quote `"/Users/lorenzo/Desktop/Projects /baby_marks"`.
- Backend tests: `cd backend && uv run pytest` (NEVER bare `python3 -m pytest`). Frontend: `cd frontend && npx vitest run` and `npx tsc --noEmit`. Current baseline: 79 backend tests (with `BM_TEST_DATABASE_URL=postgresql://baby:baby@localhost:5432/baby_marks` and `docker compose up -d db`), 9 frontend tests. Every task keeps all of them green.
- **CI is now the deploy gate** (`.github/workflows/deploy.yml`): a red test job blocks production. Never commit a failing suite.
- **No new dependencies** — Python or npm. WebRTC, Wake Lock, canvas and JPEG parsing are all done with what is already available.
- Signaling protocol message shapes are fixed by the spec — copy them verbatim (`hello`, `watch`, `signal`, `takeover`, `stop`, `ping` client→server; `welcome`, `camera_changed`, `viewer_joined`, `viewer_left`, `signal`, `error`, `pong` server→client). Error codes are exactly: `camera_busy`, `no_camera`, `too_many_viewers`, `bad_message`.
- Limits: 1 active camera, `MAX_VIEWERS = 4`, `MAX_MESSAGE_BYTES = 64 * 1024`, device name ≤ 40 chars, photo upload ≤ 2 MiB, photo retention 200 rows.
- API JSON is camelCase (`takenAt`, not `taken_at`) — see `backend/app/serializers.py`. Errors use `ApiError(status, "code")` → `{"error": "code"}`.
- All new user-visible strings are i18n keys **mirrored in `frontend/src/messages/fr.json` and `en.json`** (fr is the default locale). Never hardcode French or English in a component.
- The MCP server is NOT touched: no camera/photo tool, no change to `backend/app/mcp/**`.
- Photo endpoints live under `/api/**` (internal surface, reached through the frontend rewrite). Only `/rtc` is added to the public Traefik rule.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `CameraHub` — pure signaling logic

**Files:**
- Create: `backend/app/camera/__init__.py` (empty file)
- Create: `backend/app/camera/hub.py`
- Test: `backend/tests/test_camera_hub.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `MAX_VIEWERS = 4`, `MAX_MESSAGE_BYTES = 65536`, `MAX_NAME_LEN = 40`, `oversized(raw: str) -> bool`, `@dataclass Action(to: str, payload: dict)`, `class CameraHub` with methods `connect(peer_id: str) -> list[Action]`, `handle(peer_id: str, message: dict, now: float) -> list[Action]`, `disconnect(peer_id: str) -> list[Action]`. All synchronous, no I/O, no DB. Task 2's WebSocket layer is the only caller.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_camera_hub.py`:

```python
"""Pure unit tests for the signaling hub: no server, no DB, no sockets."""

from app.camera.hub import MAX_MESSAGE_BYTES, MAX_VIEWERS, Action, CameraHub, oversized


def payloads_for(actions: list[Action], peer: str) -> list[dict]:
    return [a.payload for a in actions if a.to == peer]


def make_camera(hub: CameraHub, peer_id: str = "cam", name: str = "Chambre") -> list[Action]:
    hub.connect(peer_id)
    return hub.handle(peer_id, {"type": "hello", "role": "camera", "name": name}, now=100.0)


def test_connect_welcomes_with_no_camera():
    hub = CameraHub()
    actions = hub.connect("v1")
    assert actions == [Action(to="v1", payload={"type": "welcome", "peerId": "v1", "camera": None})]


def test_hello_camera_announces_to_everyone():
    hub = CameraHub()
    hub.connect("v1")
    actions = make_camera(hub)
    for peer in ("cam", "v1"):
        assert payloads_for(actions, peer) == [
            {"type": "camera_changed", "camera": {"id": "cam", "name": "Chambre", "since": 100.0}}
        ]


def test_connect_after_camera_welcomes_with_current_camera():
    hub = CameraHub()
    make_camera(hub)
    actions = hub.connect("v1")
    assert actions[0].payload["camera"] == {"id": "cam", "name": "Chambre", "since": 100.0}


def test_second_camera_is_refused_with_camera_busy():
    hub = CameraHub()
    make_camera(hub)
    hub.connect("cam2")
    actions = hub.handle("cam2", {"type": "hello", "role": "camera", "name": "Salon"}, now=200.0)
    assert actions == [Action(to="cam2", payload={"type": "error", "code": "camera_busy"})]
    assert hub.camera_id == "cam"


def test_takeover_replaces_camera_and_notifies_all():
    hub = CameraHub()
    make_camera(hub)
    hub.connect("cam2")
    actions = hub.handle("cam2", {"type": "takeover", "name": "Salon"}, now=200.0)
    expected = {"type": "camera_changed", "camera": {"id": "cam2", "name": "Salon", "since": 200.0}}
    assert payloads_for(actions, "cam") == [expected]
    assert payloads_for(actions, "cam2") == [expected]
    assert hub.camera_id == "cam2"


def test_watch_notifies_camera_only():
    hub = CameraHub()
    make_camera(hub)
    hub.connect("v1")
    actions = hub.handle("v1", {"type": "watch"}, now=300.0)
    assert actions == [Action(to="cam", payload={"type": "viewer_joined", "peerId": "v1"})]


def test_watch_without_camera_errors():
    hub = CameraHub()
    hub.connect("v1")
    actions = hub.handle("v1", {"type": "watch"}, now=300.0)
    assert actions == [Action(to="v1", payload={"type": "error", "code": "no_camera"})]


def test_viewer_cap_is_enforced():
    hub = CameraHub()
    make_camera(hub)
    for i in range(MAX_VIEWERS):
        hub.connect(f"v{i}")
        assert hub.handle(f"v{i}", {"type": "watch"}, now=300.0)[0].payload["type"] == "viewer_joined"
    hub.connect("extra")
    actions = hub.handle("extra", {"type": "watch"}, now=300.0)
    assert actions == [Action(to="extra", payload={"type": "error", "code": "too_many_viewers"})]


def test_signal_is_relayed_only_to_its_target():
    hub = CameraHub()
    make_camera(hub)
    hub.connect("v1")
    hub.connect("v2")
    hub.handle("v1", {"type": "watch"}, now=300.0)
    actions = hub.handle("cam", {"type": "signal", "to": "v1", "data": {"sdp": "x"}}, now=301.0)
    assert actions == [
        Action(to="v1", payload={"type": "signal", "from": "cam", "data": {"sdp": "x"}})
    ]


def test_signal_to_unknown_peer_errors():
    hub = CameraHub()
    make_camera(hub)
    actions = hub.handle("cam", {"type": "signal", "to": "ghost", "data": {}}, now=301.0)
    assert actions == [Action(to="cam", payload={"type": "error", "code": "bad_message"})]


def test_camera_disconnect_clears_state_and_notifies():
    hub = CameraHub()
    make_camera(hub)
    hub.connect("v1")
    hub.handle("v1", {"type": "watch"}, now=300.0)
    actions = hub.disconnect("cam")
    assert payloads_for(actions, "v1") == [{"type": "camera_changed", "camera": None}]
    assert hub.camera_id is None
    # The freed slot is reusable: a new camera can take over immediately.
    hub.connect("cam2")
    assert hub.handle("cam2", {"type": "hello", "role": "camera", "name": "B"}, now=400.0)


def test_viewer_disconnect_frees_a_slot_and_notifies_camera():
    hub = CameraHub()
    make_camera(hub)
    hub.connect("v1")
    hub.handle("v1", {"type": "watch"}, now=300.0)
    actions = hub.disconnect("v1")
    assert actions == [Action(to="cam", payload={"type": "viewer_left", "peerId": "v1"})]


def test_viewer_stop_frees_a_slot_without_disconnecting():
    hub = CameraHub()
    make_camera(hub)
    hub.connect("v1")
    hub.handle("v1", {"type": "watch"}, now=300.0)
    actions = hub.handle("v1", {"type": "stop"}, now=310.0)
    assert actions == [Action(to="cam", payload={"type": "viewer_left", "peerId": "v1"})]
    # ...and watching again works.
    assert hub.handle("v1", {"type": "watch"}, now=320.0)[0].payload["type"] == "viewer_joined"


def test_camera_stop_clears_the_camera():
    hub = CameraHub()
    make_camera(hub)
    hub.connect("v1")
    actions = hub.handle("cam", {"type": "stop"}, now=310.0)
    assert payloads_for(actions, "v1") == [{"type": "camera_changed", "camera": None}]
    assert hub.camera_id is None


def test_ping_gets_pong():
    hub = CameraHub()
    hub.connect("v1")
    assert hub.handle("v1", {"type": "ping"}, now=1.0) == [
        Action(to="v1", payload={"type": "pong"})
    ]


def test_unknown_and_malformed_messages_error():
    hub = CameraHub()
    hub.connect("v1")
    for message in ({"type": "nope"}, {}, {"type": "hello", "role": "spy"}):
        assert hub.handle("v1", message, now=1.0) == [
            Action(to="v1", payload={"type": "error", "code": "bad_message"})
        ]


def test_unknown_sender_is_ignored():
    hub = CameraHub()
    assert hub.handle("ghost", {"type": "watch"}, now=1.0) == []


def test_device_name_is_trimmed_and_capped():
    hub = CameraHub()
    hub.connect("cam")
    actions = hub.handle(
        "cam", {"type": "hello", "role": "camera", "name": "  " + "x" * 60 + "  "}, now=1.0
    )
    assert actions[0].payload["camera"]["name"] == "x" * 40


def test_blank_name_falls_back_to_default():
    hub = CameraHub()
    hub.connect("cam")
    actions = hub.handle("cam", {"type": "hello", "role": "camera", "name": "   "}, now=1.0)
    assert actions[0].payload["camera"]["name"] == "Camera"


def test_oversized_predicate():
    assert oversized("a" * MAX_MESSAGE_BYTES) is False
    assert oversized("a" * (MAX_MESSAGE_BYTES + 1)) is True
    # Byte length, not character count: a 2-byte character counts twice.
    assert oversized("é" * (MAX_MESSAGE_BYTES // 2 + 1)) is True
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/backend" && uv run pytest tests/test_camera_hub.py -q
```

Expected: collection error — `ModuleNotFoundError: No module named 'app.camera'`.

- [ ] **Step 3: Implement the hub**

Create `backend/app/camera/__init__.py` (empty), then `backend/app/camera/hub.py`:

```python
"""In-memory signaling state for the camera monitor.

Deliberately pure: no sockets, no awaits, no DB. Every method returns the
list of messages the transport layer should deliver, which is what makes the
rules (single camera, takeover, viewer cap, relay targeting) testable without
a running server. `app/camera/ws.py` is the only caller.
"""

from dataclasses import dataclass

MAX_VIEWERS = 4
MAX_MESSAGE_BYTES = 64 * 1024
MAX_NAME_LEN = 40
DEFAULT_NAME = "Camera"


def oversized(raw: str) -> bool:
    """True when a raw frame exceeds the size cap (bytes, not characters)."""
    return len(raw.encode("utf-8")) > MAX_MESSAGE_BYTES


@dataclass(frozen=True)
class Action:
    """One message to deliver to one peer."""

    to: str
    payload: dict


def _clean_name(value: object) -> str:
    if not isinstance(value, str):
        return DEFAULT_NAME
    name = value.strip()[:MAX_NAME_LEN]
    return name or DEFAULT_NAME


class CameraHub:
    def __init__(self) -> None:
        self._peers: set[str] = set()
        self.camera_id: str | None = None
        self._camera_name: str = DEFAULT_NAME
        self._camera_since: float = 0.0
        self._watchers: set[str] = set()

    # -- state helpers -------------------------------------------------
    def _camera_info(self) -> dict | None:
        if self.camera_id is None:
            return None
        return {"id": self.camera_id, "name": self._camera_name, "since": self._camera_since}

    def _broadcast(self, payload: dict) -> list[Action]:
        return [Action(to=peer, payload=payload) for peer in sorted(self._peers)]

    def _error(self, peer_id: str, code: str) -> list[Action]:
        return [Action(to=peer_id, payload={"type": "error", "code": code})]

    def _set_camera(self, peer_id: str, name: object, now: float) -> list[Action]:
        self.camera_id = peer_id
        self._camera_name = _clean_name(name)
        self._camera_since = now
        self._watchers.discard(peer_id)
        return self._broadcast({"type": "camera_changed", "camera": self._camera_info()})

    def _clear_camera(self) -> list[Action]:
        self.camera_id = None
        self._camera_name = DEFAULT_NAME
        self._camera_since = 0.0
        self._watchers.clear()
        return self._broadcast({"type": "camera_changed", "camera": None})

    # -- lifecycle -----------------------------------------------------
    def connect(self, peer_id: str) -> list[Action]:
        self._peers.add(peer_id)
        return [
            Action(
                to=peer_id,
                payload={"type": "welcome", "peerId": peer_id, "camera": self._camera_info()},
            )
        ]

    def disconnect(self, peer_id: str) -> list[Action]:
        if peer_id not in self._peers:
            return []
        self._peers.discard(peer_id)
        if peer_id == self.camera_id:
            return self._clear_camera()
        return self._leave(peer_id)

    def _leave(self, peer_id: str) -> list[Action]:
        if peer_id not in self._watchers:
            return []
        self._watchers.discard(peer_id)
        if self.camera_id is None:
            return []
        return [Action(to=self.camera_id, payload={"type": "viewer_left", "peerId": peer_id})]

    # -- messages ------------------------------------------------------
    def handle(self, peer_id: str, message: dict, now: float) -> list[Action]:
        if peer_id not in self._peers:
            return []
        if not isinstance(message, dict):
            return self._error(peer_id, "bad_message")
        kind = message.get("type")

        if kind == "ping":
            return [Action(to=peer_id, payload={"type": "pong"})]

        if kind == "hello":
            role = message.get("role")
            if role == "viewer":
                return []
            if role != "camera":
                return self._error(peer_id, "bad_message")
            if self.camera_id is not None and self.camera_id != peer_id:
                return self._error(peer_id, "camera_busy")
            return self._set_camera(peer_id, message.get("name"), now)

        if kind == "takeover":
            return self._set_camera(peer_id, message.get("name"), now)

        if kind == "watch":
            if self.camera_id is None:
                return self._error(peer_id, "no_camera")
            if peer_id == self.camera_id:
                return self._error(peer_id, "bad_message")
            if peer_id not in self._watchers and len(self._watchers) >= MAX_VIEWERS:
                return self._error(peer_id, "too_many_viewers")
            self._watchers.add(peer_id)
            return [Action(to=self.camera_id, payload={"type": "viewer_joined", "peerId": peer_id})]

        if kind == "stop":
            if peer_id == self.camera_id:
                return self._clear_camera()
            return self._leave(peer_id)

        if kind == "signal":
            target = message.get("to")
            data = message.get("data")
            if not isinstance(target, str) or target not in self._peers or data is None:
                return self._error(peer_id, "bad_message")
            return [
                Action(to=target, payload={"type": "signal", "from": peer_id, "data": data})
            ]

        return self._error(peer_id, "bad_message")
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/backend" && uv run pytest tests/test_camera_hub.py -q
```

Expected: all tests pass (20 tests).

- [ ] **Step 5: Run the full backend suite**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/backend" && BM_TEST_DATABASE_URL=postgresql://baby:baby@localhost:5432/baby_marks uv run pytest -q
```

Expected: 99 passed (79 baseline + 20 new). If Docker isn't running, start the dev DB first: `cd "/Users/lorenzo/Desktop/Projects /baby_marks" && docker compose up -d db`.

- [ ] **Step 6: Commit**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
git add backend/app/camera backend/tests/test_camera_hub.py
git commit -m "feat(camera): pure in-memory signaling hub

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `/rtc` WebSocket endpoint + Traefik exposure

**Files:**
- Create: `backend/app/camera/ws.py`
- Modify: `backend/app/auth.py` (widen `is_authed` to accept a WebSocket too)
- Modify: `backend/app/main.py` (include the new router, before the catch-all mount)
- Modify: `docker-compose.prod.yml` (add `/rtc` to the backend's Traefik rule)
- Test: `backend/tests/test_camera_ws.py`

**Interfaces:**
- Consumes: `CameraHub`, `Action`, `oversized`, `MAX_MESSAGE_BYTES` from `app.camera.hub`; `is_authed` from `app.auth`.
- Produces: `router` (an `APIRouter` with a `/rtc` websocket route) and the module-level `hub` singleton, both importable from `app.camera.ws`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_camera_ws.py`:

```python
"""WebSocket-level tests for /rtc.

These mount ONLY the camera router on a bare FastAPI app -- no lifespan, so no
database is needed and these run in every environment.
"""

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("APP_SECRET_PHRASE", "test-secret")

from app.auth import COOKIE_NAME, compute_auth_token  # noqa: E402
from app.camera import ws as camera_ws  # noqa: E402
from app.camera.hub import CameraHub  # noqa: E402


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(camera_ws.router)
    # Fresh hub + socket registry per test: the module-level singletons are
    # process-wide state that would otherwise leak between tests.
    camera_ws.hub = CameraHub()
    camera_ws._sockets.clear()
    token = compute_auth_token(os.environ["APP_SECRET_PHRASE"])
    with TestClient(app, cookies={COOKIE_NAME: token}) as c:
        yield c


def test_rejects_connection_without_cookie():
    app = FastAPI()
    app.include_router(camera_ws.router)
    with TestClient(app) as anon:
        with pytest.raises(Exception):
            with anon.websocket_connect("/rtc"):
                pass


def test_rejects_connection_with_wrong_cookie():
    app = FastAPI()
    app.include_router(camera_ws.router)
    with TestClient(app) as anon:
        anon.cookies.set(COOKIE_NAME, "0" * 64)
        with pytest.raises(Exception):
            with anon.websocket_connect("/rtc"):
                pass


def test_welcome_then_camera_and_viewer_exchange_signals(client):
    with client.websocket_connect("/rtc") as cam, client.websocket_connect("/rtc") as viewer:
        cam_welcome = cam.receive_json()
        assert cam_welcome["type"] == "welcome"
        cam_id = cam_welcome["peerId"]
        viewer_welcome = viewer.receive_json()
        viewer_id = viewer_welcome["peerId"]
        assert viewer_welcome["camera"] is None

        cam.send_json({"type": "hello", "role": "camera", "name": "Chambre"})
        own = cam.receive_json()
        assert own["type"] == "camera_changed"
        assert own["camera"]["id"] == cam_id
        assert own["camera"]["name"] == "Chambre"
        assert isinstance(own["camera"]["since"], float)
        announced = viewer.receive_json()
        assert announced["type"] == "camera_changed"
        assert announced["camera"]["name"] == "Chambre"
        assert announced["camera"]["id"] == cam_id

        viewer.send_json({"type": "watch"})
        assert cam.receive_json() == {"type": "viewer_joined", "peerId": viewer_id}

        cam.send_json({"type": "signal", "to": viewer_id, "data": {"sdp": "offer"}})
        assert viewer.receive_json() == {
            "type": "signal",
            "from": cam_id,
            "data": {"sdp": "offer"},
        }

        viewer.send_json({"type": "signal", "to": cam_id, "data": {"sdp": "answer"}})
        assert cam.receive_json() == {
            "type": "signal",
            "from": viewer_id,
            "data": {"sdp": "answer"},
        }


def test_ping_pong(client):
    with client.websocket_connect("/rtc") as ws:
        ws.receive_json()
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_oversized_frame_is_rejected_without_closing(client):
    with client.websocket_connect("/rtc") as ws:
        ws.receive_json()
        ws.send_json({"type": "signal", "to": "x", "data": {"blob": "a" * 70000}})
        assert ws.receive_json() == {"type": "error", "code": "bad_message"}
        # Connection still usable:
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_non_json_frame_is_rejected_without_closing(client):
    with client.websocket_connect("/rtc") as ws:
        ws.receive_json()
        ws.send_text("not json at all")
        assert ws.receive_json() == {"type": "error", "code": "bad_message"}
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_camera_disconnect_notifies_remaining_peers(client):
    with client.websocket_connect("/rtc") as viewer:
        viewer.receive_json()
        with client.websocket_connect("/rtc") as cam:
            cam.receive_json()
            cam.send_json({"type": "hello", "role": "camera", "name": "Chambre"})
            cam.receive_json()
            assert viewer.receive_json()["camera"]["name"] == "Chambre"
        assert viewer.receive_json() == {"type": "camera_changed", "camera": None}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/backend" && uv run pytest tests/test_camera_ws.py -q
```

Expected: collection error — `ModuleNotFoundError: No module named 'app.camera.ws'`.

- [ ] **Step 3: Widen `is_authed` to accept WebSocket connections**

In `backend/app/auth.py`, replace the `Request` import and the `is_authed` signature (Starlette's `Request` and `WebSocket` both derive from `HTTPConnection`, which is where `.cookies` lives — this is the whole change):

```python
from starlette.requests import HTTPConnection
from fastapi import Request
```

```python
def is_authed(conn: HTTPConnection) -> bool:
    secret = secret_phrase()
    if not secret:
        return False
    cookie = conn.cookies.get(COOKIE_NAME)
    if not cookie:
        return False
    return hmac.compare_digest(cookie, compute_auth_token(secret))
```

Leave `require_auth(request: Request)` exactly as it is — FastAPI resolves it as a dependency by its `Request` annotation.

- [ ] **Step 4: Implement the WebSocket endpoint**

Create `backend/app/camera/ws.py`:

```python
"""WebSocket transport for camera signaling.

All rules live in `hub.py`; this module only does auth, framing, and delivery.
Handlers are synchronous between awaits, so the shared `hub` needs no lock:
asyncio runs one task at a time and `CameraHub` never awaits.
"""

import json
import time
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..auth import is_authed
from .hub import Action, CameraHub, oversized

router = APIRouter()
hub = CameraHub()
_sockets: dict[str, WebSocket] = {}


async def _deliver(actions: list[Action]) -> None:
    for action in actions:
        socket = _sockets.get(action.to)
        if socket is None:
            continue
        try:
            await socket.send_json(action.payload)
        except (RuntimeError, WebSocketDisconnect):
            # Peer vanished mid-delivery; its own handler cleans up the hub.
            continue


@router.websocket("/rtc")
async def rtc(websocket: WebSocket) -> None:
    if not is_authed(websocket):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    peer_id = uuid.uuid4().hex
    _sockets[peer_id] = websocket
    try:
        await _deliver(hub.connect(peer_id))
        while True:
            raw = await websocket.receive_text()
            if oversized(raw):
                await _deliver([Action(to=peer_id, payload={"type": "error", "code": "bad_message"})])
                continue
            try:
                message = json.loads(raw)
            except ValueError:
                await _deliver([Action(to=peer_id, payload={"type": "error", "code": "bad_message"})])
                continue
            if not isinstance(message, dict):
                await _deliver([Action(to=peer_id, payload={"type": "error", "code": "bad_message"})])
                continue
            await _deliver(hub.handle(peer_id, message, now=time.time()))
    except WebSocketDisconnect:
        pass
    finally:
        _sockets.pop(peer_id, None)
        await _deliver(hub.disconnect(peer_id))
```

- [ ] **Step 5: Wire the router into the app**

In `backend/app/main.py`, add the import next to the other route imports:

```python
from .camera import ws as camera_ws
```

and register it with the other routers — **above** the `app.mount("/", BearerGate(mcp_app))` line, which is a catch-all:

```python
app.include_router(camera_ws.router)
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/backend" && uv run pytest tests/test_camera_ws.py -q
```

Expected: 7 passed.

- [ ] **Step 7: Expose `/rtc` through Traefik in production**

In `docker-compose.prod.yml`, the backend service's router rule currently ends with `|| Path(\`/token\`))`. Add `/rtc` to it and update the comment above the labels so it says the router carries MCP **and** camera signaling. The rule becomes (single line, unchanged apart from the added `Path`):

```
      - traefik.http.routers.${COMPOSE_PROJECT_NAME}-mcp.rule=Host(`${DOMAIN:?set DOMAIN in .env}`) && (PathPrefix(`/mcp`) || PathPrefix(`/.well-known/oauth-authorization-server`) || PathPrefix(`/.well-known/oauth-protected-resource`) || Path(`/register`) || Path(`/authorize`) || Path(`/token`) || Path(`/rtc`))
```

Verify the compose file still parses:

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks" && docker compose -f docker-compose.prod.yml config --quiet && echo "compose OK"
```

Expected: `compose OK` (the command needs the `.env` vars; if it complains about unset variables, run it with `DOMAIN=example.com POSTGRES_PASSWORD=x APP_SECRET_PHRASE=x MCP_ACCESS_SECRET=x MCP_JWT_SECRET=x MCP_PUBLIC_URL=x docker compose -f docker-compose.prod.yml config --quiet`).

- [ ] **Step 8: Run the full backend suite**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/backend" && BM_TEST_DATABASE_URL=postgresql://baby:baby@localhost:5432/baby_marks uv run pytest -q
```

Expected: 106 passed.

- [ ] **Step 9: Commit**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
git add backend/app/camera/ws.py backend/app/auth.py backend/app/main.py backend/tests/test_camera_ws.py docker-compose.prod.yml
git commit -m "feat(camera): /rtc signaling websocket, cookie-gated, exposed via Traefik

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: JPEG dimension parser

**Files:**
- Create: `backend/app/photos/__init__.py` (empty file)
- Create: `backend/app/photos/jpeg.py`
- Test: `backend/tests/test_jpeg.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `class InvalidJpeg(ValueError)` and `jpeg_dimensions(data: bytes) -> tuple[int, int]` returning `(width, height)`. Task 4's upload endpoint uses it both to read dimensions and to validate that the payload really is a JPEG (never trust the client's `Content-Type`).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_jpeg.py`:

```python
import pytest

from app.photos.jpeg import InvalidJpeg, jpeg_dimensions


def sof0(width: int, height: int, prefix: bytes = b"") -> bytes:
    """A minimal but structurally valid JPEG: SOI, optional segments, SOF0, EOI."""
    sof = (
        b"\xff\xc0"
        + (17).to_bytes(2, "big")  # segment length
        + b"\x08"  # 8-bit precision
        + height.to_bytes(2, "big")
        + width.to_bytes(2, "big")
        + b"\x03"  # 3 components
        + b"\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    )
    return b"\xff\xd8" + prefix + sof + b"\xff\xd9"


def app0() -> bytes:
    """A JFIF APP0 segment, the kind browsers put before the SOF."""
    body = b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    return b"\xff\xe0" + (len(body) + 2).to_bytes(2, "big") + body


def test_reads_dimensions_from_sof0():
    assert jpeg_dimensions(sof0(320, 240)) == (320, 240)


def test_skips_leading_segments():
    assert jpeg_dimensions(sof0(1280, 720, prefix=app0())) == (1280, 720)


def test_handles_progressive_sof2():
    data = bytearray(sof0(800, 600))
    data[2:4] = b"\xff\xc2"  # SOF2 (progressive) instead of SOF0
    assert jpeg_dimensions(bytes(data)) == (800, 600)


def test_tolerates_fill_bytes_before_a_marker():
    data = sof0(320, 240, prefix=b"\xff\xff")
    assert jpeg_dimensions(data) == (320, 240)


def test_rejects_non_jpeg():
    for blob in (b"", b"\x89PNG\r\n\x1a\n", b"not an image at all"):
        with pytest.raises(InvalidJpeg):
            jpeg_dimensions(blob)


def test_rejects_jpeg_without_sof():
    with pytest.raises(InvalidJpeg):
        jpeg_dimensions(b"\xff\xd8" + app0() + b"\xff\xd9")


def test_rejects_truncated_sof():
    truncated = sof0(320, 240)[:8]
    with pytest.raises(InvalidJpeg):
        jpeg_dimensions(truncated)


def test_rejects_zero_dimension():
    with pytest.raises(InvalidJpeg):
        jpeg_dimensions(sof0(0, 240))


def test_rejects_bogus_segment_length():
    data = bytearray(sof0(320, 240, prefix=app0()))
    data[4:6] = b"\x00\x00"  # APP0 length of 0 would loop forever
    with pytest.raises(InvalidJpeg):
        jpeg_dimensions(bytes(data))
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/backend" && uv run pytest tests/test_jpeg.py -q
```

Expected: collection error — `ModuleNotFoundError: No module named 'app.photos'`.

- [ ] **Step 3: Implement the parser**

Create `backend/app/photos/__init__.py` (empty), then `backend/app/photos/jpeg.py`:

```python
"""Minimal JPEG header reader.

Used to (a) confirm an upload really is a JPEG rather than trusting the
client's Content-Type, and (b) record the image dimensions. Hand-rolled on
purpose: a full imaging library would be a heavy dependency for 30 lines of
header walking.
"""

# Start-Of-Frame markers, excluding DHT (0xC4), JPG (0xC8) and DAC (0xCC),
# which share the 0xCn range but are not frame headers.
_SOF_MARKERS = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
_STANDALONE = {0xD8, 0xD9, *range(0xD0, 0xD8)}  # SOI, EOI, RSTn: no length field


class InvalidJpeg(ValueError):
    """Raised when the payload is not a JPEG we can read dimensions from."""


def jpeg_dimensions(data: bytes) -> tuple[int, int]:
    """Return (width, height) from the first Start-Of-Frame segment."""
    if len(data) < 4 or data[0] != 0xFF or data[1] != 0xD8:
        raise InvalidJpeg("missing JPEG start-of-image marker")

    i = 2
    while i + 1 < len(data):
        if data[i] != 0xFF:
            raise InvalidJpeg("expected a segment marker")
        marker = data[i + 1]
        if marker == 0xFF:  # fill byte, keep scanning
            i += 1
            continue
        if marker in _STANDALONE:
            i += 2
            continue
        if i + 3 >= len(data):
            raise InvalidJpeg("truncated segment header")
        length = int.from_bytes(data[i + 2 : i + 4], "big")
        if length < 2:
            raise InvalidJpeg("invalid segment length")
        if marker in _SOF_MARKERS:
            if i + 9 > len(data):
                raise InvalidJpeg("truncated frame header")
            height = int.from_bytes(data[i + 5 : i + 7], "big")
            width = int.from_bytes(data[i + 7 : i + 9], "big")
            if width == 0 or height == 0:
                raise InvalidJpeg("zero-sized image")
            return width, height
        i += 2 + length

    raise InvalidJpeg("no frame header found")
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/backend" && uv run pytest tests/test_jpeg.py -q
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
git add backend/app/photos backend/tests/test_jpeg.py
git commit -m "feat(photos): minimal JPEG header parser for validation and dimensions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Photos API (migration + routes)

**Files:**
- Create: `backend/migrations/0003_photos.sql`
- Create: `backend/app/routes/photos.py`
- Modify: `backend/app/serializers.py` (add `photo_out`)
- Modify: `backend/app/main.py` (include the photos router)
- Test: `backend/tests/test_photos_api.py`

**Interfaces:**
- Consumes: `jpeg_dimensions`, `InvalidJpeg` from `app.photos.jpeg`; `require_auth`, `get_pool`, `ApiError` as in `backend/app/routes/measurements.py`.
- Produces: `photo_out(row) -> dict` in `app/serializers.py` returning `{"id", "takenAt", "width", "height"}`; endpoints `POST /api/photos`, `GET /api/photos`, `GET /api/photos/{id}`, `DELETE /api/photos/{id}`. Task 8's frontend gallery consumes these.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_photos_api.py`:

```python
"""Photos API against a real Postgres. Skipped unless BM_TEST_DATABASE_URL is set."""

import os

import pytest

DB_URL = os.environ.get("BM_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not DB_URL, reason="BM_TEST_DATABASE_URL not set")

if DB_URL:
    os.environ["DATABASE_URL"] = DB_URL
os.environ.setdefault("APP_SECRET_PHRASE", "test-secret")


def sof0(width: int, height: int) -> bytes:
    sof = (
        b"\xff\xc0"
        + (17).to_bytes(2, "big")
        + b"\x08"
        + height.to_bytes(2, "big")
        + width.to_bytes(2, "big")
        + b"\x03"
        + b"\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    )
    return b"\xff\xd8" + sof + b"\xff\xd9"


@pytest.fixture
async def client():
    from httpx import ASGITransport, AsyncClient

    from app import db as db_module
    from app.auth import COOKIE_NAME, compute_auth_token
    from app.main import app

    await db_module.run_migrations()
    pool = await db_module.get_pool()
    await pool.execute("DELETE FROM photos;")

    token = compute_auth_token(os.environ["APP_SECRET_PHRASE"])
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies={COOKIE_NAME: token},
    ) as c:
        yield c
    await db_module.close_pool()


JPEG_HEADERS = {"Content-Type": "image/jpeg"}


async def test_upload_then_fetch_returns_identical_bytes(client):
    blob = sof0(320, 240)
    res = await client.post("/api/photos", content=blob, headers=JPEG_HEADERS)
    assert res.status_code == 201
    photo = res.json()["photo"]
    assert photo["width"] == 320
    assert photo["height"] == 240
    assert photo["takenAt"].endswith("Z")

    got = await client.get(f"/api/photos/{photo['id']}")
    assert got.status_code == 200
    assert got.content == blob
    assert got.headers["content-type"] == "image/jpeg"
    assert "private" in got.headers["cache-control"]


async def test_list_returns_metadata_only_newest_first(client):
    for size in (100, 200, 300):
        await client.post("/api/photos", content=sof0(size, size), headers=JPEG_HEADERS)
    res = await client.get("/api/photos")
    assert res.status_code == 200
    photos = res.json()["photos"]
    assert [p["width"] for p in photos] == [300, 200, 100]
    assert set(photos[0]) == {"id", "takenAt", "width", "height"}


async def test_list_limit_is_validated(client):
    assert (await client.get("/api/photos?limit=0")).status_code == 400
    assert (await client.get("/api/photos?limit=201")).status_code == 400
    assert (await client.get("/api/photos?limit=1")).status_code == 200


async def test_rejects_payload_over_two_mib(client):
    blob = sof0(320, 240) + b"\x00" * (2 * 1024 * 1024)
    res = await client.post("/api/photos", content=blob, headers=JPEG_HEADERS)
    assert res.status_code == 413


async def test_rejects_wrong_content_type(client):
    res = await client.post(
        "/api/photos", content=sof0(320, 240), headers={"Content-Type": "image/png"}
    )
    assert res.status_code == 415


async def test_rejects_payload_that_is_not_a_jpeg(client):
    res = await client.post("/api/photos", content=b"totally not a jpeg", headers=JPEG_HEADERS)
    assert res.status_code == 400


async def test_delete_then_missing(client):
    created = await client.post("/api/photos", content=sof0(320, 240), headers=JPEG_HEADERS)
    photo_id = created.json()["photo"]["id"]
    assert (await client.delete(f"/api/photos/{photo_id}")).status_code == 204
    assert (await client.get(f"/api/photos/{photo_id}")).status_code == 404
    assert (await client.delete(f"/api/photos/{photo_id}")).status_code == 404


async def test_retention_keeps_only_the_newest_200(client):
    from app import db as db_module

    pool = await db_module.get_pool()
    # 200 pre-existing rows, oldest first.
    for i in range(200):
        await pool.execute(
            "INSERT INTO photos (taken_at, width, height, bytes) "
            "VALUES (now() - ($1 || ' seconds')::interval, 10, 10, $2)",
            str(300 - i),
            sof0(10, 10),
        )
    res = await client.post("/api/photos", content=sof0(999, 999), headers=JPEG_HEADERS)
    assert res.status_code == 201

    count = await pool.fetchval("SELECT count(*) FROM photos")
    assert count == 200
    newest = await pool.fetchval("SELECT width FROM photos ORDER BY taken_at DESC LIMIT 1")
    assert newest == 999


async def test_all_routes_require_auth(client):
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    created = await client.post("/api/photos", content=sof0(320, 240), headers=JPEG_HEADERS)
    photo_id = created.json()["photo"]["id"]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon:
        assert (await anon.get("/api/photos")).status_code == 401
        assert (await anon.get(f"/api/photos/{photo_id}")).status_code == 401
        assert (
            await anon.post("/api/photos", content=sof0(1, 1), headers=JPEG_HEADERS)
        ).status_code == 401
        assert (await anon.delete(f"/api/photos/{photo_id}")).status_code == 401
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/backend" && BM_TEST_DATABASE_URL=postgresql://baby:baby@localhost:5432/baby_marks uv run pytest tests/test_photos_api.py -q
```

Expected: failures — `relation "photos" does not exist` / 404s on the routes.

- [ ] **Step 3: Write the migration**

Create `backend/migrations/0003_photos.sql`:

```sql
CREATE TABLE "photos" (
    "id" bigserial PRIMARY KEY,
    "taken_at" timestamptz NOT NULL DEFAULT now(),
    "width" int NOT NULL,
    "height" int NOT NULL,
    "content_type" text NOT NULL DEFAULT 'image/jpeg',
    "bytes" bytea NOT NULL
);

CREATE INDEX "photos_taken_at_idx" ON "photos" ("taken_at" DESC, "id" DESC);
```

- [ ] **Step 4: Add the serializer**

In `backend/app/serializers.py`, append:

```python
def photo_out(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "takenAt": iso(row["taken_at"]),
        "width": row["width"],
        "height": row["height"],
    }
```

- [ ] **Step 5: Implement the routes**

Create `backend/app/routes/photos.py`:

```python
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from ..auth import require_auth
from ..db import get_pool
from ..errors import ApiError
from ..photos.jpeg import InvalidJpeg, jpeg_dimensions
from ..serializers import photo_out

router = APIRouter(prefix="/api/photos", dependencies=[Depends(require_auth)])

MAX_BYTES = 2 * 1024 * 1024
RETENTION = 200
CONTENT_TYPE = "image/jpeg"


@router.get("")
async def list_photos(limit: int = 50) -> dict:
    if limit < 1 or limit > RETENTION:
        raise ApiError(400, "invalid", message="limit must be between 1 and 200")
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, taken_at, width, height FROM photos ORDER BY taken_at DESC, id DESC LIMIT $1",
        limit,
    )
    return {"photos": [photo_out(r) for r in rows]}


@router.post("")
async def create_photo(request: Request) -> JSONResponse:
    if request.headers.get("content-type", "").split(";")[0].strip() != CONTENT_TYPE:
        raise ApiError(415, "unsupported_media_type")
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BYTES:
        raise ApiError(413, "too_large")
    body = await request.body()
    if len(body) > MAX_BYTES:
        raise ApiError(413, "too_large")
    try:
        width, height = jpeg_dimensions(body)
    except InvalidJpeg as exc:
        raise ApiError(400, "invalid", message=str(exc)) from exc

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "INSERT INTO photos (width, height, bytes) VALUES ($1, $2, $3) "
                "RETURNING id, taken_at, width, height",
                width,
                height,
                body,
            )
            # Cap the table so the pg_dump backup taken before every deploy
            # cannot grow without bound.
            await conn.execute(
                "DELETE FROM photos WHERE id NOT IN ("
                "SELECT id FROM photos ORDER BY taken_at DESC, id DESC LIMIT $1)",
                RETENTION,
            )
    return JSONResponse({"photo": photo_out(row)}, status_code=201)


@router.get("/{photo_id}")
async def get_photo(photo_id: int) -> Response:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT bytes, content_type FROM photos WHERE id = $1", photo_id
    )
    if not row:
        raise ApiError(404, "not_found")
    return Response(
        content=row["bytes"],
        media_type=row["content_type"],
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.delete("/{photo_id}", status_code=204)
async def delete_photo(photo_id: int) -> Response:
    pool = await get_pool()
    deleted = await pool.fetchrow("DELETE FROM photos WHERE id = $1 RETURNING id", photo_id)
    if not deleted:
        raise ApiError(404, "not_found")
    return Response(status_code=204)
```

In `backend/app/main.py`, add `photos` to the routes import line and register it with the other routers (before the catch-all mount):

```python
from .routes import auth, baby, events, measurements, photos, stats
```

```python
app.include_router(photos.router)
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/backend" && BM_TEST_DATABASE_URL=postgresql://baby:baby@localhost:5432/baby_marks uv run pytest tests/test_photos_api.py -q
```

Expected: 9 passed.

- [ ] **Step 7: Run the full backend suite**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/backend" && BM_TEST_DATABASE_URL=postgresql://baby:baby@localhost:5432/baby_marks uv run pytest -q
```

Expected: 124 passed. Also confirm the migration is idempotent by running the suite twice — the second run must not fail on `CREATE TABLE`.

- [ ] **Step 8: Commit**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
git add backend/migrations/0003_photos.sql backend/app/routes/photos.py backend/app/serializers.py backend/app/main.py backend/tests/test_photos_api.py
git commit -m "feat(photos): snapshot storage API backed by Postgres bytea

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend signaling client

**Files:**
- Create: `frontend/src/lib/rtc/signaling.ts`
- Test: `frontend/src/lib/__tests__/signaling.test.ts`

**Interfaces:**
- Consumes: the `/rtc` protocol from Task 2.
- Produces (all imported by Tasks 6–7):
  - `type ServerMessage` — discriminated union on `type`: `welcome` (`peerId: string; camera: CameraInfo | null`), `camera_changed` (`camera: CameraInfo | null`), `viewer_joined` / `viewer_left` (`peerId: string`), `signal` (`from: string; data: unknown`), `error` (`code: string`), `pong`.
  - `type CameraInfo = { id: string; name: string; since: number }`.
  - `type ClientMessage` — `{type:"hello";role:"camera"|"viewer";name?:string}` | `{type:"watch"}` | `{type:"signal";to:string;data:unknown}` | `{type:"takeover";name?:string}` | `{type:"stop"}` | `{type:"ping"}`.
  - `rtcUrl(origin: string, override?: string): string`.
  - `class Signaling` — `constructor(opts: SignalingOptions)`, `connect(): void`, `send(msg: ClientMessage): void`, `close(): void`, readonly `state: "connecting" | "open" | "closed"`.
  - `SignalingOptions = { url: string; onMessage: (m: ServerMessage) => void; onState?: (s: SignalingState) => void; createSocket?: (url: string) => SocketLike; schedule?: (fn: () => void, ms: number) => void }`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/__tests__/signaling.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Signaling, rtcUrl, type ServerMessage } from "@/lib/rtc/signaling";

class FakeSocket {
  static instances: FakeSocket[] = [];
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  open() {
    this.onopen?.();
  }
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function setup() {
  FakeSocket.instances = [];
  const received: ServerMessage[] = [];
  const states: string[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const signaling = new Signaling({
    url: "ws://test/rtc",
    onMessage: (m) => received.push(m),
    onState: (s) => states.push(s),
    createSocket: (url) => new FakeSocket(url),
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
    },
  });
  return { signaling, received, states, timers, socket: () => FakeSocket.instances.at(-1)! };
}

describe("rtcUrl", () => {
  it("derives a wss url from an https origin", () => {
    expect(rtcUrl("https://baby.canastrat.com")).toBe("wss://baby.canastrat.com/rtc");
  });
  it("derives a ws url from an http origin", () => {
    expect(rtcUrl("http://localhost:3000")).toBe("ws://localhost:3000/rtc");
  });
  it("prefers an explicit override", () => {
    expect(rtcUrl("https://x.test", "ws://localhost:8000/rtc")).toBe("ws://localhost:8000/rtc");
  });
});

describe("Signaling", () => {
  it("reports state transitions and delivers parsed messages", () => {
    const { signaling, received, states, socket } = setup();
    signaling.connect();
    expect(states).toEqual(["connecting"]);
    socket().open();
    expect(states).toEqual(["connecting", "open"]);
    socket().emit({ type: "welcome", peerId: "p1", camera: null });
    expect(received).toEqual([{ type: "welcome", peerId: "p1", camera: null }]);
  });

  it("queues sends made before the socket opens, then flushes them in order", () => {
    const { signaling, socket } = setup();
    signaling.connect();
    signaling.send({ type: "hello", role: "camera", name: "Chambre" });
    signaling.send({ type: "watch" });
    expect(socket().sent).toEqual([]);
    socket().open();
    expect(socket().sent.map((s) => JSON.parse(s).type)).toEqual(["hello", "watch"]);
  });

  it("ignores malformed frames instead of throwing", () => {
    const { signaling, received, socket } = setup();
    signaling.connect();
    socket().open();
    socket().onmessage?.({ data: "not json" });
    expect(received).toEqual([]);
  });

  it("reconnects with a capped exponential backoff", () => {
    const { signaling, timers, socket } = setup();
    signaling.connect();
    socket().open();
    for (const expected of [1000, 2000, 4000, 8000, 15000, 15000]) {
      socket().close();
      expect(timers.at(-1)!.ms).toBe(expected);
      timers.at(-1)!.fn();
      socket().open();
    }
  });

  it("resets the backoff after a successful connection", () => {
    const { signaling, timers, socket } = setup();
    signaling.connect();
    socket().open();
    socket().close();
    expect(timers.at(-1)!.ms).toBe(1000);
    timers.at(-1)!.fn();
    socket().open();
    socket().close();
    expect(timers.at(-1)!.ms).toBe(1000);
  });

  it("stops reconnecting once closed on purpose", () => {
    const { signaling, timers, states, socket } = setup();
    signaling.connect();
    socket().open();
    signaling.close();
    expect(socket().closed).toBe(true);
    expect(timers).toEqual([]);
    expect(states.at(-1)).toBe("closed");
  });

  it("sends a heartbeat ping on demand", () => {
    const { signaling, socket } = setup();
    signaling.connect();
    socket().open();
    signaling.send({ type: "ping" });
    expect(JSON.parse(socket().sent.at(-1)!)).toEqual({ type: "ping" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/frontend" && npx vitest run src/lib/__tests__/signaling.test.ts
```

Expected: FAIL — cannot resolve `@/lib/rtc/signaling`.

- [ ] **Step 3: Implement the client**

Create `frontend/src/lib/rtc/signaling.ts`:

```ts
export type CameraInfo = { id: string; name: string; since: number };

export type ServerMessage =
  | { type: "welcome"; peerId: string; camera: CameraInfo | null }
  | { type: "camera_changed"; camera: CameraInfo | null }
  | { type: "viewer_joined"; peerId: string }
  | { type: "viewer_left"; peerId: string }
  | { type: "signal"; from: string; data: unknown }
  | { type: "error"; code: string }
  | { type: "pong" };

export type ClientMessage =
  | { type: "hello"; role: "camera" | "viewer"; name?: string }
  | { type: "watch" }
  | { type: "signal"; to: string; data: unknown }
  | { type: "takeover"; name?: string }
  | { type: "stop" }
  | { type: "ping" };

export type SignalingState = "connecting" | "open" | "closed";

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SignalingOptions {
  url: string;
  onMessage: (msg: ServerMessage) => void;
  onState?: (state: SignalingState) => void;
  /** Injectable for tests; defaults to a real WebSocket. */
  createSocket?: (url: string) => SocketLike;
  /** Injectable for tests; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

/** Derive the signaling URL from the page origin, unless overridden. */
export function rtcUrl(origin: string, override?: string): string {
  if (override) return override;
  return origin.replace(/^http/, "ws") + "/rtc";
}

export class Signaling {
  state: SignalingState = "closed";
  private socket: SocketLike | null = null;
  private queue: ClientMessage[] = [];
  private attempt = 0;
  private stopped = false;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly schedule: (fn: () => void, ms: number) => void;

  constructor(private readonly opts: SignalingOptions) {
    this.createSocket =
      opts.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  }

  private setState(state: SignalingState) {
    this.state = state;
    this.opts.onState?.(state);
  }

  connect() {
    this.stopped = false;
    this.setState("connecting");
    const socket = this.createSocket(this.opts.url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.setState("open");
      const pending = this.queue;
      this.queue = [];
      for (const msg of pending) socket.send(JSON.stringify(msg));
    };
    socket.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return; // a frame we cannot read is not worth crashing the monitor over
      }
      if (parsed && typeof parsed === "object" && "type" in parsed) {
        this.opts.onMessage(parsed as ServerMessage);
      }
    };
    socket.onerror = () => {
      /* onclose always follows; reconnection is handled there */
    };
    socket.onclose = () => {
      this.socket = null;
      if (this.stopped) return;
      const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
      this.attempt += 1;
      this.setState("connecting");
      this.schedule(() => {
        if (!this.stopped) this.connect();
      }, delay);
    };
  }

  send(msg: ClientMessage) {
    if (this.socket && this.state === "open") {
      this.socket.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  close() {
    this.stopped = true;
    this.queue = [];
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setState("closed");
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/frontend" && npx vitest run src/lib/__tests__/signaling.test.ts
```

Expected: 10 passed.

- [ ] **Step 5: Typecheck and run the whole frontend suite**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/frontend" && npx tsc --noEmit && npx vitest run
```

Expected: tsc silent; 19 tests passed (9 baseline + 10 new).

- [ ] **Step 6: Commit**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
git add frontend/src/lib/rtc/signaling.ts frontend/src/lib/__tests__/signaling.test.ts
git commit -m "feat(camera): signaling client with queueing and capped backoff

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Peer connections + camera role (page shell, nav, i18n)

**Files:**
- Create: `frontend/src/lib/rtc/peer.ts`
- Create: `frontend/src/hooks/useSignaling.ts`
- Create: `frontend/src/hooks/useCameraRole.ts`
- Create: `frontend/src/components/CameraStage.tsx`
- Create: `frontend/src/app/camera/page.tsx`
- Modify: `frontend/src/components/BottomNav.tsx` (5th tab, `grid-cols-4` → `grid-cols-5`)
- Modify: `frontend/src/components/TopBar.tsx` (5th link)
- Modify: `frontend/src/messages/fr.json`, `frontend/src/messages/en.json` (`nav.camera` + the whole `camera.*` block)

**Interfaces:**
- Consumes: `Signaling`, `rtcUrl`, `ServerMessage`, `CameraInfo`, `ClientMessage` from `@/lib/rtc/signaling`.
- Produces:
  - `createPeer(onSignal: (data: unknown) => void, onTrack?: (stream: MediaStream) => void): RTCPeerConnection` and `applySignal(pc: RTCPeerConnection, data: unknown, onAnswer: (answer: unknown) => void): Promise<void>` in `@/lib/rtc/peer`.
  - `useSignaling(onMessage)` returning `{ send, state, peerId }` in `@/hooks/useSignaling`.
  - `useCameraRole(send)` returning `{ start(name, mode?), stop(), flip(), handleMessage(msg), stream, error, facingMode, viewerCount }` in `@/hooks/useCameraRole`, where `mode` is `"hello" | "takeover"` (default `"hello"`) and `error` is `null | "permissionDenied"`.
- Task 7 consumes `useSignaling` and `createPeer`/`applySignal`; Task 8 mounts its gallery inside `app/camera/page.tsx`.

- [ ] **Step 1: Add the i18n keys (fr then en, mirrored)**

In `frontend/src/messages/fr.json`, extend `nav` and add a `camera` block:

```json
  "nav": { "home": "Accueil", "history": "Historique", "stats": "Stats", "camera": "Caméra", "settings": "Réglages" },
  "camera": {
    "title": "Veille bébé",
    "useThisDevice": "Utiliser cet appareil comme caméra",
    "deviceName": "Nom de l'appareil",
    "defaultName": "Chambre",
    "streaming": "Diffusion en cours",
    "stop": "Arrêter la diffusion",
    "keepForeground": "Gardez l'app ouverte, l'écran allumé et l'appareil branché.",
    "tapToShow": "Touchez pour afficher l'aperçu",
    "switchCamera": "Changer de caméra",
    "permissionDenied": "Accès à la caméra refusé. Autorisez-le dans les réglages du navigateur.",
    "wakeLockUnsupported": "Cet appareil peut se mettre en veille et couper la diffusion.",
    "takeoverPrompt": "Une autre caméra est active ({name}). La remplacer ?",
    "takeoverConfirm": "Remplacer",
    "noCamera": "Aucune caméra active",
    "noCameraHint": "Lancez la diffusion depuis l'appareil qui doit filmer.",
    "watch": "Regarder",
    "connecting": "Connexion…",
    "live": "En direct",
    "lost": "Connexion perdue",
    "retry": "Réessayer",
    "enableSound": "Activer le son",
    "fullscreen": "Plein écran",
    "snapshot": "Photo",
    "gallery": "Photos",
    "galleryEmpty": "Aucune photo",
    "confirmDeletePhoto": "Supprimer cette photo ?",
    "tooManyViewers": "Trop d'appareils regardent déjà",
    "viewers": "{count} spectateur(s)"
  },
```

In `frontend/src/messages/en.json`, the exact same keys:

```json
  "nav": { "home": "Home", "history": "History", "stats": "Stats", "camera": "Camera", "settings": "Settings" },
  "camera": {
    "title": "Baby monitor",
    "useThisDevice": "Use this device as the camera",
    "deviceName": "Device name",
    "defaultName": "Bedroom",
    "streaming": "Streaming",
    "stop": "Stop streaming",
    "keepForeground": "Keep the app open, the screen on and the device plugged in.",
    "tapToShow": "Tap to show the preview",
    "switchCamera": "Flip camera",
    "permissionDenied": "Camera access denied. Allow it in your browser settings.",
    "wakeLockUnsupported": "This device may sleep and cut the stream.",
    "takeoverPrompt": "Another camera is active ({name}). Replace it?",
    "takeoverConfirm": "Replace",
    "noCamera": "No active camera",
    "noCameraHint": "Start streaming from the device that should film.",
    "watch": "Watch",
    "connecting": "Connecting…",
    "live": "Live",
    "lost": "Connection lost",
    "retry": "Retry",
    "enableSound": "Enable sound",
    "fullscreen": "Fullscreen",
    "snapshot": "Photo",
    "gallery": "Photos",
    "galleryEmpty": "No photos yet",
    "confirmDeletePhoto": "Delete this photo?",
    "tooManyViewers": "Too many devices are already watching",
    "viewers": "{count} viewer(s)"
  },
```

Verify both catalogs stay key-mirrored:

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/frontend" && node -e "
const fr=require('./src/messages/fr.json'), en=require('./src/messages/en.json');
const keys=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'?keys(v,p+k+'.'):[p+k]);
const a=keys(fr).sort(), b=keys(en).sort();
const diff=[...a.filter(k=>!b.includes(k)),...b.filter(k=>!a.includes(k))];
console.log(diff.length?'MISMATCH '+diff.join(', '):'catalogs mirrored ('+a.length+' keys)');
"
```

Expected: `catalogs mirrored (N keys)`.

- [ ] **Step 2: Add the nav entries**

In `frontend/src/components/BottomNav.tsx`, add the tab and widen the grid:

```tsx
const tabs = [
  { href: "/", key: "home", icon: "🏠" },
  { href: "/history", key: "history", icon: "📖" },
  { href: "/camera", key: "camera", icon: "📹" },
  { href: "/stats", key: "stats", icon: "📊" },
  { href: "/settings", key: "settings", icon: "⚙️" },
] as const;
```

and in the `<nav>` className replace `grid-cols-4` with `grid-cols-5`. In the `<Link>` className, replace `h-9 w-14` with `h-9 w-12` so five badges still fit at 390 px.

In `frontend/src/components/TopBar.tsx`, add the matching entry to its `tabs` array:

```tsx
const tabs = [
  { href: "/", key: "home" },
  { href: "/history", key: "history" },
  { href: "/camera", key: "camera" },
  { href: "/stats", key: "stats" },
  { href: "/settings", key: "settings" },
] as const;
```

- [ ] **Step 3: Implement the peer helpers**

Create `frontend/src/lib/rtc/peer.ts`:

```ts
/** Thin wrappers over the browser's WebRTC API. Verified by the manual
 *  two-device protocol in the plan, not by unit tests: these are almost
 *  entirely calls into APIs jsdom does not implement. */

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export function createPeer(
  onSignal: (data: unknown) => void,
  onTrack?: (stream: MediaStream) => void,
): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (event) => {
    if (event.candidate) onSignal({ candidate: event.candidate.toJSON() });
  };
  if (onTrack) {
    pc.ontrack = (event) => onTrack(event.streams[0]);
  }
  return pc;
}

/** Apply an incoming offer/answer/candidate. Answers the offer via `reply`. */
export async function applySignal(
  pc: RTCPeerConnection,
  data: unknown,
  reply: (data: unknown) => void,
): Promise<void> {
  const message = data as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
  if (message.sdp) {
    await pc.setRemoteDescription(message.sdp);
    if (message.sdp.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      reply({ sdp: answer });
    }
    return;
  }
  if (message.candidate) {
    try {
      await pc.addIceCandidate(message.candidate);
    } catch {
      // A candidate that arrives before the remote description is safe to drop.
    }
  }
}

export async function offerTo(
  pc: RTCPeerConnection,
  send: (data: unknown) => void,
): Promise<void> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send({ sdp: offer });
}
```

- [ ] **Step 4: Implement the signaling hook**

Create `frontend/src/hooks/useSignaling.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Signaling,
  rtcUrl,
  type ClientMessage,
  type ServerMessage,
  type SignalingState,
} from "@/lib/rtc/signaling";

const PING_MS = 25_000;

/** One signaling connection for the page, with a 25 s app-level heartbeat
 *  (proxies drop idle websockets long before that matters). */
export function useSignaling(onMessage: (msg: ServerMessage) => void) {
  const [state, setState] = useState<SignalingState>("closed");
  const [peerId, setPeerId] = useState<string | null>(null);
  const clientRef = useRef<Signaling | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    const client = new Signaling({
      url: rtcUrl(window.location.origin, process.env.NEXT_PUBLIC_RTC_URL),
      onState: setState,
      onMessage: (msg) => {
        if (msg.type === "welcome") setPeerId(msg.peerId);
        handlerRef.current(msg);
      },
    });
    clientRef.current = client;
    client.connect();
    const ping = setInterval(() => client.send({ type: "ping" }), PING_MS);
    return () => {
      clearInterval(ping);
      client.close();
      clientRef.current = null;
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => clientRef.current?.send(msg), []);
  return { send, state, peerId };
}
```

- [ ] **Step 5: Implement the camera role hook**

Create `frontend/src/hooks/useCameraRole.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPeer, applySignal, offerTo } from "@/lib/rtc/peer";
import type { ClientMessage, ServerMessage } from "@/lib/rtc/signaling";

type Send = (msg: ClientMessage) => void;

/** Camera side: owns the media stream, the wake lock, and one peer
 *  connection per viewer (the camera is always the offerer). */
export function useCameraRole(send: Send) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return false;
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      return true;
    } catch {
      return false;
    }
  }, []);

  const start = useCallback(
    async (name: string, mode: "hello" | "takeover" = "hello") => {
      setError(null);
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: true,
        });
        streamRef.current = media;
        setStream(media);
        await acquireWakeLock();
        send({ type: mode, role: "camera", name } as ClientMessage);
      } catch {
        setError("permissionDenied");
      }
    },
    [acquireWakeLock, facingMode, send],
  );

  const stop = useCallback(() => {
    send({ type: "stop" });
    for (const pc of peersRef.current.values()) pc.close();
    peersRef.current.clear();
    setViewerCount(0);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    releaseWakeLock();
  }, [releaseWakeLock, send]);

  const flip = useCallback(async () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    if (!streamRef.current) return;
    const media = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: next },
      audio: true,
    });
    const videoTrack = media.getVideoTracks()[0];
    for (const pc of peersRef.current.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      await sender?.replaceTrack(videoTrack);
    }
    streamRef.current.getVideoTracks().forEach((track) => track.stop());
    streamRef.current = media;
    setStream(media);
  }, [facingMode]);

  /** Feed every signaling message concerning this camera. */
  const handleMessage = useCallback(
    async (msg: ServerMessage) => {
      if (!streamRef.current) return;
      if (msg.type === "viewer_joined") {
        const pc = createPeer((data) => send({ type: "signal", to: msg.peerId, data }));
        for (const track of streamRef.current.getTracks()) {
          pc.addTrack(track, streamRef.current);
        }
        peersRef.current.set(msg.peerId, pc);
        setViewerCount(peersRef.current.size);
        await offerTo(pc, (data) => send({ type: "signal", to: msg.peerId, data }));
      } else if (msg.type === "viewer_left") {
        peersRef.current.get(msg.peerId)?.close();
        peersRef.current.delete(msg.peerId);
        setViewerCount(peersRef.current.size);
      } else if (msg.type === "signal") {
        const pc = peersRef.current.get(msg.from);
        if (pc) {
          await applySignal(pc, msg.data, (data) =>
            send({ type: "signal", to: msg.from, data }),
          );
        }
      }
    },
    [send],
  );

  // Re-acquire the wake lock when the app comes back to the foreground.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && streamRef.current) {
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [acquireWakeLock]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    releaseWakeLock();
  }, [releaseWakeLock]);

  return { start, stop, flip, handleMessage, stream, error, facingMode, viewerCount };
}
```

- [ ] **Step 6: Implement the camera stage component**

Create `frontend/src/components/CameraStage.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const DIM_AFTER_MS = 10_000;

/** What the filming device shows: a live preview that fades to a black
 *  screen with a single red dot, so the phone lights nothing in the room. */
export default function CameraStage({
  stream,
  viewerCount,
  onFlip,
  onStop,
}: {
  stream: MediaStream;
  viewerCount: number;
  onFlip: () => void;
  onStop: () => void;
}) {
  const t = useTranslations("camera");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dimmed, setDimmed] = useState(false);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (dimmed) return;
    const timer = setTimeout(() => setDimmed(true), DIM_AFTER_MS);
    return () => clearTimeout(timer);
  }, [dimmed]);

  if (dimmed) {
    return (
      <button
        onClick={() => setDimmed(false)}
        className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black text-white/40"
      >
        <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
        <span className="text-sm">{t("tapToShow")}</span>
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-3xl bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="w-full" />
      </div>
      <p className="text-sm text-ink-soft">{t("keepForeground")}</p>
      {typeof navigator !== "undefined" && !("wakeLock" in navigator) && (
        <p className="text-sm text-danger">{t("wakeLockUnsupported")}</p>
      )}
      <p className="text-sm font-semibold text-ink">
        {t("streaming")} · {t("viewers", { count: viewerCount })}
      </p>
      <div className="flex gap-3">
        <button
          onClick={onFlip}
          className="min-h-[52px] flex-1 rounded-2xl bg-surface-2 px-4 text-base font-semibold text-ink"
        >
          {t("switchCamera")}
        </button>
        <button
          onClick={onStop}
          className="min-h-[52px] flex-1 rounded-2xl bg-danger px-4 text-base font-semibold text-white"
        >
          {t("stop")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Implement the page (camera half; the viewer half lands in Task 7)**

Create `frontend/src/app/camera/page.tsx`:

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import CameraStage from "@/components/CameraStage";
import { useCameraRole } from "@/hooks/useCameraRole";
import { useSignaling } from "@/hooks/useSignaling";
import type { CameraInfo, ServerMessage } from "@/lib/rtc/signaling";

const NAME_KEY = "bm_device_name";

export default function CameraPage() {
  const t = useTranslations("camera");
  const [camera, setCamera] = useState<CameraInfo | null>(null);
  const [name, setName] = useState("");
  const [busyName, setBusyName] = useState<string | null>(null);
  const cameraRoleRef = useRef<((msg: ServerMessage) => void) | null>(null);

  const onMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === "welcome" || msg.type === "camera_changed") setCamera(msg.camera);
    if (msg.type === "error" && msg.code === "camera_busy") setBusyName(camera?.name ?? "");
    cameraRoleRef.current?.(msg);
  }, [camera]);

  const { send, peerId } = useSignaling(onMessage);
  const role = useCameraRole(send);
  cameraRoleRef.current = (msg) => void role.handleMessage(msg);

  const deviceName = () => {
    if (name) return name;
    const stored = typeof window !== "undefined" ? localStorage.getItem(NAME_KEY) : null;
    return stored || t("defaultName");
  };

  const startCamera = async (mode: "hello" | "takeover" = "hello") => {
    const chosen = deviceName();
    localStorage.setItem(NAME_KEY, chosen);
    setBusyName(null);
    await role.start(chosen, mode);
  };

  const isThisDeviceTheCamera = camera !== null && camera.id === peerId;

  if (role.stream && isThisDeviceTheCamera) {
    return (
      <main className="mx-auto max-w-2xl p-5 pb-24">
        <CameraStage
          stream={role.stream}
          viewerCount={role.viewerCount}
          onFlip={() => void role.flip()}
          onStop={role.stop}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-5 pb-24">
      <h1 className="text-2xl font-bold text-ink">{t("title")}</h1>

      <section className="space-y-3 rounded-3xl bg-surface p-4 shadow-sm">
        <label className="block text-sm font-semibold text-ink" htmlFor="device-name">
          {t("deviceName")}
        </label>
        <input
          id="device-name"
          value={name}
          placeholder={t("defaultName")}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          className="min-h-[52px] w-full rounded-2xl bg-surface-2 px-4 text-base text-ink"
        />
        <button
          onClick={() => void startCamera()}
          className="min-h-[52px] w-full rounded-2xl bg-primary px-4 text-base font-semibold text-white"
        >
          {t("useThisDevice")}
        </button>
        {role.error && <p className="text-sm text-danger">{t("permissionDenied")}</p>}
        {busyName !== null && (
          <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
            <p className="text-sm text-ink">{t("takeoverPrompt", { name: busyName })}</p>
            <button
              onClick={() => void startCamera("takeover")}
              className="min-h-[44px] w-full rounded-2xl bg-primary px-4 text-sm font-semibold text-white"
            >
              {t("takeoverConfirm")}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 8: Verify**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/frontend" && npx tsc --noEmit && npx vitest run && npm run build
```

Expected: tsc silent, 19 tests pass, build succeeds. If `WakeLockSentinel` is not in the TS lib, add `/// <reference lib="dom" />`-level typing by declaring the minimal interface at the top of `useCameraRole.ts` rather than installing new types — do NOT add a dependency.

Then check the nav visually at 390 px with the dev server (`npm run dev`, open http://localhost:3000/camera): five tabs must fit without overflow or wrapping.

- [ ] **Step 9: Commit**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
git add frontend/src/lib/rtc/peer.ts frontend/src/hooks/useSignaling.ts frontend/src/hooks/useCameraRole.ts frontend/src/components/CameraStage.tsx frontend/src/app/camera/page.tsx frontend/src/components/BottomNav.tsx frontend/src/components/TopBar.tsx frontend/src/messages/fr.json frontend/src/messages/en.json
git commit -m "feat(camera): camera role, wake lock, dimmed stage, nav entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Viewer role (watch, sound, fullscreen)

**Files:**
- Create: `frontend/src/hooks/useViewerRole.ts`
- Create: `frontend/src/components/ViewerStage.tsx`
- Modify: `frontend/src/app/camera/page.tsx` (render the viewer half when this device is not the camera)

**Interfaces:**
- Consumes: `useSignaling` (Task 6), `createPeer`/`applySignal` (Task 6), `CameraInfo`/`ServerMessage` (Task 5).
- Produces: `useViewerRole(send)` returning `{ watch, leave, handleMessage, stream, status }` where `status` is `"idle" | "connecting" | "live" | "lost"`; `ViewerStage` component taking `{ stream, onSnapshot }`. Task 8 passes a real `onSnapshot`.

- [ ] **Step 1: Implement the viewer hook**

Create `frontend/src/hooks/useViewerRole.ts`:

```ts
"use client";

import { useCallback, useRef, useState } from "react";
import { applySignal, createPeer } from "@/lib/rtc/peer";
import type { ClientMessage, ServerMessage } from "@/lib/rtc/signaling";

export type ViewerStatus = "idle" | "connecting" | "live" | "lost";

/** Viewer side: one peer connection to the current camera. The camera is the
 *  offerer, so this side only answers and consumes the incoming tracks. */
export function useViewerRole(send: (msg: ClientMessage) => void) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("idle");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const cameraIdRef = useRef<string | null>(null);

  const teardown = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    cameraIdRef.current = null;
    setStream(null);
  }, []);

  const watch = useCallback(
    (cameraId: string) => {
      teardown();
      cameraIdRef.current = cameraId;
      setStatus("connecting");
      const pc = createPeer(
        (data) => send({ type: "signal", to: cameraId, data }),
        (incoming) => {
          setStream(incoming);
          setStatus("live");
        },
      );
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setStatus("lost");
        }
      };
      pcRef.current = pc;
      send({ type: "watch" });
    },
    [send, teardown],
  );

  const leave = useCallback(() => {
    send({ type: "stop" });
    teardown();
    setStatus("idle");
  }, [send, teardown]);

  const handleMessage = useCallback(
    async (msg: ServerMessage) => {
      if (msg.type === "signal" && pcRef.current && msg.from === cameraIdRef.current) {
        await applySignal(pcRef.current, msg.data, (data) =>
          send({ type: "signal", to: msg.from, data }),
        );
      } else if (msg.type === "camera_changed" && msg.camera === null) {
        teardown();
        setStatus("idle");
      } else if (msg.type === "error" && msg.code === "too_many_viewers") {
        teardown();
        setStatus("lost");
      }
    },
    [send, teardown],
  );

  return { watch, leave, handleMessage, stream, status };
}
```

- [ ] **Step 2: Implement the viewer stage**

Create `frontend/src/components/ViewerStage.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/** What a watching device shows. Starts muted because browsers refuse
 *  autoplay with sound; a tap on "enable sound" unmutes. */
export default function ViewerStage({
  stream,
  onSnapshot,
}: {
  stream: MediaStream;
  onSnapshot?: (video: HTMLVideoElement) => void;
}) {
  const t = useTranslations("camera");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-3xl bg-black">
        <video ref={videoRef} autoPlay playsInline muted={muted} className="w-full" />
      </div>
      <div className="flex flex-wrap gap-3">
        {muted && (
          <button
            onClick={() => setMuted(false)}
            className="min-h-[52px] flex-1 rounded-2xl bg-primary px-4 text-base font-semibold text-white"
          >
            {t("enableSound")}
          </button>
        )}
        <button
          onClick={() => void videoRef.current?.requestFullscreen?.()}
          className="min-h-[52px] flex-1 rounded-2xl bg-surface-2 px-4 text-base font-semibold text-ink"
        >
          {t("fullscreen")}
        </button>
        {onSnapshot && (
          <button
            onClick={() => videoRef.current && onSnapshot(videoRef.current)}
            className="min-h-[52px] flex-1 rounded-2xl bg-surface-2 px-4 text-base font-semibold text-ink"
          >
            📸 {t("snapshot")}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Render the viewer half in the page**

In `frontend/src/app/camera/page.tsx`, add the viewer wiring. Import the new pieces:

```tsx
import ViewerStage from "@/components/ViewerStage";
import { useViewerRole } from "@/hooks/useViewerRole";
```

Instantiate the viewer role next to the camera role, and fan messages to both (replace the single `cameraRoleRef.current = ...` line):

```tsx
  const viewer = useViewerRole(send);
  cameraRoleRef.current = (msg) => {
    void role.handleMessage(msg);
    void viewer.handleMessage(msg);
  };
```

Then, in the returned markup for the "not the camera" case, add this section **below** the existing device section:

```tsx
      <section className="space-y-3 rounded-3xl bg-surface p-4 shadow-sm">
        {camera === null || isThisDeviceTheCamera ? (
          <>
            <p className="text-base font-semibold text-ink">{t("noCamera")}</p>
            <p className="text-sm text-ink-soft">{t("noCameraHint")}</p>
          </>
        ) : viewer.stream ? (
          <ViewerStage stream={viewer.stream} />
        ) : (
          <>
            <p className="text-base font-semibold text-ink">📹 {camera.name}</p>
            {viewer.status === "lost" && <p className="text-sm text-danger">{t("lost")}</p>}
            <button
              onClick={() => viewer.watch(camera.id)}
              className="min-h-[52px] w-full rounded-2xl bg-primary px-4 text-base font-semibold text-white"
            >
              {viewer.status === "connecting"
                ? t("connecting")
                : viewer.status === "lost"
                  ? t("retry")
                  : t("watch")}
            </button>
          </>
        )}
      </section>
```

- [ ] **Step 4: Verify**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/frontend" && npx tsc --noEmit && npx vitest run && npm run build
```

Expected: tsc silent, 19 tests pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
git add frontend/src/hooks/useViewerRole.ts frontend/src/components/ViewerStage.tsx frontend/src/app/camera/page.tsx
git commit -m "feat(camera): viewer role with sound gate and fullscreen

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Snapshot capture + gallery

**Files:**
- Create: `frontend/src/lib/snapshot.ts`
- Create: `frontend/src/hooks/usePhotos.ts`
- Create: `frontend/src/components/PhotoGallery.tsx`
- Modify: `frontend/src/app/camera/page.tsx` (pass `onSnapshot`, render the gallery)
- Modify: `frontend/src/lib/types.ts` (add the `Photo` type)
- Test: `frontend/src/lib/__tests__/snapshot.test.ts`

**Interfaces:**
- Consumes: `POST/GET/DELETE /api/photos` (Task 4); `ViewerStage`'s `onSnapshot(video)` (Task 7).
- Produces: `type Photo = { id: number; takenAt: string; width: number; height: number }` in `@/lib/types`; `fitWithin(width, height, max): { width: number; height: number }` in `@/lib/snapshot`; `usePhotos()` / `useUploadPhoto()` / `useDeletePhoto()` hooks; `PhotoGallery` component.

- [ ] **Step 1: Write the failing test for the pure resize maths**

Create `frontend/src/lib/__tests__/snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fitWithin, MAX_SNAPSHOT_PX } from "@/lib/snapshot";

describe("fitWithin", () => {
  it("leaves small images untouched", () => {
    expect(fitWithin(640, 480, 1280)).toEqual({ width: 640, height: 480 });
  });

  it("scales a landscape image down to the cap on its long side", () => {
    expect(fitWithin(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it("scales a portrait image down to the cap on its long side", () => {
    expect(fitWithin(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 });
  });

  it("never returns a zero dimension", () => {
    expect(fitWithin(4000, 3, 1280)).toEqual({ width: 1280, height: 1 });
  });

  it("exposes a sane default cap", () => {
    expect(MAX_SNAPSHOT_PX).toBe(1280);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/frontend" && npx vitest run src/lib/__tests__/snapshot.test.ts
```

Expected: FAIL — cannot resolve `@/lib/snapshot`.

- [ ] **Step 3: Implement the snapshot helper**

Create `frontend/src/lib/snapshot.ts`:

```ts
export const MAX_SNAPSHOT_PX = 1280;
export const SNAPSHOT_QUALITY = 0.8;

/** Scale (w, h) so the long side is at most `max`, keeping the aspect ratio. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const ratio = max / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** Freeze the current frame of a playing <video> into a JPEG blob. */
export async function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const { width, height } = fitWithin(
    video.videoWidth,
    video.videoHeight,
    MAX_SNAPSHOT_PX,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", SNAPSHOT_QUALITY),
  );
  if (!blob) throw new Error("snapshot failed");
  return blob;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/frontend" && npx vitest run src/lib/__tests__/snapshot.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Add the type and the data hooks**

In `frontend/src/lib/types.ts`, append:

```ts
export type Photo = {
  id: number;
  takenAt: string;
  width: number;
  height: number;
};
```

Create `frontend/src/hooks/usePhotos.ts` (mirrors the shape of `useMeasurements.ts`; the upload posts a raw JPEG body, so it uses `fetch` directly rather than the JSON `api` client):

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { toast } from "@/components/Toast";
import type { Photo } from "@/lib/types";

export function usePhotos() {
  return useQuery<Photo[]>({
    queryKey: ["photos"],
    queryFn: async () => (await api.get<{ photos: Photo[] }>("/api/photos")).photos,
  });
}

export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (blob: Blob) => {
      const res = await fetch("/api/photos", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { photo: Photo };
    },
    onError: () => toast("error"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["photos"] }),
  });
}

export function useDeletePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/photos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
    },
    onError: () => toast("error"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["photos"] }),
  });
}
```

- [ ] **Step 6: Implement the gallery**

Create `frontend/src/components/PhotoGallery.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useDeletePhoto, usePhotos } from "@/hooks/usePhotos";

export default function PhotoGallery() {
  const t = useTranslations("camera");
  const { data: photos = [] } = usePhotos();
  const remove = useDeletePhoto();

  return (
    <section className="space-y-3 rounded-3xl bg-surface p-4 shadow-sm">
      <h2 className="text-base font-semibold text-ink">{t("gallery")}</h2>
      {photos.length === 0 ? (
        <p className="text-sm text-ink-soft">{t("galleryEmpty")}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <li key={photo.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated
                  bytes served by our own API; next/image would need a loader. */}
              <img
                src={`/api/photos/${photo.id}`}
                alt=""
                className="aspect-square w-full rounded-2xl object-cover"
              />
              <button
                onClick={() => {
                  if (confirm(t("confirmDeletePhoto"))) remove.mutate(photo.id);
                }}
                aria-label={t("confirmDeletePhoto")}
                className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-sm text-white"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Wire capture and gallery into the page**

In `frontend/src/app/camera/page.tsx`, add the imports:

```tsx
import PhotoGallery from "@/components/PhotoGallery";
import { captureFrame } from "@/lib/snapshot";
import { useUploadPhoto } from "@/hooks/usePhotos";
```

Add the mutation next to the other hooks:

```tsx
  const upload = useUploadPhoto();
```

Pass the handler to `ViewerStage`:

```tsx
          <ViewerStage
            stream={viewer.stream}
            onSnapshot={(video) => void captureFrame(video).then((blob) => upload.mutate(blob))}
          />
```

And render `<PhotoGallery />` as the last section of the non-camera branch, after the viewer section.

- [ ] **Step 8: Verify**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/frontend" && npx tsc --noEmit && npx vitest run && npm run build
```

Expected: tsc silent, 24 tests pass, build succeeds.

- [ ] **Step 9: Commit**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
git add frontend/src/lib/snapshot.ts frontend/src/hooks/usePhotos.ts frontend/src/components/PhotoGallery.tsx frontend/src/app/camera/page.tsx frontend/src/lib/types.ts frontend/src/lib/__tests__/snapshot.test.ts
git commit -m "feat(photos): snapshot capture and gallery on the camera page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Documentation + dev configuration

**Files:**
- Modify: `README.md` (new "Baby monitor (camera)" section)
- Modify: `frontend/.env.example` (document `NEXT_PUBLIC_RTC_URL`)

**Interfaces:**
- Consumes: everything built in Tasks 1–8.
- Produces: the user-facing runbook and the manual two-device verification protocol.

- [ ] **Step 1: Document the dev override**

In `frontend/.env.example`, add (keeping the file's existing comment style):

```
# Signaling websocket for the baby monitor. In production the app derives it
# from the page origin (wss://<domain>/rtc) and this stays unset. In dev, the
# Next server on :3000 does not proxy websockets, so point it at the backend:
# NEXT_PUBLIC_RTC_URL=ws://localhost:8000/rtc
```

- [ ] **Step 2: Add the README section**

In `README.md`, after the MCP section, add:

```markdown
## Baby monitor (camera)

The **Caméra** tab turns any logged-in device into a live monitor.

- On the phone that should film: open the tab, name the device (e.g. "Chambre"),
  tap **Utiliser cet appareil comme caméra**, and grant camera + microphone access.
  After 10 seconds the screen goes black with a small red dot — tap to bring the
  preview back.
- On any other logged-in device: the camera appears with a **Regarder** button.
  Sound starts muted (browsers forbid autoplay with sound) — tap **Activer le son**.
  **Photo** freezes the current frame and stores it in the gallery below.

How it works: video and audio go **directly from device to device** (WebRTC) over
your wifi. The server only introduces the two devices, over a websocket at `/rtc`
protected by the same secret phrase as the app; it never sees, relays or records
the stream. Snapshots are the only thing stored, as rows in Postgres — so they are
included in the `pg_dump` backup taken before every deploy, and capped at the 200
most recent.

Limits, by design:

- The filming phone must stay **plugged in, app open and screen on**. Locking it or
  switching apps stops the stream — a browser limitation on iOS and Android.
- Same wifi only. Watching from outside would need a relay (TURN) server, which is
  deliberately not part of this version.
- Streaming state lives in memory, so a backend restart (every deploy) ends the
  session: viewers reconnect on their own, the camera is restarted with one tap.
- One camera at a time. Starting a second one asks to replace the first.
```

- [ ] **Step 3: Verify the whole project one last time**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks/backend" && BM_TEST_DATABASE_URL=postgresql://baby:baby@localhost:5432/baby_marks uv run pytest -q
cd "/Users/lorenzo/Desktop/Projects /baby_marks/frontend" && npx vitest run && npx tsc --noEmit && npm run build
```

Expected: 124 backend passed, 24 frontend passed, tsc silent, build succeeds.

- [ ] **Step 4: Commit**

```bash
cd "/Users/lorenzo/Desktop/Projects /baby_marks"
git add README.md frontend/.env.example
git commit -m "docs: baby monitor usage, limits and dev signaling override

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Manual verification protocol (session controller + user, after Task 9)

Automated tests cannot exercise real cameras, so this runs on two real devices on the home wifi, against the deployed app:

1. **Phone** (the camera): open `https://baby.canastrat.com/camera`, name it « Chambre », tap **Utiliser cet appareil comme caméra**, allow camera + microphone. Expect the live preview, then a black screen with a red dot after 10 s; tap it to restore the preview.
2. **Tablet** (the viewer): open the same page. Expect « 📹 Chambre » with a **Regarder** button. Tap it → the video appears within a few seconds.
3. Tap **Activer le son** on the tablet → you hear the room. Speak near the phone to confirm.
4. Tap **Plein écran** → the video fills the screen; exit.
5. Tap **📸 Photo** → a thumbnail appears in the gallery below within a second. Reload the page → it is still there.
6. Tap ✕ on the thumbnail, confirm → it disappears.
7. On the phone, tap **Arrêter la diffusion** → the tablet shows « Aucune caméra active » within a couple of seconds.
8. Lock the phone while streaming → confirm the documented limit: the tablet loses the stream. Unlock and restart the camera with one tap.
9. Try a second camera: start streaming on a third device (or the tablet) → expect the « remplacer ? » prompt; confirming switches the camera and the other viewer follows.
