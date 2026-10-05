"""
The first-1:1 wrap-up reminder (backend/jobs/wrapup_reminder.py) against an
in-memory table store standing in for the worker's service-role client.

What matters: one reminder per manager, ever; only before their first logged
1:1; only on the evening of the meeting in their timezone, and not days late;
never another tenant's data; and a HubSpot failure releases the claim so the
next tick retries.
"""
import os
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

for _k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    os.environ.setdefault(_k, f"https://dummy.{_k.lower()}.invalid")

import hubspot  # noqa: E402
from jobs import wrapup_reminder as wr  # noqa: E402

DAY = "2026-10-05T12:00:00+00:00"  # a meeting on Oct 5 (noon UTC encoding)
BEFORE = datetime(2026, 10, 5, 21, 59, tzinfo=timezone.utc)   # 17:59 New York
EVENING = datetime(2026, 10, 5, 22, 0, tzinfo=timezone.utc)   # 18:00 New York
TOO_LATE = datetime(2026, 10, 7, 22, 0, tzinfo=timezone.utc)  # 48h after


class _Query:
    def __init__(self, client, table):
        self.client, self.table = client, table
        self.filters, self.operation, self.values = [], "select", None
        self._negate = False

    @property
    def not_(self):
        self._negate = True
        return self

    def _add(self, pred):
        if self._negate:
            self._negate = False
            self.filters.append(lambda r, p=pred: not p(r))
        else:
            self.filters.append(pred)
        return self

    def select(self, *_a, **_k):
        return self

    def eq(self, f, v):
        return self._add(lambda r, f=f, v=v: r.get(f) == v)

    def is_(self, f, v):
        exp = None if v == "null" else v
        return self._add(lambda r, f=f, e=exp: r.get(f) is e)

    def in_(self, f, vs):
        vs = set(vs)
        return self._add(lambda r, f=f, vs=vs: r.get(f) in vs)

    def gte(self, f, v):
        return self._add(lambda r, f=f, v=v: r.get(f) is not None and str(r.get(f)) >= v)

    def lt(self, f, v):
        return self._add(lambda r, f=f, v=v: r.get(f) is not None and str(r.get(f)) < v)

    def update(self, values):
        self.operation, self.values = "update", values
        return self

    def execute(self):
        rows = self.client.rows.setdefault(self.table, [])
        matched = [r for r in rows if all(p(r) for p in self.filters)]
        if self.operation == "update":
            for r in matched:
                r.update(self.values)
        return SimpleNamespace(data=[dict(r) for r in matched])


class _Client:
    def __init__(self, rows):
        self.rows = rows

    def table(self, name):
        return _Query(self, name)


def _user(id_, **kw):
    return {"id": id_, "email": f"{id_}@example.com", "full_name": "Theo Park",
            "role": "manager", "wrapup_reminder_sent_at": None, **kw}


def _meeting(id_, manager="m1", at=DAY, summary=None, series=None):
    return {"id": id_, "manager_id": manager, "series_id": series, "scheduled_at": at,
            "created_at": at, "summary": summary}


def _world(**extra):
    rows = {
        "users": [_user("m1")],
        "one_on_ones": [_meeting("o1")],
        "one_on_one_series": [],
    }
    for k, v in extra.items():
        rows[k] = v
    return rows


@pytest.fixture
def sent(monkeypatch):
    calls = []
    monkeypatch.setattr(hubspot, "enabled", lambda: True)
    monkeypatch.setattr(hubspot, "set_contact_properties", lambda email, props: calls.append((email, props)))
    events = []
    monkeypatch.setattr(wr.analytics, "capture", lambda uid, ev, props=None: events.append((uid, ev, props)))
    return SimpleNamespace(calls=calls, events=events)


def test_due_from_the_evening_of_the_meeting_day_for_48_hours():
    ny = wr.zone_for("UTC")
    assert not wr.is_due(date(2026, 10, 5), ny, BEFORE)
    assert wr.is_due(date(2026, 10, 5), ny, EVENING)
    assert not wr.is_due(date(2026, 10, 5), ny, TOO_LATE)


def test_utc_or_unknown_timezone_means_new_york_and_a_real_one_is_used():
    assert str(wr.zone_for("UTC")) == "America/New_York"
    assert str(wr.zone_for(None)) == "America/New_York"
    assert str(wr.zone_for("Not/AZone")) == "America/New_York"
    assert str(wr.zone_for("Europe/London")) == "Europe/London"


def test_sends_once_on_the_evening_with_only_email_first_name_and_day(sent):
    client = _Client(_world())
    assert wr.run(client, BEFORE) == 0
    assert wr.run(client, EVENING) == 1
    assert sent.calls == [("m1@example.com", {"wrapup_reminder_due": "2026-10-05", "firstname": "Theo"})]
    assert sent.events == [("m1", "wrapup_reminder_sent", {"tz_known": False})]
    assert client.rows["users"][0]["wrapup_reminder_sent_at"] == EVENING.isoformat()
    # A later tick, still inside the window, sends nothing more.
    assert wr.run(client, datetime(2026, 10, 6, 1, 0, tzinfo=timezone.utc)) == 0
    assert len(sent.calls) == 1


def test_a_manager_who_already_logged_a_1_1_is_never_reminded(sent):
    world = _world(one_on_ones=[_meeting("o0", at="2026-09-28T12:00:00+00:00", summary="Talked."),
                                _meeting("o1")])
    assert wr.run(_Client(world), EVENING) == 0
    assert sent.calls == []


def test_the_first_meeting_logged_before_the_evening_sends_nothing(sent):
    world = _world(one_on_ones=[_meeting("o1", summary="Logged it.")])
    assert wr.run(_Client(world), EVENING) == 0


def test_a_stale_meeting_is_not_reminded(sent):
    assert wr.run(_Client(_world()), TOO_LATE) == 0


def test_series_timezone_sets_the_evening(sent):
    world = _world(
        one_on_ones=[_meeting("o1", series="s1")],
        one_on_one_series=[{"id": "s1", "manager_id": "m1", "timezone": "Europe/London"}],
    )
    london_evening = datetime(2026, 10, 5, 17, 0, tzinfo=timezone.utc)  # 18:00 BST
    assert wr.run(_Client(world), london_evening) == 1
    assert sent.events[0][2] == {"tz_known": True}


def test_another_managers_series_does_not_lend_its_timezone(sent):
    world = _world(
        one_on_ones=[_meeting("o1", series="s1")],
        one_on_one_series=[{"id": "s1", "manager_id": "someone-else", "timezone": "Europe/London"}],
    )
    london_evening = datetime(2026, 10, 5, 17, 0, tzinfo=timezone.utc)
    assert wr.run(_Client(world), london_evening) == 0  # falls back to New York: not evening yet


def test_ics_and_already_reminded_managers_are_skipped(sent):
    world = _world(
        users=[_user("m1", role="ic"), _user("m2", wrapup_reminder_sent_at="2026-09-01T00:00:00+00:00")],
        one_on_ones=[_meeting("o1", manager="m1"), _meeting("o2", manager="m2")],
    )
    assert wr.run(_Client(world), EVENING) == 0


def test_a_hubspot_failure_releases_the_claim_for_the_next_tick(monkeypatch, sent):
    def refuse(email, props):
        raise hubspot.HubSpotError("hubspot upsert refused: 500")

    monkeypatch.setattr(hubspot, "set_contact_properties", refuse)
    client = _Client(_world())
    assert wr.run(client, EVENING) == 0
    assert client.rows["users"][0]["wrapup_reminder_sent_at"] is None
    assert sent.events == []


def test_off_without_a_token(monkeypatch):
    monkeypatch.setattr(hubspot, "enabled", lambda: False)
    assert wr.run(_Client(_world()), EVENING) == 0


def test_a_selection_error_skips_the_tick_instead_of_raising(monkeypatch, sent):
    class Broken:
        def table(self, name):
            raise RuntimeError('column users.wrapup_reminder_sent_at does not exist')

    assert wr.run(Broken(), EVENING) == 0


def test_the_standalone_pass_does_nothing_without_a_token(monkeypatch):
    monkeypatch.setattr(hubspot, "enabled", lambda: False)
    called = []
    monkeypatch.setattr(wr, "run", lambda *a, **k: called.append(1))
    wr.main()
    assert called == []
