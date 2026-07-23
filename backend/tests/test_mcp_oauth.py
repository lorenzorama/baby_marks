"""Failing-first test suite for backend/app/mcp/oauth.py — OAuth 2.1 endpoints
(metadata, DCR, secret-gated authorize, PKCE token exchange, refresh rotation)
per .superpowers/sdd/task-4-brief.md.

Pure-shape tests (metadata) run ungated. DB-backed tests (DCR persistence,
authorize->code->token, refresh rotation) are gated on BM_TEST_DATABASE_URL,
exactly like tests/test_api.py.
"""

import base64
import hashlib
import os
import secrets
import time
from urllib.parse import parse_qs, urlsplit

import pytest

DB_URL = os.environ.get("BM_TEST_DATABASE_URL")

MCP_ACCESS_SECRET = "test-mcp-secret"
MCP_JWT_SECRET = "test-jwt"
MCP_PUBLIC_URL = "https://test.local"

if DB_URL:
    os.environ["DATABASE_URL"] = DB_URL
os.environ.setdefault("APP_SECRET_PHRASE", "test-secret")


@pytest.fixture(autouse=True)
def mcp_env(monkeypatch):
    monkeypatch.setenv("MCP_ACCESS_SECRET", MCP_ACCESS_SECRET)
    monkeypatch.setenv("MCP_JWT_SECRET", MCP_JWT_SECRET)
    monkeypatch.setenv("MCP_PUBLIC_URL", MCP_PUBLIC_URL)


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(32)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    return verifier, challenge


# ---------------------------------------------------------------------------
# Pure-shape metadata tests (no DB)
# ---------------------------------------------------------------------------


async def test_authorization_server_metadata_shape():
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        res = await c.get("/.well-known/oauth-authorization-server")
    assert res.status_code == 200
    body = res.json()
    assert body["issuer"] == MCP_PUBLIC_URL
    assert body["authorization_endpoint"] == f"{MCP_PUBLIC_URL}/authorize"
    assert body["token_endpoint"] == f"{MCP_PUBLIC_URL}/token"
    assert body["registration_endpoint"] == f"{MCP_PUBLIC_URL}/register"
    assert body["code_challenge_methods_supported"] == ["S256"]
    assert set(["authorization_code", "refresh_token"]).issubset(
        set(body["grant_types_supported"])
    )


async def test_protected_resource_metadata_shape():
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        res = await c.get("/.well-known/oauth-protected-resource")
    assert res.status_code == 200
    body = res.json()
    assert body["resource"] == f"{MCP_PUBLIC_URL}/mcp"
    assert body["authorization_servers"] == [MCP_PUBLIC_URL]


async def test_well_known_mcp_suffix_variants_served():
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        as_res = await c.get("/.well-known/oauth-authorization-server/mcp")
        pr_res = await c.get("/.well-known/oauth-protected-resource/mcp")
    assert as_res.status_code == 200
    assert as_res.json()["issuer"] == MCP_PUBLIC_URL
    assert pr_res.status_code == 200
    assert pr_res.json()["resource"] == f"{MCP_PUBLIC_URL}/mcp"


# ---------------------------------------------------------------------------
# DB-gated tests
# ---------------------------------------------------------------------------

pytestmark_db = pytest.mark.skipif(not DB_URL, reason="BM_TEST_DATABASE_URL not set")


@pytest.fixture
async def client():
    if not DB_URL:
        pytest.skip("BM_TEST_DATABASE_URL not set")

    from httpx import ASGITransport, AsyncClient

    from app import db as db_module
    from app.main import app

    await db_module.run_migrations()
    pool = await db_module.get_pool()
    await pool.execute("DELETE FROM mcp_refresh_tokens; DELETE FROM mcp_clients;")

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test", follow_redirects=False
    ) as c:
        yield c
    await db_module.close_pool()


async def register_client(client, redirect_uri="https://claude.ai/callback") -> dict:
    res = await client.post(
        "/register",
        json={"redirect_uris": [redirect_uri], "client_name": "Test Client"},
    )
    assert res.status_code == 201, res.text
    return res.json()


async def test_dcr_happy_path_persists_client(client):
    from app import db as db_module

    body = await register_client(client)
    assert body["redirect_uris"] == ["https://claude.ai/callback"]
    assert body["client_id"]

    pool = await db_module.get_pool()
    row = await pool.fetchrow(
        "SELECT client_id, redirect_uris, client_name FROM mcp_clients WHERE client_id=$1",
        body["client_id"],
    )
    assert row is not None
    assert row["redirect_uris"] == ["https://claude.ai/callback"]
    assert row["client_name"] == "Test Client"


async def test_dcr_rejects_evil_redirect(client):
    res = await client.post(
        "/register",
        json={"redirect_uris": ["https://evil.example.com/callback"]},
    )
    assert res.status_code == 400
    assert res.json()["error"] == "invalid_redirect_uri"


async def test_dcr_rejects_mixed_good_and_evil_redirects(client):
    res = await client.post(
        "/register",
        json={
            "redirect_uris": [
                "https://claude.ai/callback",
                "https://evil.example.com/callback",
            ]
        },
    )
    assert res.status_code == 400
    assert res.json()["error"] == "invalid_redirect_uri"


async def test_authorize_get_renders_form(client):
    registered = await register_client(client)
    verifier, challenge = pkce_pair()

    res = await client.get(
        "/authorize",
        params={
            "client_id": registered["client_id"],
            "redirect_uri": "https://claude.ai/callback",
            "state": "xyz123",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "response_type": "code",
        },
    )
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert 'name="secret"' in res.text
    assert registered["client_id"] in res.text
    assert "https://claude.ai/callback" in res.text
    assert challenge in res.text
    assert "xyz123" in res.text


async def test_authorize_get_unknown_client_400(client):
    verifier, challenge = pkce_pair()
    res = await client.get(
        "/authorize",
        params={
            "client_id": "does-not-exist",
            "redirect_uri": "https://claude.ai/callback",
            "state": "xyz",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "response_type": "code",
        },
    )
    assert res.status_code == 400


async def test_authorize_get_mismatched_redirect_400(client):
    registered = await register_client(client)
    verifier, challenge = pkce_pair()
    res = await client.get(
        "/authorize",
        params={
            "client_id": registered["client_id"],
            "redirect_uri": "https://claude.ai/other-callback",
            "state": "xyz",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "response_type": "code",
        },
    )
    assert res.status_code == 400


async def test_authorize_post_wrong_secret_re_renders_and_dampens(client):
    registered = await register_client(client)
    verifier, challenge = pkce_pair()
    form = {
        "client_id": registered["client_id"],
        "redirect_uri": "https://claude.ai/callback",
        "state": "xyz",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "response_type": "code",
        "secret": "wrong-secret",
    }
    start = time.monotonic()
    res = await client.post("/authorize", data=form)
    elapsed = time.monotonic() - start

    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert 'name="secret"' in res.text
    assert elapsed >= 0.5


async def test_full_happy_path_dcr_authorize_code_token(client):
    from app.mcp.tokens import verify_access_token

    registered = await register_client(client)
    verifier, challenge = pkce_pair()
    redirect_uri = "https://claude.ai/callback"

    form = {
        "client_id": registered["client_id"],
        "redirect_uri": redirect_uri,
        "state": "state-1",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "response_type": "code",
        "secret": MCP_ACCESS_SECRET,
    }
    auth_res = await client.post("/authorize", data=form)
    assert auth_res.status_code == 302
    location = auth_res.headers["location"]
    parsed = urlsplit(location)
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == redirect_uri
    qs = parse_qs(parsed.query)
    assert qs["state"] == ["state-1"]
    code = qs["code"][0]

    token_res = await client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": registered["client_id"],
            "redirect_uri": redirect_uri,
        },
    )
    assert token_res.status_code == 200, token_res.text
    body = token_res.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 3600
    assert body["refresh_token"]

    claims = verify_access_token(body["access_token"], MCP_JWT_SECRET)
    assert claims["sub"] == "mcp"

    return body  # not used by pytest, just documents the shape


async def test_pkce_mismatch_rejected(client):
    registered = await register_client(client)
    verifier, challenge = pkce_pair()
    redirect_uri = "https://claude.ai/callback"

    form = {
        "client_id": registered["client_id"],
        "redirect_uri": redirect_uri,
        "state": "s",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "response_type": "code",
        "secret": MCP_ACCESS_SECRET,
    }
    auth_res = await client.post("/authorize", data=form)
    code = parse_qs(urlsplit(auth_res.headers["location"]).query)["code"][0]

    wrong_verifier, _ = pkce_pair()
    token_res = await client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": wrong_verifier,
            "client_id": registered["client_id"],
            "redirect_uri": redirect_uri,
        },
    )
    assert token_res.status_code == 400
    assert token_res.json()["error"] == "invalid_grant"


async def test_code_reuse_rejected(client):
    registered = await register_client(client)
    verifier, challenge = pkce_pair()
    redirect_uri = "https://claude.ai/callback"

    form = {
        "client_id": registered["client_id"],
        "redirect_uri": redirect_uri,
        "state": "s",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "response_type": "code",
        "secret": MCP_ACCESS_SECRET,
    }
    auth_res = await client.post("/authorize", data=form)
    code = parse_qs(urlsplit(auth_res.headers["location"]).query)["code"][0]

    token_kwargs = {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": verifier,
        "client_id": registered["client_id"],
        "redirect_uri": redirect_uri,
    }
    first = await client.post("/token", data=token_kwargs)
    assert first.status_code == 200

    second = await client.post("/token", data=token_kwargs)
    assert second.status_code == 400
    assert second.json()["error"] == "invalid_grant"


async def test_refresh_rotation_and_old_refresh_dies(client):
    registered = await register_client(client)
    verifier, challenge = pkce_pair()
    redirect_uri = "https://claude.ai/callback"

    form = {
        "client_id": registered["client_id"],
        "redirect_uri": redirect_uri,
        "state": "s",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "response_type": "code",
        "secret": MCP_ACCESS_SECRET,
    }
    auth_res = await client.post("/authorize", data=form)
    code = parse_qs(urlsplit(auth_res.headers["location"]).query)["code"][0]

    token_res = await client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": registered["client_id"],
            "redirect_uri": redirect_uri,
        },
    )
    old_refresh = token_res.json()["refresh_token"]

    rotated_res = await client.post(
        "/token", data={"grant_type": "refresh_token", "refresh_token": old_refresh}
    )
    assert rotated_res.status_code == 200, rotated_res.text
    rotated_body = rotated_res.json()
    assert rotated_body["access_token"]
    new_refresh = rotated_body["refresh_token"]
    assert new_refresh != old_refresh

    # Old refresh token must now be dead (rotated, single-use).
    dead_res = await client.post(
        "/token", data={"grant_type": "refresh_token", "refresh_token": old_refresh}
    )
    assert dead_res.status_code == 400
    assert dead_res.json()["error"] == "invalid_grant"

    # New refresh token works.
    again_res = await client.post(
        "/token", data={"grant_type": "refresh_token", "refresh_token": new_refresh}
    )
    assert again_res.status_code == 200, again_res.text


async def test_token_malformed_request_is_invalid_request(client):
    res = await client.post("/token", data={"grant_type": "bogus"})
    assert res.status_code == 400
    assert res.json()["error"] == "invalid_request"
