"""Photos API against a real Postgres. Skipped unless BM_TEST_DATABASE_URL is set."""

import asyncio
import os

import pytest

DB_URL = os.environ.get("BM_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not DB_URL, reason="BM_TEST_DATABASE_URL not set")

if DB_URL:
    os.environ["DATABASE_URL"] = DB_URL
os.environ.setdefault("APP_SECRET_PHRASE", "test-secret")


def sof0(width: int, height: int) -> bytes:
    sof = (
        b"\xff\xc0"
        + (17).to_bytes(2, "big")
        + b"\x08"
        + height.to_bytes(2, "big")
        + width.to_bytes(2, "big")
        + b"\x03"
        + b"\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    )
    return b"\xff\xd8" + sof + b"\xff\xd9"


@pytest.fixture
async def client():
    from httpx import ASGITransport, AsyncClient

    from app import db as db_module
    from app.auth import COOKIE_NAME, compute_auth_token
    from app.main import app

    await db_module.run_migrations()
    pool = await db_module.get_pool()
    await pool.execute("DELETE FROM photos;")

    token = compute_auth_token(os.environ["APP_SECRET_PHRASE"])
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies={COOKIE_NAME: token},
    ) as c:
        yield c
    await db_module.close_pool()


JPEG_HEADERS = {"Content-Type": "image/jpeg"}


async def test_upload_then_fetch_returns_identical_bytes(client):
    blob = sof0(320, 240)
    res = await client.post("/api/photos", content=blob, headers=JPEG_HEADERS)
    assert res.status_code == 201
    photo = res.json()["photo"]
    assert photo["width"] == 320
    assert photo["height"] == 240
    assert photo["takenAt"].endswith("Z")

    got = await client.get(f"/api/photos/{photo['id']}")
    assert got.status_code == 200
    assert got.content == blob
    assert got.headers["content-type"] == "image/jpeg"
    assert "private" in got.headers["cache-control"]


async def test_list_returns_metadata_only_newest_first(client):
    for size in (100, 200, 300):
        await client.post("/api/photos", content=sof0(size, size), headers=JPEG_HEADERS)
    res = await client.get("/api/photos")
    assert res.status_code == 200
    photos = res.json()["photos"]
    assert [p["width"] for p in photos] == [300, 200, 100]
    assert set(photos[0]) == {"id", "takenAt", "width", "height"}


async def test_list_limit_is_validated(client):
    assert (await client.get("/api/photos?limit=0")).status_code == 400
    assert (await client.get("/api/photos?limit=201")).status_code == 400
    assert (await client.get("/api/photos?limit=1")).status_code == 200


async def test_rejects_payload_over_two_mib(client):
    blob = sof0(320, 240) + b"\x00" * (2 * 1024 * 1024)
    res = await client.post("/api/photos", content=blob, headers=JPEG_HEADERS)
    assert res.status_code == 413


async def test_rejects_wrong_content_type(client):
    res = await client.post(
        "/api/photos", content=sof0(320, 240), headers={"Content-Type": "image/png"}
    )
    assert res.status_code == 415


async def test_rejects_payload_that_is_not_a_jpeg(client):
    res = await client.post("/api/photos", content=b"totally not a jpeg", headers=JPEG_HEADERS)
    assert res.status_code == 400


async def test_delete_then_missing(client):
    created = await client.post("/api/photos", content=sof0(320, 240), headers=JPEG_HEADERS)
    photo_id = created.json()["photo"]["id"]
    assert (await client.delete(f"/api/photos/{photo_id}")).status_code == 204
    assert (await client.get(f"/api/photos/{photo_id}")).status_code == 404
    assert (await client.delete(f"/api/photos/{photo_id}")).status_code == 404


async def test_retention_keeps_only_the_newest_200(client):
    from app import db as db_module

    pool = await db_module.get_pool()
    # 200 pre-existing rows, oldest first.
    for i in range(200):
        await pool.execute(
            "INSERT INTO photos (taken_at, width, height, bytes) "
            "VALUES (now() - ($1 || ' seconds')::interval, 10, 10, $2)",
            str(300 - i),
            sof0(10, 10),
        )
    res = await client.post("/api/photos", content=sof0(999, 999), headers=JPEG_HEADERS)
    assert res.status_code == 201

    count = await pool.fetchval("SELECT count(*) FROM photos")
    assert count == 200
    newest = await pool.fetchval("SELECT width FROM photos ORDER BY taken_at DESC LIMIT 1")
    assert newest == 999


async def test_rejects_chunked_upload_over_two_mib_with_no_content_length(client):
    # An async generator makes httpx stream the request body without a known
    # length, so no Content-Length header is sent (Transfer-Encoding:
    # chunked instead). This exercises the streaming size guard rather than
    # the Content-Length fast-path. The payload is well over MAX_BYTES so a
    # non-streaming implementation (`await request.body()`) would have
    # buffered the whole thing into memory before ever checking its size.
    chunk = b"\x00" * (64 * 1024)
    total_bytes = 6 * 1024 * 1024  # well past the 2 MiB limit

    async def chunks():
        sent = 0
        yield sof0(320, 240)  # valid-looking JPEG start, irrelevant once rejected
        sent += len(sof0(320, 240))
        while sent < total_bytes:
            yield chunk
            sent += len(chunk)

    res = await client.post("/api/photos", content=chunks(), headers=JPEG_HEADERS)
    assert res.status_code == 413
    assert res.request.headers.get("content-length") is None
    assert res.request.headers.get("transfer-encoding") == "chunked"


async def test_concurrent_uploads_keep_retention_invariant(client):
    from app import db as db_module

    pool = await db_module.get_pool()
    # 200 pre-existing rows, oldest first, mirroring
    # test_retention_keeps_only_the_newest_200.
    for i in range(200):
        await pool.execute(
            "INSERT INTO photos (taken_at, width, height, bytes) "
            "VALUES (now() - ($1 || ' seconds')::interval, 10, 10, $2)",
            str(300 - i),
            sof0(10, 10),
        )

    # Genuine concurrency: four separate requests fired together with
    # asyncio.gather over one AsyncClient/ASGI app, each getting its own
    # pool connection and transaction. Before the advisory-lock fix, two
    # overlapping transactions can each compute "delete everything except
    # the newest 200" from a snapshot that doesn't include the other's
    # just-inserted row, leaving 201+ rows behind.
    new_widths = [901, 902, 903, 904]
    results = await asyncio.gather(
        *(
            client.post("/api/photos", content=sof0(w, w), headers=JPEG_HEADERS)
            for w in new_widths
        )
    )
    assert [r.status_code for r in results] == [201] * 4

    count = await pool.fetchval("SELECT count(*) FROM photos")
    assert count == 200

    surviving = await pool.fetch(
        "SELECT width FROM photos WHERE width = ANY($1::int[])", new_widths
    )
    assert {r["width"] for r in surviving} == set(new_widths)


async def test_all_routes_require_auth(client):
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    created = await client.post("/api/photos", content=sof0(320, 240), headers=JPEG_HEADERS)
    photo_id = created.json()["photo"]["id"]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon:
        assert (await anon.get("/api/photos")).status_code == 401
        assert (await anon.get(f"/api/photos/{photo_id}")).status_code == 401
        assert (
            await anon.post("/api/photos", content=sof0(1, 1), headers=JPEG_HEADERS)
        ).status_code == 401
        assert (await anon.delete(f"/api/photos/{photo_id}")).status_code == 401
