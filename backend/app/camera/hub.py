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
        # Every viewer session dies the moment the camera changes: the old
        # camera's peer connections are gone and the new camera never receives
        # `viewer_joined` for them, so keeping them in `_watchers` would only
        # burn viewer slots until each client happens to send `stop` (a frozen
        # mobile tab never does). Clients already tolerate a `stop` for a peer
        # no longer in the set, so dropping them all here is safe.
        self._watchers.clear()
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
            if peer_id in self._watchers:
                # Already watching: re-emitting `viewer_joined` would make the
                # camera build a second RTCPeerConnection for the same viewer
                # and orphan the first one, so a client looping `watch` could
                # pile ICE agents on the filming phone. Nothing to do.
                return []
            if len(self._watchers) >= MAX_VIEWERS:
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
