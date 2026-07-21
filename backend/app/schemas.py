from datetime import date, datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

EventType = Literal["feed", "sleep", "diaper", "pump", "medicine"]
Caregiver = Literal["maman", "papa"]

TIMER_TYPES: set[str] = {"feed", "sleep", "pump"}
POINT_TYPES: set[str] = {"diaper", "medicine"}

EVENT_TYPES: set[str] = {"feed", "sleep", "diaper", "pump", "medicine"}


class _Details(BaseModel):
    model_config = ConfigDict(extra="ignore")


class FeedDetails(_Details):
    method: Literal["breast", "bottle", "solids"]
    side: Literal["left", "right"] | None = None
    amountMl: int | None = Field(None, gt=0, le=2000)
    food: str | None = Field(None, max_length=200)


class SleepDetails(_Details):
    pass


class DiaperDetails(_Details):
    kind: Literal["wet", "dirty", "both"]


class PumpDetails(_Details):
    leftMl: int | None = Field(None, ge=0, le=2000)
    rightMl: int | None = Field(None, ge=0, le=2000)


class MedicineDetails(_Details):
    name: str = Field(min_length=1, max_length=200)
    dose: str | None = Field(None, max_length=100)


DETAILS_BY_TYPE: dict[str, type[_Details]] = {
    "feed": FeedDetails,
    "sleep": SleepDetails,
    "diaper": DiaperDetails,
    "pump": PumpDetails,
    "medicine": MedicineDetails,
}


def validate_details(event_type: str, details: dict[str, Any] | None) -> bool:
    try:
        DETAILS_BY_TYPE[event_type].model_validate(details or {})
        return True
    except ValidationError:
        return False


def ensure_utc(dt: datetime) -> datetime:
    # Treat naive datetimes as UTC so comparisons with tz-aware DB values work.
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class CreateEventInput(BaseModel):
    type: EventType
    startedAt: datetime
    endedAt: datetime | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    note: str | None = Field(None, max_length=1000)
    caregiver: Caregiver


class PatchEventInput(BaseModel):
    startedAt: datetime | None = None
    endedAt: datetime | None = None
    details: dict[str, Any] | None = None
    note: str | None = Field(None, max_length=1000)
    caregiver: Caregiver | None = None


class BabyInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    birthDate: date


class MeasurementInput(BaseModel):
    measuredAt: date
    weightG: int | None = Field(None, gt=0, le=50000)
    heightMm: int | None = Field(None, gt=0, le=2000)
    headCircMm: int | None = Field(None, gt=0, le=1000)
    note: str | None = Field(None, max_length=1000)


class LoginInput(BaseModel):
    secret: str
