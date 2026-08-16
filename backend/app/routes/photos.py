from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from ..auth import require_auth
from ..db import get_pool
from ..errors import ApiError
from ..photos.jpeg import InvalidJpeg, jpeg_dimensions
from ..serializers import photo_out

router = APIRouter(prefix="/api/photos", dependencies=[Depends(require_auth)])

MAX_BYTES = 2 * 1024 * 1024
RETENTION = 200
CONTENT_TYPE = "image/jpeg"


@router.get("")
async def list_photos(limit: int = 50) -> dict:
    if limit < 1 or limit > RETENTION:
        raise ApiError(400, "invalid", message="limit must be between 1 and 200")
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, taken_at, width, height FROM photos ORDER BY taken_at DESC, id DESC LIMIT $1",
        limit,
    )
    return {"photos": [photo_out(r) for r in rows]}


@router.post("")
async def create_photo(request: Request) -> JSONResponse:
    if request.headers.get("content-type", "").split(";")[0].strip() != CONTENT_TYPE:
        raise ApiError(415, "unsupported_media_type")
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BYTES:
        raise ApiError(413, "too_large")
    body = await request.body()
    if len(body) > MAX_BYTES:
        raise ApiError(413, "too_large")
    try:
        width, height = jpeg_dimensions(body)
    except InvalidJpeg as exc:
        raise ApiError(400, "invalid", message=str(exc)) from exc

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "INSERT INTO photos (width, height, bytes) VALUES ($1, $2, $3) "
                "RETURNING id, taken_at, width, height",
                width,
                height,
                body,
            )
            # Cap the table so the pg_dump backup taken before every deploy
            # cannot grow without bound.
            await conn.execute(
                "DELETE FROM photos WHERE id NOT IN ("
                "SELECT id FROM photos ORDER BY taken_at DESC, id DESC LIMIT $1)",
                RETENTION,
            )
    return JSONResponse({"photo": photo_out(row)}, status_code=201)


@router.get("/{photo_id}")
async def get_photo(photo_id: int) -> Response:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT bytes, content_type FROM photos WHERE id = $1", photo_id
    )
    if not row:
        raise ApiError(404, "not_found")
    return Response(
        content=row["bytes"],
        media_type=row["content_type"],
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.delete("/{photo_id}", status_code=204)
async def delete_photo(photo_id: int) -> Response:
    pool = await get_pool()
    deleted = await pool.fetchrow("DELETE FROM photos WHERE id = $1 RETURNING id", photo_id)
    if not deleted:
        raise ApiError(404, "not_found")
    return Response(status_code=204)
