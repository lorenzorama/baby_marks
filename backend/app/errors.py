from typing import Any


class ApiError(Exception):
    """Raised by routes; converted to a JSON body of the form {"error": code, ...extra}."""

    def __init__(self, status: int, code: str, **extra: Any):
        self.status = status
        self.code = code
        self.extra = extra
        super().__init__(code)

    def body(self) -> dict[str, Any]:
        return {"error": self.code, **self.extra}
