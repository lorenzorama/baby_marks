"""FastMCP tool server for Baby Marks: five read-only journal tools, backed
by Task 2's pure aggregation logic (`app/mcp/summaries.py`) and the app's
existing asyncpg pool (`app/db.py`).

Mounting (`/mcp`) and bearer-token gating live in `app/main.py`, per
`app/mcp/NOTES.md` items 2/3 (mount-path + combined-lifespan gotchas) and
item 6 (why gating is a thin ASGI wrapper around the mounted app rather than
a `fastmcp.server.auth.AuthProvider`: Task 4's tokens are minted/verified by
this repo's own `app/mcp/tokens.py` + `app/mcp/oauth.verify_bearer`, not by
any of FastMCP's built-in verifier classes).

Error idiom (per NOTES.md's `FastMCPError`/`ToolError` behavior, verified in
`fastmcp/server/server.py`): a bare `ValueError` escaping a tool gets
wrapped by FastMCP's generic exception handler as
`"Error calling tool 'x': <message>"` (or masked entirely if
`mask_error_details` is enabled). Catching `ValueError` here and re-raising
as `fastmcp.exceptions.ToolError(str(exc))` instead skips that generic
wrapping (`ToolError` is a `FastMCPError` and is re-raised as-is) and always
surfaces the clean, readable message from `app/mcp/summaries.py` to the MCP
client, regardless of masking settings.
"""

from __future__ import annotations

from datetime import datetime
from datetime import timezone as dt_timezone
from typing import Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

from ..config import mcp_default_timezone
from ..db import get_pool
from .summaries import (
    day_bounds,
    fetch_all_measurements,
    fetch_baby_name,
    fetch_events_between,
    fetch_measurements_on,
    list_diapers,
    list_feedings,
    sleep_stats,
    summarize_day,
)

DEFAULT_TZ = mcp_default_timezone()

mcp = FastMCP("Baby Marks")


@mcp.tool
async def get_daily_summary(date: str, timezone: str = DEFAULT_TZ) -> dict[str, Any]:
    """Return sleep, feeds, diapers, medicines, pump output, and measurements for one local day.

    Use this to write or update Theana's daily journal entry — one call per day.

    Args:
        date: The local calendar date to summarize, as YYYY-MM-DD.
        timezone: IANA timezone name the date is interpreted in.
    """
    try:
        day_start, day_end = day_bounds(date, timezone)
        pool = await get_pool()
        events = await fetch_events_between(pool, day_start, day_end)
        measurements = await fetch_measurements_on(pool, date)
        baby_name = await fetch_baby_name(pool)
        now = datetime.now(dt_timezone.utc)
        return summarize_day(events, measurements, date, timezone, now, baby_name)
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


@mcp.tool
async def get_sleep_stats(
    start_date: str, end_date: str, timezone: str = DEFAULT_TZ
) -> dict[str, Any]:
    """Return per-day sleep totals and period averages across a range of local days (inclusive).

    Use this to answer questions about sleep trends over multiple days, e.g. "how did Theana sleep this week?".

    Args:
        start_date: First local calendar date in the range, as YYYY-MM-DD.
        end_date: Last local calendar date in the range (inclusive), as YYYY-MM-DD.
        timezone: IANA timezone name the dates are interpreted in.
    """
    try:
        range_start, _ = day_bounds(start_date, timezone)
        _, range_end = day_bounds(end_date, timezone)
        pool = await get_pool()
        events = await fetch_events_between(pool, range_start, range_end)
        now = datetime.now(dt_timezone.utc)
        return sleep_stats(events, start_date, end_date, timezone, now)
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


@mcp.tool
async def get_feedings(date: str, timezone: str = DEFAULT_TZ) -> list[dict[str, Any]]:
    """Return the chronological list of feeding entries (breast, bottle, solids) for one local day.

    Use this to check exactly what and when Theana ate on a given day.

    Args:
        date: The local calendar date to list feedings for, as YYYY-MM-DD.
        timezone: IANA timezone name the date is interpreted in.
    """
    try:
        day_start, day_end = day_bounds(date, timezone)
        pool = await get_pool()
        events = await fetch_events_between(pool, day_start, day_end)
        return list_feedings(events, date, timezone)
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


@mcp.tool
async def get_diapers(date: str, timezone: str = DEFAULT_TZ) -> list[dict[str, Any]]:
    """Return the chronological list of diaper changes (wet, dirty, both) for one local day.

    Use this to check diaper frequency/pattern on a given day.

    Args:
        date: The local calendar date to list diaper changes for, as YYYY-MM-DD.
        timezone: IANA timezone name the date is interpreted in.
    """
    try:
        day_start, day_end = day_bounds(date, timezone)
        pool = await get_pool()
        events = await fetch_events_between(pool, day_start, day_end)
        return list_diapers(events, date, timezone)
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


@mcp.tool
async def get_measurements(limit: int = 20) -> list[dict[str, Any]]:
    """Return the most recent growth measurements (weight, height, head circumference), oldest first.

    Use this to check recent growth trends or the latest recorded weight/height.

    Args:
        limit: Maximum number of most-recent measurements to return.
    """
    pool = await get_pool()
    rows = await fetch_all_measurements(pool, limit)
    rows.reverse()  # fetch_all_measurements is most-recent-first; return ascending (oldest first)
    return [
        {
            "date": r["measured_at"].isoformat() if r["measured_at"] else None,
            "weight_g": r["weight_g"],
            "height_mm": r["height_mm"],
            "head_circ_mm": r["head_circ_mm"],
            "note": r["note"],
        }
        for r in rows
    ]
