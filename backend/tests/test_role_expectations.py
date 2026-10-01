"""Roles & expectations — the AI-output contracts and draft rules that don't
need a database: the no-invented-numbers guard, composed-draft and
reanalysis sanitizing, system target questions, what a save may change, and
what blocks approval. The approval transaction, RLS and consumer reads are
verified against local Postgres (see docs/systems/expectations.md)."""
from types import SimpleNamespace
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "x")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "x")

import routes.role_expectations as rex  # noqa: E402

JD = ("Own renewals for your assigned accounts. Drive retention across your book. "
      "Maintain an accurate renewal forecast and update it weekly. 3+ years in customer success.")


def test_numbers_guard_basics():
    assert rex.numbers_in("Hit 95% of 1,200 accounts in 3.5 days") == {"95", "1200", "3.5"}
    assert rex.numbers_in("Weekly 1:1s, 24/7 coverage") == set()
    allowed = rex.numbers_in(JD)
    text, changed = rex.strip_unsupported("Keeps forecasts current. Achieves 90% retention.", allowed)
    assert changed and text == "Keeps forecasts current."
    text, changed = rex.strip_unsupported("Brings 3+ years of experience.", allowed)
    assert not changed


def test_spelled_out_numbers_count_as_numbers():
    assert rex.numbers_in("two working days") == {"2"}
    assert rex.numbers_in("under two a quarter") == {"2"}
    assert rex.numbers_in("about six a week") == {"6"}
    assert rex.numbers_in("twenty-five percent, one hundred and five accounts") == {"25", "105"}
    assert rex.numbers_in("one a week") == {"1"}
    assert rex.numbers_in("one to two days") == {"2", "1"}
    # a word in the notes supports the same figure as a digit in the draft, and back
    assert rex.unsupported_numbers("Ships within 2 working days.", rex.numbers_in("two working days")) == set()
    assert rex.unsupported_numbers("Ships within two working days.", rex.numbers_in("2 working days")) == set()
    # and an invented figure is still caught
    assert rex.unsupported_numbers("Ships within three working days.", rex.numbers_in("two working days")) == {"3"}


def test_one_as_a_pronoun_is_not_a_number():
    for text in ("No one is left behind.", "Nobody owns it, no one asks.", "One of the team leads it.",
                 "Weekly one-on-one meetings.", "Weekly one on one meetings.", "Someone or one person.",
                 "Each one is reviewed.", "The one who owns it.", "One another's work."):
        assert rex.numbers_in(text) == set(), text
    assert rex.strip_unsupported("No one is surprised.", set()) == ("No one is surprised.", False)


def test_a_spelled_out_target_is_traced_to_the_managers_notes():
    notes = "Andre sends the weekly status about six a week and tickets get answered within two working days."
    items, questions, _ = rex.sanitize_composed(
        {"items": [_composed(title="Answer tickets", meets="Answers tickets within two working days.", exceeds="",
                             target={"text": "within two working days",
                                     "quote": "answered within two working days"})]},
        corpus_text="", source_available=False, context_text=notes)
    (item,) = items
    assert item["target"]["status"] == "set" and item["target"]["source"] == "manager"
    assert "two working days" in item["meets"]
    assert questions == []
    # and a spelled-out number that is NOT in the notes is still refused
    items, _, _ = rex.sanitize_composed(
        {"items": [_composed(meets="Answers tickets within three working days.",
                             target={"text": "within three working days",
                                     "quote": "answered within three working days"})]},
        corpus_text="", source_available=False, context_text=notes)
    assert items[0]["target"] == {"status": "unresolved"}
    assert "three" not in items[0]["meets"]


def _composed(**over):
    item = {"key": "x", "section": "responsibility", "measure": "numeric", "title": "Own renewals",
            "responsibility": "Own renewals for assigned accounts.",
            "meets": "Renewals stay on track. Reaches 92% gross retention.", "exceeds": "",
            "measurement_period": "quarter", "target": {"text": "92% gross retention", "quote": "Drive retention"},
            "source_quote": "Own renewals for your assigned accounts"}
    item.update(over)
    return item


def test_compose_never_keeps_an_invented_target_or_number():
    items, questions, notes = rex.sanitize_composed({"items": [_composed()], "questions": []},
                                                    corpus_text=JD, source_available=True)
    (item,) = items
    assert item["target"] == {"status": "unresolved"}
    assert "92" not in item["meets"] and item["meets"] == "Renewals stay on track."
    assert item["source_quote"] == "Own renewals for your assigned accounts"
    assert [q["topic"] for q in questions] == ["target"]
    assert questions[0]["origin"] == "system" and questions[0]["item_key"] == item["key"]
    assert notes


def test_compose_keeps_a_target_the_source_states_with_provenance():
    jd = JD + " Maintain 95% gross revenue retention each quarter."
    items, questions, _ = rex.sanitize_composed(
        {"items": [_composed(meets="Renewals stay on track.", target={"text": "95% gross revenue retention",
                                                                       "quote": "Maintain 95% gross revenue retention each quarter"})]},
        corpus_text=jd, source_available=True)
    assert items[0]["target"]["status"] == "set"
    assert items[0]["target"]["source"] == "source"
    assert items[0]["target"]["quote"].startswith("Maintain 95%")
    assert questions == []


def test_compose_target_with_a_fabricated_quote_is_refused():
    items, _, _ = rex.sanitize_composed(
        {"items": [_composed(target={"text": "95% retention", "quote": "95% retention"})]},
        corpus_text=JD, source_available=True)
    assert items[0]["target"] == {"status": "unresolved"}


def test_compose_drops_company_value_copies_and_target_questions():
    raw = {"items": [_composed(), {"section": "value", "title": "Close the loop", "meets": "Follows through."}],
           "questions": [{"item_index": 0, "topic": "target", "question": "What's the target?"},
                         {"item_index": 0, "topic": "scope", "question": "Does this include expansion?"}]}
    items, questions, _ = rex.sanitize_composed(raw, corpus_text=JD, source_available=True, org_value_names=["Close the loop"])
    assert [i["section"] for i in items] == ["responsibility"]
    assert sorted(q["topic"] for q in questions) == ["scope", "target"]
    assert all(q["origin"] == "system" for q in questions if q["topic"] == "target")


def test_judged_responsibility_has_no_target():
    items, questions, _ = rex.sanitize_composed(
        {"items": [_composed(measure="judged", meets="Forecast is current.")]}, corpus_text=JD, source_available=True)
    assert items[0]["target"] is None and questions == []
    assert rex.item_kind(items[0]) == "skills"


NOTES = "He was promoted from Director of Support. He now owns renewals and expansion too, and we agreed 110% net revenue retention for the year."


def test_compose_takes_a_target_from_the_managers_notes():
    items, questions, notes = rex.sanitize_composed(
        {"items": [_composed(meets="Grows the book. Keeps NRR at 110%.",
                             target={"text": "110% net revenue retention",
                                     "quote": "we agreed 110% net revenue retention for the year"})]},
        corpus_text=JD, source_available=True, context_text=NOTES)
    (item,) = items
    assert item["target"]["status"] == "set" and item["target"]["source"] == "manager"
    assert "110%" in item["meets"]
    assert questions == [] and notes == []


def test_notes_do_not_launder_an_invented_number():
    items, _, notes = rex.sanitize_composed(
        {"items": [_composed(meets="Keeps NRR at 120%.", target={"text": "120% NRR", "quote": "120% NRR"})]},
        corpus_text=JD, source_available=True, context_text=NOTES)
    assert items[0]["target"] == {"status": "unresolved"}
    assert "120" not in items[0]["meets"]
    assert any("your notes" in n for n in notes)


def test_notes_work_when_the_pdf_has_no_text_layer():
    # Scanned PDF: corpus is empty and source unavailable, but the notes still count.
    items, _, _ = rex.sanitize_composed(
        {"items": [_composed(meets="Keeps NRR on plan.", target={"text": "110% net revenue retention", "quote": "110% net revenue retention"})]},
        corpus_text="", source_available=False, context_text=NOTES)
    assert items[0]["target"]["source"] == "manager"


def test_compose_prompt_puts_the_notes_above_the_job_description():
    prompt = rex._compose_prompt(jd_text=JD, role_hint=None, ladders_block="(none)", org_values=[],
                                 sibling_block="", include_identity=True, context=NOTES)
    assert NOTES in prompt and "follow the notes" in prompt
    assert "manager's notes win" in prompt
    bare = rex._compose_prompt(jd_text=JD, role_hint=None, ladders_block="(none)", org_values=[],
                               sibling_block="", include_identity=False)
    assert "MANAGER'S NOTES" not in bare


def test_review_counts_the_notes_as_stated():
    item = rex.normalize_item(_composed(key="n-bbbbbbbbbbbb", meets="Grows the book.", target={"status": "unresolved"}))
    draft = _draft([item])
    draft["analysis"] = {"context": NOTES}
    parsed = {"suggestions": [{"type": "target", "item_key": item["key"], "text": "110% net revenue retention"},
                              {"type": "target", "item_key": item["key"], "text": "130% net revenue retention"}]}
    _, sugs, _ = rex.sanitize_review(parsed, draft)
    assert [(s["text"], s["source"]) for s in sugs] == [("110% net revenue retention", "manager")]
    assert NOTES in rex._review_prompt(role={"job_role": "Director of CS", "job_level": 5, "role_families": None},
                                       draft={**draft, "questions": []}, org_values=[])


def _draft(items, questions=None, source=JD):
    return {"items": items, "questions": questions or [], "suggestions": [], "source_text": source}


def test_review_suggestions_obey_the_number_rule():
    item = rex.normalize_item(_composed(key="n-aaaaaaaaaaaa", meets="Renewals stay on track.",
                                        target={"status": "unresolved"}))
    answered = rex.normalize_question({"id": "q1", "item_key": item["key"], "topic": "scope",
                                       "question": "Target?", "answer": "Finance agreed 92% GRR", "status": "answered"})
    parsed = {"questions": [{"item_key": item["key"], "topic": "target", "question": "Target?"},
                            {"item_key": item["key"], "topic": "scope", "question": "Expansion too?"}],
              "suggestions": [
                  {"type": "target", "item_key": item["key"], "text": "92% gross revenue retention"},
                  {"type": "target", "item_key": item["key"], "text": "97% gross revenue retention"},
                  {"type": "rewrite", "item_key": item["key"], "field": "meets", "text": "Closes 88% of renewals."},
                  {"type": "rewrite", "item_key": item["key"], "field": "meets", "text": "Renewals stay on track."},
                  {"type": "rewrite", "item_key": "missing", "field": "meets", "text": "Anything"},
                  {"type": "add", "section": "skill", "title": "Negotiation", "meets": "Handles pricing pushback calmly."},
              ]}
    qs, sugs, _ = rex.sanitize_review(parsed, _draft([item], [answered]))
    assert [q["topic"] for q in qs] == ["scope"]
    types = [(s["type"], s.get("text") or s["item"]["title"]) for s in sugs]
    assert types == [("target", "92% gross revenue retention"), ("add", "Negotiation")]
    assert sugs[0]["source"] == "manager"


def test_reconcile_opens_and_closes_target_questions():
    item = rex.normalize_item({"key": "n-bbbbbbbbbbbb", "section": "responsibility", "measure": "numeric",
                               "title": "Adoption", "target": {"status": "unresolved"}})
    qs = rex.reconcile_questions([item], [])
    assert len(qs) == 1 and qs[0]["id"] == "target:n-bbbbbbbbbbbb" and qs[0]["status"] == "open"
    item_set = {**item, "target": {"status": "set", "text": "Weekly active", "source": "manager"}}
    assert rex.reconcile_questions([item_set], qs) == []
    deferred = [{**qs[0], "status": "deferred", "decision_id": "d1"}]
    closed = rex.reconcile_questions([item_set], deferred)
    assert closed[0]["status"] == "answered" and closed[0]["answer"] == "Weekly active"
    reopened = rex.reconcile_questions([item], closed)
    assert reopened[0]["status"] == "deferred"


def test_legacy_metric_is_not_forced_into_a_target_question():
    items = rex.items_from_configs({"metrics": [{"id": "m1", "metric_name": "Onboarding completion",
                                                 "expectation": "On schedule", "measurement_period": "quarter",
                                                 "target_status": None}], "skills": [], "values": []})
    assert items[0]["target"] is None and items[0]["legacy_target"]
    assert rex.reconcile_questions(items, []) == []
    # Round-trips through a save unchanged.
    again = rex.normalize_item(items[0])
    assert again["target"] is None and again["legacy_target"]


def test_items_from_configs_maps_every_kind_and_skips_org_values():
    items = rex.items_from_configs({
        "metrics": [{"id": "m", "metric_name": "Retention", "target_status": "unresolved"}],
        "skills": [{"id": "s1", "skill_name": "Forecast", "area": "responsibility"},
                   {"id": "s2", "skill_name": "Discovery", "area": None}],
        "values": [{"id": "v1", "value_name": "Candor", "role_level_id": "r", "description": "Says it plainly"},
                   {"id": "v2", "value_name": "Close the loop", "role_level_id": None}],
    })
    assert [(i["section"], i["measure"], i["config_kind"]) for i in items] == [
        ("responsibility", "numeric", "metrics"), ("responsibility", "judged", "skills"),
        ("skill", "judged", "skills"), ("value", "judged", "values")]
    assert items[0]["target"] == {"status": "unresolved"}
    assert items[3]["meets"] == "Says it plainly"


def test_save_cannot_defer_or_undefer_without_the_decisions_endpoint():
    stored = [rex.normalize_question({"id": "a", "question": "Q?", "status": "open"}),
              rex.normalize_question({"id": "b", "question": "R?", "status": "deferred", "decision_id": "d"})]
    merged = rex.merge_client_questions(stored, [{"id": "a", "status": "deferred"}, {"id": "b", "status": "open"}])
    assert [q["status"] for q in merged] == ["open", "deferred"]
    merged = rex.merge_client_questions(stored, [{"id": "a", "status": "answered", "answer": "Yes, both."}])
    assert merged[0]["status"] == "answered" and merged[0]["answer"] == "Yes, both."
    # An empty answer can't mark a question answered.
    merged = rex.merge_client_questions(stored, [{"id": "a", "status": "answered", "answer": ""}])
    assert merged[0]["status"] == "open"


def test_approval_problems_name_every_open_decision():
    item = rex.normalize_item({"key": "n-cccccccccccc", "section": "responsibility", "measure": "numeric",
                               "title": "Retention", "target": {"status": "unresolved"}})
    qs = rex.reconcile_questions([item], [rex.normalize_question({"id": "s", "question": "Scope?", "status": "open"})])
    problems = rex.approval_problems({"items": [item], "questions": qs})
    assert any("Set the target (“Retention”)" in p for p in problems)
    # An optional question left open doesn't block approval; approving parks it.
    assert not any("Scope?" in p for p in problems)
    assert rex.approval_problems({"items": [], "questions": []}) == ["Add at least one expectation before approving."]


# ---- setup mode chunk C: describe the role, source marks, data source --------

DESC = ("Priya leads a team of six support reps. She owns first response time and keeps CSAT above 90 each month. "
        "She coaches reps weekly.")


def _described(**over):
    item = {"section": "responsibility", "measure": "numeric", "title": "CSAT", "responsibility": "Keeps CSAT up.",
            "meets": "CSAT stays above 90.", "measurement_period": "month",
            "target": {"text": "above 90", "quote": "keeps CSAT above 90 each month"},
            "source_quote": "keeps CSAT above 90 each month", "basis": "described"}
    item.update(over)
    return item


def _typical(**over):
    item = {"section": "skill", "measure": "numeric", "title": "Escalation handling", "responsibility": "Handles 5 escalations a week.",
            "meets": "Resolves escalations within 24 hours.", "target": {"text": "24 hours", "quote": "24 hours"},
            "source_quote": "made up", "basis": "typical"}
    item.update(over)
    return item


def _run(items, **kw):
    return rex.sanitize_composed({"items": items, "questions": []}, corpus_text="Support Lead level 2",
                                 source_available=False, context_text=DESC, mode="description", **kw)


def test_description_lines_are_marked_from_the_description_and_keep_a_stated_target():
    (item,), questions, _ = _run([_described()])
    assert item["origin"] == "description"
    assert item["target"]["status"] == "set" and item["target"]["source"] == "manager"
    assert item["source_quote"] == "keeps CSAT above 90 each month"


def test_a_quote_that_is_not_in_the_description_is_dropped():
    (item,), _, _ = _run([_described(source_quote="never said this")])
    assert item["source_quote"] is None


def test_a_typical_line_is_judged_numberless_and_has_no_target_or_quote():
    items, questions, notes = _run([_typical()])
    (item,) = items
    assert item["origin"] == "typical" and item["measure"] == "judged" and item["target"] is None
    assert item["source_quote"] is None
    assert not any(ch.isdigit() for ch in item["responsibility"] + item["meets"] + item["title"])
    assert questions == [] and notes                       # numbers were removed and the manager is told


def test_at_most_three_typical_lines_survive():
    items, _, _ = _run([_typical(title=f"Skill {n}", responsibility="", meets="") for n in "abcde"])
    assert len(items) == rex._MAX_TYPICAL


def test_a_client_cannot_relabel_a_typical_line_as_described_by_omitting_basis():
    (item,), _, _ = _run([{**_typical(), "basis": None, "origin": "typical"}])
    assert item["origin"] == "typical" and item["target"] is None


def test_a_job_description_draft_keeps_the_old_origin():
    items, _, _ = rex.sanitize_composed({"items": [_composed()]}, corpus_text=JD, source_available=True)
    assert items[0]["origin"] == "source"


def test_description_prompt_has_no_job_description_and_states_the_typical_rules():
    prompt = rex._compose_prompt(jd_text=None, role_hint=None, ladders_block="(none)", org_values=[],
                                 sibling_block="", include_identity=True, context=DESC, description_only=True)
    assert "There is no job description." in prompt and "JOB DESCRIPTION (as supplied" not in prompt
    assert prompt.index(DESC) < prompt.index('"typical"')
    assert "At most three such items" in prompt and "no number" in prompt
    assert '"basis": "described"' in prompt and "always true" in prompt
    normal = rex._compose_prompt(jd_text=JD, role_hint=None, ladders_block="(none)", org_values=[],
                                 sibling_block="", include_identity=True, context=None)
    assert "basis" not in normal and "THERE IS NO JOB DESCRIPTION" not in normal


def test_read_source_allows_no_source_only_when_the_manager_described_the_role():
    assert rex._read_source(None, "  ", allow_none=True) == (None, None, "Your description")
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as err:
        rex._read_source(None, "")
    assert err.value.status_code == 422 and "describe the role" in err.value.detail


def test_data_source_and_example_are_kept_for_numeric_responsibilities_only():
    n = rex.normalize_item({"section": "responsibility", "measure": "numeric", "title": "Retention", "target": None,
                            "data_source": "  CRM report, weekly ", "example": "Q2: kept Acme after a save call."})
    assert n["data_source"] == "CRM report, weekly" and n["example"].startswith("Q2")
    judged = rex.normalize_item({"section": "responsibility", "measure": "judged", "title": "Coaching",
                                 "data_source": "x", "example": "y"})
    assert judged["data_source"] is None and judged["example"] is None
    assert rex.normalize_item({"title": "T", "origin": "typical"})["origin"] == "typical"
    assert rex.normalize_item({"title": "T", "origin": "bogus"})["origin"] == "manager"


def test_an_approved_metrics_data_source_returns_to_a_revision():
    (item,) = rex.items_from_configs({"metrics": [{"id": "m1", "metric_name": "Retention", "description": "d", "expectation": "e",
                                                   "target_status": "unresolved", "data_source": "CRM report"}]})
    assert item["data_source"] == "CRM report" and item["example"] is None


class _DraftDB:
    """Just enough client for create_draft: no open draft yet, insert echoes the row."""

    def __init__(self):
        self.inserted = None

    def table(self, _name):
        return self

    def select(self, *_a):
        return self

    def eq(self, *_a):
        return self

    def insert(self, row):
        self.inserted = row
        return self

    def execute(self):
        from types import SimpleNamespace
        return SimpleNamespace(data=[self.inserted] if self.inserted else [])


def _create(monkeypatch, items, approved=None):
    db = _DraftDB()
    monkeypatch.setattr(rex, "ensure_org", lambda *a, **k: "org1")
    monkeypatch.setattr(rex, "get_email_from_token", lambda a: "m@example.com")
    monkeypatch.setattr(rex, "_fetch_role", lambda _s, _i: {"id": "rl1", "job_role": "Support Lead", "job_level": 2, "job_responsibilities": None})
    monkeypatch.setattr(rex, "_approved_configs", lambda _s, _i: approved or {})
    monkeypatch.setattr(rex, "_org_values", lambda _s: [])
    monkeypatch.setattr(rex, "_open_decisions", lambda _s, _i: [])
    monkeypatch.setattr(rex, "_present_draft", lambda _s, d: {"draft": d})
    body = rex.DraftCreateIn(role_level_id="rl1", context=DESC, items=items)
    return rex.create_draft(body, auth=("u1", db), authorization="Bearer x")["draft"]


def test_typical_lines_wait_as_suggestions_in_a_new_draft(monkeypatch):
    draft = _create(monkeypatch, [{**_described(), "origin": "description"}, {**_typical(), "origin": "typical"}])
    assert [i["origin"] for i in draft["items"]] == ["description"]
    (sug,) = draft["suggestions"]
    assert sug["type"] == "add" and sug["status"] == "pending" and sug["item"]["origin"] == "typical"
    assert sug["why"] == "Typical for this role, not from you."
    assert draft["analysis"]["context"] == DESC


def test_typical_lines_wait_as_suggestions_on_a_revision_too(monkeypatch):
    approved = {"metrics": [{"id": "m1", "metric_name": "First response", "description": "d", "expectation": "e", "target_status": "unresolved"}]}
    draft = _create(monkeypatch, [{**_described(), "origin": "description"}, {**_typical(), "origin": "typical"}], approved)
    assert [i["title"] for i in draft["items"]] == ["First response"]
    assert sorted(s["item"]["origin"] for s in draft["suggestions"]) == ["description", "typical"]
    whys = {s["item"]["origin"]: s["why"] for s in draft["suggestions"]}
    assert whys["description"].startswith("From your description") and whys["typical"] == "Typical for this role, not from you."


# ---------------------------------------------------------------------------
# Bulk defer: one call, one write, one version bump
# ---------------------------------------------------------------------------

class _DeferDB:
    """A draft row plus a decisions table: enough client for the defer routes.
    Counts draft writes so one-write-per-call is checked, not assumed."""

    def __init__(self, draft):
        from types import SimpleNamespace
        self._ns = SimpleNamespace
        self.draft = draft
        self.draft_writes = 0
        self.decisions = {}
        self._inserted = 0
        self._t = self._op = self._payload = None
        self._filters = {}

    def table(self, name):
        self._t, self._op, self._payload, self._filters = name, "select", None, {}
        return self

    def select(self, *_a):
        self._op = "select"
        return self

    def insert(self, row):
        self._op, self._payload = "insert", row
        return self

    def update(self, patch):
        self._op, self._payload = "update", patch
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def execute(self):
        if self._t == "role_expectation_drafts":
            if self._op == "select":
                return self._ns(data=[self.draft])
            assert self._op == "update"
            if self._filters.get("version") != self.draft["version"]:
                return self._ns(data=[])
            self.draft = {**self.draft, **self._payload}
            self.draft_writes += 1
            return self._ns(data=[self.draft])
        assert self._t == "role_expectation_decisions"
        if self._op == "insert":
            self._inserted += 1
            row = {**self._payload, "id": f"dec{self._inserted}"}
            self.decisions[row["id"]] = row
            return self._ns(data=[row])
        assert self._op == "update"
        self.decisions[self._filters["id"]].update(self._payload)
        return self._ns(data=[self.decisions[self._filters["id"]]])


def _defer_setup(monkeypatch, questions, items=(), version=3):
    draft = {"id": "dr1", "org_id": "org1", "role_level_id": "rl1", "status": "open", "version": version,
             "items": list(items), "questions": questions, "suggestions": []}
    db = _DeferDB(draft)
    monkeypatch.setattr(rex, "_present_draft", lambda _s, d: {"draft": d})
    return db


def _q(qid, **over):
    return {"id": qid, "question": f"{qid}?", "topic": "scope", "status": "open", **over}


def test_approving_with_an_open_optional_question_parks_it_a_month_out(monkeypatch):
    from datetime import date, timedelta
    db = _defer_setup(monkeypatch, [_q("a"), _q("b", topic="other", status="answered", answer="Yes.")],
                      items=[rex.normalize_item({"key": "n-aaaaaaaaaaaa", "section": "responsibility", "title": "Own renewals"})])
    calls = {}

    class _Rpc:
        def execute(self_inner):
            return SimpleNamespace(data=[{"id": "dr1", "role_level_id": "rl1", "approved_at": "now"}])

    def rpc(name, args):
        calls.update(args)
        return _Rpc()

    db.rpc = rpc
    monkeypatch.setattr(rex, "get_role", lambda *_a, **_k: {})
    out = rex.approve_draft("dr1", rex.ApproveIn(version=3), auth=("u1", db))
    assert out["approved_draft"]["id"] == "dr1"
    assert calls["p_expected_version"] == 4 and db.draft_writes == 1
    (decision,) = db.decisions.values()
    assert decision["status"] == "deferred"
    assert decision["follow_up_on"] == (date.today() + timedelta(days=30)).isoformat()
    parked = {q["id"]: q for q in db.draft["questions"]}
    assert parked["a"]["status"] == "deferred" and parked["a"]["decision_id"] == "dec1"
    assert parked["b"]["status"] == "answered"


def test_approving_with_nothing_open_does_not_rewrite_the_draft(monkeypatch):
    db = _defer_setup(monkeypatch, [], items=[rex.normalize_item({"key": "n-aaaaaaaaaaaa", "section": "responsibility", "title": "Own renewals"})])
    seen = {}
    db.rpc = lambda name, args: (seen.update(args) or SimpleNamespace(execute=lambda: SimpleNamespace(data=[{"id": "dr1", "role_level_id": "rl1"}])))
    monkeypatch.setattr(rex, "get_role", lambda *_a, **_k: {})
    rex.approve_draft("dr1", rex.ApproveIn(version=3), auth=("u1", db))
    assert seen["p_expected_version"] == 3 and db.draft_writes == 0


def _defer_many(db, ids, version=3, when=None):
    from datetime import date, timedelta
    when = when or (date.today() + timedelta(days=14)).isoformat()
    body = rex.DeferManyIn(version=version, question_ids=ids, follow_up_on=when)
    return rex.defer_questions("dr1", body, auth=("u1", db))["draft"]


def test_defer_many_parks_every_question_in_one_write(monkeypatch):
    db = _defer_setup(monkeypatch, [_q("a"), _q("b"), _q("c"), _q("d")])
    out = _defer_many(db, ["a", "b", "c", "d"])
    assert db.draft_writes == 1 and out["version"] == 4
    assert [q["status"] for q in out["questions"]] == ["deferred"] * 4
    assert len(db.decisions) == 4
    assert {q["decision_id"] for q in out["questions"]} == set(db.decisions)
    assert len({q["follow_up_on"] for q in out["questions"]}) == 1
    assert rex.approval_problems({"items": [{"title": "x"}], "questions": out["questions"]}) == []


def test_defer_many_moves_the_date_of_an_already_parked_question(monkeypatch):
    from datetime import date, timedelta
    db = _defer_setup(monkeypatch, [_q("a", status="deferred", decision_id="dec9", follow_up_on="2026-01-01"), _q("b")])
    db.decisions["dec9"] = {"id": "dec9", "follow_up_on": "2026-01-01", "status": "deferred"}
    later = (date.today() + timedelta(days=30)).isoformat()
    out = _defer_many(db, ["a", "b"], when=later)
    assert sorted(db.decisions) == ["dec1", "dec9"]  # b got a row; a did not get a second one
    assert db.decisions["dec9"]["follow_up_on"] == later
    by_id = {q["id"]: q for q in out["questions"]}
    assert by_id["a"]["decision_id"] == "dec9" and by_id["a"]["follow_up_on"] == later
    assert by_id["b"]["decision_id"] == "dec1" and by_id["b"]["follow_up_on"] == later


def test_defer_many_binds_the_decision_to_the_approved_config(monkeypatch):
    item = rex.normalize_item({"key": "n-aaaaaaaaaaaa", "section": "responsibility", "measure": "judged",
                               "title": "Forecast", "config_id": "cfg1", "config_kind": "skills"})
    db = _defer_setup(monkeypatch, [_q("a", item_key="n-aaaaaaaaaaaa")], items=[item])
    _defer_many(db, ["a"])
    (row,) = db.decisions.values()
    assert row["config_id"] == "cfg1" and row["config_kind"] == "skills" and row["item_key"] == "cfg1"
    assert row["status"] == "deferred" and row["created_by"] == "u1" and row["draft_id"] == "dr1"


def test_defer_many_skips_unknown_ids_and_leaves_answered_and_dismissed_alone(monkeypatch):
    db = _defer_setup(monkeypatch, [_q("a"), _q("b", status="answered", answer="Yes"), _q("c", status="dismissed")])
    out = _defer_many(db, ["a", "b", "c", "gone"])
    assert [q["status"] for q in out["questions"]] == ["deferred", "answered", "dismissed"]
    assert len(db.decisions) == 1 and db.draft_writes == 1


def test_defer_many_with_only_unknown_ids_is_a_404(monkeypatch):
    import pytest
    from fastapi import HTTPException
    db = _defer_setup(monkeypatch, [_q("a")])
    with pytest.raises(HTTPException) as err:
        _defer_many(db, ["gone", "also-gone"])
    assert err.value.status_code == 404
    assert db.draft_writes == 0 and not db.decisions


def test_defer_many_with_nothing_left_to_park_writes_nothing(monkeypatch):
    db = _defer_setup(monkeypatch, [_q("a", status="answered", answer="Yes")])
    out = _defer_many(db, ["a"])
    assert out["version"] == 3 and db.draft_writes == 0 and not db.decisions


def test_defer_many_validates_date_version_and_size(monkeypatch):
    import pytest
    from datetime import date, timedelta
    from fastapi import HTTPException
    db = _defer_setup(monkeypatch, [_q("a")])
    for bad in ("soon", (date.today() - timedelta(days=5)).isoformat(), (date.today() + timedelta(days=400)).isoformat()):
        with pytest.raises(HTTPException) as err:
            _defer_many(db, ["a"], when=bad)
        assert err.value.status_code == 422
    with pytest.raises(HTTPException) as err:
        _defer_many(db, ["a"], version=2)
    assert err.value.status_code == 409
    with pytest.raises(HTTPException) as err:
        _defer_many(db, [f"q{n}" for n in range(rex._MAX_ITEMS + 1)])
    assert err.value.status_code == 422
    assert db.draft_writes == 0 and not db.decisions


def test_a_parked_target_question_still_closes_and_reopens_with_the_target(monkeypatch):
    item = rex.normalize_item({"key": "n-bbbbbbbbbbbb", "section": "responsibility", "measure": "numeric",
                               "title": "Adoption", "target": {"status": "unresolved"}})
    (tq,) = rex.reconcile_questions([item], [])
    db = _defer_setup(monkeypatch, [tq], items=[item])
    parked = _defer_many(db, [tq["id"]])["questions"]
    assert parked[0]["status"] == "deferred" and parked[0]["decision_id"]
    with_target = {**item, "target": {"status": "set", "text": "Weekly active", "source": "manager"}}
    answered = rex.reconcile_questions([with_target], parked)
    assert answered[0]["status"] == "answered" and answered[0]["answer"] == "Weekly active"
    reopened = rex.reconcile_questions([item], answered)
    assert reopened[0]["status"] == "deferred" and reopened[0]["answer"] is None


def test_single_defer_still_works_through_the_shared_helpers(monkeypatch):
    from datetime import date, timedelta
    db = _defer_setup(monkeypatch, [_q("a"), _q("b")])
    when = (date.today() + timedelta(days=7)).isoformat()
    out = rex.defer_question("dr1", rex.DeferIn(version=3, question_id="a", follow_up_on=when), auth=("u1", db))["draft"]
    assert [q["status"] for q in out["questions"]] == ["deferred", "open"]
    assert db.draft_writes == 1 and len(db.decisions) == 1


# ── Build 2: the target must be a span of the quote it cites ─────────────

# Fictional (business/digital-customers/.../2026-09-30-dana-spoken-monologue.md).
DANA = (
    "Okay. The five without expectations. Andre first, because he's the one I keep replaying. Backend, "
    "mid-level, two years. What good looks like for him, I never wrote down. Two conversations, nothing on "
    "paper. I'd want a weekly written status from him. He sent two, then stopped. Last month. And consistent "
    "delivery, I guess. That's the actual thing.\n\n"
    "Kwame. Junior, eight months. Remote onboarding. I said at his 90-day mark I'd write him a growth plan. "
    "Still a bullet point in my head. So, growth plan, mine. His side is, ask questions early, don't sit on a "
    "blocker. He needs a lot of coaching. Weekly 1:1, thirty minutes.\n\n"
    "Lena. Senior platform, SRE. Six hours ahead. Only remote one. Biweekly, mostly async. Honestly I don't "
    "know what she's working on until something breaks. I owe her quarterly priorities. Asked two weeks ago, "
    "waiting on her. What I'd want from her, visibility. Tell me before it breaks.\n\n"
    "Mei. Senior full-stack. Three years. Was my peer. Applied for the job. Design doc feedback, I owe her, "
    "three weeks now. And the meets versus exceeds talk after calibration. Not raised."
)


def test_canon_numbers_rewrites_digits_and_spelled_runs_the_same_way():
    assert rex._canon_numbers("Within  Two working\ndays") == "within 2 working days"
    assert rex._canon_numbers("within 2 working days") == "within 2 working days"
    assert rex._canon_numbers("Twenty-five percent of 1,200 accounts") == "25 percent of 1200 accounts"
    assert rex._canon_numbers("one hundred and five accounts, 3.50 days") == "105 accounts, 3.5 days"
    assert rex._canon_numbers("one a week") == "1 a week"
    assert rex._canon_numbers("I\u2019d want it") == "i'd want it"


def test_canon_numbers_leaves_a_pronoun_one_as_a_word():
    for text in ("No one is left behind.", "One of the team leads it.", "Weekly one-on-one meetings.",
                 "Each one is reviewed."):
        assert rex._canon_numbers(text) == " ".join(text.split()).lower(), text


def test_span_check_is_whole_token_and_canonical():
    assert rex.is_span_of("2 working days", "answered within two working days")
    assert rex.is_span_of("within two working days", "answered within 2 working days")
    assert rex.is_span_of("within two working days.", "answered within two working days")
    assert not rex.is_span_of("2 working days", "answered within 12 working days")
    assert not rex.is_span_of("3 days", "resolved in 3.5 days")
    assert not rex.is_span_of("5 days", "resolved in 1.5 days")
    assert not rex.is_span_of("week", "a weekly status")
    assert not rex.is_span_of("", "anything") and not rex.is_span_of(" . ", "anything")


def _target_status(text, quote, *, corpus="", source_available=False, context=None):
    items, _, _ = rex.sanitize_composed(
        {"items": [_composed(meets="Delivers.", target={"text": text, "quote": quote})]},
        corpus_text=corpus, source_available=source_available, context_text=context)
    t = items[0]["target"]
    return (t["status"], t.get("source"))


def test_spans_of_a_real_quote_are_set_with_provenance():
    jd = JD + " Maintain 95% gross revenue retention each quarter. Respond to reviews within two working days."
    notes = DANA + " Tickets get answered within two working days."
    assert _target_status("95% gross revenue retention", "Maintain 95% gross revenue retention each quarter",
                          corpus=jd, source_available=True) == ("set", "source")
    assert _target_status("within two working days", "answered within two working days",
                          context=notes) == ("set", "manager")
    # digit <-> spelled, both directions
    assert _target_status("2 working days", "answered within two working days", context=notes) == ("set", "manager")
    assert _target_status("Two working days", "respond to reviews within 2 working days",
                          corpus=jd.replace("two working", "2 working"), source_available=True) == ("set", "source")
    assert _target_status("Two working days", "respond to reviews within two working days",
                          corpus=jd, source_available=True) == ("set", "source")


def test_cadence_targets_from_danas_own_words_are_set():
    assert _target_status("weekly written status", "I'd want a weekly written status from him",
                          context=DANA) == ("set", "manager")
    assert _target_status("Weekly", "a weekly written status from him", context=DANA) == ("set", "manager")
    assert _target_status("quarterly priorities", "I owe her quarterly priorities", context=DANA) == ("set", "manager")
    assert _target_status("Quarterly", "I owe her quarterly priorities", context=DANA) == ("set", "manager")


def test_a_genuine_quote_cannot_carry_a_fabricated_target():
    fabricated = [
        ("2 working days", "Backend, mid-level, two years"),
        ("90% of design docs reviewed", "at his 90-day mark"),
        ("90% of design docs", "at his 90-day mark"),
        ("3 status updates a week", "Design doc feedback, I owe her, three weeks now"),
        ("6 incidents per quarter", "Six hours ahead"),
        ("30 PRs a month", "Weekly 1:1, thirty minutes"),
        ("Every sprint", "consistent delivery"),
    ]
    for text, quote in fabricated:
        assert rex._squash(quote) in rex._squash(DANA), quote  # the quote itself is genuine
        assert _target_status(text, quote, context=DANA) == ("unresolved", None), text


def test_the_allowed_set_of_one_roles_slice_strips_anothers_number():
    # 2c is a caller constraint (Build 3): given only Andre's slice, Mei's "three weeks" can't vouch for a 3.
    andre = DANA.split("\n\n")[0]
    text, changed = rex.strip_unsupported("Responds to design doc feedback within 3 days.", rex.numbers_in(andre))
    assert changed and text == ""


def test_a_why_with_an_invented_number_is_cleared_and_the_question_kept():
    raw = {"items": [_composed()],
           "questions": [{"item_index": 0, "topic": "scope", "question": "Does this include expansion?",
                          "why": "Most teams expand 40% of their book."},
                         {"item_index": 0, "topic": "wording", "question": "Is on track observable?",
                          "why": "It shapes the 1:1 conversation."}]}
    _, questions, _ = rex.sanitize_composed(raw, corpus_text=JD, source_available=True)
    by_topic = {q["topic"]: q for q in questions}
    assert by_topic["scope"]["why"] is None and by_topic["scope"]["question"] == "Does this include expansion?"
    assert by_topic["wording"]["why"] == "It shapes the 1:1 conversation."


def test_review_clears_a_why_with_an_invented_number():
    item = rex.normalize_item(_composed(key="n-cccccccccccc", meets="Renewals stay on track.",
                                        target={"status": "unresolved"}))
    parsed = {"questions": [{"item_key": item["key"], "topic": "scope", "question": "Expansion too?",
                             "why": "Peers hit 85% on this."}],
              "suggestions": [{"type": "add", "section": "skill", "title": "Negotiation",
                               "meets": "Handles pricing pushback calmly.", "why": "Top reps win 70% of these."},
                              {"type": "add", "section": "skill", "title": "Forecasting",
                               "meets": "Keeps the forecast current.", "why": "The JD asks for 3+ years."}]}
    qs, sugs, _ = rex.sanitize_review(parsed, _draft([item]))
    assert [(q["question"], q["why"]) for q in qs] == [("Expansion too?", None)]
    assert [(s["item"]["title"], s["why"]) for s in sugs] == [("Negotiation", None),
                                                               ("Forecasting", "The JD asks for 3+ years.")]


# ---------------------------------------------------------------------------
# Build 3b: attached documents are a lower tier than the job description
# ---------------------------------------------------------------------------

PLAYBOOK = ("Support playbook. Every renewal call is logged in the CRM. "
            "Escalations are answered within 4 hours. We aim for 97% gross retention.")


def test_a_document_number_reaches_prose_but_cannot_make_a_target():
    items, questions, notes = rex.sanitize_composed(
        {"items": [_composed(meets="Renewals stay on track. Answers escalations within 4 hours.",
                             target={"text": "97% gross retention", "quote": "We aim for 97% gross retention"},
                             source_quote="We aim for 97% gross retention")]},
        corpus_text=JD, source_available=True, extra_numbers_text=PLAYBOOK)
    (item,) = items
    # the figure is real, so the wording keeps it
    assert item["meets"] == "Renewals stay on track. Answers escalations within 4 hours."
    # the quote is genuine but it is the document's, not the job description's
    assert item["target"] == {"status": "unresolved"}
    assert item["source_quote"] is None
    assert [q["topic"] for q in questions] == ["target"]
    assert any("can't set a target" in n for n in notes)


def test_without_the_document_the_same_number_is_stripped():
    items, _, _ = rex.sanitize_composed(
        {"items": [_composed(meets="Renewals stay on track. Answers escalations within 4 hours.",
                             target=None)]},
        corpus_text=JD, source_available=True)
    assert items[0]["meets"] == "Renewals stay on track."


def test_a_document_does_not_vouch_for_a_number_it_does_not_state():
    items, _, notes = rex.sanitize_composed(
        {"items": [_composed(meets="Renewals stay on track. Hits 99% retention.", target=None)]},
        corpus_text=JD, source_available=True, extra_numbers_text=PLAYBOOK)
    assert items[0]["meets"] == "Renewals stay on track."
    assert any("documents you attached" in n for n in notes)


def test_the_job_description_and_notes_still_set_targets_beside_a_document():
    jd = JD + " Maintain 95% gross revenue retention each quarter."
    items, _, _ = rex.sanitize_composed(
        {"items": [_composed(meets="Renewals stay on track.",
                             target={"text": "95% gross revenue retention",
                                     "quote": "Maintain 95% gross revenue retention each quarter"})]},
        corpus_text=jd, source_available=True, extra_numbers_text=PLAYBOOK)
    assert items[0]["target"]["status"] == "set" and items[0]["target"]["source"] == "source"
    items, _, _ = rex.sanitize_composed(
        {"items": [_composed(meets="Grows the book.",
                             target={"text": "110% net revenue retention",
                                     "quote": "we agreed 110% net revenue retention for the year"})]},
        corpus_text=JD, source_available=True, context_text=NOTES, extra_numbers_text=PLAYBOOK)
    assert items[0]["target"]["source"] == "manager"


def test_description_prompt_forbids_content_the_description_does_not_state():
    prompt = rex._compose_prompt(jd_text=None, role_hint=None, ladders_block="(none)", org_values=[],
                                 sibling_block="", include_identity=False, context=DESC, description_only=True)
    assert 'Say only what the description says' in prompt
    assert '"visible progress each week"' in prompt and "on the plan the person has set" in prompt
    assert "never a fuller one built from what such a role usually does" in prompt
    normal = rex._compose_prompt(jd_text=JD, role_hint=None, ladders_block="(none)", org_values=[],
                                 sibling_block="", include_identity=False, context=None)
    assert "Say only what the description says" not in normal
