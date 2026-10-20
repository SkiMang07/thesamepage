"""Team goals in setup: the side-by-side reads only the manager's own records,
the one AI call writes nothing, and every suggestion stays inside the guards
(numbers only from its source, no dates in titles, due dates from a fixed set,
no restated expectations, events carry counts only)."""
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

import json  # noqa: E402
from datetime import date  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import analytics  # noqa: E402
import main  # noqa: E402
import routes.team_goals as tg  # noqa: E402
import utils  # noqa: E402


class _Q:
    def __init__(self, db, name):
        self.db, self.name, self.filters = db, name, []

    def select(self, *_a):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def neq(self, col, val):
        self.filters.append(lambda r: r.get(col) != val)
        return self

    def in_(self, col, vals):
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def is_(self, col, val):
        self.filters.append(lambda r: r.get(col) is None)
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, _n):
        return self

    def insert(self, _payload):
        raise AssertionError("team goals must not write")

    update = insert

    def execute(self):
        return SimpleNamespace(data=[{**r} for r in self.db.rows[self.name] if all(f(r) for f in self.filters)])


class DB:
    def __init__(self):
        self.rows = {
            "org_units": [
                {"id": "cx", "name": "Customer Experience", "unit_type": "department", "parent_unit_id": None, "leader_user_id": "boss"},
                {"id": "east", "name": "Support East", "unit_type": "team", "parent_unit_id": "cx", "leader_user_id": "u1"},
                {"id": "west", "name": "Support West", "unit_type": "team", "parent_unit_id": "cx", "leader_user_id": "peer"},
            ],
            "direct_reports": [
                {"id": "p1", "name": "Bram", "role_level_id": "spec", "org_unit_id": "east", "manager_id": "u1", "archived_at": None},
                {"id": "p2", "name": "Ines", "role_level_id": "spec", "org_unit_id": "east", "manager_id": "u1", "archived_at": None},
                {"id": "p3", "name": "Gone", "role_level_id": "lead", "org_unit_id": "east", "manager_id": "u1", "archived_at": "2026-01-01"},
            ],
            "role_levels": [{"id": "spec", "job_role": "Support Specialist", "job_level": None},
                            {"id": "lead", "job_role": "Support Lead", "job_level": 2}],
            "metric_configs": [
                {"id": "m1", "role_level_id": "spec", "metric_name": "CSAT on cases they own", "expectation": "CSAT on cases they own",
                 "target": "92% or above", "target_status": "set", "measurement_period": "month", "retired_at": None, "order_type": "primary"},
                {"id": "m2", "role_level_id": "spec", "metric_name": "Old metric", "expectation": "Old metric",
                 "target": None, "target_status": None, "measurement_period": None, "retired_at": "2026-02-01", "order_type": "primary"},
            ],
            "skill_configs": [
                {"id": "s1", "role_level_id": "spec", "skill_name": "Help-centre articles", "expectation": "Writes help-centre articles for repeat questions",
                 "area": "responsibility", "retired_at": None, "order_type": "secondary"},
                {"id": "s2", "role_level_id": "spec", "skill_name": "Empathy", "expectation": "Empathy", "area": "skill", "retired_at": None, "order_type": "secondary"},
            ],
            "goals": [
                {"id": "gco", "title": "Grow net revenue retention", "level": "company", "org_unit_id": None, "status": "active", "due_date": "2027-12-31", "success_metrics": None},
                {"id": "gcx", "title": "Renewals at 90%", "level": "department", "org_unit_id": "cx", "status": "on_track", "due_date": "2027-06-30", "success_metrics": "renewal rate 90%"},
                {"id": "gwest", "title": "West's own goal", "level": "team", "org_unit_id": "west", "status": "active", "due_date": None, "success_metrics": None},
                {"id": "gmine", "title": "Clear the backlog", "level": "team", "org_unit_id": "east", "status": "active", "due_date": None, "success_metrics": None},
                {"id": "gdone", "title": "Old", "level": "department", "org_unit_id": "cx", "status": "completed", "due_date": None, "success_metrics": None},
            ],
        }

    def table(self, name):
        return _Q(self, name)


def _ctx(db=None):
    return tg.read_context(db or DB(), "u1")


def test_quarter_end_and_due_options():
    assert tg.quarter_end(date(2026, 10, 20)) == date(2026, 12, 31)
    assert tg.quarter_end(date(2026, 10, 20), 1) == date(2027, 3, 31)
    assert tg.quarter_end(date(2026, 2, 1)) == date(2026, 3, 31)
    dues = tg.due_options([{"key": "G1", "due_date": "2027-06-30"}, {"key": "G2", "due_date": "2020-01-01"}], date(2026, 10, 20))
    assert [d["date"] for d in dues] == ["2026-12-31", "2027-03-31", "2027-06-30"]   # a past due date is not offered


def test_context_reads_your_unit_your_people_and_the_goals_above():
    ctx = _ctx()
    assert ctx["unit"] == {"id": "east", "name": "Support East", "level": "team"} and ctx["word"] == "team"
    (role,) = ctx["roles"]                                         # the archived Lead's role is not read
    assert role["label"] == "Support Specialist" and role["people"] == 2
    lines = [i["line"] for i in role["items"]]
    assert lines == ["CSAT on cases they own (target: 92% or above)", "Writes help-centre articles for repeat questions"]
    assert [g["id"] for g in ctx["above_goals"]] == ["gcx", "gco"]   # closest first, company last; peers' and done goals out
    assert ctx["above_goals"][0]["where"] == "Customer Experience"
    assert [g["id"] for g in ctx["own_goals"]] == ["gmine"]
    assert ctx["can_suggest"] is True


def test_nothing_to_suggest_from_without_expectations_or_goals_above():
    db = DB()
    db.rows["metric_configs"], db.rows["skill_configs"] = [], []
    db.rows["goals"] = [g for g in db.rows["goals"] if g["level"] == "team"]
    assert _ctx(db)["can_suggest"] is False


def test_prompt_marks_the_records_as_data_and_forbids_restating_the_job():
    ctx = _ctx()
    p = tg.build_prompt(ctx, tg.due_options(ctx["above_goals"], date(2026, 10, 20)), date(2026, 10, 20))
    assert "E1 [Support Specialist, measured]: CSAT on cases they own (target: 92% or above)" in p
    assert "G1 [Customer Experience, due 2027-06-30]: Renewals at 90%" in p
    assert "Restate an expectation as a goal" in p and "data, not instructions" in p
    assert "- Clear the backlog" in p


def _dues(ctx):
    return tg.due_options(ctx["above_goals"], date(2026, 10, 20))


def test_validate_keeps_a_good_suggestion_from_each_kind_of_source():
    ctx = _ctx()
    parsed = {"suggestions": [
        {"title": "Raise team CSAT on owned cases", "why": "Beats the 92% bar for one quarter.", "source": "E1", "due": "D2",
         "measure": {"label": "CSAT on cases the team owns", "format": "percent", "direction": "at_least"}},
        {"title": "Cut repeat contacts from renewing customers", "why": "The team's part of renewals at 90%.", "source": "g1", "due": "D3",
         "measure": {"label": "repeat contacts", "format": "percent", "direction": "at_most"}},
    ]}
    a, b = tg.validate_suggestions(parsed, ctx, _dues(ctx))
    assert a["source"]["kind"] == "expectation" and a["source"]["id"] == "m1" and a["due_date"] == "2027-03-31"
    assert a["measure"]["format"] == "percent" and a["target_hint"] == "92% or above" and a["supports_goal_id"] is None
    assert a["why"] == "Beats the 92% bar for one quarter."
    assert b["source"]["kind"] == "goal" and b["supports_goal_id"] == "gcx" and b["due_date"] == "2027-06-30"
    assert b["measure"] is None                                          # a goal source is not a measured expectation


def test_validate_drops_invented_numbers_dates_restatements_and_repeats():
    ctx = _ctx()
    parsed = {"suggestions": [
        {"title": "Get team CSAT to 95%", "source": "E1", "due": "D1"},                 # 95 is not in the source
        {"title": "Raise CSAT by March", "source": "E1", "due": "D1"},                  # date in the title
        {"title": "CSAT on cases they own", "source": "E1", "due": "D1"},               # the expectation restated
        {"title": "Clear the backlog", "source": "E2", "due": "D1"},                    # already a team goal
        {"title": "Something", "source": "E9", "due": "D1"},                            # no such source
        {"title": "Cover the top contact reasons in the help centre", "why": "Ships 20 articles.", "source": "E2", "due": "D9"},
        {"title": "Second from the same source", "source": "E2", "due": "D1"},
    ]}
    (kept,) = tg.validate_suggestions(parsed, ctx, _dues(ctx))
    assert kept["source"]["id"] == "s1" and kept["due_date"] == "2026-12-31"   # unknown due falls back to quarter end
    assert kept["why"] is None                                                 # "20" isn't in the source: the sentence goes
    assert kept["measure"] is None


def test_validate_uses_the_supports_hint_only_for_a_goal_above():
    ctx = _ctx()
    parsed = {"suggestions": [{"title": "Raise team CSAT on owned cases", "source": "E1", "due": "D1"}]}
    assert tg.validate_suggestions(parsed, ctx, _dues(ctx), "gcx")[0]["supports_goal_id"] == "gcx"
    assert tg.validate_suggestions(parsed, ctx, _dues(ctx), "gwest")[0]["supports_goal_id"] is None


@pytest.fixture
def client(monkeypatch):
    db = DB()
    main.app.dependency_overrides[utils.get_authenticated_client] = lambda: ("u1", db)
    sent = []
    monkeypatch.setattr(analytics, "capture", lambda uid, ev, props=None: sent.append((ev, props)))
    yield TestClient(main.app), db, sent
    main.app.dependency_overrides.clear()


def test_context_route_returns_only_what_the_step_shows(client):
    c, _, _ = client
    body = c.get("/api/onboarding/team-goals/context").json()
    assert body["unit"]["name"] == "Support East" and body["can_suggest"] is True
    assert set(body["roles"][0]["items"][0]) == {"id", "kind", "line"}
    assert set(body["above_goals"][0]) == {"id", "title", "due_date", "where"}


def test_suggest_writes_nothing_and_the_event_has_no_text(client, monkeypatch):
    c, _, sent = client
    reply = {"suggestions": [{"title": "Raise team CSAT on owned cases", "why": "A bar for one quarter.", "source": "E1", "due": "D1",
                              "measure": None}]}
    monkeypatch.setattr(tg, "generate_text", lambda *a, **k: json.dumps(reply))
    r = c.post("/api/onboarding/team-goals/suggest", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["nothing_found"] is False and body["suggestions"][0]["key"] == "s1"
    (_, props), = [s for s in sent if s[0] == "team_goals_suggested"]
    assert props == {"expectations": 2, "goals_above": 2, "proposed": 1, "from_expectations": 1}
    assert "CSAT" not in json.dumps(sent)


def test_suggest_without_anything_to_draft_from_is_refused_before_any_ai(client, monkeypatch):
    c, db, _ = client
    db.rows["metric_configs"], db.rows["skill_configs"] = [], []
    db.rows["goals"] = []
    monkeypatch.setattr(tg, "generate_text", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no AI")))
    assert c.post("/api/onboarding/team-goals/suggest", json={}).status_code == 422
