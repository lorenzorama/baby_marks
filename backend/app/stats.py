"""Daily aggregation of events, a direct port of the former TypeScript lib/stats.ts."""

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from app.mcp.summaries import merge_intervals

DAY = timedelta(days=1)


def _js_round(x: float) -> int:
    """JS Math.round semantics (halves round up), unlike Python's banker's rounding."""
    return math.floor(x + 0.5)


@dataclass
class StatEvent:
    type: str
    started_at: datetime
    ended_at: datetime | None
    details: dict[str, Any] = field(default_factory=dict)


def _day_key(d: datetime, tz_offset_minutes: int) -> str:
    return (d - timedelta(minutes=tz_offset_minutes)).astimezone(timezone.utc).date().isoformat()


def _empty_day(date_str: str) -> dict[str, Any]:
    return {
        "date": date_str,
        "sleepMinutes": 0.0,
        "breastMinutes": 0.0,
        "feedCount": 0,
        "bottleMl": 0,
        "diaperWet": 0,
        "diaperDirty": 0,
        "diaperBoth": 0,
        "pumpMl": 0,
        "medicineCount": 0,
    }


def _next_local_midnight(d: datetime, tz_offset_minutes: int) -> datetime:
    """End of the local day containing `d`, as a UTC instant."""
    local = (d - timedelta(minutes=tz_offset_minutes)).astimezone(timezone.utc)
    next_midnight = datetime(
        local.year, local.month, local.day, tzinfo=timezone.utc
    ) + DAY
    return next_midnight + timedelta(minutes=tz_offset_minutes)


def aggregate_daily(
    events: list[StatEvent], days: int, tz_offset_minutes: int, now: datetime
) -> list[dict[str, Any]]:
    by_day: dict[str, dict[str, Any]] = {}
    for i in range(days - 1, -1, -1):
        key = _day_key(now - i * DAY, tz_offset_minutes)
        by_day[key] = _empty_day(key)

    # Sleep intervals are collected per local day (clipped to day boundaries)
    # and merged (union) below, rather than summed directly, so overlapping
    # sleep events don't double-count a day's total.
    sleep_intervals_by_day: dict[str, list[tuple[datetime, datetime]]] = defaultdict(list)

    for e in events:
        details = e.details or {}
        is_breast = e.type == "feed" and details.get("method") == "breast"

        # Durations (sleep + breast feeds) are spread across local days.
        if e.type == "sleep" or is_breast:
            end = e.ended_at or now
            cursor = e.started_at
            while cursor < end:
                boundary = _next_local_midnight(cursor, tz_offset_minutes)
                slice_end = min(end, boundary)
                day_key = _day_key(cursor, tz_offset_minutes)
                if e.type == "sleep":
                    if day_key in by_day:
                        sleep_intervals_by_day[day_key].append((cursor, slice_end))
                else:
                    minutes = (slice_end - cursor).total_seconds() / 60
                    bucket = by_day.get(day_key)
                    if bucket is not None:
                        bucket["breastMinutes"] += minutes
                cursor = slice_end

        # Counts/volumes attributed to the start day.
        bucket = by_day.get(_day_key(e.started_at, tz_offset_minutes))
        if bucket is None:
            continue
        if e.type == "feed":
            bucket["feedCount"] += 1
            amount = details.get("amountMl")
            if details.get("method") == "bottle" and isinstance(amount, (int, float)):
                bucket["bottleMl"] += amount
        elif e.type == "diaper":
            kind = details.get("kind")
            if kind == "wet":
                bucket["diaperWet"] += 1
            elif kind == "dirty":
                bucket["diaperDirty"] += 1
            elif kind == "both":
                bucket["diaperBoth"] += 1
        elif e.type == "pump":
            left = details.get("leftMl")
            right = details.get("rightMl")
            bucket["pumpMl"] += (left if isinstance(left, (int, float)) else 0) + (
                right if isinstance(right, (int, float)) else 0
            )
        elif e.type == "medicine":
            bucket["medicineCount"] += 1

    for day_key, intervals in sleep_intervals_by_day.items():
        bucket = by_day[day_key]
        merged = merge_intervals(intervals)
        bucket["sleepMinutes"] = sum((e - s).total_seconds() / 60 for s, e in merged)

    out = list(by_day.values())
    for d in out:
        d["sleepMinutes"] = _js_round(d["sleepMinutes"])
        d["breastMinutes"] = _js_round(d["breastMinutes"])
    return out
