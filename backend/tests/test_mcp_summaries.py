"""Pure-logic tests for backend/app/mcp/summaries.py — no DB required.

Covers day_bounds (DST-correct, zoneinfo-based), summarize_day, sleep_stats,
list_feedings, list_diapers, and the fmt() timestamp helper, per
.superpowers/sdd/task-2-brief.md and the "Tools (read-only)" section of
docs/superpowers/specs/2026-07-23-mcp-server-design.md.
"""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.mcp.summaries import (
    day_bounds,
    fmt,
    list_diapers,
    list_feedings,
    sleep_stats,
    summarize_day,
)


def d(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


NOW = d("2026-07-23T12:00:00")


def ev(type: str, start: str, end: str | None = None, **details) -> dict:
    return {
        "type": type,
        "started_at": d(start),
        "ended_at": d(end) if end else None,
        "details": details,
    }


# --- fmt() -------------------------------------------------------------


def test_fmt_returns_iso_with_offset_and_local_hhmm():
    tz = ZoneInfo("Europe/Paris")
    out = fmt(d("2026-07-23T08:00:00"), tz)  # 08:00Z = 10:00 Paris (summer, +2)
    assert out == {"iso": "2026-07-23T10:00:00+02:00", "local": "10:00"}


# --- 1. midnight-spanning sleep, tz=UTC ---------------------------------


def test_midnight_spanning_sleep_splits_across_local_days_utc():
    events = [ev("sleep", "2026-07-22T23:00:00", "2026-07-23T01:30:00")]

    day22 = summarize_day(events, [], "2026-07-22", "UTC", NOW, None)
    assert len(day22["sleep"]["blocks"]) == 1
    assert day22["sleep"]["blocks"][0]["minutes"] == 60
    assert day22["sleep"]["total_minutes"] == 60

    day23 = summarize_day(events, [], "2026-07-23", "UTC", NOW, None)
    assert len(day23["sleep"]["blocks"]) == 1
    assert day23["sleep"]["blocks"][0]["minutes"] == 90
    assert day23["sleep"]["total_minutes"] == 90


# --- 2. Europe/Paris bucketing ------------------------------------------


def test_europe_paris_bucketing_uses_local_day():
    # 21:30Z Jul 22 = 23:30 local (Paris, summer +2) -> local day 2026-07-22
    events = [ev("diaper", "2026-07-22T21:30:00", kind="wet")]

    day22 = summarize_day(events, [], "2026-07-22", "Europe/Paris", NOW, None)
    assert day22["diapers"]["wet"] == 1

    day23 = summarize_day(events, [], "2026-07-23", "Europe/Paris", NOW, None)
    assert day23["diapers"]["wet"] == 0


# --- 3. DST spring-forward day -------------------------------------------


def test_dst_spring_forward_day_spans_23_hours():
    start_utc, end_utc = day_bounds("2026-03-29", "Europe/Paris")
    assert end_utc - start_utc == timedelta(hours=23)
    assert start_utc.tzinfo is not None and end_utc.tzinfo is not None


# --- 4. running sleep ------------------------------------------------------


def test_running_sleep_counts_up_to_now_and_clips():
    events = [ev("sleep", "2026-07-23T10:00:00")]  # still running, no ended_at
    summary = summarize_day(events, [], "2026-07-23", "UTC", NOW, None)

    assert summary["sleep"]["total_minutes"] == 120
    assert summary["sleep"]["longest_block_minutes"] == 120
    block = summary["sleep"]["blocks"][0]
    assert block["minutes"] == 120
    assert block["end"] is None  # running & clipped end == now


# --- 5. empty day ------------------------------------------------------


def test_empty_day_returns_zeroed_structure():
    summary = summarize_day([], [], "2026-07-23", "UTC", NOW, None)

    assert summary["sleep"]["total_minutes"] == 0
    assert summary["sleep"]["blocks"] == []
    assert summary["sleep"]["longest_block_minutes"] == 0
    assert summary["feeds"]["count"] == 0
    assert summary["diapers"]["total"] == 0
    assert summary["medicines"] == []
    assert summary["pump_ml"] == 0
    assert summary["measurements"] == []
    assert summary["date"] == "2026-07-23"
    assert summary["timezone"] == "UTC"


# --- 6. full summary ------------------------------------------------------


def test_full_summary_aggregates_every_event_type():
    events = [
        ev(
            "feed",
            "2026-07-23T08:00:00",
            "2026-07-23T08:20:00",
            method="breast",
            side="left",
        ),
        ev("feed", "2026-07-23T09:00:00", "2026-07-23T09:05:00", method="bottle", amountMl=90),
        ev("diaper", "2026-07-23T07:00:00", kind="both"),
        ev("medicine", "2026-07-23T07:30:00", name="Vit D"),
        ev("pump", "2026-07-23T09:30:00", "2026-07-23T09:45:00", leftMl=60, rightMl=40),
    ]

    summary = summarize_day(events, [], "2026-07-23", "UTC", NOW, "Theana")

    assert summary["baby_name"] == "Theana"
    assert summary["feeds"]["count"] == 2
    assert summary["feeds"]["breast_count"] == 1
    assert summary["feeds"]["breast_minutes"] == 20
    assert summary["feeds"]["bottle_count"] == 1
    assert summary["feeds"]["bottle_ml"] == 90
    assert summary["diapers"]["both"] == 1
    assert summary["diapers"]["total"] == 1
    assert summary["medicines"][0]["name"] == "Vit D"
    assert summary["pump_ml"] == 100


# --- 7. measurements passthrough -------------------------------------------


def test_measurements_passthrough_for_the_day():
    measurements = [
        {
            "measured_at": date(2026, 7, 23),
            "weight_g": 4200,
            "height_mm": None,
            "head_circ_mm": None,
            "note": None,
        }
    ]

    summary = summarize_day([], measurements, "2026-07-23", "UTC", NOW, None)

    assert len(summary["measurements"]) == 1
    assert summary["measurements"][0]["weight_g"] == 4200


# --- 8. invalid date / tz -----------------------------------------------


def test_invalid_date_raises_value_error():
    with pytest.raises(ValueError):
        day_bounds("2026-13-01", "UTC")


def test_invalid_timezone_raises_value_error():
    with pytest.raises(ValueError):
        day_bounds("2026-07-23", "Mars/Olympus")


def test_summarize_day_propagates_invalid_date():
    with pytest.raises(ValueError):
        summarize_day([], [], "2026-13-01", "UTC", NOW, None)


# --- 9. sleep_stats over a range -------------------------------------------


def test_sleep_stats_returns_days_oldest_first_with_averages():
    events = [
        ev("sleep", "2026-07-21T22:00:00", "2026-07-21T23:00:00"),  # 60 min on 21st
        ev("sleep", "2026-07-22T01:00:00", "2026-07-22T03:00:00"),  # 120 min on 22nd
        ev("sleep", "2026-07-23T05:00:00", "2026-07-23T05:30:00"),  # 30 min on 23rd
    ]

    result = sleep_stats(events, "2026-07-21", "2026-07-23", "UTC", NOW)

    assert [day["date"] for day in result["days"]] == [
        "2026-07-21",
        "2026-07-22",
        "2026-07-23",
    ]
    assert result["days"][0]["total_minutes"] == 60
    assert result["days"][0]["block_count"] == 1
    assert result["days"][0]["longest_block_minutes"] == 60
    assert result["days"][1]["total_minutes"] == 120
    assert result["days"][2]["total_minutes"] == 30

    assert result["averages"]["total_minutes"] == pytest.approx(70)
    assert result["averages"]["longest_block_minutes"] == pytest.approx(70)


def test_sleep_stats_rejects_ranges_over_90_days():
    with pytest.raises(ValueError):
        sleep_stats([], "2026-01-01", "2026-04-15", "UTC", NOW)


# --- 10. list_feedings / list_diapers --------------------------------------


def test_list_feedings_chronological_with_breast_minutes():
    events = [
        ev("feed", "2026-07-23T09:00:00", "2026-07-23T09:05:00", method="bottle", amountMl=90),
        ev(
            "feed",
            "2026-07-23T08:00:00",
            "2026-07-23T08:20:00",
            method="breast",
            side="left",
        ),
    ]

    feeds = list_feedings(events, "2026-07-23", "UTC")

    assert len(feeds) == 2
    assert feeds[0]["method"] == "breast"
    assert feeds[0]["minutes"] == 20
    assert feeds[0]["side"] == "left"
    assert feeds[1]["method"] == "bottle"
    assert feeds[1]["amount_ml"] == 90


def test_list_diapers_chronological_with_time_and_kind():
    events = [
        ev("diaper", "2026-07-23T10:00:00", kind="dirty"),
        ev("diaper", "2026-07-23T07:00:00", kind="wet"),
    ]

    diapers = list_diapers(events, "2026-07-23", "UTC")

    assert len(diapers) == 2
    assert diapers[0]["kind"] == "wet"
    assert diapers[1]["kind"] == "dirty"
    assert "iso" in diapers[0]["time"]
    assert "local" in diapers[0]["time"]


# --- 11. overlapping sleep intervals must be merged (union, not sum) ------


def test_monster_block_plus_real_sleep_caps_at_1440_and_merges_to_one_block():
    # A 3-day monster sleep event spanning 2026-07-21..2026-07-24, plus two
    # normal sleep events fully inside 2026-07-22 that overlap the monster.
    events = [
        ev("sleep", "2026-07-21T12:00:00", "2026-07-24T12:00:00"),
        ev("sleep", "2026-07-22T02:00:00", "2026-07-22T04:00:00"),
        ev("sleep", "2026-07-22T20:00:00", "2026-07-22T21:00:00"),
    ]

    summary = summarize_day(events, [], "2026-07-22", "UTC", NOW, None)

    assert summary["sleep"]["total_minutes"] == 1440
    assert len(summary["sleep"]["blocks"]) == 1
    assert summary["sleep"]["longest_block_minutes"] == 1440


def test_sleep_stats_monster_day_caps_at_1440():
    events = [
        ev("sleep", "2026-07-21T12:00:00", "2026-07-24T12:00:00"),
        ev("sleep", "2026-07-22T02:00:00", "2026-07-22T04:00:00"),
        ev("sleep", "2026-07-22T20:00:00", "2026-07-22T21:00:00"),
    ]

    result = sleep_stats(events, "2026-07-21", "2026-07-24", "UTC", NOW)

    day22 = next(d for d in result["days"] if d["date"] == "2026-07-22")
    assert day22["total_minutes"] == 1440
    assert day22["block_count"] == 1
    assert day22["longest_block_minutes"] == 1440


def test_simple_overlap_merges_into_one_block_of_union_length():
    # 10:00-12:00 and 11:00-13:00 overlap by 1h -> union is 10:00-13:00 (180 min).
    events = [
        ev("sleep", "2026-07-23T10:00:00", "2026-07-23T12:00:00"),
        ev("sleep", "2026-07-23T11:00:00", "2026-07-23T13:00:00"),
    ]

    summary = summarize_day(events, [], "2026-07-23", "UTC", NOW, None)

    assert summary["sleep"]["total_minutes"] == 180
    assert len(summary["sleep"]["blocks"]) == 1
    assert summary["sleep"]["blocks"][0]["minutes"] == 180


def test_touching_blocks_merge_into_one():
    # 10:00-11:00 and 11:00-12:00 touch exactly at the boundary -> merged.
    events = [
        ev("sleep", "2026-07-23T10:00:00", "2026-07-23T11:00:00"),
        ev("sleep", "2026-07-23T11:00:00", "2026-07-23T12:00:00"),
    ]

    summary = summarize_day(events, [], "2026-07-23", "UTC", NOW, None)

    assert summary["sleep"]["total_minutes"] == 120
    assert len(summary["sleep"]["blocks"]) == 1
    assert summary["sleep"]["blocks"][0]["minutes"] == 120


def test_disjoint_blocks_stay_separate_regression():
    # Existing non-overlapping scenario must remain unaffected by the merge.
    events = [
        ev("sleep", "2026-07-23T01:00:00", "2026-07-23T02:00:00"),
        ev("sleep", "2026-07-23T10:00:00", "2026-07-23T11:00:00"),
    ]

    summary = summarize_day(events, [], "2026-07-23", "UTC", NOW, None)

    assert summary["sleep"]["total_minutes"] == 120
    assert len(summary["sleep"]["blocks"]) == 2
    assert summary["sleep"]["longest_block_minutes"] == 60
