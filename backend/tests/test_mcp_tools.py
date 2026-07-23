"""Failing-first test suite for backend/app/mcp/server.py (the five MCP
tools) + the `/mcp` mount and bearer gating wired in backend/app/main.py,
per .superpowers/sdd/task-5-brief.md.

Design note -- why this is fewer, larger test functions than usual: FastMCP's
underlying `mcp.server.streamable_http_manager.StreamableHTTPSessionManager`
documents itself as **single-use** ("Important: Only one
StreamableHTTPSessionManager instance should be created per application. The
instance cannot be reused after its run() context has completed."), and
`app/main.py`'s `mcp_app` (and its session manager) is a process-wide
singleton built once at import time. Since pytest caches `app.main` across
the whole test session, driving its lifespan (`async with
mcp_app.lifespan(app): ...`, required per NOTES.md item 3 because
`httpx.ASGITransport` never fires real ASGI lifespan events) more than once
anywhere in this file raises `RuntimeError` the second time. So every
assertion that needs the mounted `/mcp` endpoint to actually be running
lives inside ONE `async with mcp_app.lifespan(app):` block, entered exactly
once for the whole module. Assertions that never reach `mcp_app` at all (the
bearer-gate 401 check, `/api/health`) are ordinary standalone tests.

Covers task-5-brief.md Step 1: seed a baby ("Theana") + a full day of events
(a midnight-spanning sleep, a breast feed, a bottle feed, two diapers, a
medicine) + two measurements directly via SQL (DB-gated on
BM_TEST_DATABASE_URL, exactly like tests/test_api.py), then drive the
*actual mounted* `/mcp` Streamable HTTP endpoint with a real
`mint_access_token` bearer per app/mcp/NOTES.md item 5's ASGI-transport
recipe -- this exercises tool logic AND the bearer gate together, since a
missing/invalid token never reaches the tools at all. Plus two ungated
checks: without a token -> 401 + WWW-Authenticate; with a valid token ->
not 401.
"""

import os
from datetime import date, datetime, timezone

import pytest

DB_URL = os.environ.get("BM_TEST_DATABASE_URL")

MCP_ACCESS_SECRET = "test-mcp-secret"
MCP_JWT_SECRET = "test-jwt"
MCP_PUBLIC_URL = "https://test.local"

if DB_URL:
    os.environ["DATABASE_URL"] = DB_URL
os.environ.setdefault("APP_SECRET_PHRASE", "test-secret")

EXPECTED_TOOL_NAMES = sorted(
    [
        "get_daily_summary",
        "get_sleep_stats",
        "get_feedings",
        "get_diapers",
        "get_measurements",
    ]
)


@pytest.fixture(autouse=True)
def mcp_env(monkeypatch):
    monkeypatch.setenv("MCP_ACCESS_SECRET", MCP_ACCESS_SECRET)
    monkeypatch.setenv("MCP_JWT_SECRET", MCP_JWT_SECRET)
    monkeypatch.setenv("MCP_PUBLIC_URL", MCP_PUBLIC_URL)


def _bearer_httpx_client_factory(app, token: str):
    """NOTES.md item 5's ASGI httpx_client_factory recipe, extended to always
    inject `Authorization: Bearer <token>` into whatever headers FastMCP's
    StreamableHttpTransport passes along (merged, not replaced -- the
    transport sets its own Accept/Content-Type headers)."""
    import httpx
    from httpx import ASGITransport

    def factory(*, headers=None, auth=None, follow_redirects=True, timeout=None):
        merged_headers = dict(headers or {})
        merged_headers["Authorization"] = f"Bearer {token}"
        kwargs: dict = {
            "transport": ASGITransport(app=app),
            "base_url": "http://testserver",
            "follow_redirects": follow_redirects,
            "headers": merged_headers,
        }
        if auth is not None:
            kwargs["auth"] = auth
        if timeout is not None:
            kwargs["timeout"] = timeout
        return httpx.AsyncClient(**kwargs)

    return factory


async def _seed(pool) -> None:
    """Baby "Theana" + a midnight-spanning sleep, a breast feed, a bottle
    feed, two diapers, a medicine, and two measurements, per
    task-5-brief.md Step 1."""
    baby_id = await pool.fetchval(
        "INSERT INTO babies (name, birth_date) VALUES ($1, $2) RETURNING id",
        "Theana",
        date(2026, 1, 1),
    )

    # Midnight-spanning sleep: 23:00 Jul 22 UTC -> 01:30 Jul 23 UTC (90 min
    # of it falls on the 23rd's local UTC day, 60 min on the 22nd's).
    await pool.execute(
        "INSERT INTO events (baby_id, type, started_at, ended_at, details, caregiver) "
        "VALUES ($1, 'sleep', $2, $3, '{}'::jsonb, 'maman')",
        baby_id,
        datetime(2026, 7, 22, 23, 0, tzinfo=timezone.utc),
        datetime(2026, 7, 23, 1, 30, tzinfo=timezone.utc),
    )
    # Breast feed. NB: `details` is passed as a Python dict, not a
    # pre-serialized JSON string -- app/db.py registers a jsonb type codec
    # (encoder=json.dumps) on every pool connection, so a dict is encoded
    # correctly, but a Python str would be double-encoded (json.dumps of a
    # string produces a JSON string scalar, not the object callers expect;
    # decoding it back then hands the summaries code a `str` where it
    # expects a `dict`). app/routes/events.py's own inserts pass dicts the
    # same way, uncast.
    await pool.execute(
        "INSERT INTO events (baby_id, type, started_at, ended_at, details, caregiver) "
        "VALUES ($1, 'feed', $2, $3, $4, 'papa')",
        baby_id,
        datetime(2026, 7, 23, 8, 0, tzinfo=timezone.utc),
        datetime(2026, 7, 23, 8, 20, tzinfo=timezone.utc),
        {"method": "breast", "side": "left"},
    )
    # Bottle feed.
    await pool.execute(
        "INSERT INTO events (baby_id, type, started_at, ended_at, details, caregiver) "
        "VALUES ($1, 'feed', $2, $3, $4, 'maman')",
        baby_id,
        datetime(2026, 7, 23, 12, 0, tzinfo=timezone.utc),
        datetime(2026, 7, 23, 12, 10, tzinfo=timezone.utc),
        {"method": "bottle", "amountMl": 90},
    )
    # Diapers (point events: started_at == ended_at).
    await pool.execute(
        "INSERT INTO events (baby_id, type, started_at, ended_at, details, caregiver) "
        "VALUES ($1, 'diaper', $2, $2, $3, 'papa')",
        baby_id,
        datetime(2026, 7, 23, 9, 0, tzinfo=timezone.utc),
        {"kind": "wet"},
    )
    await pool.execute(
        "INSERT INTO events (baby_id, type, started_at, ended_at, details, caregiver) "
        "VALUES ($1, 'diaper', $2, $2, $3, 'maman')",
        baby_id,
        datetime(2026, 7, 23, 15, 0, tzinfo=timezone.utc),
        {"kind": "dirty"},
    )
    # Medicine.
    await pool.execute(
        "INSERT INTO events (baby_id, type, started_at, ended_at, details, caregiver) "
        "VALUES ($1, 'medicine', $2, $2, $3, 'papa')",
        baby_id,
        datetime(2026, 7, 23, 7, 30, tzinfo=timezone.utc),
        {"name": "Vit D"},
    )
    # Two measurements -- only the second lands on 2026-07-23.
    await pool.execute(
        "INSERT INTO measurements (baby_id, measured_at, weight_g) VALUES ($1, $2, $3)",
        baby_id,
        date(2026, 7, 10),
        4000,
    )
    await pool.execute(
        "INSERT INTO measurements (baby_id, measured_at, weight_g) VALUES ($1, $2, $3)",
        baby_id,
        date(2026, 7, 23),
        4200,
    )


# ---------------------------------------------------------------------------
# Ungated: bearer gate on /mcp without touching the FastMCP session manager
# ---------------------------------------------------------------------------


async def test_mcp_without_token_401_with_www_authenticate():
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        res = await c.post("/mcp", json={"jsonrpc": "2.0", "method": "ping", "id": 1})

    assert res.status_code == 401
    www_auth = res.headers["www-authenticate"]
    assert www_auth.startswith("Bearer ")
    assert f'resource_metadata="{MCP_PUBLIC_URL}/.well-known/oauth-protected-resource"' in www_auth


async def test_api_health_still_200_and_untouched():
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        res = await c.get("/api/health")

    assert res.status_code == 200
    assert res.json() == {"ok": True}


# ---------------------------------------------------------------------------
# The one test that runs the mounted /mcp endpoint for real (see module
# docstring for why this is a single test rather than several).
# ---------------------------------------------------------------------------


async def test_mcp_gate_passthrough_and_tools_over_http():
    from httpx import ASGITransport, AsyncClient

    from app.main import app, mcp_app
    from app.mcp.tokens import mint_access_token

    token = mint_access_token(MCP_JWT_SECRET)

    async with mcp_app.lifespan(app):
        # Ungated check: a request with a *valid* bearer reaches the mounted
        # FastMCP app instead of being rejected by the gate (no DB needed).
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            res = await c.post(
                "/mcp",
                json={"jsonrpc": "2.0", "method": "ping", "id": 1},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json, text/event-stream",
                },
            )
        assert res.status_code != 401

        if not DB_URL:
            pytest.skip("BM_TEST_DATABASE_URL not set; skipping DB-gated tool assertions")

        from fastmcp import Client
        from fastmcp.client.transports import StreamableHttpTransport

        from app import db as db_module

        await db_module.run_migrations()
        pool = await db_module.get_pool()
        await pool.execute("DELETE FROM events; DELETE FROM measurements; DELETE FROM babies;")
        await _seed(pool)

        transport = StreamableHttpTransport(
            "http://testserver/mcp",
            httpx_client_factory=_bearer_httpx_client_factory(app, token),
        )

        try:
            async with Client(transport) as client:
                tools = await client.list_tools()
                assert sorted(t.name for t in tools) == EXPECTED_TOOL_NAMES

                summary = (
                    await client.call_tool(
                        "get_daily_summary", {"date": "2026-07-23", "timezone": "UTC"}
                    )
                ).data
                assert summary["baby_name"] == "Theana"
                assert summary["sleep"]["total_minutes"] == 90
                assert summary["feeds"]["count"] == 2
                assert summary["feeds"]["breast_count"] == 1
                assert summary["feeds"]["bottle_count"] == 1
                assert summary["feeds"]["bottle_ml"] == 90
                assert summary["diapers"]["wet"] == 1
                assert summary["diapers"]["dirty"] == 1
                assert summary["diapers"]["total"] == 2
                assert summary["medicines"][0]["name"] == "Vit D"
                assert len(summary["measurements"]) == 1
                assert summary["measurements"][0]["weight_g"] == 4200

                feedings = (
                    await client.call_tool(
                        "get_feedings", {"date": "2026-07-23", "timezone": "UTC"}
                    )
                ).data
                assert [f["method"] for f in feedings] == ["breast", "bottle"]

                diapers = (
                    await client.call_tool(
                        "get_diapers", {"date": "2026-07-23", "timezone": "UTC"}
                    )
                ).data
                assert [d["kind"] for d in diapers] == ["wet", "dirty"]

                sleep_result = (
                    await client.call_tool(
                        "get_sleep_stats",
                        {
                            "start_date": "2026-07-22",
                            "end_date": "2026-07-23",
                            "timezone": "UTC",
                        },
                    )
                ).data
                days = {d["date"]: d for d in sleep_result["days"]}
                assert days["2026-07-22"]["total_minutes"] == 60
                assert days["2026-07-23"]["total_minutes"] == 90

                measurements = (
                    await client.call_tool("get_measurements", {"limit": 1})
                ).data
                assert len(measurements) == 1
                assert measurements[0]["weight_g"] == 4200

                from fastmcp.exceptions import ToolError

                with pytest.raises(ToolError):
                    await client.call_tool(
                        "get_daily_summary", {"date": "not-a-date", "timezone": "UTC"}
                    )
        finally:
            await db_module.close_pool()
