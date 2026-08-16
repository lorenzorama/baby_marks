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
