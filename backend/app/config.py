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
