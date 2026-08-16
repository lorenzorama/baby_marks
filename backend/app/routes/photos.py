import zlib

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

# Fixed key for pg_advisory_xact_lock, used to serialize the insert+prune
# below across concurrent uploads (see create_photo). Under READ COMMITTED,
# two overlapping transactions can each decide to evict the same oldest row
# without seeing each other's just-inserted row, leaving more than RETENTION
# rows behind. Taking this transaction-scoped advisory lock as the first
# statement of the transaction forces overlapping uploads to run one at a
# time; the lock is released automatically at commit/rollback. The value
# itself is arbitrary and carries no meaning beyond being a stable int64 that
# is unlikely to collide with another lock in this application, so it's
# derived deterministically (crc32, not the randomized builtin hash()) from
# the table name.
RETENTION_LOCK_KEY = zlib.crc32(b"photos_retention_prune")

# Reject a Content-Length header before parsing it as an int: an
# attacker-controlled digit string with thousands of digits can make
# int(declared) itself raise ValueError (Python's integer-string conversion
# limit), turning a bad header into an unhandled 500. No legitimate
# Content-Length needs more than 20 digits (that's already ~10**20 bytes).
MAX_CONTENT_LENGTH_HEADER_DIGITS = 20


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
    if (
        declared is not None
        and len(declared) <= MAX_CONTENT_LENGTH_HEADER_DIGITS
        and declared.isdigit()
        and int(declared) > MAX_BYTES
    ):
        # Cheap early exit when the client sent an honest, well-formed
        # Content-Length. Chunked requests (Transfer-Encoding: chunked) have
        # no Content-Length at all, so this is only a fast path, not the
        # actual guard against oversized uploads below.
        raise ApiError(413, "too_large")

    # Stream the body in bounded chunks instead of `await request.body()`,
    # which would buffer the entire payload in memory before we ever get to
    # check its size. Without Content-Length (chunked transfer encoding) an
    # unauthenticated-size-limit-free `.body()` call lets any authenticated
    # caller exhaust memory on a small VPS. Bail out the instant the running
    # total crosses MAX_BYTES and stop reading further chunks.
    buffer = bytearray()
    async for chunk in request.stream():
        buffer.extend(chunk)
        if len(buffer) > MAX_BYTES:
            raise ApiError(413, "too_large")
    body = bytes(buffer)
    try:
        width, height = jpeg_dimensions(body)
    except InvalidJpeg as exc:
        raise ApiError(400, "invalid", message=str(exc)) from exc

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Serialize the insert+prune below against other concurrent
            # uploads; see RETENTION_LOCK_KEY for why.
            await conn.execute("SELECT pg_advisory_xact_lock($1)", RETENTION_LOCK_KEY)
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
