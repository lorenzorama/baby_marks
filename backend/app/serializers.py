from datetime import date, datetime, timezone
from typing import Any

import asyncpg


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def day(d: date | None) -> str | None:
    return d.isoformat() if d is not None else None


def baby_out(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "birthDate": day(row["birth_date"]),
        "createdAt": iso(row["created_at"]),
    }


def event_out(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "babyId": row["baby_id"],
        "type": row["type"],
        "startedAt": iso(row["started_at"]),
        "endedAt": iso(row["ended_at"]),
        "details": row["details"] or {},
        "note": row["note"],
        "caregiver": row["caregiver"],
        "createdAt": iso(row["created_at"]),
        "updatedAt": iso(row["updated_at"]),
    }


def measurement_out(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "babyId": row["baby_id"],
        "measuredAt": day(row["measured_at"]),
        "weightG": row["weight_g"],
        "heightMm": row["height_mm"],
        "headCircMm": row["head_circ_mm"],
        "note": row["note"],
        "createdAt": iso(row["created_at"]),
    }
