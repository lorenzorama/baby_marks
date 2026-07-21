import hashlib
import hmac

from fastapi import Request

from .config import secret_phrase
from .errors import ApiError

COOKIE_NAME = "bm_auth"
# Keep the exact HMAC construction the old Next.js backend used so existing
# bm_auth cookies stay valid across the migration.
_MESSAGE = b"baby-marks-auth-v1"


def compute_auth_token(secret: str) -> str:
    return hmac.new(secret.encode(), _MESSAGE, hashlib.sha256).hexdigest()


def is_authed(request: Request) -> bool:
    secret = secret_phrase()
    if not secret:
        return False
    cookie = request.cookies.get(COOKIE_NAME)
    if not cookie:
        return False
    return hmac.compare_digest(cookie, compute_auth_token(secret))


def require_auth(request: Request) -> None:
    if not is_authed(request):
        raise ApiError(401, "unauthenticated")
