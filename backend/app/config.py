import os


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


def secret_phrase() -> str | None:
    return os.environ.get("APP_SECRET_PHRASE")


def cookie_secure() -> bool:
    # Must stay false when serving over plain http (e.g. local docker-compose),
    # otherwise the browser drops the auth cookie.
    return os.environ.get("COOKIE_SECURE", "false").lower() == "true"


def mcp_access_secret() -> str:
    secret = os.environ.get("MCP_ACCESS_SECRET")
    if not secret:
        raise RuntimeError("MCP_ACCESS_SECRET is not set")
    return secret


def mcp_jwt_secret() -> str:
    secret = os.environ.get("MCP_JWT_SECRET")
    if not secret:
        raise RuntimeError("MCP_JWT_SECRET is not set")
    return secret


def mcp_public_url() -> str:
    url = os.environ.get("MCP_PUBLIC_URL")
    if not url:
        raise RuntimeError("MCP_PUBLIC_URL is not set")
    return url


def mcp_default_timezone() -> str:
    return os.environ.get("MCP_DEFAULT_TIMEZONE", "Europe/Paris")
