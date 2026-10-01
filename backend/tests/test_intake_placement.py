"""Sentence placement (2026-10-01, round 3 personas): a role draft reads only
sentences tagged "About the role", a pasted sentence no row cites is listed as
unplaced, and a moved row is saved where the manager put it. The model's
mistakes are fed in and the output is checked. No database, no model, except
the apply and parse routes, which use the same in-memory stand-ins as the
other intake tests."""
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

import json  # noqa: E402

import pytest  # noqa: E402

import expectations_batch as eb  # noqa: E402
import intake_placement as ip  # noqa: E402
import routes.notes_dump as nd  # noqa: E402
import utils  # noqa: E402
from intake_slices import slice_by_person  # noqa: E402
from tests.test_expectations_batch import DANA, _apply, _dana_model, dana  # noqa: E402,F401
from tests.test_lane_guards import CTX, DANA2, REF, ROSTER, _model_reply  # noqa: E402
from tests.test_notes_dump import client  # noqa: E402,F401


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    # Several routes are hit per test; the 20 per minute apply limit is not under test.
    monkeypatch.setattr(utils.limiter, "enabled", False)


# ── role sentences: what a draft may read ────────────────────────────────

JAMAL = ("Brennan is the one I joined two calls for. I joined two. That's rescuing, not coaching. "
         "I'd want a weekly written status from him. He did twice and then he just stopped. "
         "Owns the renewal forecast. Stopped. Forty-five percent.")


def test_a_lapse_and_the_managers_own_account_never_become_role_lines():
    evidence = ["I joined two. That's rescuing, not coaching.", "I'd want a weekly written status from him.",
                "He did twice and then he just stopped.", "Owns the renewal forecast.", "Stopped."]
    got = ip.role_sentences(JAMAL, evidence, [])
    assert got == ["I'd want a weekly written status from him.", "Owns the renewal forecast."]


def test_a_sentence_another_row_cites_is_never_a_role_line():
    piece = "Owns design docs. Meets versus exceeds talk after calibration. Not raised."
    other = ip.quotes_of(["Meets versus exceeds talk after calibration. Not raised."])
    got = ip.role_sentences(piece, ["Owns design docs.", "Meets versus exceeds talk after calibration."], other)
    assert got == ["Owns design docs."]


def test_a_sentence_the_model_did_not_name_is_not_a_role_line():
    assert ip.role_sentences("Owns renewals. Flags risk early.", ["Owns renewals."], []) == ["Owns renewals."]
    assert ip.role_sentences("Owns renewals.", [], []) == []
    assert ip.role_sentences(None, ["Owns renewals."], []) == []


def test_the_managers_private_admission_is_not_a_role_line():
    piece = "Owns design docs. I avoid this one."
    assert ip.role_sentences(piece, ["Owns design docs.", "I avoid this one."], []) == ["Owns design docs."]


def test_verbatim_sentences_come_from_the_text_and_an_altered_one_is_dropped():
    text = "Owns onboarding.  Writes a weekly   update.\n\nStopped after two."
    got = ip.verbatim_sentences(text, ["owns onboarding", "Writes a weekly update.", "Invented line about Priya.", "Owns onboarding."])
    assert got == ["Owns onboarding.", "Writes a weekly   update."]       # the text's own spelling, each once
    assert ip.verbatim_sentences(text, []) == [] and ip.verbatim_sentences("", ["x y"]) == []


# ── unplaced: nothing said is silently dropped ───────────────────────────

def test_a_sentence_no_row_cites_is_listed_and_a_cited_one_is_not():
    text = "Kwame\n\nWeekly status is Andre's ask. Ride-alongs for Ignacio, twice a month. Stopped. Cited line here."
    guess = ip.name_guesser([{"id": "and", "name": "Andre Whitaker"}, {"id": "ign", "name": "Ignacio Ruiz"}])
    got, more = ip.unplaced_sentences(text, ip.quotes_of(["Cited line here."]), guess)
    assert more == 0
    assert [(u["key"], u["text"], u["report_id"]) for u in got] == [
        ("u1", "Weekly status is Andre's ask.", "and"),       # heading "Kwame" and the one-word "Stopped." are not offered
        ("u2", "Ride-alongs for Ignacio, twice a month.", "ign"),
    ]


def test_a_row_carries_the_sentences_its_excerpt_covers():
    text = "Mei. Design doc feedback, owed her, three weeks now. Meets versus exceeds talk after calibration. Not raised."
    assert ip.cited_sentences(text, "Design doc feedback, owed her, three weeks now.") == ["Design doc feedback, owed her, three weeks now."]
    assert ip.cited_sentences(text, "Meets versus exceeds talk after calibration. Not raised.") == \
        ["Meets versus exceeds talk after calibration.", "Not raised."]
    assert ip.cited_sentences(text, None) == [] and ip.cited_sentences(text, "short") == []


def test_unplaced_is_capped_and_says_how_many_more():
    text = " ".join(f"Sentence number {n} is here." for n in range(10))
    got, more = ip.unplaced_sentences(text, [], limit=4)
    assert len(got) == 4 and more == 6


def test_the_person_is_guessed_only_from_a_name_in_the_sentence():
    guess = ip.name_guesser([{"id": "a", "name": "Andre Whitaker"}, {"id": "b", "name": "Brennan Cole"}], ["Gwen"])
    assert guess("Andre sent two.") == "a"
    assert guess("He did twice and then he just stopped.") is None          # who "he" is, the manager says
    assert guess("Gwen needs a written summary on Brennan for HR.") is None   # two people in it: not Brennan's
    assert guess("Andre and Brennan both sat in.") is None


# ── the Dana2 paste, end to end through the parse's pure steps ───────────

def _review(reply, text=DANA2):
    drafts = nd.validate_parse(reply, CTX, text)
    drafts.pop("unmatched_people")
    nd.finish_expectations(
        drafts["expectations"], slices=slice_by_person(text, ROSTER, want={r["report_id"] for r in drafts["expectations"]}),
        open_draft_roles=set(), covered_roles=set(), rank={}, roster=ROSTER, commitments=drafts["commitments"])
    nd.commitments_for_held_back(drafts)
    nd.commitments_for_lapses(drafts)
    nd.assign_role_sentences(drafts)
    shown, _ = nd.rank_and_cap(drafts, [])
    nd.number_items(shown)
    return shown


def test_dana2_the_model_names_a_promise_and_a_lapse_as_role_evidence_and_neither_is_tagged():
    reply = _model_reply()
    for e in reply["expectations"]:
        if e["person"] == REF["mei"]:
            e["evidence"] = ["Senior full-stack.", "Meets versus exceeds talk after calibration."]
        if e["person"] == REF["andre"]:
            e["evidence"] = ["Weekly status, asked for it.", "Sent two.", "Stopped."]
    shown = _review(reply)
    by = {r["report_id"]: r for r in shown["expectations"]}
    assert by["mei"]["role_sentences"] == ["Senior full-stack."]          # her promise is a commitment row's
    assert by["andre"]["role_sentences"] == []                            # a lapse is history, and the ask is in the lapse row's quote
    assert by["andre"]["draft"] is False                                  # nothing tagged, so nothing preselected
    assert "evidence" not in by["mei"]                                    # internal, never sent to the browser


def test_dana2_a_role_row_with_no_evidence_falls_back_to_its_one_excerpt():
    reply = _model_reply()
    shown = _review(reply)
    kwame = next(r for r in shown["expectations"] if r["report_id"] == "kwame")
    assert kwame["role_sentences"] == ["Eight months."]       # thin, but his own, and never his growth plan (a promise)


def test_dana2_promises_nobody_has_a_row_for_are_unplaced_and_the_person_is_left_to_the_manager():
    shown = _review(_model_reply())
    unplaced, more = nd.unplaced_for(DANA2, shown, CTX, [])
    texts = {u["text"]: u["report_id"] for u in unplaced}
    assert texts["Promised him a stretch project toward staff in April."] is None      # the model gave Tomás no row; "him" is not a name
    assert "Never scoped it." in texts
    assert "Design doc feedback, owed her, three weeks now." not in texts             # a commitment row cites it
    assert "Growth plan, mine." not in texts and not any(t == "Stopped." for t in texts)
    assert more == 0


# ── apply: the draft reads exactly what is tagged ────────────────────────

def _record(reads):
    """A drafter that records what it was given to read."""
    def model(prompt):
        reads.append(prompt.split("THE MANAGER'S DESCRIPTION OF THE ROLE")[1].split("THERE IS NO JOB DESCRIPTION.")[0])
        return {"items": [{"section": "skill", "title": "Asks early", "responsibility": "Raises blockers early.",
                           "basis": "described", "source_quote": ""}], "questions": []}
    return model


def test_apply_writes_a_draft_from_the_tagged_sentences_only(dana):
    c, db, queued = dana
    rows = [
        {"report_id": "mei", "role_level_id": "rl_sr", "draft": True,
         "role_sentences": ["For her role, owning design docs, reviewing others' work.", "Hold the senior bar.",
                            "Invented: she must ship weekly."]},
        {"report_id": "andre", "role_level_id": "rl_be", "draft": True,
         "role_sentences": ["I'd want a weekly written status from him."]},
    ]
    body = _apply(c, text=DANA, expectations=rows).json()
    assert len(queued) == 2 and body["not_drafted"] == []
    seen: list[str] = []
    for d in queued:
        assert eb.run_one(db, d, call=_record(seen)) == "composed"
    mei = next(d for d in db.rows["role_expectation_drafts"] if d["role_level_id"] == "rl_sr")
    reads = next(r for r in seen if "owning design docs" in r)
    assert "owning design docs" in reads and "Hold the senior bar." in reads
    assert "meets versus exceeds" not in reads and "Not raised" not in reads and "Invented" not in reads
    assert "Three years" not in reads and "Was my peer" not in reads                  # untagged, so unread
    assert mei["analysis"]["context"] == "For her role, owning design docs, reviewing others' work.\n\nHold the senior bar."
    assert "promises" not in mei["analysis"]


def test_apply_with_nothing_tagged_does_not_draft_and_says_why(dana):
    c, db, queued = dana
    rows = [{"report_id": "mei", "role_level_id": "rl_sr", "draft": True, "role_sentences": []},
            {"report_id": "andre", "role_level_id": "rl_be", "draft": True, "role_sentences": ["I'd want a weekly written status from him."]}]
    body = _apply(c, text=DANA, expectations=rows).json()
    assert len(queued) == 1
    assert {"report_id": "mei", "person_name": "Mei Tanaka",
            "reason": "Nothing is tagged as about Mei’s role, so there’s nothing to draft from."} in body["not_drafted"]
    assert body["waiting"] == []


def test_apply_with_only_untrue_tags_does_not_draft(dana):
    c, db, queued = dana
    rows = [{"report_id": "mei", "role_level_id": "rl_sr", "draft": True, "role_sentences": ["She must ship weekly."]}]
    body = _apply(c, text=DANA, expectations=rows).json()
    assert queued == [] and body["drafting"] == []
    assert body["not_drafted"][0]["reason"].startswith("Nothing tagged as about Mei’s role is in what you typed")


def test_a_kept_row_not_drafted_this_time_still_carries_its_tags_for_the_second_pass(dana):
    c, db, queued = dana
    tags = ["For her role, owning design docs, reviewing others' work."]
    first = _apply(c, text=DANA, expectations=[{"report_id": "mei", "role_level_id": "rl_sr", "draft": False, "role_sentences": tags}]).json()
    assert first["waiting"] == [{"report_id": "mei", "person_name": "Mei Tanaka", "role_level_id": "rl_sr"}] and queued == []
    second = _apply(c, text=DANA, expectations=[{"report_id": "mei", "role_level_id": "rl_sr", "draft": True, "role_sentences": tags}]).json()
    assert len(second["drafting"]) == 1 and len(queued) == 1


def test_a_caller_that_sends_no_tags_still_gets_the_slice_path(dana):
    c, db, queued = dana
    _apply(c, text=DANA, expectations=[{"report_id": "mei", "role_level_id": "rl_sr", "draft": True}])
    assert len(queued) == 1
    mei = next(d for d in db.rows["role_expectation_drafts"] if d["role_level_id"] == "rl_sr")
    assert "Three years" in mei["analysis"]["context"]            # the whole slice, as before


# ── parse: the route returns the roster, role tags and unplaced ──────────

PASTE = ("Priya owns onboarding for new accounts. I want a written update from her every Friday. "
         "She did two and then she just stopped. I owe her feedback on her plan. "
         "Gwen needs a written summary on Priya for HR. Sam runs renewals. Weekly standup is Tuesdays.")


def test_parse_returns_people_role_tags_and_what_no_row_cites(client, monkeypatch):
    c, db, sent = client
    reply = json.dumps({
        "expectations": [{"person": "P1", "role": None, "job_role": "CSM", "job_level": 2,
                          "statement": "Owns onboarding and sends a weekly update.",
                          "evidence": ["Priya owns onboarding for new accounts.", "I want a written update from her every Friday.",
                                       "She did two and then she just stopped.", "Not in the notes at all."],
                          "excerpt": "Priya owns onboarding for new accounts.", "confidence": "high"}],
        "commitments": [
            {"person": "P1", "committed_by": "manager", "description": "Give Priya feedback on her plan",
             "excerpt": "I owe her feedback on her plan.", "confidence": "high"},
            # Jamal's Gwen: a promise about someone else, filed under the report. The review lets the manager move it.
            {"person": "P1", "committed_by": "manager", "description": "Give Priya a written summary for HR",
             "excerpt": "Gwen needs a written summary on Priya for HR.", "confidence": "high"}],
    })
    monkeypatch.setattr(nd, "generate_text", lambda *a, **k: reply)
    body = c.post("/api/onboarding/notes-dump/parse", data={"text": PASTE}).json()
    assert body["people"] == [{"id": "dr1", "name": "Priya Nair"}, {"id": "dr2", "name": "Sam Ortiz"}]
    (row,) = body["expectations"]
    assert row["role_sentences"] == ["Priya owns onboarding for new accounts.", "I want a written update from her every Friday."]
    assert row["draft"] is True and "evidence" not in row
    gwen = next(c for c in body["commitments"] if "Gwen" in c["excerpt"])
    assert gwen["sentences"] == ["Gwen needs a written summary on Priya for HR."]     # what moving it to the role would tag
    texts = {u["text"]: u["report_id"] for u in body["unplaced"]}
    assert texts == {"Sam runs renewals.": "dr2", "Weekly standup is Tuesdays.": None,
                     "She did two and then she just stopped.": None}     # history nobody cites is still shown, never lost
    assert body["unplaced_more"] == 0
    assert [u["key"] for u in body["unplaced"]] == ["u1", "u2", "u3"]
    (event, props), = [s for s in sent if s[0] == "notes_dump_parsed"]
    assert props["unplaced"] == 3 and "Gwen" not in json.dumps(sent)


def test_parse_with_files_only_has_nothing_unplaced(client, monkeypatch):
    c, db, sent = client
    monkeypatch.setattr(nd, "generate_text", lambda *a, **k: json.dumps({}))
    body = c.post("/api/onboarding/notes-dump/parse", files=[("files", ("n.txt", b"Priya owns onboarding for new accounts and more text here to pass the minimum length.", "text/plain"))]).json()
    assert body["unplaced"] == [] and body["unplaced_more"] == 0 and body["people"]
