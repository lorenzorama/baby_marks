"""Pure aggregation logic + thin asyncpg fetchers for the MCP journal tools.

Ports the day-bucketing / midnight-split idioms of `app/stats.py`, but uses
`zoneinfo` (IANA tz names, per-date offsets, DST-correct) instead of fixed
minute offsets, since these functions back MCP tools that must reason about
arbitrary local "days" (per the "Tools (read-only)" section of
docs/superpowers/specs/2026-07-23-mcp-server-design.md).

Everything here except the `fetch_*` functions is pure and synchronous —
callers (later MCP tasks) are responsible for fetching rows and passing plain
dicts in.
"""

import math
from datetime import date as date_cls
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import asyncpg

MAX_SLEEP_STATS_DAYS = 90


def _round(x: float) -> int:
    """JS Math.round semantics (halves round up), matching app/stats.py."""
    return math.floor(x + 0.5)


def _zone(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"invalid timezone: {tz_name}") from exc


def _parse_date(date_str: str) -> date_cls:
    try:
        return date_cls.fromisoformat(date_str)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"invalid date: {date_str}") from exc


def fmt(dt: datetime, tz: ZoneInfo) -> dict[str, str]:
    """Render an aware datetime as `{"iso": ..., "local": "HH:MM"}` in `tz`."""
    local = dt.astimezone(tz)
    return {"iso": local.isoformat(), "local": local.strftime("%H:%M")}


def day_bounds(date_str: str, tz_name: str) -> tuple[datetime, datetime]:
    """UTC instants of local midnight -> next local midnight for `date_str` in `tz_name`.

    DST-correct: the next-midnight is computed as "same wall-clock time, next
    calendar day" in `tz_name`, then converted to UTC — so a spring-forward
    day yields a UTC span shorter than 24h and a fall-back day yields one
    longer than 24h.
    """
    day = _parse_date(date_str)
    tz = _zone(tz_name)
    start_local = datetime(day.year, day.month, day.day, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def _clip(start: datetime, end: datetime, day_start: datetime, day_end: datetime) -> tuple[datetime, datetime] | None:
    s, e = max(start, day_start), min(end, day_end)
    return (s, e) if s < e else None


def _duration_minutes(start: datetime, end: datetime) -> float:
    return (end - start).total_seconds() / 60


def _sleep_blocks(
    events: list[dict[str, Any]], day_start: datetime, day_end: datetime, now: datetime
) -> list[dict[str, Any]]:
    """Clipped, chronological sleep blocks (raw datetimes, not yet formatted)."""
    blocks: list[dict[str, Any]] = []
    for e in events:
        if e["type"] != "sleep":
            continue
        is_running = e.get("ended_at") is None
        raw_end = e["ended_at"] or now
        clipped = _clip(e["started_at"], raw_end, day_start, day_end)
        if clipped is None:
            continue
        s, clipped_end = clipped
        blocks.append(
            {
                "start": s,
                "end": clipped_end,
                "still_running": is_running and clipped_end == now,
                "minutes": _round(_duration_minutes(s, clipped_end)),
            }
        )
    blocks.sort(key=lambda b: b["start"])
    return blocks


def _in_day(started_at: datetime, day_start: datetime, day_end: datetime) -> bool:
    return day_start <= started_at < day_end


def summarize_day(
    events: list[dict[str, Any]],
    measurements: list[dict[str, Any]],
    date_str: str,
    tz_name: str,
    now: datetime,
    baby_name: str | None,
) -> dict[str, Any]:
    """The get_daily_summary shape for the local day `date_str` in `tz_name`."""
    day_start, day_end = day_bounds(date_str, tz_name)
    tz = _zone(tz_name)

    raw_blocks = _sleep_blocks(events, day_start, day_end, now)
    blocks = [
        {
            "start": fmt(b["start"], tz),
            "end": None if b["still_running"] else fmt(b["end"], tz),
            "minutes": b["minutes"],
        }
        for b in raw_blocks
    ]
    sleep_total = sum(b["minutes"] for b in blocks)
    longest_sleep = max((b["minutes"] for b in blocks), default=0)

    breast_minutes = 0.0
    feed_count = 0
    breast_count = 0
    bottle_count = 0
    bottle_ml = 0
    solids: list[str] = []
    diaper_wet = diaper_dirty = diaper_both = 0
    medicines: list[dict[str, Any]] = []
    pump_ml = 0

    for e in events:
        started_at = e["started_at"]
        etype = e["type"]
        details = e.get("details") or {}

        if etype == "feed" and details.get("method") == "breast":
            raw_end = e.get("ended_at") or now
            clipped = _clip(started_at, raw_end, day_start, day_end)
            if clipped is not None:
                s, en = clipped
                breast_minutes += _duration_minutes(s, en)

        if not _in_day(started_at, day_start, day_end):
            continue

        if etype == "feed":
            feed_count += 1
            method = details.get("method")
            if method == "breast":
                breast_count += 1
            elif method == "bottle":
                bottle_count += 1
                amount = details.get("amountMl")
                if isinstance(amount, (int, float)):
                    bottle_ml += amount
            elif method == "solids":
                food = details.get("food")
                if food:
                    solids.append(food)
        elif etype == "diaper":
            kind = details.get("kind")
            if kind == "wet":
                diaper_wet += 1
            elif kind == "dirty":
                diaper_dirty += 1
            elif kind == "both":
                diaper_both += 1
        elif etype == "medicine":
            medicines.append(
                {"time": fmt(started_at, tz), "name": details.get("name"), "dose": details.get("dose")}
            )
        elif etype == "pump":
            left = details.get("leftMl")
            right = details.get("rightMl")
            pump_ml += (left if isinstance(left, (int, float)) else 0) + (
                right if isinstance(right, (int, float)) else 0
            )

    day_measurements = []
    for m in measurements:
        measured_at = m.get("measured_at")
        if measured_at is not None and measured_at.isoformat() != date_str:
            continue
        day_measurements.append(
            {
                "weight_g": m.get("weight_g"),
                "height_mm": m.get("height_mm"),
                "head_circ_mm": m.get("head_circ_mm"),
            }
        )

    return {
        "date": date_str,
        "timezone": tz_name,
        "baby_name": baby_name,
        "sleep": {
            "total_minutes": sleep_total,
            "blocks": blocks,
            "longest_block_minutes": longest_sleep,
        },
        "feeds": {
            "count": feed_count,
            "breast_count": breast_count,
            "breast_minutes": _round(breast_minutes),
            "bottle_count": bottle_count,
            "bottle_ml": bottle_ml,
            "solids": solids,
        },
        "diapers": {
            "wet": diaper_wet,
            "dirty": diaper_dirty,
            "both": diaper_both,
            "total": diaper_wet + diaper_dirty + diaper_both,
        },
        "medicines": medicines,
        "pump_ml": pump_ml,
        "measurements": day_measurements,
    }


def sleep_stats(
    events: list[dict[str, Any]],
    start_date: str,
    end_date: str,
    tz_name: str,
    now: datetime,
) -> dict[str, Any]:
    """Per-day sleep totals + period averages, per get_sleep_stats."""
    start = _parse_date(start_date)
    end = _parse_date(end_date)
    _zone(tz_name)  # validate tz eagerly for a consistent error regardless of range
    if end < start:
        raise ValueError("end_date must not be before start_date")
    span_days = (end - start).days
    if span_days > MAX_SLEEP_STATS_DAYS:
        raise ValueError(f"date range exceeds {MAX_SLEEP_STATS_DAYS} days")

    sleep_events = [e for e in events if e["type"] == "sleep"]

    days: list[dict[str, Any]] = []
    for i in range(span_days + 1):
        current = start + timedelta(days=i)
        date_str = current.isoformat()
        day_start, day_end = day_bounds(date_str, tz_name)
        blocks = _sleep_blocks(sleep_events, day_start, day_end, now)
        minutes = [b["minutes"] for b in blocks]
        days.append(
            {
                "date": date_str,
                "total_minutes": sum(minutes),
                "block_count": len(blocks),
                "longest_block_minutes": max(minutes, default=0),
            }
        )

    n = len(days) or 1
    averages = {
        "total_minutes": sum(d["total_minutes"] for d in days) / n,
        "longest_block_minutes": sum(d["longest_block_minutes"] for d in days) / n,
    }

    return {"days": days, "averages": averages}


def list_feedings(events: list[dict[str, Any]], date_str: str, tz_name: str) -> list[dict[str, Any]]:
    """Chronological feed entries for the local day, per get_feedings."""
    day_start, day_end = day_bounds(date_str, tz_name)
    tz = _zone(tz_name)

    feeds = [
        e
        for e in events
        if e["type"] == "feed" and _in_day(e["started_at"], day_start, day_end)
    ]
    feeds.sort(key=lambda e: e["started_at"])

    out: list[dict[str, Any]] = []
    for e in feeds:
        details = e.get("details") or {}
        method = details.get("method")
        entry: dict[str, Any] = {
            "start": fmt(e["started_at"], tz),
            "end": fmt(e["ended_at"], tz) if e.get("ended_at") else None,
            "method": method,
        }
        if method == "breast":
            if details.get("side"):
                entry["side"] = details["side"]
            if e.get("ended_at"):
                entry["minutes"] = _round(_duration_minutes(e["started_at"], e["ended_at"]))
        elif method == "bottle":
            if isinstance(details.get("amountMl"), (int, float)):
                entry["amount_ml"] = details["amountMl"]
        elif method == "solids":
            if details.get("food"):
                entry["food"] = details["food"]
        out.append(entry)
    return out


def list_diapers(events: list[dict[str, Any]], date_str: str, tz_name: str) -> list[dict[str, Any]]:
    """Chronological diaper entries for the local day, per get_diapers."""
    day_start, day_end = day_bounds(date_str, tz_name)
    tz = _zone(tz_name)

    diapers = [
        e
        for e in events
        if e["type"] == "diaper" and _in_day(e["started_at"], day_start, day_end)
    ]
    diapers.sort(key=lambda e: e["started_at"])

    return [
        {"time": fmt(e["started_at"], tz), "kind": (e.get("details") or {}).get("kind")}
        for e in diapers
    ]


# --- Async fetchers (thin, asyncpg; parameterized SQL only) ----------------


async def fetch_events_between(
    pool: asyncpg.Pool, start_utc: datetime, end_utc: datetime
) -> list[dict[str, Any]]:
    """Events overlapping [start_utc, end_utc). Running events (ended_at IS
    NULL) are always included regardless of when they started, so callers can
    clip/attribute them relative to `now` themselves."""
    rows = await pool.fetch(
        """
        SELECT type, started_at, ended_at, details, caregiver
        FROM events
        WHERE started_at < $2 AND (ended_at IS NULL OR ended_at > $1)
        ORDER BY started_at ASC
        """,
        start_utc,
        end_utc,
    )
    return [
        {
            "type": r["type"],
            "started_at": r["started_at"],
            "ended_at": r["ended_at"],
            "details": r["details"] or {},
            "caregiver": r["caregiver"],
        }
        for r in rows
    ]


async def fetch_measurements_on(pool: asyncpg.Pool, date_str: str) -> list[dict[str, Any]]:
    """Measurements recorded on the given calendar date (measured_at is a
    plain date column, not tz-aware)."""
    day = _parse_date(date_str)
    rows = await pool.fetch(
        """
        SELECT measured_at, weight_g, height_mm, head_circ_mm, note
        FROM measurements
        WHERE measured_at = $1
        ORDER BY measured_at ASC
        """,
        day,
    )
    return [
        {
            "measured_at": r["measured_at"],
            "weight_g": r["weight_g"],
            "height_mm": r["height_mm"],
            "head_circ_mm": r["head_circ_mm"],
            "note": r["note"],
        }
        for r in rows
    ]


async def fetch_all_measurements(pool: asyncpg.Pool, limit: int) -> list[dict[str, Any]]:
    """Most recent `limit` measurements, most-recent-first (caller reverses
    for ascending output per get_measurements)."""
    rows = await pool.fetch(
        """
        SELECT measured_at, weight_g, height_mm, head_circ_mm, note
        FROM measurements
        ORDER BY measured_at DESC
        LIMIT $1
        """,
        limit,
    )
    return [
        {
            "measured_at": r["measured_at"],
            "weight_g": r["weight_g"],
            "height_mm": r["height_mm"],
            "head_circ_mm": r["head_circ_mm"],
            "note": r["note"],
        }
        for r in rows
    ]


async def fetch_baby_name(pool: asyncpg.Pool) -> str | None:
    row = await pool.fetchrow("SELECT name FROM babies LIMIT 1")
    return row["name"] if row else None
