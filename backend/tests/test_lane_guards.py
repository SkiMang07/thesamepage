"""Lane guards (2026-10-01 Dana2 run): a promise is never also a role
expectation, and a private admission is never a line to say to the report.
Both are enforced in code on the model's output, so these tests feed the
model's mistakes in and check what comes out. Pure: no database, no model."""
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

import json  # noqa: E402

import expectations_batch as eb  # noqa: E402
import routes.notes_dump as nd  # noqa: E402
from intake_slices import for_drafting, slice_by_person, sourced_by, split_lapses  # noqa: E402
from private_lane import discloses_self_state, report_facing  # noqa: E402
from routes.one_on_ones import parse_prep_output  # noqa: E402
from tests.test_expectations_batch import _apply, _dana_model, _dana_rows, dana, DANA  # noqa: E402,F401

# ── Guard 1: promise or expectation, never both ──────────────────────────

# The people and roles of the 2026-10-01 Dana2 run (team-roster.md).
ROSTER = [
    {"id": "tomas", "name": "Tomás Ibarra"}, {"id": "mei", "name": "Mei Tanaka"},
    {"id": "andre", "name": "Andre Whitaker"}, {"id": "kwame", "name": "Kwame Adjei"},
    {"id": "lena", "name": "Lena Hoffmann"}, {"id": "sofia", "name": "Sofia Marchetti"},
]
CTX = {
    "people": {f"P{i}": {"id": p["id"], "name": p["name"], "role_level_id": None, "role_label": None,
                         "org_unit_id": None, "unit_name": None} for i, p in enumerate(ROSTER, 1)},
    "roles": {}, "units": [], "goals": [],
}
REF = {p["id"]: ref for ref, p in CTX["people"].items()}

# That run's paste was not saved, so this is a reconstruction in the same
# shape: Dana's fragments, no "I". The model's three wrong role rows below are
# verbatim from sessions/2026-10-01-dayna2-walkthrough.md.
DANA2 = """Tomás. Senior backend. Five years. Promised him a stretch project toward staff in April. Never scoped it.

Mei. Senior full-stack. Three years. Design doc feedback, owed her, three weeks now. Meets versus exceeds talk after calibration. Not raised.

Andre. Mid backend. Two years. Weekly status, asked for it. Sent two. Stopped.

Kwame. Junior. Eight months. Growth plan, mine. Said at his 90-day mark. Ask questions early.

Lena. Senior platform and SRE, remote. Six hours ahead. Her priorities for next quarter, waiting on her. Asked two weeks ago.

Sofia. Mid frontend. Steady."""

MEI_STATEMENT = "Needs clarity on what meets versus exceeds expectations looks like."
ANDRE_STATEMENT = "Expected to send a weekly status; stopped after two."
LENA_STATEMENT = "Owns setting priorities for next quarter."


def _model_reply(mei_statement=MEI_STATEMENT):
    def exp(pid, statement, excerpt):
        return {"person": REF[pid], "job_role": "Engineer", "job_level": 3, "statement": statement,
                "excerpt": excerpt, "confidence": "high"}
    return {
        "expectations": [
            exp("mei", mei_statement, "Meets versus exceeds talk after calibration."),
            exp("andre", ANDRE_STATEMENT, "Weekly status, asked for it. Sent two. Stopped."),
            exp("lena", LENA_STATEMENT, "Senior platform and SRE, remote."),
            exp("kwame", "Asks questions early.", "Junior. Eight months."),
        ],
        "commitments": [
            {"person": REF["mei"], "committed_by": "manager", "description": "Give Mei written feedback on her design doc",
             "excerpt": "Design doc feedback, owed her, three weeks now.", "confidence": "high"},
            {"person": REF["mei"], "committed_by": "manager",
             "description": "Talk with Mei about what meets versus exceeds looks like",
             "excerpt": "Meets versus exceeds talk after calibration. Not raised.", "confidence": "high"},
            {"person": REF["lena"], "committed_by": "direct_report", "description": "Send next quarter's priorities",
             "excerpt": "Her priorities for next quarter, waiting on her. Asked two weeks ago.", "confidence": "high"},
            {"person": REF["kwame"], "committed_by": "manager", "description": "Write Kwame a growth plan",
             "excerpt": "Growth plan, mine.", "confidence": "high"},
        ],
    }


def _review(reply, text=DANA2):
    """The parse route's pure steps, in its order, on a model reply."""
    drafts = nd.validate_parse(reply, CTX, text)
    drafts.pop("unmatched_people")
    others = [r["person_name"] for r in drafts["expectations"]]
    nd.finish_expectations(
        drafts["expectations"], slices=slice_by_person(text, ROSTER, want={r["report_id"] for r in drafts["expectations"]}),
        open_draft_roles=set(), covered_roles=set(), rank={}, roster=ROSTER, commitments=drafts["commitments"])
    nd.commitments_for_held_back(drafts)
    nd.commitments_for_lapses(drafts)
    assert others
    return drafts


def _row(drafts, pid):
    return next(r for r in drafts["expectations"] if r["report_id"] == pid)


def test_mei_a_promise_to_her_is_not_her_expectation():
    row = _row(_review(_model_reply()), "mei")
    assert row["statement"] is None
    assert "Meets versus exceeds talk after calibration." in row["promises"]
    assert "meets versus exceeds" not in (row["slice"] or "").lower()   # the draft doesn't read it either


def test_lena_what_she_owes_dana_is_not_an_expectation_of_her_role():
    drafts = _review(_model_reply())
    assert _row(drafts, "lena")["statement"] is None
    owed_to_you = [c for c in drafts["commitments"] if c["committed_by"] == "direct_report"]
    assert [c["description"] for c in owed_to_you if c["report_id"] == "lena"] == ["Send next quarter's priorities"]


def test_andre_a_lapsed_weekly_status_is_follow_through_he_owes_not_a_role_row():
    drafts = _review(_model_reply())
    assert _row(drafts, "andre")["statement"] is None            # neither the ask nor "stopped after two"
    assert "follow_through" not in _row(drafts, "andre")          # internal, never sent to the browser
    owed = [c for c in drafts["commitments"] if c["report_id"] == "andre"]
    assert owed == [{
        "report_id": "andre", "person_name": "Andre Whitaker", "description": "Send a weekly status",
        "due_date": None, "committed_by": "direct_report", "excerpt": "Weekly status, asked for it. Sent two. Stopped.",
        "low": True,                                              # the notes never said "owes": starts unchecked
    }]


def test_an_existing_commitment_for_the_lapse_is_not_proposed_twice():
    reply = _model_reply()
    reply["commitments"].append({"person": REF["andre"], "committed_by": "direct_report", "confidence": "high",
                                 "description": "Send a weekly status", "excerpt": "Weekly status, asked for it."})
    drafts = _review(reply)
    assert [c["description"] for c in drafts["commitments"] if c["report_id"] == "andre"] == ["Send a weekly status"]
    assert _row(drafts, "andre")["statement"] is None


def test_the_rows_still_carry_the_role_and_the_people_with_nothing_to_separate_are_untouched():
    drafts = _review(_model_reply())
    assert {r["report_id"] for r in drafts["expectations"]} == {"mei", "andre", "lena", "kwame"}
    assert all(r["role_label"] is None and r["new_role"] for r in drafts["expectations"])   # role kept
    assert _row(drafts, "kwame")["statement"] == "Asks questions early."
    # His growth plan is held back by the wording patterns ("mine"), so it is the manager's side, not a promise-by-citation.
    assert _row(drafts, "kwame")["held_back"] == ["Growth plan, mine."] and _row(drafts, "kwame")["promises"] == []


def test_a_real_expectation_survives_next_to_a_promise_on_the_same_person():
    text = DANA2.replace("Not raised.", "Not raised. For her role, owning design docs, reviewing others' work. Hold the senior bar.")
    row = _row(_review(_model_reply("Owns design docs and reviews others' work."), text), "mei")
    assert row["statement"] == "Owns design docs and reviews others' work."
    assert "owning design docs" in row["slice"]
    assert row["promises"] == ["Design doc feedback, owed her, three weeks now.",
                               "Meets versus exceeds talk after calibration.", "Not raised."]


def test_a_sentence_is_a_promise_only_when_a_commitment_cites_it():
    piece = "Mei. Senior. Meets versus exceeds talk after calibration. Not raised. She should own design docs."
    got = sourced_by(piece, ["Meets versus exceeds talk after calibration. Not raised.", "Mei"])
    assert got == ["Meets versus exceeds talk after calibration.", "Not raised."]   # not "Mei." (one word), not the expectation
    assert sourced_by(piece, ["She should own design docs."]) == []                 # states something of the report: kept
    assert sourced_by(piece, ["talk"]) == []                                       # too thin to cite from
    reads, held = for_drafting(piece, extra=got)
    assert "meets versus exceeds" not in reads.lower() and held == got
    assert for_drafting(piece, extra=["Something never said."])[1] == []           # not a sentence of the slice: ignored


def test_history_leaves_a_statement_and_the_ask_it_followed_goes_with_it():
    assert split_lapses(ANDRE_STATEMENT) == (None, [("Expected to send a weekly status", "stopped after two.")])
    assert split_lapses("Owns renewals. Sent a weekly note; stopped in March.") == \
        ("Owns renewals.", [("Sent a weekly note", "stopped in March.")])
    assert split_lapses("Owns renewals; flags risk early.") == ("Owns renewals; flags risk early.", [])


def test_apply_writes_the_draft_without_the_promises(dana):
    """Dana1's Mei: the "meets versus exceeds" line has no "I", so the wording
    patterns never held it back. The review row carries it as a promise; the
    browser echoes it on apply and the drafter never reads it."""
    c, db, queued = dana
    rows = [dict(r, promises=["And the meets versus exceeds talk after calibration.", "Not raised."]) if r["report_id"] == "mei" else r
            for r in _dana_rows()]
    assert _apply(c, text=DANA, expectations=rows).status_code == 200
    prompts = {}
    for d in queued:
        assert eb.run_one(db, d, call=_dana_model(prompts)) == "composed"
    mei = next(d for d in db.rows["role_expectation_drafts"] if d["role_level_id"] == "rl_sr")
    reads = prompts["Mei"].split("THE MANAGER'S DESCRIPTION OF THE ROLE")[1].split("THERE IS NO JOB DESCRIPTION.")[0]
    assert "meets versus exceeds" not in reads and "Not raised" not in reads
    assert "owning design docs" in reads                                           # the role itself is still read
    assert mei["analysis"]["promises"] == ["And the meets versus exceeds talk after calibration.", "Not raised."]
    assert any(n.startswith(eb.PROMISES_NOTE) and "meets versus exceeds" in n for n in mei["analysis"]["notes"])
    assert "meets versus exceeds" in mei["analysis"]["context"]                    # the stored slice is still her words


# ── Guard 2: the private lane ────────────────────────────────────────────

# Verbatim, sessions/2026-10-01-dayna2-walkthrough.md, Mei's sheet.
MEI_PRIVATE_NOTE = ("Was my peer. Applied for the EM role too. Her last rating got held down in calibration and she felt it. "
                    "I avoid the hard feedback with her more than with anyone.")
MEI_ITEM_4_LINE = ("I want to name something directly: I've noticed I hold back on hard feedback with you more than I do "
                   "with others, and I want that to change going forward.")
MEI_ITEM_1_LINES = [
    "Where did you land on needing the design doc feedback from me, has the timing of it caused any issues?",
    "I want to give you a status on this one before we move on.",
]
MEI_ITEM_3_LINE = "What's your read on how that calibration outcome landed for you looking back?"


def test_the_private_admission_and_the_line_that_carries_it_are_the_same_shape():
    assert discloses_self_state("I avoid the hard feedback with her more than with anyone.")
    assert discloses_self_state(MEI_ITEM_4_LINE)
    assert discloses_self_state(MEI_ITEM_4_LINE.replace("’", "'").replace("'", "’"))    # curly apostrophes


def test_mei_item_4_does_not_reach_the_sheet_as_a_line_to_say_to_her():
    raw = json.dumps({
        "situation_summary": "You noted her rating was held down in calibration.",
        "agenda_items": [
            {"title": "Design doc feedback", "rationale": "Three weeks owed.", "suggested_questions": MEI_ITEM_1_LINES},
            {"title": "Hard feedback, naming the pattern",
             "rationale": "You said you avoid hard feedback with her, so name it without asking her to diagnose it.",
             "suggested_questions": [MEI_ITEM_4_LINE]},
            {"title": "Calibration outcome", "rationale": "Her rating stung.", "suggested_questions": [MEI_ITEM_3_LINE]},
        ],
    })
    summary, agenda = parse_prep_output(raw)
    said = [q for item in agenda for q in item["suggested_questions"]]
    assert MEI_ITEM_4_LINE not in said and not any("hold back" in q for q in said)
    assert said == MEI_ITEM_1_LINES + [MEI_ITEM_3_LINE]                                      # the rest is untouched
    # The rationale is addressed to the manager, who wrote the note: it may say so.
    assert agenda[1]["rationale"].startswith("You said you avoid hard feedback")
    assert agenda[1]["suggested_questions"] == [] and summary.startswith("You noted")


def test_a_line_about_a_promise_or_the_work_is_not_a_private_admission():
    for line in [
        "I haven't sent the feedback yet. Can I walk you through where it stands?",
        "I owe you the design doc feedback and I want to give you a status on it.",
        "I'm worried about the migration date. What do you need from me?",
        "Can I share how I'd frame what we talked about before, so we have it written down this time?",
        "What's getting in the way of the QBRs?",
    ]:
        assert not discloses_self_state(line), line
    assert report_facing(["What's getting in the way?", MEI_ITEM_4_LINE]) == ["What's getting in the way?"]
