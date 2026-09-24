"""Product analytics: off without a key, flags-only payloads, never raises,
and the first-sheet check behind prep_sheet_saved's is_first."""
from types import SimpleNamespace

import analytics
from config import settings
from routes.one_on_ones import _manager_has_prep_sheet


class _Pool:
    def __init__(self):
        self.calls = []

    def submit(self, fn, *args):
        self.calls.append((fn, args))


def test_capture_is_a_no_op_without_a_key(monkeypatch):
    pool = _Pool()
    monkeypatch.setattr(analytics, "_pool", pool)
    monkeypatch.setattr(settings, "POSTHOG_PROJECT_KEY", "")
    analytics.capture("user-1", "prep_sheet_saved", {"is_first": True})
    assert pool.calls == []


def test_capture_sends_the_user_id_and_flags_only(monkeypatch):
    pool = _Pool()
    monkeypatch.setattr(analytics, "_pool", pool)
    monkeypatch.setattr(settings, "POSTHOG_PROJECT_KEY", "phc_test")
    analytics.capture("user-1", "prep_sheet_saved", {"is_first": True, "regenerated": False})

    [(fn, (payload,))] = pool.calls
    assert fn is analytics._send
    assert payload["api_key"] == "phc_test"
    assert payload["event"] == "prep_sheet_saved"
    assert payload["distinct_id"] == "user-1"
    props = payload["properties"]
    assert props["is_first"] is True and props["regenerated"] is False
    assert props["$geoip_disable"] is True
    assert set(props) == {"is_first", "regenerated", "environment", "$lib", "$geoip_disable"}


def test_send_never_raises(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("posthog down")

    monkeypatch.setattr(analytics.httpx, "post", boom)
    analytics._send({"event": "x"})  # logged at warning, not raised


class _Query:
    def __init__(self, rows):
        self.rows = rows
        self.filters = []

    def select(self, *_):
        return self

    def eq(self, field, value):
        self.filters.append(lambda r: r.get(field) == value)
        return self

    @property
    def not_(self):
        outer = self

        class _Not:
            def is_(self, field, _null):
                outer.filters.append(lambda r: r.get(field) is not None)
                return outer

        return _Not()

    def limit(self, _n):
        return self

    def execute(self):
        return SimpleNamespace(data=[r for r in self.rows if all(f(r) for f in self.filters)])


class _Client:
    def __init__(self, rows):
        self.rows = rows

    def table(self, _name):
        return _Query(self.rows)


def test_first_sheet_check_only_counts_this_managers_sheets():
    rows = [
        {"id": "a", "manager_id": "other", "prep_guide": {"situation_summary": "x"}},
        {"id": "b", "manager_id": "me", "prep_guide": None},
    ]
    assert _manager_has_prep_sheet(_Client(rows), "me") is False
    rows.append({"id": "c", "manager_id": "me", "prep_guide": {"situation_summary": "y"}})
    assert _manager_has_prep_sheet(_Client(rows), "me") is True
