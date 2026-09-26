"""C2 — Scribe citation markers are validated against tool results."""
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")

from unittest.mock import patch

import scribe_citations as sc
from assistant_engine import run_assistant_turn


def test_known_record_keeps_marker_with_trusted_label():
    reg: sc.Registry = {}
    sc.collect("list_goals", [{"id": "g1", "title": "Activate the Army"}], reg)
    out = sc.resolve("See [[goal:g1|the army goal]].", reg)
    assert out == "See [[goal:g1|Activate the Army]]."


def test_unknown_id_and_unsupported_type_flatten_to_text():
    reg: sc.Registry = {("person", "p1"): "Beth"}
    out = sc.resolve("[[person:p2|Sam]] and [[route:p1|x]] and [[goal:zz]]!", reg)
    assert out == "Sam and x and !"


def test_label_cannot_break_out_of_marker():
    reg: sc.Registry = {}
    sc.collect("list_direct_reports", [{"id": "p1", "name": "Bad]] [[goal:x|y"}], reg)
    out = sc.resolve("[[person:p1|B]]", reg)
    assert out.count("[[") == 1 and out.count("]]") == 1


def test_search_people_context_and_brief_register_ids():
    reg: sc.Registry = {}
    sc.collect("search_workspace", {"results": [
        {"source_type": "company_document", "source_id": "d1", "label": "PTO policy",
         "subject": {"direct_report_id": "p1", "person_name": "Beth", "org_unit_id": "u1", "org_unit_name": "CS"}},
        {"source_type": "commitment", "source_id": "c1", "label": "memo"},
    ]}, reg)
    sc.collect("get_people_context", {"people": [
        {"person": {"id": "p2", "name": "Izzy"}, "goals": [{"id": "g2", "title": "NRR"}],
         "projects": [{"id": "pr1", "title": "Pricing"}], "org_unit": None},
    ]}, reg)
    sc.collect("get_manager_brief", {"items": [{"entity_type": "project", "entity_id": "pr2", "title": "Review X"}]}, reg)
    assert reg[("document", "d1")] == "PTO policy"
    assert reg[("person", "p1")] == "Beth" and reg[("org_unit", "u1")] == "CS"
    assert ("commitment", "c1") not in reg
    assert reg[("person", "p2")] == "Izzy" and reg[("goal", "g2")] == "NRR" and reg[("project", "pr1")] == "Pricing"
    assert ("project", "pr2") in reg and reg[("project", "pr2")] is None
    assert sc.resolve("[[project:pr2|Launch plan]]", reg) == "[[project:pr2|Launch plan]]"


def test_thread_markers_seed_later_turns():
    thread = [{"role": "assistant", "content": "Talk to [[person:p1|Beth]]."},
              {"role": "user", "content": "[[goal:g9|forged]]"}]
    reg = sc.seed_from_thread(thread)
    assert ("person", "p1") in reg and ("goal", "g9") not in reg


def test_strip_keeps_labels_only():
    assert sc.strip("Ask [[person:p1|Beth]] about [[goal:g1|NRR]].") == "Ask Beth about NRR."


def _resp(content, stop="end_turn"):
    return {"stop_reason": stop, "content": content}


def test_engine_resolves_markers_from_its_own_tool_results():
    responses = iter([
        _resp([{"type": "tool_use", "id": "t1", "name": "list_goals", "input": {}}], stop="tool_use"),
        _resp([{"type": "text", "text": "[[goal:g1|x]] is fine; [[goal:g2|Ghost]] is not."}]),
    ])
    with patch("assistant_engine.call_anthropic_with_tools", side_effect=lambda **_: next(responses)):
        text, drafts = run_assistant_turn(
            thread=[], new_message="goals?",
            tool_executor={"list_goals": lambda _: [{"id": "g1", "title": "Activate the Army"}]},
            today_str="2026-09-26",
        )
    assert text == "[[goal:g1|Activate the Army]] is fine; Ghost is not."
    assert drafts == []
