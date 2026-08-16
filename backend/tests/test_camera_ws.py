"""WebSocket-level tests for /rtc.

These mount ONLY the camera router on a bare FastAPI app -- no lifespan, so no
database is needed and these run in every environment.
"""

import os

import anyio
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("APP_SECRET_PHRASE", "test-secret")

from app.auth import COOKIE_NAME, compute_auth_token  # noqa: E402
from app.camera import ws as camera_ws  # noqa: E402
from app.camera.hub import Action, CameraHub  # noqa: E402


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


def test_binary_frame_is_rejected_without_closing(client):
    with client.websocket_connect("/rtc") as ws:
        ws.receive_json()
        ws.send_bytes(b"\x00\x01\x02")
        assert ws.receive_json() == {"type": "error", "code": "bad_message"}
        # Connection still usable:
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


class _FakeSocket:
    """Minimal stand-in for a WebSocket, exposing only what `_deliver` uses."""

    def __init__(self, *, fails: bool = False) -> None:
        self.fails = fails
        self.received: list[dict] = []

    async def send_json(self, payload: dict) -> None:
        if self.fails:
            raise anyio.ClosedResourceError()
        self.received.append(payload)


async def test_deliver_isolates_one_peers_send_failure_from_another(client):
    dead = _FakeSocket(fails=True)
    alive = _FakeSocket()
    camera_ws._sockets["dead"] = dead
    camera_ws._sockets["alive"] = alive
    try:
        # Should not raise, even though `dead`'s send_json blows up with an
        # anyio error that isn't RuntimeError or WebSocketDisconnect.
        await camera_ws._deliver(
            [
                Action(to="dead", payload={"type": "ping"}),
                Action(to="alive", payload={"type": "ping"}),
            ]
        )
    finally:
        camera_ws._sockets.pop("dead", None)
        camera_ws._sockets.pop("alive", None)
    assert alive.received == [{"type": "ping"}]


def test_camera_disconnect_notifies_remaining_peers(client):
    with client.websocket_connect("/rtc") as viewer:
        viewer.receive_json()
        with client.websocket_connect("/rtc") as cam:
            cam.receive_json()
            cam.send_json({"type": "hello", "role": "camera", "name": "Chambre"})
            cam.receive_json()
            assert viewer.receive_json()["camera"]["name"] == "Chambre"
        assert viewer.receive_json() == {"type": "camera_changed", "camera": None}
