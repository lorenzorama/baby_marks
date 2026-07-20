from datetime import datetime, timezone

from app.stats import StatEvent, aggregate_daily

NOW = datetime(2026, 7, 15, 12, 0, 0, tzinfo=timezone.utc)


def dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def ev(type: str, started: str, ended: str | None = None, details: dict | None = None) -> StatEvent:
    return StatEvent(
        type=type,
        started_at=dt(started),
        ended_at=dt(ended) if ended else None,
        details=details or {},
    )


def by_date(out: list[dict], date: str) -> dict:
    return next(d for d in out if d["date"] == date)


def test_returns_days_entries_oldest_first_ending_today():
    out = aggregate_daily([], 7, 0, NOW)
    assert len(out) == 7
    assert out[0]["date"] == "2026-07-09"
    assert out[6]["date"] == "2026-07-15"


def test_splits_sleep_spanning_midnight_across_both_days():
    out = aggregate_daily(
        [ev("sleep", "2026-07-14T23:00:00Z", "2026-07-15T01:30:00Z")], 7, 0, NOW
    )
    assert by_date(out, "2026-07-14")["sleepMinutes"] == 60
    assert by_date(out, "2026-07-15")["sleepMinutes"] == 90


def test_buckets_by_local_day_using_tz_offset():
    # 23:30 Paris on Jul 14 = 21:30Z Jul 14 — must land on Jul 14, not Jul 15
    out = aggregate_daily(
        [ev("diaper", "2026-07-14T21:30:00Z", "2026-07-14T21:30:00Z", {"kind": "wet"})],
        7,
        -120,
        NOW,
    )
    assert by_date(out, "2026-07-14")["diaperWet"] == 1


def test_counts_running_sleep_up_to_now():
    out = aggregate_daily([ev("sleep", "2026-07-15T11:00:00Z")], 7, 0, NOW)
    assert by_date(out, "2026-07-15")["sleepMinutes"] == 60


def test_sums_all_metrics():
    out = aggregate_daily(
        [
            ev("feed", "2026-07-15T08:00:00Z", "2026-07-15T08:20:00Z",
               {"method": "breast", "side": "left"}),
            ev("feed", "2026-07-15T10:00:00Z", "2026-07-15T10:05:00Z",
               {"method": "bottle", "amountMl": 90}),
            ev("pump", "2026-07-15T09:00:00Z", "2026-07-15T09:15:00Z",
               {"leftMl": 60, "rightMl": 40}),
            ev("diaper", "2026-07-15T07:00:00Z", "2026-07-15T07:00:00Z", {"kind": "dirty"}),
            ev("medicine", "2026-07-15T07:30:00Z", "2026-07-15T07:30:00Z", {"name": "Vit D"}),
        ],
        1,
        0,
        NOW,
    )
    d = out[0]
    assert d["feedCount"] == 2
    assert d["breastMinutes"] == 20
    assert d["bottleMl"] == 90
    assert d["pumpMl"] == 100
    assert d["diaperDirty"] == 1
    assert d["medicineCount"] == 1


def test_ignores_events_outside_window():
    out = aggregate_daily(
        [ev("diaper", "2026-07-01T10:00:00Z", "2026-07-01T10:00:00Z", {"kind": "wet"})],
        7,
        0,
        NOW,
    )
    assert all(d["diaperWet"] == 0 for d in out)
