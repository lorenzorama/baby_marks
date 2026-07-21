import asyncpg
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..auth import require_auth
from ..db import get_pool
from ..errors import ApiError
from ..schemas import BabyInput
from ..serializers import baby_out

router = APIRouter(prefix="/api/baby", dependencies=[Depends(require_auth)])


@router.get("")
async def get_baby() -> dict:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM babies LIMIT 1")
    return {"baby": baby_out(row) if row else None}


@router.post("")
async def create_baby(body: BabyInput) -> JSONResponse:
    pool = await get_pool()
    existing = await pool.fetchrow("SELECT id FROM babies LIMIT 1")
    if existing:
        raise ApiError(409, "baby_exists")
    try:
        row = await pool.fetchrow(
            "INSERT INTO babies (name, birth_date) VALUES ($1, $2::date) RETURNING *",
            body.name,
            body.birthDate,
        )
    except asyncpg.UniqueViolationError:
        raise ApiError(409, "baby_exists")
    return JSONResponse({"baby": baby_out(row)}, status_code=201)


@router.patch("")
async def update_baby(body: BabyInput) -> dict:
    pool = await get_pool()
    existing = await pool.fetchrow("SELECT id FROM babies LIMIT 1")
    if not existing:
        raise ApiError(404, "not_found")
    row = await pool.fetchrow(
        "UPDATE babies SET name = $1, birth_date = $2::date WHERE id = $3 RETURNING *",
        body.name,
        body.birthDate,
        existing["id"],
    )
    return {"baby": baby_out(row)}
