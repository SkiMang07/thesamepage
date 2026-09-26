"""B3 — the Mission Control morning line: cache per manager per day, rewrite
only when the top three change, cap rewrites, never block the brief."""
from datetime import date

import pytest
from fastapi import HTTPException

import routes.dashboard as dash

TODAY = date.today()


def _cand(key, fp="f1"):
    return {
        "candidate_key": key,
        "evidence_fingerprint": fp,
        "title": f"Title {key}",
        "explanation": "Because the record says so.",
        "evidence": [{"label": "1 commitment, overdue since Aug 28", "source": "commitments"}],
    }


def _brief(mode="normal", keys=("a", "b")):
    cands = [_cand(k) for k in keys]
    return {"mode": mode, "primary": cands[0] if cands else None, "secondary": cands[1:]}


class _Q:
    def __init__(self, db, op=None, payload=None):
        self.db, self.op, self.payload, self.filters = db, op, payload, {}

    def select(self, *_):
        self.op = "select"
        return self

    def eq(self, k, v):
        self.filters[k] = v
        return self

    def limit(self, *_):
        return self

    def insert(self, row):
        return _Q(self.db, "insert", row)

    def update(self, values):
        return _Q(self.db, "update", values)

    def execute(self):
        class R: ...
        r = R()
        key = (self.filters.get("manager_id"), self.filters.get("local_date"))
        if self.op == "select":
            r.data = [self.db.rows[key]] if key in self.db.rows else []
        elif self.op == "insert":
            self.db.rows[(self.payload["manager_id"], self.payload["local_date"])] = dict(self.payload)
            r.data = [self.payload]
        elif self.op == "update":
            self.db.rows[key].update(self.payload)
            r.data = [self.db.rows[key]]
        return r


class _DB:
    def __init__(self):
        self.rows = {}

    def table(self, name):
        assert name == "mission_control_morning_lines"
        return _Q(self)


@pytest.fixture
def env(monkeypatch):
    db = _DB()
    state = {"brief": _brief(), "calls": 0, "reply": "Two things today, led by a."}
    monkeypatch.setattr(dash, "_load_action_snapshot", lambda *a: ({}, []))
    monkeypatch.setattr(dash, "build_brief", lambda *a, **k: state["brief"])

    def fake_generate(prompt, **_):
        state["calls"] += 1
        state["prompt"] = prompt
        return state["reply"]

    monkeypatch.setattr(dash, "generate_text", fake_generate)
    return db, state


def _post(db, fingerprint):
    body = dash.MorningLineIn(fingerprint=fingerprint, local_date=TODAY.isoformat())
    return dash.generate_morning_line.__wrapped__(None, body, auth=("u1", db))


def test_first_load_is_pending_then_cached_without_a_second_call(env):
    db, state = env
    pending = dash._morning_line_state("u1", db, TODAY, state["brief"])
    assert pending["status"] == "pending"
    assert _post(db, pending["fingerprint"]) == {"status": "ok", "text": "Two things today, led by a."}
    assert "Title a" in state["prompt"] and "overdue since Aug 28" in state["prompt"]
    # Reload: served from cache, no model call.
    assert dash._morning_line_state("u1", db, TODAY, state["brief"]) == {"status": "ready", "text": "Two things today, led by a."}
    assert _post(db, pending["fingerprint"])["text"] == "Two things today, led by a."
    assert state["calls"] == 1


def test_changed_top_three_rewrites_and_cap_stops_it(env):
    db, state = env
    for i in range(dash._MORNING_LINE_MAX_GENERATIONS):
        state["brief"] = _brief(keys=(f"k{i}", "b"))
        s = dash._morning_line_state("u1", db, TODAY, state["brief"])
        assert s["status"] == "pending"
        _post(db, s["fingerprint"])
    state["brief"] = _brief(keys=("new", "b"))
    assert dash._morning_line_state("u1", db, TODAY, state["brief"]) is None
    fp = dash._morning_line_fingerprint(dash._morning_line_candidates(state["brief"]))
    assert _post(db, fp) == {"status": "unavailable", "text": None}
    assert state["calls"] == dash._MORNING_LINE_MAX_GENERATIONS


def test_stale_fingerprint_is_rejected(env):
    db, _ = env
    with pytest.raises(HTTPException) as err:
        _post(db, "not-the-current-one")
    assert err.value.status_code == 409


def test_model_decline_is_cached_as_no_line(env):
    db, state = env
    state["reply"] = "null"
    fp = dash._morning_line_state("u1", db, TODAY, state["brief"])["fingerprint"]
    assert _post(db, fp) == {"status": "unavailable", "text": None}
    assert dash._morning_line_state("u1", db, TODAY, state["brief"]) is None
    assert state["calls"] == 1


@pytest.mark.parametrize("mode", ["all_clear", "empty", "partial"])
def test_no_line_when_there_is_nothing_ranked_or_evidence_is_partial(env, mode):
    db, _ = env
    assert dash._morning_line_state("u1", db, TODAY, _brief(mode=mode)) is None


def test_cache_read_failure_never_breaks_the_brief(env):
    class Broken:
        def table(self, _):
            raise RuntimeError("relation does not exist")

    assert dash._morning_line_state("u1", Broken(), TODAY, _brief()) is None
