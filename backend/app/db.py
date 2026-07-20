import json
from pathlib import Path

import asyncpg

from .config import database_url

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

_pool: asyncpg.Pool | None = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec(
        "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(database_url(), init=_init_connection)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def run_migrations() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS _migrations (
                name text PRIMARY KEY,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        applied = {r["name"] for r in await conn.fetch("SELECT name FROM _migrations")}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in applied:
                continue
            async with conn.transaction():
                await conn.execute(path.read_text())
                await conn.execute(
                    "INSERT INTO _migrations (name) VALUES ($1)", path.name
                )
