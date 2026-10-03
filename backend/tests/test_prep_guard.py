"""The prep sheet's report-facing guard (prep_guard.py): manager-side context
is held for the manager, never put in a line for the report and never dropped;
escalation words the record never used are flagged; every item is stored
manager-only. Fixtures: tests/fixtures/prep_sensitive_context.json."""
import json
import os
from pathlib import Path

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

import pytest  # noqa: E402

from prep_guard import GuardContext, hold_reason, leadership_names, unsupported_words  # noqa: E402
from routes.one_on_ones import _build_prep_prompt, build_prep_guide, parse_prep_output, summary_unsupported  # noqa: E402

CASES = json.loads((Path(__file__).parent / "fixtures" / "prep_sensitive_context.json").read_text())["cases"]


def _run(case):
    ctx = GuardContext(report_name=case["report"], others=case["others"], source=case["notes"])
    summary, agenda = parse_prep_output(json.dumps(case["reply"]), ctx)
    return ctx, summary, agenda


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_sensitive_context_is_held_for_the_manager_never_said_never_dropped(case):
    ctx, summary, agenda = _run(case)
    exp = case["expect"]
    held = {str(i): [h["reason"] for h in item["held"]] for i, item in enumerate(agenda) if item["held"]}
    assert held == exp["held"]
    assert sum(len(i["suggested_questions"]) for i in agenda) == exp["kept_lines"]
    # Nothing the model wrote is lost: every line is either kept or held, in order.
    for item, raw in zip(agenda, case["reply"]["agenda_items"]):
        assert item["suggested_questions"] + [h["line"] for h in item["held"]] == sorted(
            raw["suggested_questions"], key=lambda q: q not in item["suggested_questions"])
        assert all(h["label"] for h in item["held"])
        assert item["audience"] == "manager"
    flagged = {str(i): {u["field"]: u["words"] for u in item["unsupported"]} for i, item in enumerate(agenda) if item["unsupported"]}
    assert flagged == exp["unsupported"]
    assert summary_unsupported(summary, ctx) == exp.get("summary_unsupported", [])


def test_jamal_item_3_never_reaches_brennan_and_the_sheet_says_why():
    case = next(c for c in CASES if c["name"] == "jamal_hr_documentation")
    _, _, agenda = _run(case)
    said = [q for item in agenda for q in item["suggested_questions"]]
    assert not any("HR" in q or "document" in q for q in said)
    item3 = agenda[2]
    assert item3["held"][0]["label"] == "Mentions HR."
    assert item3["from_your_notes"] == "HR wants documentation."      # the manager's own words stay, faithfully
    assert item3["unsupported"] == [{"field": "suggested_questions", "words": ["start documenting", "asked"]}]


def test_the_guard_needs_no_record_to_hold_but_never_flags_without_one():
    ctx = GuardContext()
    assert hold_reason("HR asked me to start documenting this.", ctx)["reason"] == "hr"
    assert unsupported_words("HR asked me to start documenting this.", "") == []


def test_a_first_name_shared_with_the_report_only_counts_on_the_full_name():
    ctx = GuardContext(report_name="Sam Ortiz", others=["Sam Lee", "Andre Silva"])
    assert hold_reason("Sam, what's in the way?", ctx) is None
    assert hold_reason("Sam Lee hit target, what is he doing differently?", ctx)["reason"] == "roster"
    assert hold_reason("Andrea in finance wants the numbers", ctx) is None


def test_boss_names_come_from_how_the_notes_tag_them():
    assert leadership_names("Priya (my boss) said no. My manager, Gwen, agreed. Talia is fine.") == {"Priya", "Gwen"}
    assert leadership_names("Talia closed three.") == set()


def test_ordinary_career_and_work_questions_pass():
    ctx = GuardContext(report_name="Mei Tanaka", others=["Andre Silva"], source="")
    for line in [
        "What would make this role feel like it's moving in the right direction for you?",
        "Are you interested in a promotion path?",
        "Where did you land on the weekly pipeline plan?",
        "I owe you the design doc feedback and I want to give you a status on it.",
        "What's getting in the way of the QBRs?",
        "Can you walk me through the documentation for the API change?",
        "What's different or the same compared to last quarter?",        # Jamal round 4, live
        "How does this month look compared with September?",
        "What would you like the team to know about Halvorsen?",
    ]:
        assert hold_reason(line, ctx) is None, line


def test_unsupported_words_only_count_in_sentences_about_hr_or_leadership():
    src = "HR wants documentation. He asked for more leads."
    assert unsupported_words("He asked for more leads.", src) == []
    assert unsupported_words("HR wants documentation.", src) == []
    assert unsupported_words("HR has flagged this.", src) == ["flagged"]


def test_the_stored_sheet_carries_the_summary_flag_only_when_there_is_one():
    assert build_prep_guide("s", [], [], source_notes="", prepared_by="manager",
                            summary_unsupported=["flagged"])["summary_unsupported"] == ["flagged"]
    assert "summary_unsupported" not in build_prep_guide("s", [], [], source_notes="", prepared_by="manager")


def test_the_prompt_restates_by_default_and_scripts_only_on_request():
    body = str(_build_prep_prompt(
        report_name="Brennan", raw_notes="HR wants documentation.", open_commitments=[],
        recent_summaries=[], days_since_last=7, cadence_days=7,
    ))
    assert "RESTATE BY DEFAULT, SCRIPT ON REQUEST" in body
    assert '"from_your_notes"' in body
    assert "only when the notes say the manager intends to tell them" in body
    assert "never coach them toward telling" in body
    assert "MANAGER TALKING POINTS" not in body and "pre-write the SBI framing" not in body
    assert '"What\'s actually going on?"' in body
