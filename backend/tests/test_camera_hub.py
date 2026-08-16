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
