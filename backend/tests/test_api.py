"""API tests against a real Postgres. Skipped unless BM_TEST_DATABASE_URL is set.

Run locally with the docker-compose Postgres:
    BM_TEST_DATABASE_URL=postgresql://baby:baby@localhost:5432/baby_marks uv run pytest tests/test_api.py
"""

import os

import pytest

DB_URL = os.environ.get("BM_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not DB_URL, reason="BM_TEST_DATABASE_URL not set")

if DB_URL:
    os.environ["DATABASE_URL"] = DB_URL
os.environ.setdefault("APP_SECRET_PHRASE", "test-secret")


@pytest.fixture
async def client():
    from httpx import ASGITransport, AsyncClient

    from app import db as db_module
    from app.auth import COOKIE_NAME, compute_auth_token
    from app.main import app

    await db_module.run_migrations()
    pool = await db_module.get_pool()
    await pool.execute("DELETE FROM events; DELETE FROM measurements; DELETE FROM babies;")

    token = compute_auth_token(os.environ["APP_SECRET_PHRASE"])
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        cookies={COOKIE_NAME: token},
    ) as c:
        yield c
    await db_module.close_pool()


async def seed_baby(client) -> None:
    res = await client.post("/api/baby", json={"name": "Test", "birthDate": "2026-06-01"})
    assert res.status_code == 201


async def test_requires_auth(client):
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon:
        res = await anon.get("/api/events")
    assert res.status_code == 401
    assert res.json()["error"] == "unauthenticated"


async def test_timer_survives_refetch_and_stops(client):
    await seed_baby(client)
    res = await client.post(
        "/api/events",
        json={
            "type": "sleep",
            "startedAt": "2026-07-15T10:00:00Z",
            "endedAt": None,
            "details": {},
            "caregiver": "maman",
        },
    )
    assert res.status_code == 201
    event = res.json()["event"]
    assert event["endedAt"] is None

    # Simulates a page refresh: the running timer comes back from the API.
    res = await client.get("/api/events")
    running = res.json()["running"]
    assert [e["id"] for e in running] == [event["id"]]
    assert running[0]["startedAt"] == "2026-07-15T10:00:00.000Z"

    res = await client.patch(
        f"/api/events/{event['id']}", json={"endedAt": "2026-07-15T11:00:00Z"}
    )
    assert res.status_code == 200
    assert res.json()["event"]["endedAt"] == "2026-07-15T11:00:00.000Z"

    res = await client.get("/api/events")
    assert res.json()["running"] == []


async def test_one_running_timer_per_type(client):
    await seed_baby(client)
    body = {
        "type": "feed",
        "startedAt": "2026-07-15T10:00:00Z",
        "endedAt": None,
        "details": {"method": "breast", "side": "left"},
        "caregiver": "papa",
    }
    assert (await client.post("/api/events", json=body)).status_code == 201
    res = await client.post("/api/events", json=body)
    assert res.status_code == 409
    assert res.json()["error"] == "timer_running"


async def test_point_events_require_ended_at(client):
    await seed_baby(client)
    res = await client.post(
        "/api/events",
        json={
            "type": "diaper",
            "startedAt": "2026-07-15T10:00:00Z",
            "endedAt": None,
            "details": {"kind": "wet"},
            "caregiver": "maman",
        },
    )
    assert res.status_code == 400
    assert res.json()["error"] == "invalid"


async def test_patch_details_null_coerced_to_empty_dict(client):
    await seed_baby(client)
    res = await client.post(
        "/api/events",
        json={
            "type": "sleep",
            "startedAt": "2026-07-15T10:00:00Z",
            "endedAt": "2026-07-15T11:00:00Z",
            "details": {},
            "caregiver": "maman",
        },
    )
    assert res.status_code == 201
    event_id = res.json()["event"]["id"]

    # Explicit null for a type whose details may be empty ({}) validates fine.
    res = await client.patch(f"/api/events/{event_id}", json={"details": None})
    assert res.status_code == 200
    assert res.json()["event"]["details"] == {}

    # Explicit null for a type that requires fields in details is a 400, never a 500.
    res = await client.post(
        "/api/events",
        json={
            "type": "diaper",
            "startedAt": "2026-07-15T10:00:00Z",
            "endedAt": "2026-07-15T10:00:00Z",
            "details": {"kind": "wet"},
            "caregiver": "maman",
        },
    )
    assert res.status_code == 201
    diaper_id = res.json()["event"]["id"]

    res = await client.patch(f"/api/events/{diaper_id}", json={"details": None})
    assert res.status_code == 400
    assert res.json()["error"] == "invalid"


async def test_baby_singleton(client):
    await seed_baby(client)
    res = await client.post("/api/baby", json={"name": "Two", "birthDate": "2026-06-02"})
    assert res.status_code == 409
    assert res.json()["error"] == "baby_exists"


async def test_measurements_roundtrip(client):
    await seed_baby(client)
    res = await client.post(
        "/api/measurements", json={"measuredAt": "2026-07-10", "weightG": 4200}
    )
    assert res.status_code == 201
    mid = res.json()["measurement"]["id"]

    res = await client.get("/api/measurements")
    assert len(res.json()["measurements"]) == 1

    assert (await client.delete(f"/api/measurements/{mid}")).status_code == 200
    res = await client.get("/api/measurements")
    assert res.json()["measurements"] == []


async def test_stats_endpoint(client):
    await seed_baby(client)
    await client.post(
        "/api/events",
        json={
            "type": "diaper",
            "startedAt": "2026-07-15T10:00:00Z",
            "endedAt": "2026-07-15T10:00:00Z",
            "details": {"kind": "both"},
            "caregiver": "maman",
        },
    )
    res = await client.get("/api/stats?days=7&tzOffset=0")
    assert res.status_code == 200
    assert len(res.json()["days"]) == 7
