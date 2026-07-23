"""Pure token core for the MCP OAuth flow: HS256 JWS access tokens and
opaque refresh tokens.

No DB, no fastmcp import, no new dependencies -- just `hmac`, `hashlib`,
`base64`, `json`, `time`, and `secrets` from the standard library. This
module is deliberately hand-rolled rather than pulled in from a JWT library
so the whole trust boundary (what alg is accepted, what "expired" means, how
signatures are compared) is legible in one file.

Security notes:
- `mint_access_token` always emits the exact header
  `{"alg":"HS256","typ":"JWT"}` (compact JSON, no whitespace, keys in this
  order) as its first segment.
- `verify_access_token` rejects any token whose header segment is not
  byte-identical to that exact string once decoded -- not just "alg==HS256"
  -- which closes the classic alg-confusion hole (e.g. `{"alg":"none",...}`
  or a header with reordered/extra keys designed to smuggle past a looser
  parser).
- Signature comparison uses `hmac.compare_digest` (constant-time).
"""

import base64
import hashlib
import hmac
import json
import secrets
import time

_HEADER = '{"alg":"HS256","typ":"JWT"}'
_HEADER_B64 = base64.urlsafe_b64encode(_HEADER.encode()).rstrip(b"=").decode()


class TokenError(Exception):
    """Raised for any invalid/expired/tampered access token."""


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64decode(s: str) -> bytes:
    padding = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + padding)


def mint_access_token(secret: str, ttl_seconds: int = 3600) -> str:
    """Mint a compact HS256 JWS: `header.payload.signature`, all urlsafe-base64."""
    now = int(time.time())
    claims = {
        "sub": "mcp",
        "scope": "mcp",
        "iat": now,
        "exp": now + ttl_seconds,
        "jti": secrets.token_hex(16),
    }
    payload_b64 = _b64encode(json.dumps(claims, separators=(",", ":")).encode())
    signing_input = f"{_HEADER_B64}.{payload_b64}".encode()
    sig = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    return f"{_HEADER_B64}.{payload_b64}.{_b64encode(sig)}"


def verify_access_token(token: str, secret: str) -> dict:
    """Verify a token minted by `mint_access_token` and return its claims.

    Raises `TokenError` for any malformed input, a header that isn't
    byte-identical to the one this module mints, a bad signature, or an
    expired token.
    """
    if not isinstance(token, str):
        raise TokenError("malformed token")

    parts = token.split(".")
    if len(parts) != 3:
        raise TokenError("malformed token: expected 3 segments")
    header_b64, payload_b64, sig_b64 = parts

    # Alg-confusion defense: the decoded header must be byte-identical to
    # what mint_access_token produces -- not merely "parseable JSON with
    # alg==HS256". This rejects `{"alg":"none",...}`, reordered keys, extra
    # whitespace, extra claims, anything.
    try:
        header_raw = _b64decode(header_b64)
    except Exception as exc:
        raise TokenError("malformed token: bad header encoding") from exc
    if header_raw != _HEADER.encode():
        raise TokenError("invalid header")

    signing_input = f"{header_b64}.{payload_b64}".encode()
    try:
        expected_sig = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
        actual_sig = _b64decode(sig_b64)
    except Exception as exc:
        raise TokenError("malformed token: bad signature encoding") from exc
    if not hmac.compare_digest(expected_sig, actual_sig):
        raise TokenError("invalid signature")

    try:
        payload_raw = _b64decode(payload_b64)
        claims = json.loads(payload_raw)
    except Exception as exc:
        raise TokenError("malformed token: bad payload") from exc
    if not isinstance(claims, dict):
        raise TokenError("malformed token: payload is not an object")

    exp = claims.get("exp")
    if not isinstance(exp, (int, float)) or exp < time.time():
        raise TokenError("token expired")

    return claims


def new_refresh_token() -> str:
    """A fresh high-entropy urlsafe refresh token (43+ chars)."""
    return secrets.token_urlsafe(32)


def hash_refresh_token(token: str, secret: str) -> str:
    """HMAC-SHA256 hex digest of a refresh token, keyed by `secret`, for
    storage as `token_hash`.

    Keyed (not a bare `sha256(token)`) so that rotating the secret genuinely
    revokes every outstanding refresh token: an unkeyed hash is invariant
    under secret rotation, so a stored `token_hash` would still match on
    lookup at `/token` even after the operator rotates the secret to "kick
    everyone off" -- letting an already-connected client refresh forever.
    Callers pass `mcp_jwt_secret()` so refresh-chain revocation piggybacks on
    the same rotation operators already use to invalidate access tokens.
    """
    return hmac.new(secret.encode(), token.encode(), hashlib.sha256).hexdigest()
