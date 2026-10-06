"""Role expectations on the prep sheet (finding #2, 2026-10-05 onboarding
review). The prompt numbers the approved expectations E1..En; each agenda item
lists the ones it drew on; prep_guard resolves them to the approved lines the
manager sees under the item; the byline says how many were used. And the
manager's own doubt about what good looks like is answered for the manager,
never handed to the report as a question.

Fixture: Theo's Mobile Engineer role and his note on Jonah, from the
2026-10-05 Theo run (business/digital-customers/.../2026-10-05-theo-new-manager-onboard.md)."""
import json
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

from prep_guard import GuardContext, normalize_refs  # noqa: E402
from routes.one_on_ones import (  # noqa: E402
    AgendaItem,
    _build_prep_prompt,
    drew_on_expectations,
    expectation_lines,
    parse_prep_output,
)

MOBILE_ROLE = {
    "role_level": {"job_role": "Mobile Engineer", "job_level": 1, "functional_team": "Mobile",
                   "job_responsibilities": None},
    "metrics": [
        {"metric_name": "Crash-free sessions", "expectation": "Keeps crash-free sessions above 99.5%",
         "target_status": "set", "target": "99.5%", "measurement_period": "none"},
        {"metric_name": "Release cadence", "expectation": "Releases go out on time through app store review",
         "target_status": "unresolved", "measurement_period": "none"},
    ],
    "skills": [
        {"skill_name": "Feature ownership", "expectation": "Owns features end to end on iOS and Android"},
        {"skill_name": "Tests on risky paths", "expectation": "Writes tests on the risky paths, payments first"},
        {"skill_name": "Code review", "expectation": "Reviews teammates' PRs"},
        {"skill_name": "On-call", "expectation": "Covers on-call shifts as scheduled"},
        {"skill_name": "Debugging", "expectation": ""},
    ],
    "values": [],
}

JONAH_NOTE = (
    "shipped his first store release solo in august!! never said anything about it, need to. I told him "
    "at 90 days I'd write him a growth plan, that was like 4 months ago, still nothing. reviews coming, "
    "he's junior so not sure what good looks like for him yet"
)


def _prompt(notes=JONAH_NOTE, role=MOBILE_ROLE):
    return str(_build_prep_prompt(
        report_name="Jonah", raw_notes=notes, open_commitments=[], recent_summaries=[],
        days_since_last=None, cadence_days=7, role_expectations=role,
    ))


def _ctx():
    return GuardContext(report_name="Jonah", source=JONAH_NOTE, expectations=expectation_lines(MOBILE_ROLE))


def test_the_prompt_numbers_every_expectation_in_the_order_it_shows_them():
    body = _prompt()
    assert "• E1 Crash-free sessions" in body
    assert "• E2 Release cadence" in body
    assert "• E3 Feature ownership" in body
    assert "• E7 Debugging" in body
    assert "E8" not in body
    assert '"expectation_refs"' in body


def test_the_lines_the_sheet_shows_are_what_the_manager_approved():
    lines = expectation_lines(MOBILE_ROLE)
    assert lines["E1"] == "Keeps crash-free sessions above 99.5% (target: 99.5%)"
    assert lines["E2"] == "Releases go out on time through app store review"
    # No expectation text: the name stands in, never an empty line.
    assert lines["E7"] == "Debugging"
    assert len(lines) == 7
    assert expectation_lines(None) == {}


def test_the_managers_doubt_is_answered_for_the_manager_not_handed_to_the_report():
    body = _prompt()
    # The growth question fires on the report's signal, not on the manager's doubt.
    assert "CAREER / GROWTH SIGNALS (from the report" in body
    assert "The manager's own uncertainty about this person's level, bar or what good looks like is not a signal from the report" in body
    # Rule 4 names the exact rationale the Theo run produced as the thing not to do.
    assert "so it's worth surfacing with him directly" in body
    assert "the doubt is answered for the manager, not handed to the report" in body
    assert "Do not ask the report what good looks like." in body
    # The expectations block says it to the model where the lines are.
    assert "do not ask Jonah to define the standard" in body


def test_items_resolve_their_refs_to_the_approved_lines_and_drop_the_rest():
    reply = {"situation_summary": "", "agenda_items": [
        {"title": "Review season, his level", "rationale": "The standard you approved covers releases and tests.",
         "from_your_notes": "he's junior so not sure what good looks like for him yet",
         "expectation_refs": ["E2", "e4", 9, "E2", "release"], "suggested_questions": ["How did the August release go?"]},
        {"title": "Closing", "rationale": "", "suggested_questions": ["Anything we haven't covered?"]},
    ]}
    review, closing = parse_prep_output(json.dumps(reply), _ctx())[1]
    assert review["expectation_refs"] == ["E2", "E4"]
    assert review["expectations_used"] == [
        {"ref": "E2", "line": "Releases go out on time through app store review"},
        {"ref": "E4", "line": "Writes tests on the risky paths, payments first"},
    ]
    assert closing["expectation_refs"] == [] and closing["expectations_used"] == []
    # The API model accepts both the new item and a sheet saved before it existed.
    AgendaItem(**review)
    assert AgendaItem(title="t", rationale="r", suggested_questions=[]).expectations_used == []


def test_refs_without_numbered_expectations_resolve_to_nothing():
    reply = {"situation_summary": "", "agenda_items": [
        {"title": "T", "rationale": "", "expectation_refs": ["E1"], "suggested_questions": []}]}
    [item] = parse_prep_output(json.dumps(reply), GuardContext(report_name="Jonah"))[1]
    assert item["expectations_used"] == []


def test_e_refs_and_c_refs_are_read_the_same_way():
    assert normalize_refs(["E1", "e2", 3, "C4", "first"], "E") == ["E1", "E2", "E3"]
    assert normalize_refs(["C1", "E2"]) == ["C1"]


def test_the_byline_says_how_many_were_used_or_drops_the_label():
    ctx = _ctx()
    drew_on = ["your notes", "role expectations"]
    used = [{"expectations_used": [{"ref": "E2", "line": "x"}, {"ref": "E4", "line": "y"}]},
            {"expectations_used": [{"ref": "E2", "line": "x"}]}]
    assert drew_on_expectations(drew_on, used, ctx) == ["your notes", "2 of 7 role expectations"]
    assert drew_on_expectations(drew_on, [{"expectations_used": []}], ctx) == ["your notes"]
    # A job queued before the refs existed has no numbered map: label unchanged.
    assert drew_on_expectations(drew_on, used, GuardContext()) == drew_on
    one = GuardContext(expectations={"E1": "Only line"})
    assert drew_on_expectations(["role expectations"], [{"expectations_used": [{"ref": "E1", "line": "Only line"}]}],
                                one) == ["1 of 1 role expectation"]


def test_the_guard_context_carries_the_lines_through_the_overnight_snapshot():
    ctx = _ctx()
    again = GuardContext.from_dict(json.loads(json.dumps(ctx.to_dict())))
    assert again.expectations == ctx.expectations
    assert GuardContext.from_dict({"source": "x"}).expectations == {}


def test_the_expectations_are_manager_facing():
    from prep_guard import SHAREABLE_FIELDS
    assert "expectations_used" not in SHAREABLE_FIELDS and "expectation_refs" not in SHAREABLE_FIELDS
