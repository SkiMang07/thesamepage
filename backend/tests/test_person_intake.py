"""Capture by person: who a sentence is about is decided by the page, the model
only drafts, every row must quote the manager's own words, and nothing is written."""
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

import json  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import analytics  # noqa: E402
import main  # noqa: E402
import routes.person_intake as pi  # noqa: E402
import utils  # noqa: E402

MEI = {"id": "dr1", "name": "Mei Tanaka"}
ANDRE = {"id": "dr2", "name": "Andre Silva"}
SAM1 = {"id": "dr3", "name": "Sam Ortiz"}
SAM2 = {"id": "dr4", "name": "Sam Lee"}


# ── guard 1: sentences naming someone else are never read ────────────────

def test_a_sentence_naming_another_person_is_held_back_not_read():
    text = "I owe her written feedback on her design doc. Andre also sits on that review rota. She asked about staff."
    readable, held = pi.separate(text, MEI, [ANDRE])
    assert "Andre" not in readable
    assert readable == "I owe her written feedback on her design doc. She asked about staff."
    assert held == [{"sentence": "Andre also sits on that review rota.", "person_id": "dr2", "person_name": "Andre Silva"}]


def test_a_sentence_naming_both_people_is_held_back_too():
    _, held = pi.separate("Mei and Andre both want the staff track.", MEI, [ANDRE])
    assert len(held) == 1 and held[0]["person_id"] == "dr2"


def test_names_match_whole_words_and_ignore_case():
    assert pi.mentioned_other("andre said yes", MEI, [ANDRE]) == ANDRE
    assert pi.mentioned_other("Andrea said yes", MEI, [ANDRE]) is None


def test_a_shared_first_name_only_matches_on_the_full_name():
    me = {"id": "x", "name": "Sam Ortiz"}
    others = [SAM2, ANDRE]
    assert pi.mentioned_other("Sam owes me a plan.", me, others) is None        # could be either Sam
    assert pi.mentioned_other("Sam Lee owes me a plan.", me, others) == SAM2
    assert pi.mentioned_other("Andre owes me a plan.", me, others) == ANDRE


# ── guard 2: a row must quote the manager's own words ────────────────────

TEXT = "I owe her written feedback on her design doc, three weeks now. She will confirm the on-call priorities by Friday."


def test_rows_with_a_missing_or_invented_quote_are_dropped():
    parsed = {
        "commitments": [
            {"description": "Send written feedback on her design doc", "committed_by": "manager", "quote": "I owe her written feedback"},
            {"description": "Plan her promotion", "committed_by": "manager", "quote": "promotion case"},   # not in text
            {"description": "Book a retro", "committed_by": "manager"},                                   # no quote
        ],
        "kept_thoughts": [
            {"text": "Feedback is three weeks late", "quote": "three weeks now"},
            {"text": "She is burned out", "quote": "burned out"},
        ],
    }
    out = pi.validate(parsed, TEXT, [])
    assert [c["description"] for c in out["commitments"]] == ["Send written feedback on her design doc"]
    assert [t["text"] for t in out["thoughts"]] == ["Feedback is three weeks late"]
    assert out["dropped"] == 3          # the page tells the manager some rows could not be tied to their words


def test_quote_matching_ignores_case_punctuation_and_spacing():
    parsed = {"commitments": [{"description": "Confirm priorities", "committed_by": "direct_report", "quote": "she will confirm  the ON-CALL priorities"}]}
    assert len(pi.validate(parsed, TEXT, [])["commitments"]) == 1


# ── guard 3: an unclear side stays unclear ───────────────────────────────

def test_direction_is_never_defaulted():
    parsed = {"commitments": [
        {"description": "Confirm priorities", "committed_by": "someone", "quote": "confirm the on-call priorities"},
        {"description": "Send feedback", "committed_by": None, "quote": "written feedback"},
    ]}
    out = pi.validate(parsed, TEXT, [])
    assert [c["committed_by"] for c in out["commitments"]] == [None, None]


def test_bad_dates_are_dropped_not_guessed():
    parsed = {"commitments": [{"description": "Confirm priorities", "committed_by": "direct_report", "due_date": "2026-13-45", "quote": "by Friday"}]}
    assert pi.validate(parsed, TEXT, [])["commitments"][0]["due_date"] is None


def test_an_already_open_commitment_on_the_same_side_is_not_drafted_again():
    parsed = {"commitments": [
        {"description": "Send written feedback on her design doc", "committed_by": "manager", "quote": "written feedback"},
        {"description": "Send written feedback on her design doc", "committed_by": "direct_report", "quote": "written feedback"},
    ]}
    open_rows = [{"description": "send written feedback on her design doc.", "committed_by": "manager"}]
    out = pi.validate(parsed, TEXT, open_rows)
    assert out["already_there"] == 1
    assert [c["committed_by"] for c in out["commitments"]] == ["direct_report"]


# ── kept thoughts never repeat a drafted commitment ──────────────────────

BRAM = (
    "I promised Bram I would move two accounts over to him, and the transfer status is unclear. "
    "I asked for a weekly written status; he did it twice, then stopped. "
    "The Halvorsen status update has not arrived and I told him I would check on it. "
    "I worry he is carrying too much."
)


def _draft(commitments, thoughts):
    return pi.validate({"commitments": commitments, "kept_thoughts": thoughts}, BRAM, [])


def test_a_thought_that_restates_a_commitment_from_the_same_sentence_is_dropped():
    out = _draft(
        [{"description": "Finish the transfer of two accounts to Bram", "committed_by": "manager", "quote": "I would move two accounts over to him"}],
        [{"text": "Account transfer status is unclear", "quote": "the transfer status is unclear"}],
    )
    assert len(out["commitments"]) == 1 and out["thoughts"] == []


def test_a_thought_whose_quote_sits_inside_a_commitment_quote_is_dropped():
    out = _draft(
        [{"description": "Check on the Halvorsen status update", "committed_by": "manager", "quote": "The Halvorsen status update has not arrived and I told him I would check on it"}],
        [{"text": "Halvorsen status update has not arrived", "quote": "Halvorsen status update has not arrived"}],
    )
    assert out["thoughts"] == []


def test_a_lapse_that_shares_a_sentence_with_a_standing_ask_is_kept():
    out = _draft(
        [{"description": "Send a weekly written status", "committed_by": "direct_report", "quote": "I asked for a weekly written status"}],
        [{"text": "He did it twice, then stopped", "quote": "he did it twice, then stopped"}],
    )
    assert [t["text"] for t in out["thoughts"]] == ["He did it twice, then stopped"]


def test_a_thought_from_a_different_sentence_is_kept_and_renumbered():
    out = _draft(
        [{"description": "Finish the transfer of two accounts to Bram", "committed_by": "manager", "quote": "I would move two accounts over to him"}],
        [
            {"text": "Account transfer status is unclear", "quote": "the transfer status is unclear"},
            {"text": "Worried he is carrying too much", "quote": "I worry he is carrying too much"},
        ],
    )
    assert [(t["key"], t["text"]) for t in out["thoughts"]] == [("t0", "Worried he is carrying too much")]


def test_the_prompt_keeps_third_party_deliverables_out_of_commitments():
    prompt = pi.build_prompt("Brennan Ostrowski", "text", "2026-10-03")
    assert "only ever between the manager and THIS person" in prompt.prefix
    assert "boss or HR" in prompt.prefix


# ── the route: drafts only, nothing written, no text in the event ────────

class _Q:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.mode = db, name, [], "select"

    def select(self, *_a):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def is_(self, col, val):
        self.filters.append(lambda r: r.get(col) is None if val == "null" else True)
        return self

    def insert(self, _p):
        self.mode = "insert"
        return self

    def update(self, _p):
        self.mode = "update"
        return self

    def execute(self):
        if self.mode != "select":
            self.db.writes.append((self.name, self.mode))
        rows = self.db.rows.get(self.name, [])
        return SimpleNamespace(data=[{**r} for r in rows if all(f(r) for f in self.filters)])


class DB:
    def __init__(self):
        self.writes = []
        self.rows = {
            "direct_reports": [
                {**MEI, "manager_id": "u1", "archived_at": None},
                {**ANDRE, "manager_id": "u1", "archived_at": None},
                {"id": "gone", "name": "Old Hand", "manager_id": "u1", "archived_at": "2026-01-01"},
                {"id": "theirs", "name": "Not Mine", "manager_id": "u2", "archived_at": None},
            ],
            "commitments": [],
        }

    def table(self, name):
        return _Q(self, name)


@pytest.fixture
def client(monkeypatch):
    db = DB()
    main.app.dependency_overrides[utils.get_authenticated_client] = lambda: ("u1", db)
    sent = []
    monkeypatch.setattr(analytics, "capture", lambda uid, ev, props=None: sent.append((ev, props)))
    yield TestClient(main.app), db, sent
    main.app.dependency_overrides.clear()


def _reply(**kw):
    return json.dumps(kw)


def test_draft_returns_rows_holds_back_other_people_and_writes_nothing(client, monkeypatch):
    c, db, sent = client
    seen = {}

    def fake(prompt, **k):
        seen["body"] = prompt.body
        return _reply(commitments=[{"description": "Send written feedback on her design doc", "committed_by": "manager", "quote": "I owe her written feedback"}], kept_thoughts=[])

    monkeypatch.setattr(pi, "generate_text", fake)
    text = "I owe her written feedback on her design doc. Andre also sits on that review rota."
    r = c.post("/api/person-intake/dr1/draft", json={"text": text})
    assert r.status_code == 200
    body = r.json()
    assert "Andre" not in seen["body"] and "Mei Tanaka" in seen["body"]
    assert body["commitments"][0]["committed_by"] == "manager"
    assert body["mentions"][0]["person_name"] == "Andre Silva"
    assert db.writes == []
    ev, props = sent[-1]
    assert ev == "person_intake_drafted" and props["held_back"] == 1
    assert "Mei" not in json.dumps(props) and "feedback" not in json.dumps(props)


def test_only_other_peoples_sentences_means_no_ai_call(client, monkeypatch):
    c, _db, _sent = client
    monkeypatch.setattr(pi, "generate_text", lambda *a, **k: pytest.fail("model must not be called"))
    r = c.post("/api/person-intake/dr1/draft", json={"text": "Andre owes me a plan."})
    assert r.status_code == 200 and r.json()["commitments"] == [] and len(r.json()["mentions"]) == 1


def test_a_person_who_is_not_yours_or_is_archived_is_a_404(client, monkeypatch):
    c, _db, _sent = client
    monkeypatch.setattr(pi, "generate_text", lambda *a, **k: "{}")
    assert c.post("/api/person-intake/theirs/draft", json={"text": "hi"}).status_code == 404
    assert c.post("/api/person-intake/gone/draft", json={"text": "hi"}).status_code == 404


def test_garbage_from_the_model_is_an_empty_draft_not_an_error(client, monkeypatch):
    c, _db, _sent = client
    monkeypatch.setattr(pi, "generate_text", lambda *a, **k: "not json at all")
    r = c.post("/api/person-intake/dr1/draft", json={"text": "I owe her feedback."})
    assert r.status_code == 200 and r.json()["commitments"] == [] and r.json()["thoughts"] == []


# ── the prep page reuses the reader on the note a sheet was built from ────

def test_a_prep_note_is_read_the_same_way_and_tagged_for_analytics(client, monkeypatch):
    c, db, sent = client
    monkeypatch.setattr(pi, "generate_text", lambda *a, **k: _reply(
        commitments=[{"description": "Talk with her about what lead or staff looks like", "committed_by": "manager",
                      "quote": "we'd talk about what lead or staff looks like here"}],
        kept_thoughts=[]))
    text = "I said like 4 months ago we'd talk about what lead or staff looks like here, never did."
    r = c.post("/api/person-intake/dr1/draft", json={"text": text, "source": "prep_note"})
    assert r.status_code == 200 and len(r.json()["commitments"]) == 1
    assert db.writes == []
    ev, props = sent[-1]
    assert ev == "person_intake_drafted" and props["source"] == "prep_note"


def test_source_defaults_to_intake_and_refuses_anything_else(client, monkeypatch):
    c, _db, sent = client
    monkeypatch.setattr(pi, "generate_text", lambda *a, **k: "{}")
    assert c.post("/api/person-intake/dr1/draft", json={"text": "I owe her feedback."}).status_code == 200
    assert sent[-1][1]["source"] == "intake"
    assert c.post("/api/person-intake/dr1/draft", json={"text": "hi", "source": "elsewhere"}).status_code == 422


def test_a_prep_note_tells_the_model_agenda_lines_are_not_commitments():
    prep = pi.build_prompt("Mei Tanaka", "Ask how she likes feedback.", "2026-10-06", "prep_note")
    intake = pi.build_prompt("Mei Tanaka", "Ask how she likes feedback.", "2026-10-06")
    assert prep.prefix == intake.prefix                     # the cached prefix is shared
    assert "NOT commitments" in prep.body and "NEXT 1:1 WITH Mei Tanaka" in prep.body
    assert "NOT commitments" not in intake.body
