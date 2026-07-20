import pytest
from pydantic import ValidationError

from app.schemas import CreateEventInput, MeasurementInput, validate_details


def test_feed_details_require_valid_method():
    assert validate_details("feed", {"method": "breast", "side": "left"})
    assert validate_details("feed", {"method": "bottle", "amountMl": 90})
    assert not validate_details("feed", {"method": "spoon"})
    assert not validate_details("feed", {})


def test_diaper_details_require_kind():
    assert validate_details("diaper", {"kind": "wet"})
    assert not validate_details("diaper", {})
    assert not validate_details("diaper", {"kind": "soaked"})


def test_medicine_details_require_name():
    assert validate_details("medicine", {"name": "Vit D"})
    assert not validate_details("medicine", {})


def test_pump_amounts_bounded():
    assert validate_details("pump", {"leftMl": 0, "rightMl": 2000})
    assert not validate_details("pump", {"leftMl": -1})
    assert not validate_details("pump", {"rightMl": 2001})


def test_create_event_rejects_unknown_type():
    with pytest.raises(ValidationError):
        CreateEventInput.model_validate(
            {"type": "bath", "startedAt": "2026-07-15T10:00:00Z", "caregiver": "maman"}
        )


def test_measurement_bounds():
    MeasurementInput.model_validate({"measuredAt": "2026-07-15", "weightG": 4000})
    with pytest.raises(ValidationError):
        MeasurementInput.model_validate({"measuredAt": "not-a-date", "weightG": 4000})
    with pytest.raises(ValidationError):
        MeasurementInput.model_validate({"measuredAt": "2026-07-15", "weightG": 50001})
