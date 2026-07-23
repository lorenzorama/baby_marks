"""Spike test proving FastMCP's installed API shape for backend/app/mcp/NOTES.md.

This is throwaway verification, not production code: it exercises the exact
snippets documented in NOTES.md so those notes are ground truth for later
MCP tasks rather than guesses. Two things are proven:

1. `@mcp.tool` + `fastmcp.Client` in-memory round trip (items 1 + 5 in NOTES.md).
2. `mcp.http_app()` mounted inside a FastAPI app with a *combined* lifespan,
   reached over ASGI transport at the mounted path (items 2 + 3 in NOTES.md).
"""

import httpx
import pytest
from fastapi import FastAPI
from fastmcp import Client, FastMCP
from fastmcp.client.transports import StreamableHttpTransport
from httpx import ASGITransport


@pytest.fixture
def spike_server():
    mcp = FastMCP("spike")

    @mcp.tool
    def ping(name: str) -> dict:
        """Return a greeting."""
        return {"hello": name}

    return mcp


@pytest.mark.asyncio
async def test_spike_tool_roundtrip(spike_server):
    async with Client(spike_server) as client:
        tools = await client.list_tools()
        assert [t.name for t in tools] == ["ping"]
        result = await client.call_tool("ping", {"name": "Theana"})
        # Verified accessor for this installed version (fastmcp 3.4.4):
        # CallToolResult.data holds the tool's Python return value.
        assert result.data == {"hello": "Theana"}


@pytest.mark.asyncio
async def test_spike_http_mount_combined_lifespan(spike_server):
    # (2) Build the Streamable HTTP ASGI app. FastMCP's default
    # `streamable_http_path` is "/mcp", so the returned app already has a
    # route AT "/mcp" (not "/"). Mounting it under another "/mcp" prefix in
    # FastAPI would double the path to "/mcp/mcp" -- mount at "/" instead so
    # the final client-facing URL is exactly "/mcp".
    mcp_app = spike_server.http_app(path="/mcp")

    # (3) Combine lifespans: FastMCP's http_app carries its own lifespan
    # (it starts/stops the Streamable HTTP session manager). Passing it as
    # the *outer* FastAPI app's lifespan is how that lifespan gets run --
    # without this, calling the mounted endpoint raises a RuntimeError
    # ("Task group is not initialized") because the session manager never
    # started.
    app = FastAPI(lifespan=mcp_app.lifespan)
    app.mount("/", mcp_app)

    def httpx_client_factory(
        *, headers=None, auth=None, follow_redirects=True, timeout=None
    ) -> httpx.AsyncClient:
        kwargs: dict = {
            "transport": ASGITransport(app=app),
            "base_url": "http://testserver",
            "follow_redirects": follow_redirects,
        }
        if headers is not None:
            kwargs["headers"] = headers
        if auth is not None:
            kwargs["auth"] = auth
        if timeout is not None:
            kwargs["timeout"] = timeout
        return httpx.AsyncClient(**kwargs)

    transport = StreamableHttpTransport(
        "http://testserver/mcp", httpx_client_factory=httpx_client_factory
    )

    # httpx's ASGITransport does not send ASGI lifespan events on its own, so
    # the combined lifespan above never actually runs unless something drives
    # it. Drive it manually here (a real Uvicorn server does this for you) --
    # `app.router.lifespan_context` is the async context manager Starlette
    # builds from whatever `lifespan=` was passed to the FastAPI constructor.
    async with app.router.lifespan_context(app):
        async with Client(transport) as client:
            tools = await client.list_tools()
            assert [t.name for t in tools] == ["ping"]
            result = await client.call_tool("ping", {"name": "Theana"})
            assert result.data == {"hello": "Theana"}
