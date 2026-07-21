from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request

from ..auth import require_auth
from ..db import get_pool
from ..stats import StatEvent, aggregate_daily

router = APIRouter(prefix="/api/stats", dependencies=[Depends(require_auth)])


def _int_param(request: Request, name: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(request.query_params.get(name) or default)
    except ValueError:
        value = default
    return min(max(value, lo), hi)


@router.get("")
async def get_stats(request: Request) -> dict:
    days = _int_param(request, "days", 7, 1, 90)
    tz_offset = _int_param(request, "tzOffset", 0, -840, 840)

    pool = await get_pool()
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days + 1)
    rows = await pool.fetch(
        """
        SELECT type, started_at, ended_at, details FROM events
        WHERE started_at >= $1 OR ended_at >= $1 OR ended_at IS NULL
        """,
        since,
    )
    events = [
        StatEvent(
            type=r["type"],
            started_at=r["started_at"],
            ended_at=r["ended_at"],
            details=r["details"] or {},
        )
        for r in rows
    ]
    return {"days": aggregate_daily(events, days, tz_offset, now)}
