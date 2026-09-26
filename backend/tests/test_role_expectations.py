"""Roles & expectations — the AI-output contracts and draft rules that don't
need a database: the no-invented-numbers guard, composed-draft and
reanalysis sanitizing, system target questions, what a save may change, and
what blocks approval. The approval transaction, RLS and consumer reads are
verified against local Postgres (see docs/systems/expectations.md)."""
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
    assert any("Scope?" in p for p in problems)
    assert rex.approval_problems({"items": [], "questions": []}) == ["Add at least one expectation before approving."]
