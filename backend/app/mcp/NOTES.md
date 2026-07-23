# FastMCP API notes (verified ground truth)

These notes document the *actual, installed* FastMCP API for this repo, verified
by executing every snippet below (see `backend/tests/test_mcp_spike.py`) or by
reading the installed package source directly. Where the installed package
disagrees with `https://gofastmcp.com` docs, this file follows the package
source. Later MCP tasks should follow this file, not general FastMCP knowledge
from training data — this version (3.4.4) is newer than most public examples.

## 0. Installed version (item 6)

```
fastmcp==3.4.4          # pinned in backend/pyproject.toml as "fastmcp>=3.4.4"
mcp==1.28.1             # the underlying MCP Python SDK, pulled in transitively
```

Resolved with `cd backend && uv add fastmcp` against the existing FastAPI pin
(`fastapi>=0.115`, currently resolving to `fastapi==0.139.2`). **No conflict** —
`uv add` resolved cleanly, added 47 packages, and did not touch the FastAPI
version. Confirmed after install:

```
uv run python -c "import fastapi; print(fastapi.__version__)"   # 0.139.2 (unchanged)
uv run python -c "import fastmcp; print(fastmcp.__version__)"   # 3.4.4
```

## 1. Defining a tool

Decorate a plain function with `@mcp.tool` (bare, no parens needed — it also
works as `@mcp.tool(...)` with kwargs like `name=`, `description=`, `tags=`).
The function's docstring is parsed (Google/NumPy/Sphinx style, via `griffe`)
for the tool description **and** per-parameter descriptions — a Google-style
`Args:` section is enough, no extra decorator config required.

```python
from fastmcp import FastMCP

mcp = FastMCP("spike")

@mcp.tool
def ping(name: str) -> dict:
    """Return a greeting.

    Args:
        name: The name to greet.
    """
    return {"hello": name}
```

Verified generated schema (via `client.list_tools()`):

```python
# tools[0].name        == "ping"
# tools[0].description == "Return a greeting."
# tools[0].inputSchema  == {
#     "type": "object",
#     "properties": {"name": {"type": "string", "description": "The name to greet."}},
#     "required": ["name"],
#     "additionalProperties": False,
# }
```

The full decorator signature (from `fastmcp/server/server.py`) also accepts:
`name`, `title`, `description`, `tags`, `output_schema`, `annotations`,
`exclude_args`, `meta`, `auth` (per-tool `AuthCheck`), `timeout`, and a few
task/versioning options not relevant here.

## 2. Getting the ASGI app for Streamable HTTP + mount path behavior

```python
mcp_app = mcp.http_app()          # transport defaults to "http" == streamable-http
# or explicitly: mcp.http_app(path="/mcp", transport="http")
```

`http_app()` returns a `StarletteWithLifespan` app (`fastmcp/server/http.py`,
`create_streamable_http_app`). **Critical gotcha verified by source and by the
spike test:** the returned app already has its MCP route mounted at a path —
`fastmcp.settings.streamable_http_path`, which **defaults to `"/mcp"`**, not
`"/"`. That means:

- If you mount it in FastAPI at `/mcp` (`app.mount("/mcp", mcp_app)`), the
  real client-facing URL becomes **`/mcp/mcp`** (the mount prefix + the
  app's own internal route path) — a very easy mistake.
- To make the client-facing URL be exactly `/mcp`, mount the app at the
  **root** instead:

```python
from fastapi import FastAPI

mcp_app = mcp.http_app(path="/mcp")   # app's internal route is "/mcp"
app = FastAPI(lifespan=mcp_app.lifespan)
app.mount("/", mcp_app)               # final client URL: http://host/mcp
```

This is exactly what `test_spike_http_mount_combined_lifespan` in the spike
test does, and the client successfully round-trips against `"http://testserver/mcp"`.

(`http_app()` also accepts `transport="sse"` for the legacy SSE transport via
`create_sse_app`, and other kwargs — `middleware`, `json_response`,
`stateless_http`, `event_store`, `host_origin_protection`, `allowed_hosts`,
`allowed_origins` — not needed for the spike.)

## 3. Combining lifespans with the existing FastAPI lifespan

`mcp.http_app()`'s returned app owns a lifespan that starts/stops the
Streamable HTTP session manager (`StreamableHTTPSessionManager.run()`) and
FastMCP's own internal lifespan manager. If that lifespan never runs, every
request to the mounted MCP endpoint raises (verified by triggering it in the
spike, before fixing it):

```
RuntimeError: FastMCP's StreamableHTTPSessionManager task group was not
initialized. This commonly occurs when the FastMCP application's lifespan is
not passed to the parent ASGI application ... set `lifespan=mcp_app.lifespan`
in your parent app's constructor.
```

`StarletteWithLifespan.lifespan` is a plain property (`self.router.lifespan_context`)
— it is **not itself an async context manager to `async with`**, it is a
*callable* you pass as `lifespan=` to the parent app's constructor, same
shape as FastAPI/Starlette's own `lifespan` parameter. Two cases:

**Case A — no existing app lifespan** (this repo's spike): pass it straight
through.

```python
app = FastAPI(lifespan=mcp_app.lifespan)
app.mount("/", mcp_app)
```

**Case B — app already has its own lifespan** (this repo's real `app/main.py`,
which runs DB migrations / closes the connection pool in `lifespan`): combine
both with a nested async context manager, e.g.:

```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def combined_lifespan(app: FastAPI):
    async with mcp_app.lifespan(app):   # starts/stops the MCP session manager
        await run_migrations()          # this repo's existing startup work
        yield
        await close_pool()

app = FastAPI(lifespan=combined_lifespan)
app.mount("/", mcp_app)
```

(Verified detail for tests only, not production: `httpx.ASGITransport` does
**not** send ASGI lifespan events on its own, so in-process tests that hit a
mounted app over ASGI transport must drive the lifespan manually with
`async with app.router.lifespan_context(app): ...` — a real Uvicorn server
does this automatically. See `test_spike_http_mount_combined_lifespan`.)

## 4. Auth interfaces (decision-critical for Task 4)

All auth types live under `fastmcp.server.auth` (public re-exports in
`fastmcp/server/auth/__init__.py`; some are lazy-imported via `__getattr__`
to avoid pulling in `authlib`/`cryptography` unless used — still importable
the normal way, e.g. `from fastmcp.server.auth import JWTVerifier`).

FastMCP supports **all three** of the mechanisms this decision is choosing
between, at different levels of "built-in":

**(a) Full OAuth authorization-server provider — yes, but as a base class you
implement, not a ready-made local AS.**

- `fastmcp.server.auth.OAuthProvider` — `class OAuthProvider(AuthProvider,
  OAuthAuthorizationServerProvider[AuthorizationCode, RefreshToken,
  AccessToken])` (`fastmcp/server/auth/auth.py`). It wires up full OAuth
  server routes (authorize, token, registration, revocation, metadata) via
  the underlying MCP SDK's protocol
  `mcp.server.auth.provider.OAuthAuthorizationServerProvider`, but that
  protocol is abstract — a subclass must implement:
  `get_client`, `register_client`, `authorize`, `load_authorization_code`,
  `exchange_authorization_code`, `load_refresh_token`,
  `exchange_refresh_token`, `load_access_token`, `revoke_token`
  (signatures in `mcp/server/auth/provider.py`).
- Dynamic Client Registration is a flag, not extra code: pass
  `client_registration_options=mcp.server.auth.settings.ClientRegistrationOptions(enabled=True, ...)`
  to `OAuthProvider.__init__` and the `/register` (RFC 7591) route is added.
  It defaults to `enabled=False`.
- PKCE is handled generically by the SDK's authorize/token route handlers
  (`code_challenge`/`code_challenge_method` flow through
  `AuthorizationParams` and the `AuthorizationCode` object) — a provider
  implementation just needs to persist/return those fields; it does not need
  to re-implement PKCE verification itself.
- FastMCP does **not** ship a ready-to-use concrete `OAuthProvider` that
  mints its own JWTs locally. The two concrete subclasses it does ship —
  `fastmcp.server.auth.oauth_proxy.OAuthProxy` and
  `fastmcp.server.auth.oidc_proxy.OIDCProxy` — are both proxies in front of
  an **external upstream IdP** (they translate DCR into a single static
  upstream client registration and forward authorize/token calls upstream).
  Neither fits "mint our own JWTs" — see recommendation below.

**(b) Custom auth provider interface — yes.**

- `fastmcp.server.auth.AuthProvider` — the base class for everything
  (`class AuthProvider(TokenVerifierProtocol)`). Minimal contract: implement
  `async def verify_token(self, token: str) -> AccessToken | None`. Optionally
  override `get_routes()` (custom auth HTTP routes) and `get_middleware()`
  (defaults to bearer-auth Starlette middleware).
- `fastmcp.server.auth.MultiAuth` — composes one optional full `server`
  (an `AuthProvider`, e.g. an `OAuthProxy`) with a list of additional
  `TokenVerifier`s, trying each in order. Useful if multiple token sources
  must be accepted, not needed for a single-user server.

**(c) Bearer/JWT token verification only (resource-server style) — yes,
with a ready-made concrete implementation.**

- `fastmcp.server.auth.TokenVerifier` — `class TokenVerifier(AuthProvider)`,
  narrows `AuthProvider` to "verify tokens, no OAuth server routes by
  default."
- `fastmcp.server.auth.providers.jwt.JWTVerifier` — concrete, ready to use:
  verifies RS/ES/HS-signed JWTs against a JWKS URI or a static public
  key/JWK, with issuer/audience validation
  (`from fastmcp.server.auth.providers.jwt import JWTVerifier`, also
  re-exported as `fastmcp.server.auth.JWTVerifier`).
- `fastmcp.server.auth.providers.jwt.StaticTokenVerifier` — fixed
  token → claims map, for local dev/testing.
- `fastmcp.server.auth.RemoteAuthProvider` — pairs a `TokenVerifier` with a
  list of external `authorization_servers` to advertise RFC 9728
  protected-resource metadata. Still resource-server only; does not mint
  tokens itself.
- `fastmcp.server.auth.providers.jwt.RSAKeyPair` — a test/dev helper to
  generate an RSA key pair and mint short-lived JWTs
  (`RSAKeyPair.generate()` / `.create_token(...)`) — handy for local testing
  of a `JWTVerifier`, and a useful reference for the "mint our own JWT" code
  path in the recommendation below.
- Numerous vendor-specific `TokenVerifier`/`OAuthProxy` subclasses ship under
  `fastmcp.server.auth.providers.*` (auth0, aws, azure, clerk, descope,
  discord, github, google, huggingface, keycloak, oci, propelauth, scalekit,
  supabase, workos) plus `DebugTokenVerifier` (`providers/debug.py`) for
  local dev without any real verification. None apply here (no vendor IdP).

### Recommendation for our flow (single-user, DCR + PKCE + own JWTs)

We need to **be** the authorization server (mint and verify our own JWTs) while
still speaking standard MCP OAuth discovery to clients (DCR + PKCE), so this is
squarely mechanism **(a)**, not (b) or (c) alone:

- Subclass `fastmcp.server.auth.OAuthProvider` and implement the
  `OAuthAuthorizationServerProvider` protocol methods directly against this
  repo's own storage (in-memory is fine for a single user; Postgres if we
  want registration to survive restarts):
  - `register_client` / `get_client`: persist the one (or few) dynamically
    registered client(s) — this is what `ClientRegistrationOptions(enabled=True)`
    exposes at `/register`.
  - `authorize`: since it's single-user, authenticate against this app's
    existing `APP_SECRET_PHRASE` session/cookie (see `app/auth.py`) instead of
    building a real login UI; issue an authorization code carrying the
    client's `code_challenge`/`code_challenge_method` (PKCE) — verification of
    the PKCE `code_verifier` at the token endpoint is handled by the SDK, not
    by us.
  - `exchange_authorization_code` / `load_access_token`: mint and verify our
    own signed JWT (HS256 with a local secret, or RS256 with a generated
    keypair à la `RSAKeyPair` above) instead of delegating to any upstream
    IdP — this is the part `OAuthProxy`/`OIDCProxy` don't give us, since they
    only proxy someone else's tokens.
  - `load_refresh_token` / `exchange_refresh_token`: implement simply, or
    omit refresh support for v1 (single long-lived session is acceptable for
    a single-user local tool).
  - `revoke_token`: simple in-memory/DB revocation list.
- Pass `client_registration_options=ClientRegistrationOptions(enabled=True)` to
  turn on DCR.
- This is more implementation work than dropping in `JWTVerifier` (option c),
  but option (c) alone cannot satisfy "our own JWTs + DCR" because
  `TokenVerifier`/`JWTVerifier` are resource-server-only — they verify tokens
  someone else issued, they don't expose `/authorize`, `/token`, or `/register`
  endpoints at all. Task 4 should build the custom `OAuthProvider` subclass
  described above.

## 5. Calling the server from a Python client (for tests)

**In-memory (no HTTP), for unit-testing tools directly against a `FastMCP`
instance:**

```python
from fastmcp import FastMCP, Client

mcp = FastMCP("spike")

@mcp.tool
def ping(name: str) -> dict:
    """Return a greeting."""
    return {"hello": name}

async with Client(mcp) as client:          # Client(FastMCP) -> in-memory transport
    tools = await client.list_tools()      # [t.name for t in tools] == ["ping"]
    result = await client.call_tool("ping", {"name": "Theana"})
    result.data                            # == {"hello": "Theana"}
```

`CallToolResult` (`fastmcp/client/client.py`) is a dataclass with fields
`content`, `structured_content`, `meta`, `data`, `is_error`. **`.data` is
confirmed correct for this installed version (3.4.4)** — it holds the tool's
parsed Python return value (validated against the tool's output schema when
present).

**Over HTTP, against a mounted ASGI app (no real network / port binding),
using a custom `httpx_client_factory`:**

```python
import httpx
from httpx import ASGITransport
from fastmcp.client.transports import StreamableHttpTransport

def httpx_client_factory(*, headers=None, auth=None, follow_redirects=True, timeout=None):
    return httpx.AsyncClient(
        transport=ASGITransport(app=app),   # `app` = the FastAPI app the MCP app is mounted in
        base_url="http://testserver",
        follow_redirects=follow_redirects,
        **({"headers": headers} if headers else {}),
        **({"auth": auth} if auth else {}),
        **({"timeout": timeout} if timeout else {}),
    )

transport = StreamableHttpTransport(
    "http://testserver/mcp", httpx_client_factory=httpx_client_factory
)
async with Client(transport) as client:
    ...  # same list_tools()/call_tool() calls as above
```

`Client(...)` accepts, among other things: a `FastMCP` instance (in-memory),
a `str`/`AnyUrl` (real network `StreamableHttpTransport`/`SSETransport`), a
`Path` (stdio), an `MCPConfig`/`dict`, or a pre-built transport instance
(as used above) — see the overloads in `fastmcp/client/client.py`.

Note: `httpx.ASGITransport` does **not** trigger ASGI lifespan
startup/shutdown by itself (see item 3) — in a real deployment Uvicorn does
this; in tests, drive it manually with `async with
app.router.lifespan_context(app): ...` around the `Client` usage.
