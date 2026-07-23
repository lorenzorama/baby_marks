import asyncio
import hmac

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..auth import COOKIE_NAME, compute_auth_token
from ..config import cookie_secure, secret_phrase
from ..errors import ApiError
from ..schemas import LoginInput

router = APIRouter(prefix="/api/auth")

YEAR_SECONDS = 60 * 60 * 24 * 365


@router.post("/login")
async def login(body: LoginInput) -> JSONResponse:
    secret = secret_phrase()
    if not secret:
        raise ApiError(500, "server_not_configured")
    if not hmac.compare_digest(
        compute_auth_token(body.secret), compute_auth_token(secret)
    ):
        await asyncio.sleep(0.5)  # brute-force damper
        raise ApiError(401, "invalid_secret")
    res = JSONResponse({"ok": True})
    res.set_cookie(
        COOKIE_NAME,
        compute_auth_token(secret),
        httponly=True,
        samesite="lax",
        secure=cookie_secure(),
        max_age=YEAR_SECONDS,
        path="/",
    )
    return res


@router.post("/logout")
async def logout() -> JSONResponse:
    res = JSONResponse({"ok": True})
    res.delete_cookie(
        COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=cookie_secure(),
        path="/",
    )
    return res
