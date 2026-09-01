from datetime import date, timezone

from routes.away import (
    _day_bounds_utc,
    _noon_utc,
    _nudge_off_weekend,
    _shift_date,
    _window_days,
)


def test_window_days_is_inclusive_of_both_endpoints():
    # Away Sept 10-19 is a ten-day trip, not nine.
    assert _window_days(date(2026, 9, 10), date(2026, 9, 19)) == 10
    # A single day away still counts as one day.
    assert _window_days(date(2026, 9, 10), date(2026, 9, 10)) == 1


def test_shift_date_advances_by_the_window_length():
    assert _shift_date(date(2026, 9, 10), 10) == date(2026, 9, 20)


def test_nudge_off_weekend_pushes_saturday_and_sunday_to_monday():
    saturday = date(2026, 9, 5)
    sunday = date(2026, 9, 6)
    monday = date(2026, 9, 7)
    assert saturday.weekday() == 5 and sunday.weekday() == 6
    assert _nudge_off_weekend(saturday) == monday
    assert _nudge_off_weekend(sunday) == monday


def test_nudge_off_weekend_leaves_weekdays_alone():
    tuesday = date(2026, 9, 8)
    assert _nudge_off_weekend(tuesday) == tuesday


def test_noon_utc_encodes_the_calendar_day_stably():
    # Same encoding the 2026-08-28 one_on_ones migration backfill uses, so a
    # shifted meeting date reads the same way every other meeting date does.
    value = _noon_utc(date(2026, 9, 20))
    assert value == "2026-09-20T12:00:00+00:00"


def test_day_bounds_utc_is_a_half_open_range_covering_the_whole_end_date():
    start_ts, end_ts = _day_bounds_utc(date(2026, 9, 10), date(2026, 9, 19))
    assert start_ts == "2026-09-10T00:00:00+00:00"
    # Exclusive upper bound, one day past end_date, so a scheduled_at
    # anywhere on the 19th (e.g. noon) is still gte start and lt end.
    assert end_ts == "2026-09-20T00:00:00+00:00"
