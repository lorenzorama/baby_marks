from datetime import datetime

import asyncpg
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..auth import require_auth
from ..db import get_pool
from ..errors import ApiError
from ..schemas import (
    EVENT_TYPES,
    POINT_TYPES,
    TIMER_TYPES,
    CreateEventInput,
    PatchEventInput,
    ensure_utc,
    validate_details,
)
from ..serializers import event_out

router = APIRouter(prefix="/api/events", dependencies=[Depends(require_auth)])


def _parse_date(value: str) -> datetime:
    try:
        return ensure_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError:
        raise ApiError(400, "invalid", message="invalid date")


async def _running_event(
    pool: asyncpg.Pool, event_type: str, exclude_id: int | None = None
) -> asyncpg.Record | None:
    if exclude_id is None:
        return await pool.fetchrow(
            "SELECT * FROM events WHERE type = $1 AND ended_at IS NULL", event_type
        )
    return await pool.fetchrow(
        "SELECT * FROM events WHERE type = $1 AND ended_at IS NULL AND id <> $2",
        event_type,
        exclude_id,
    )


@router.get("")
async def list_events(request: Request) -> dict:
    pool = await get_pool()
    params = request.query_params

    try:
        limit = int(params.get("limit") or 100)
    except ValueError:
        limit = 100
    limit = min(max(limit, 1), 500)

    conds: list[str] = []
    args: list = []

    event_type = params.get("type")
    if event_type:
        if event_type not in EVENT_TYPES:
            raise ApiError(400, "invalid", message="invalid type")
        args.append(event_type)
        conds.append(f"type = ${len(args)}")
    if params.get("from"):
        args.append(_parse_date(params["from"]))
        conds.append(f"started_at >= ${len(args)}")
    if params.get("to"):
        args.append(_parse_date(params["to"]))
        conds.append(f"started_at <= ${len(args)}")
    if params.get("before"):
        args.append(_parse_date(params["before"]))
        conds.append(f"started_at < ${len(args)}")

    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    args.append(limit)
    rows = await pool.fetch(
        f"SELECT * FROM events {where} ORDER BY started_at DESC LIMIT ${len(args)}",
        *args,
    )
    running = await pool.fetch(
        "SELECT * FROM events WHERE ended_at IS NULL ORDER BY started_at DESC"
    )
    return {"events": [event_out(r) for r in rows], "running": [event_out(r) for r in running]}


@router.post("")
async def create_event(body: CreateEventInput) -> JSONResponse:
    if not validate_details(body.type, body.details):
        raise ApiError(400, "invalid", message=f"invalid details for {body.type}")
    started = ensure_utc(body.startedAt)
    ended = ensure_utc(body.endedAt) if body.endedAt else None
    if ended and ended < started:
        raise ApiError(400, "invalid", message="endedAt before startedAt")
    if body.type in POINT_TYPES and ended is None:
        raise ApiError(400, "invalid", message=f"{body.type} requires endedAt")

    pool = await get_pool()
    baby = await pool.fetchrow("SELECT id FROM babies LIMIT 1")
    if not baby:
        raise ApiError(400, "no_baby")

    if ended is None and body.type in TIMER_TYPES:
        running = await _running_event(pool, body.type)
        if running:
            raise ApiError(409, "timer_running", event=event_out(running))

    try:
        row = await pool.fetchrow(
            """
            INSERT INTO events (baby_id, type, started_at, ended_at, details, note, caregiver)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
            """,
            baby["id"],
            body.type,
            started,
            ended,
            body.details,
            body.note,
            body.caregiver,
        )
    except asyncpg.UniqueViolationError:
        running = await _running_event(pool, body.type)
        raise ApiError(
            409, "timer_running", event=event_out(running) if running else None
        )
    return JSONResponse({"event": event_out(row)}, status_code=201)


@router.patch("/{event_id}")
async def patch_event(event_id: int, body: PatchEventInput) -> dict:
    pool = await get_pool()
    existing = await pool.fetchrow("SELECT * FROM events WHERE id = $1", event_id)
    if not existing:
        raise ApiError(404, "not_found")

    provided = body.model_fields_set
    started = ensure_utc(body.startedAt) if body.startedAt else existing["started_at"]
    if "endedAt" in provided:
        ended = ensure_utc(body.endedAt) if body.endedAt else None
    else:
        ended = existing["ended_at"]
    details = body.details if "details" in provided else (existing["details"] or {})
    note = body.note if "note" in provided else existing["note"]
    caregiver = body.caregiver if body.caregiver else existing["caregiver"]

    if not validate_details(existing["type"], details):
        raise ApiError(400, "invalid", message=f"invalid details for {existing['type']}")
    if ended and ended < started:
        raise ApiError(400, "invalid", message="endedAt before startedAt")
    if ended is None and existing["type"] in POINT_TYPES:
        raise ApiError(400, "invalid", message="point events require endedAt")

    if ended is None and existing["type"] in TIMER_TYPES:
        running = await _running_event(pool, existing["type"], exclude_id=event_id)
        if running:
            raise ApiError(409, "timer_running", event=event_out(running))

    try:
        row = await pool.fetchrow(
            """
            UPDATE events
            SET started_at = $1, ended_at = $2, details = $3, note = $4,
                caregiver = $5, updated_at = now()
            WHERE id = $6 RETURNING *
            """,
            started,
            ended,
            details,
            note,
            caregiver,
            event_id,
        )
    except asyncpg.UniqueViolationError:
        running = await _running_event(pool, existing["type"], exclude_id=event_id)
        raise ApiError(
            409, "timer_running", event=event_out(running) if running else None
        )
    return {"event": event_out(row)}


@router.delete("/{event_id}")
async def delete_event(event_id: int) -> dict:
    pool = await get_pool()
    deleted = await pool.fetchrow(
        "DELETE FROM events WHERE id = $1 RETURNING id", event_id
    )
    if not deleted:
        raise ApiError(404, "not_found")
    return {"ok": True}
