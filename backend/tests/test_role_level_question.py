"""One standard or two levels (finding #3 of the 2026-10-05 onboarding
review). The level question: when it exists, that approval keeps it due
instead of parking it a month out, and the starting lines a split copies.
The split itself (new level, approved copies, people moved, decision
resolved, RLS) is verified against local Postgres; see
docs/systems/expectations.md."""
import os
from datetime import date, timedelta
from types import SimpleNamespace

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "x")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "x")

import routes.role_expectations as rex  # noqa: E402
from tests.test_role_expectations import _defer_setup, _q  # noqa: E402

THEO = ("so it's iOS and Android, they own features end to end. Jonah is junior and Dakota is senior so honestly "
        "it's not the same bar for all four, not sure how to do that here")


def test_a_question_asking_one_standard_or_several_is_a_level_question():
    q = rex.normalize_question({"question": "Should this document describe one shared standard for everyone, "
                                            "or do you want two versions of this role profile?", "topic": "scope"})
    assert q["topic"] == "level"
    assert rex.normalize_question({"question": "Keep separate levels?", "topic": "level"})["topic"] == "level"
    # A target question is never retagged, and ordinary questions stay as they are.
    assert rex.normalize_question({"question": "Is there one standard target?", "topic": "target"})["topic"] == "target"
    assert rex.normalize_question({"question": "Who owns on-call for senior engineers?", "topic": "scope"})["topic"] == "scope"


def test_the_managers_notes_raising_seniority_add_the_question_once():
    qs = rex.ensure_level_question([], THEO)
    assert [(q["id"], q["topic"], q["origin"]) for q in qs] == [("level", "level", "system")]
    assert rex.ensure_level_question(qs, THEO) == qs
    ai = rex.normalize_question({"question": "One shared standard or two versions?", "topic": "other"})
    assert rex.ensure_level_question([ai], THEO) == [ai]
    assert rex.ensure_level_question([], "They own features end to end on iOS and Android.") == []
    assert rex.ensure_level_question([], None) == []


def test_compose_adds_the_level_question_from_the_notes():
    item = {"section": "skill", "measure": "judged", "title": "Feature ownership", "meets": "Owns features end to end.",
            "source_quote": "they own features end to end", "basis": "described"}
    _, questions, _ = rex.sanitize_composed({"items": [item], "questions": []}, corpus_text="Mobile Engineer",
                                            source_available=False, context_text=THEO, mode="description")
    assert [q["topic"] for q in questions] == ["level"]


def test_approval_keeps_the_level_question_due_and_parks_the_rest_a_month_out(monkeypatch):
    db = _defer_setup(monkeypatch, [_q("lvl", topic="level"), _q("a")],
                      items=[rex.normalize_item({"key": "n-aaaaaaaaaaaa", "section": "responsibility", "title": "Own releases"})])
    db.rpc = lambda _n, _a: SimpleNamespace(execute=lambda: SimpleNamespace(data=[{"id": "dr1", "role_level_id": "rl1"}]))
    monkeypatch.setattr(rex, "get_role", lambda *_a, **_k: {})
    rex.approve_draft("dr1", rex.ApproveIn(version=3), auth=("u1", db))
    dates = {d["topic"]: d["follow_up_on"] for d in db.decisions.values()}
    assert dates == {"level": date.today().isoformat(), "scope": (date.today() + timedelta(days=30)).isoformat()}


def test_a_split_starts_from_the_same_lines_unlinked_from_the_source():
    approved = [rex.normalize_item({"key": "cfg1", "config_id": "cfg1", "config_kind": "skills", "section": "skill",
                                    "title": "Code review", "meets": "Reviews PRs.", "origin": "approved"}, default_origin="approved"),
                rex.normalize_item({"key": "cfg2", "config_id": "cfg2", "config_kind": "metrics", "section": "responsibility",
                                    "measure": "numeric", "title": "Crash-free", "legacy_target": True, "origin": "approved"},
                                   default_origin="approved")]
    copies = rex.split_items(approved)
    assert [c["title"] for c in copies] == ["Code review", "Crash-free"]
    assert all(c["config_id"] is None and c["key"] not in ("cfg1", "cfg2") and c["origin"] == "copied" for c in copies)
    assert copies[1]["target"] == {"status": "unresolved"} and copies[1]["legacy_target"] is False


def test_only_a_level_question_closes_without_a_revision():
    class _DB:
        def __init__(self, row): self.row, self.updated = row, None
        def table(self, _n): return self
        def select(self, *_a): return self
        def update(self, p): self.updated = p; return self
        def eq(self, *_a): return self
        def execute(self): return SimpleNamespace(data=[self.row])
    import pytest
    db = _DB({"id": "d1", "role_level_id": "rl1", "topic": "scope", "status": "deferred"})
    with pytest.raises(rex.HTTPException) as e:
        rex.close_decision("d1", rex.CloseDecisionIn(resolution="one_standard"), auth=("u1", db))
    assert e.value.status_code == 422 and db.updated is None
    with pytest.raises(rex.HTTPException) as e:
        rex.close_decision("d1", rex.CloseDecisionIn(resolution="whatever"), auth=("u1", db))
    assert e.value.status_code == 422


def test_a_ladder_that_already_has_levels_is_not_asked_again():
    item = {"section": "skill", "measure": "judged", "title": "Release lead", "meets": "Leads releases.",
            "source_quote": "leads releases", "basis": "described"}
    parsed = {"items": [item], "questions": [{"topic": "level", "question": "One standard or two levels?"}]}
    _, questions, _ = rex.sanitize_composed(parsed, corpus_text="Senior Mobile Engineer", source_available=False,
                                            context_text="Dakota is senior and leads releases", mode="description",
                                            ask_level=False)
    assert questions == []


class _OverviewDB:
    """Every query returns the table's rows; the overview's own logic is what's under test."""
    def __init__(self, tables): self.tables, self._t = tables, None
    def table(self, name): self._t = name; return self
    def __getattr__(self, _name): return lambda *_a, **_k: self
    def execute(self): return SimpleNamespace(data=list(self.tables.get(self._t, [])))


def _overview(decision_topic, config_id=None, open_draft=False):
    today = date.today().isoformat()
    drafts = [{"id": "dr0", "role_level_id": "rl1", "kind": "new", "status": "approved", "questions": [], "items": [],
               "updated_at": today, "approved_at": today, "analysis": None}]
    if open_draft:
        drafts.append({**drafts[0], "id": "dr1", "kind": "revision", "status": "open", "approved_at": None})
    db = _OverviewDB({
        "role_levels": [{"id": "rl1", "job_role": "QA Engineer", "job_level": 1, "role_family_id": None, "job_responsibilities": ""}],
        "role_expectation_drafts": drafts,
        "role_expectation_decisions": [{"id": "dec1", "role_level_id": "rl1", "question": "One standard or two levels?",
                                        "topic": decision_topic, "follow_up_on": today, "status": "deferred",
                                        "config_id": config_id, "item_key": None}],
        "skill_configs": [{"id": "s1", "role_level_id": "rl1", "area": "skill"}],
    })
    return rex.get_overview(auth=("u1", db))


def test_an_open_level_question_is_listed_with_the_approved_role():
    out = _overview("level")
    [item] = [i for i in out["needs_review"] if i["type"] == "decision"]
    assert item["topic"] == "level" and item["decision_id"] == "dec1"
    assert item["kind_label"] == "Approved · level question open"
    assert out["levels"][0]["open_decisions"][0]["approved"] is True


def test_a_role_wide_question_other_than_level_is_still_not_listed_alone():
    out = _overview("scope")
    assert [i for i in out["needs_review"] if i["type"] == "decision"] == []


def test_inside_an_open_revision_the_level_question_belongs_to_the_draft_entry():
    out = _overview("level", open_draft=True)
    assert [i["type"] for i in out["needs_review"]] == ["revision"]
