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
        except Exception:
            # Broad catch is deliberate and scoped to this one peer's send:
            # real transports (uvicorn/anyio) raise anyio.ClosedResourceError /
            # anyio.BrokenResourceError -- not just RuntimeError or
            # WebSocketDisconnect -- when the peer dropped without a clean
            # close (e.g. a phone losing wifi). Letting that escape here would
            # abort delivery to the remaining peers in this batch and would be
            # attributed to whichever peer's message triggered the broadcast,
            # not the dead one. The dead peer's own receive loop / `finally`
            # is what actually evicts it from `_sockets` and the hub, so it's
            # safe to just swallow the failure and move on.
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
            frame = await websocket.receive()
            if frame["type"] == "websocket.disconnect":
                # Mirrors the WebSocketDisconnect path below: client hung up
                # cleanly, stop the loop instead of calling receive() again
                # (Starlette raises RuntimeError if you do).
                break
            if "text" not in frame:
                # Binary (or any other non-text) frame: per spec this is a
                # malformed message, not a fatal error -- report it and keep
                # the connection open, same as oversized/non-JSON frames.
                await _deliver([Action(to=peer_id, payload={"type": "error", "code": "bad_message"})])
                continue
            raw = frame["text"]
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
