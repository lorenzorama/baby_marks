from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .db import close_pool, run_migrations
from .errors import ApiError
from .routes import auth, baby, events, measurements, stats


@asynccontextmanager
async def lifespan(_: FastAPI):
    await run_migrations()
    yield
    await close_pool()


app = FastAPI(title="Baby Marks API", lifespan=lifespan)


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(exc.body(), status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    # Match the old API contract: bad payloads are 400 {"error": "invalid", ...}.
    return JSONResponse(
        {"error": "invalid", "details": exc.errors(include_url=False, include_input=False)},
        status_code=400,
    )


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True}


app.include_router(auth.router)
app.include_router(baby.router)
app.include_router(events.router)
app.include_router(measurements.router)
app.include_router(stats.router)
