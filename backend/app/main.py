from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .db import close_pool, run_migrations
from .errors import ApiError
from .mcp import oauth as mcp_oauth
from .mcp.oauth import verify_bearer
from .mcp.server import mcp as mcp_server
from .routes import auth, baby, events, measurements, stats

# `http_app(path="/mcp")` gives the returned ASGI app an *internal* route at
# "/mcp". Mounting it at FastAPI's root ("/") below -- not at "/mcp" -- is
# what makes the final client-facing URL exactly "/mcp" instead of the
# "/mcp/mcp" double-mount described in app/mcp/NOTES.md item 2 (verified by
# `test_spike_http_mount_combined_lifespan` in tests/test_mcp_spike.py).
mcp_app = mcp_server.http_app(path="/mcp")


class BearerGate:
    """Thin ASGI middleware gating the mounted FastMCP app on a bearer token.

    FastMCP ships resource-server auth types (`TokenVerifier`/`JWTVerifier`)
    but they verify tokens *they* were configured to mint/trust; this app's
    access tokens are minted and verified entirely by Task 3/4's own code
    (`app/mcp/tokens.py`, `app/mcp/oauth.verify_bearer`), which is
    FastAPI-`Request`-shaped, not a `fastmcp.server.auth.AuthProvider`.
    Rather than reimplement that verification a second time as a FastMCP
    `AuthProvider` just to satisfy FastMCP's own auth hook, this wraps the
    mounted ASGI app in a small ASGI middleware that calls `verify_bearer`
    on every request before delegating -- reusing Task 4's exact 401 +
    `WWW-Authenticate` behavior with zero duplication. See
    app/mcp/NOTES.md item 6 for why Task 4 made the same mechanism (c)
    choice for the OAuth endpoints themselves.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        try:
            await verify_bearer(request)
        except HTTPException as exc:
            response = JSONResponse(
                {"error": "unauthorized", "detail": exc.detail},
                status_code=exc.status_code,
                headers=exc.headers,
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Combine this app's own startup/shutdown work with the mounted FastMCP
    # app's lifespan (starts/stops its Streamable HTTP session manager) --
    # per app/mcp/NOTES.md item 3, "Case B". Without this, every request to
    # the mounted MCP endpoint raises a RuntimeError because the session
    # manager's task group was never initialized.
    async with mcp_app.lifespan(app):
        await run_migrations()
        yield
        await close_pool()


app = FastAPI(title="Baby Marks API", lifespan=lifespan)


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(exc.body(), status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    # Match the old API contract: bad payloads are 400 {"error": "invalid", ...}.
    return JSONResponse(
        {"error": "invalid", "details": exc.errors(include_url=False, include_input=False)},
        status_code=400,
    )


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True}


app.include_router(auth.router)
app.include_router(baby.router)
app.include_router(events.router)
app.include_router(measurements.router)
app.include_router(stats.router)
app.include_router(mcp_oauth.router)

# Mounted last: FastAPI/Starlette tries routes in registration order, so the
# explicit routes above (/api/*, the OAuth endpoints, /.well-known/*) all
# match before this catch-all mount is ever consulted. The only path the
# mounted app itself responds to is "/mcp" (see mcp_app construction above);
# anything else falls through to FastMCP's own 404 handling.
app.mount("/", BearerGate(mcp_app))
