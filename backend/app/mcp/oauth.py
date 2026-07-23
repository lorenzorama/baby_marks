"""OAuth 2.1 authorization-server endpoints for the Baby Marks MCP server.

Metadata (RFC 8414 / RFC 9728), open Dynamic Client Registration (RFC 7591)
restricted to the claude.ai/claude.com redirect-uri origins, a secret-gated
authorize page (single-user, no real login UI), PKCE (S256-only) token
exchange, and refresh-token rotation.

**Mechanism note (see app/mcp/NOTES.md section "Task 4"):** this is plain
FastAPI routes, not a `fastmcp.server.auth.OAuthProvider` subclass. The MCP
SDK's built-in `/authorize` route (`mcp.server.auth.handlers.authorize.
AuthorizationHandler`) validates both GET and POST bodies against a fixed
`AuthorizationRequest` schema (client_id/redirect_uri/response_type/
code_challenge/...) and always resolves to either a JSON error or a 302
redirect produced by `provider.authorize() -> str` -- it has no way to render
an HTML login form on GET or accept a `secret` field on POST, which this
task's fixed contract requires. Likewise `fastmcp.server.auth.auth.
OAuthProvider` overrides the token endpoint to turn `invalid_grant` into an
HTTP 401, but this task's contract requires all token failures to stay at
400. Both mismatches are structural, not incidental, so mechanism (a) was
dropped in favor of (c): plain FastAPI routes here, with `verify_bearer`
below standing in for FastMCP's resource-server token verification (used by
Task 5 to gate `/mcp`).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import html
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from ..config import mcp_access_secret, mcp_jwt_secret, mcp_public_url
from ..db import get_pool
from ..errors import ApiError
from .tokens import TokenError, hash_refresh_token, mint_access_token, new_refresh_token, verify_access_token

router = APIRouter()

ALLOWED_REDIRECT_ORIGINS = {"https://claude.ai", "https://claude.com"}
AUTH_CODE_TTL_SECONDS = 600
ACCESS_TOKEN_TTL_SECONDS = 3600
REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600

# DCR is an unauthenticated public endpoint (RFC 7591 open registration), so
# it needs its own bounds independent of anything a client claims about
# itself -- otherwise a single POST can wedge an arbitrarily large JSON body
# or an unbounded number/size of redirect_uris into `mcp_clients`.
MAX_REGISTER_BODY_BYTES = 8192
MAX_CLIENT_NAME_LENGTH = 200
MAX_REDIRECT_URIS = 5
MAX_REDIRECT_URI_LENGTH = 512
STALE_CLIENT_AGE = timedelta(days=30)

# Single-use authorization codes. In-memory is fine: this is a single-user
# local server, codes live at most 10 minutes, and a restart invalidates any
# in-flight authorize step, which is an acceptable failure mode (the client
# just retries the flow from /authorize).
_AUTH_CODES: dict[str, dict] = {}

_HIDDEN_FIELDS = (
    "client_id",
    "redirect_uri",
    "state",
    "code_challenge",
    "code_challenge_method",
    "response_type",
)


def _redirect_origin_allowed(uri: str) -> bool:
    parts = urlsplit(uri)
    origin = f"{parts.scheme}://{parts.netloc}"
    return origin in ALLOWED_REDIRECT_ORIGINS


def _pkce_challenge_from_verifier(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def _render_authorize_form(
    params: dict, client_name: str | None = None, error: str | None = None
) -> str:
    hidden = "".join(
        f'<input type="hidden" name="{key}" value="{html.escape(str(params.get(key, "")))}">\n'
        for key in _HIDDEN_FIELDS
        if params.get(key) is not None
    )
    error_html = f'<p class="error">{html.escape(error)}</p>' if error else ""
    heading = f"Authorizing {html.escape(client_name)}" if client_name else "Authorize MCP client"
    return f"""<!doctype html>
<html>
<head><title>Authorize MCP client</title></head>
<body>
<h1>{heading}</h1>
{error_html}
<form method="post" action="/authorize">
{hidden}
<label>Secret: <input type="password" name="secret" autofocus></label>
<button type="submit">Authorize</button>
</form>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Metadata (RFC 8414 / RFC 9728)
# ---------------------------------------------------------------------------


def _authorization_server_metadata() -> dict:
    issuer = mcp_public_url()
    return {
        "issuer": issuer,
        "authorization_endpoint": f"{issuer}/authorize",
        "token_endpoint": f"{issuer}/token",
        "registration_endpoint": f"{issuer}/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
    }


def _protected_resource_metadata() -> dict:
    issuer = mcp_public_url()
    return {
        "resource": f"{issuer}/mcp",
        "authorization_servers": [issuer],
    }


@router.get("/.well-known/oauth-authorization-server")
async def oauth_authorization_server_metadata() -> JSONResponse:
    return JSONResponse(_authorization_server_metadata())


@router.get("/.well-known/oauth-authorization-server/mcp")
async def oauth_authorization_server_metadata_mcp() -> JSONResponse:
    return JSONResponse(_authorization_server_metadata())


@router.get("/.well-known/oauth-protected-resource")
async def oauth_protected_resource_metadata() -> JSONResponse:
    return JSONResponse(_protected_resource_metadata())


@router.get("/.well-known/oauth-protected-resource/mcp")
async def oauth_protected_resource_metadata_mcp() -> JSONResponse:
    return JSONResponse(_protected_resource_metadata())


# ---------------------------------------------------------------------------
# Dynamic Client Registration (RFC 7591), open, redirect-origin allowlisted
# ---------------------------------------------------------------------------


@router.post("/register")
async def register_client(request: Request) -> JSONResponse:
    # Reject oversized bodies before even touching them. Content-Length is
    # attacker-supplied but Starlette/uvicorn already require it (or chunked
    # transfer, which this check doesn't see) -- either way, a JSON body this
    # large can only be padding, since every real field below is capped far
    # below 8KiB.
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            too_big = int(content_length) > MAX_REGISTER_BODY_BYTES
        except ValueError:
            too_big = False
        if too_big:
            raise ApiError(400, "invalid_request", error_description="request body too large")

    try:
        body = await request.json()
    except Exception as exc:  # malformed JSON body
        raise ApiError(400, "invalid_request") from exc

    redirect_uris = body.get("redirect_uris") if isinstance(body, dict) else None
    if (
        not isinstance(redirect_uris, list)
        or not redirect_uris
        or not all(isinstance(u, str) for u in redirect_uris)
    ):
        raise ApiError(400, "invalid_request", error_description="redirect_uris is required")

    if len(redirect_uris) > MAX_REDIRECT_URIS:
        raise ApiError(
            400,
            "invalid_request",
            error_description=f"too many redirect_uris (max {MAX_REDIRECT_URIS})",
        )
    for uri in redirect_uris:
        if len(uri) > MAX_REDIRECT_URI_LENGTH:
            raise ApiError(
                400,
                "invalid_request",
                error_description=f"redirect_uri exceeds {MAX_REDIRECT_URI_LENGTH} characters",
            )
        if not _redirect_origin_allowed(uri):
            raise ApiError(
                400,
                "invalid_redirect_uri",
                error_description=f"redirect_uri origin not allowed: {uri}",
            )

    client_name = body.get("client_name") if isinstance(body.get("client_name"), str) else None
    if client_name is not None and len(client_name) > MAX_CLIENT_NAME_LENGTH:
        raise ApiError(
            400,
            "invalid_request",
            error_description=f"client_name exceeds {MAX_CLIENT_NAME_LENGTH} characters",
        )

    client_id = secrets.token_urlsafe(16)

    pool = await get_pool()
    # Prune stale, never-used registrations before inserting the new one:
    # DCR is open (no auth), so abandoned/probing registrations otherwise
    # accumulate in `mcp_clients` forever. Only rows with zero refresh tokens
    # are eligible -- a client that completed a flow and is still holding a
    # refresh token must never be pruned out from under it.
    await pool.execute(
        """
        DELETE FROM mcp_clients c
        WHERE c.created_at < now() - $1::interval
          AND NOT EXISTS (
              SELECT 1 FROM mcp_refresh_tokens rt WHERE rt.client_id = c.client_id
          )
        """,
        STALE_CLIENT_AGE,
    )
    await pool.execute(
        "INSERT INTO mcp_clients (client_id, redirect_uris, client_name) VALUES ($1, $2, $3)",
        client_id,
        redirect_uris,
        client_name,
    )

    return JSONResponse(
        {
            "client_id": client_id,
            "redirect_uris": redirect_uris,
            "client_name": client_name,
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        },
        status_code=201,
    )


# ---------------------------------------------------------------------------
# Authorize: secret-gated HTML form (this app IS the login, single user)
# ---------------------------------------------------------------------------


async def _load_and_validate_client(client_id: str, redirect_uri: str) -> str | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT redirect_uris, client_name FROM mcp_clients WHERE client_id=$1", client_id
    )
    if row is None:
        raise ApiError(400, "invalid_client", error_description="unknown client_id")
    if redirect_uri not in row["redirect_uris"]:
        raise ApiError(400, "invalid_request", error_description="redirect_uri mismatch")
    # Defense in depth: re-validate the origin allowlist at authorize time too,
    # not just at registration time.
    if not _redirect_origin_allowed(redirect_uri):
        raise ApiError(400, "invalid_request", error_description="redirect_uri origin not allowed")
    return row["client_name"]


@router.api_route("/authorize", methods=["GET", "POST"])
async def authorize(request: Request):
    if request.method == "GET":
        params = dict(request.query_params)
    else:
        params = dict(await request.form())

    client_id = params.get("client_id")
    redirect_uri = params.get("redirect_uri")
    code_challenge = params.get("code_challenge")
    code_challenge_method = params.get("code_challenge_method", "S256")
    response_type = params.get("response_type", "code")
    state = params.get("state", "")

    if not client_id or not redirect_uri or not code_challenge:
        raise ApiError(400, "invalid_request", error_description="missing required parameter")
    if response_type != "code":
        raise ApiError(400, "invalid_request", error_description="response_type must be 'code'")
    if code_challenge_method != "S256":
        raise ApiError(400, "invalid_request", error_description="code_challenge_method must be 'S256'")

    client_name = await _load_and_validate_client(client_id, redirect_uri)

    no_store = {"Cache-Control": "no-store"}  # OAuth 2.1 authorize response hygiene

    if request.method == "GET":
        return HTMLResponse(_render_authorize_form(params, client_name=client_name), headers=no_store)

    supplied_secret = params.get("secret") or ""
    expected_secret = mcp_access_secret()
    if not hmac.compare_digest(supplied_secret.encode(), expected_secret.encode()):
        await asyncio.sleep(0.5)  # brute-force damper, same convention as app/routes/auth.py
        return HTMLResponse(
            _render_authorize_form(params, client_name=client_name, error="Incorrect secret."),
            headers=no_store,
        )

    # Sweep expired codes before inserting a new one -- bounds the in-memory
    # dict's size for a long-running process instead of only ever growing it
    # (codes that are exchanged are already popped in
    # `_exchange_authorization_code`; this catches the ones nobody redeemed).
    now_ts = time.time()
    for expired_code in [c for c, data in _AUTH_CODES.items() if data["expires"] < now_ts]:
        del _AUTH_CODES[expired_code]

    code = secrets.token_urlsafe(32)
    _AUTH_CODES[code] = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_challenge": code_challenge,
        "expires": time.time() + AUTH_CODE_TTL_SECONDS,
    }
    separator = "&" if "?" in redirect_uri else "?"
    location = f"{redirect_uri}{separator}{urlencode({'code': code, 'state': state})}"
    return RedirectResponse(url=location, status_code=302, headers=no_store)


# ---------------------------------------------------------------------------
# Token: authorization_code (+PKCE) and refresh_token rotation
# ---------------------------------------------------------------------------


async def _issue_token_pair(client_id: str) -> JSONResponse:
    access_token = mint_access_token(mcp_jwt_secret(), ACCESS_TOKEN_TTL_SECONDS)
    refresh_token = new_refresh_token()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=REFRESH_TOKEN_TTL_SECONDS)

    pool = await get_pool()
    await pool.execute(
        "INSERT INTO mcp_refresh_tokens (token_hash, client_id, expires_at) VALUES ($1, $2, $3)",
        hash_refresh_token(refresh_token, mcp_jwt_secret()),
        client_id,
        expires_at,
    )

    return JSONResponse(
        {
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": ACCESS_TOKEN_TTL_SECONDS,
            "refresh_token": refresh_token,
        },
        headers={"Cache-Control": "no-store"},  # OAuth 2.1 token response hygiene
    )


async def _exchange_authorization_code(form: dict) -> JSONResponse:
    code = form.get("code")
    code_verifier = form.get("code_verifier")
    client_id = form.get("client_id")
    redirect_uri = form.get("redirect_uri")
    if not code or not code_verifier or not client_id or not redirect_uri:
        raise ApiError(400, "invalid_request")

    # Pop (burn) the code on the first exchange attempt regardless of outcome:
    # a code must be single-use even if this attempt fails PKCE verification.
    data = _AUTH_CODES.pop(code, None)
    if data is None:
        raise ApiError(400, "invalid_grant")
    if data["expires"] < time.time():
        raise ApiError(400, "invalid_grant")
    if data["client_id"] != client_id or data["redirect_uri"] != redirect_uri:
        raise ApiError(400, "invalid_grant")

    expected_challenge = _pkce_challenge_from_verifier(code_verifier)
    if not hmac.compare_digest(expected_challenge, data["code_challenge"]):
        raise ApiError(400, "invalid_grant")

    return await _issue_token_pair(client_id)


async def _exchange_refresh_token(form: dict) -> JSONResponse:
    refresh_token = form.get("refresh_token")
    if not refresh_token:
        raise ApiError(400, "invalid_request")

    token_hash = hash_refresh_token(refresh_token, mcp_jwt_secret())
    pool = await get_pool()

    # Atomic check-and-delete: a single DELETE ... RETURNING statement means
    # the row can be consumed by at most one concurrent request. Without this,
    # a SELECT-then-DELETE pair lets N concurrent requests with the same
    # refresh token all observe the row via SELECT before any DELETE commits,
    # so all N succeed -- breaking single-use rotation. Postgres row-level
    # locking serializes concurrent DELETEs on the same row: only the first
    # one returns it, the rest see zero rows.
    row = await pool.fetchrow(
        "DELETE FROM mcp_refresh_tokens WHERE token_hash=$1 RETURNING client_id, expires_at",
        token_hash,
    )
    if row is None:
        raise ApiError(400, "invalid_grant")

    # Token was consumed either way (rotated out above); an expired-but-reused
    # token dies the same way as an unknown one.
    if row["expires_at"] < datetime.now(timezone.utc):
        raise ApiError(400, "invalid_grant")

    return await _issue_token_pair(row["client_id"])


@router.post("/token")
async def token(request: Request) -> JSONResponse:
    form = dict(await request.form())
    grant_type = form.get("grant_type")

    if grant_type == "authorization_code":
        return await _exchange_authorization_code(form)
    if grant_type == "refresh_token":
        return await _exchange_refresh_token(form)
    raise ApiError(400, "invalid_request", error_description="unsupported grant_type")


# ---------------------------------------------------------------------------
# Bearer verification for Task 5 (gating the /mcp resource routes)
# ---------------------------------------------------------------------------


def _www_authenticate_header() -> str:
    resource_metadata_url = f"{mcp_public_url()}/.well-known/oauth-protected-resource"
    return f'Bearer resource_metadata="{resource_metadata_url}"'


async def verify_bearer(request: Request) -> dict:
    """Verify the `Authorization: Bearer <token>` header on an incoming request.

    Returns the token's claims (see app/mcp/tokens.py) on success. Raises a
    FastAPI `HTTPException(401, ...)` with a `WWW-Authenticate` header
    pointing at the RFC 9728 protected-resource metadata document on any
    failure (missing header, wrong scheme, expired/invalid/tampered token).

    Import path for Task 5: `from app.mcp.oauth import verify_bearer`.
    """
    auth_header = request.headers.get("authorization", "")
    scheme, _, token_value = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token_value:
        raise HTTPException(
            401,
            detail="missing bearer token",
            headers={"WWW-Authenticate": _www_authenticate_header()},
        )
    try:
        claims = verify_access_token(token_value, mcp_jwt_secret())
    except TokenError as exc:
        raise HTTPException(
            401,
            detail=str(exc),
            headers={"WWW-Authenticate": _www_authenticate_header()},
        ) from exc

    # Defense in depth: this server only ever mints tokens with scope "mcp"
    # (see `mint_access_token`), so a token with any other/missing scope is
    # not one of ours -- reject it rather than trusting claims wholesale.
    if claims.get("scope") != "mcp":
        raise HTTPException(
            401,
            detail="invalid scope",
            headers={"WWW-Authenticate": _www_authenticate_header()},
        )

    return claims
