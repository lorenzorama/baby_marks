from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..auth import require_auth
from ..db import get_pool
from ..errors import ApiError
from ..schemas import MeasurementInput
from ..serializers import measurement_out

router = APIRouter(prefix="/api/measurements", dependencies=[Depends(require_auth)])


@router.get("")
async def list_measurements() -> dict:
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM measurements ORDER BY measured_at ASC")
    return {"measurements": [measurement_out(r) for r in rows]}


@router.post("")
async def create_measurement(body: MeasurementInput) -> JSONResponse:
    if body.weightG is None and body.heightMm is None and body.headCircMm is None:
        raise ApiError(400, "invalid", message="at least one measurement value required")
    pool = await get_pool()
    baby = await pool.fetchrow("SELECT id FROM babies LIMIT 1")
    if not baby:
        raise ApiError(400, "no_baby")
    row = await pool.fetchrow(
        """
        INSERT INTO measurements (baby_id, measured_at, weight_g, height_mm, head_circ_mm, note)
        VALUES ($1, $2::date, $3, $4, $5, $6) RETURNING *
        """,
        baby["id"],
        body.measuredAt,
        body.weightG,
        body.heightMm,
        body.headCircMm,
        body.note,
    )
    return JSONResponse({"measurement": measurement_out(row)}, status_code=201)


@router.delete("/{measurement_id}")
async def delete_measurement(measurement_id: int) -> dict:
    pool = await get_pool()
    deleted = await pool.fetchrow(
        "DELETE FROM measurements WHERE id = $1 RETURNING id", measurement_id
    )
    if not deleted:
        raise ApiError(404, "not_found")
    return {"ok": True}
