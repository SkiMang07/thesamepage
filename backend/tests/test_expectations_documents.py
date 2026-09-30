"""Build 3b — a job description plus supporting documents on
POST /api/role-expectations/import. Documents inform the draft and are not
kept; the job description wins; a document can put a stated figure in wording
but never set a target; a disagreement becomes a question with its own cap."""
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
import routes.role_expectations as rex  # noqa: E402
import utils  # noqa: E402

JD = ("Support Lead. Own renewals for your assigned accounts. Answer escalations within 8 hours. "
      "Maintain an accurate renewal forecast and update it weekly.")
PLAYBOOK = ("Support playbook. Every renewal call is logged in the CRM. Escalations are answered within 4 hours. "
            "We aim for 97% gross retention.")
DOCS = [("playbook.txt", PLAYBOOK)]


def _conflict(**over):
    c = {"about": "escalation response time", "jd_quote": "Answer escalations within 8 hours",
         "document": "playbook.txt", "document_quote": "Escalations are answered within 4 hours"}
    c.update(over)
    return c


def _conflicts(parsed):
    return rex.conflict_questions(parsed, jd_text=JD, documents=DOCS, question_allowed=rex.numbers_in(JD))


# ── conflicts: verified, dropped, capped ─────────────────────────────────

def test_a_conflict_with_both_quotes_verified_becomes_a_question():
    (q,) = _conflicts({"conflicts": [_conflict()]})
    assert q["topic"] == "other" and q["item_key"] is None and q["origin"] == "ai" and q["status"] == "open"
    assert q["question"] == ("The job description and playbook.txt disagree about escalation response time. "
                             "Which should this role follow?")
    assert "“Answer escalations within 8 hours”" in q["why"]
    assert "playbook.txt: “Escalations are answered within 4 hours”" in q["why"]
    assert "follows the job description" in q["why"]


@pytest.mark.parametrize("bad", [
    _conflict(jd_quote="Answer escalations within 2 hours"),          # not in the job description
    _conflict(document_quote="Escalations are answered within 1 hour"),  # not in the document
    _conflict(jd_quote="Escalations are answered within 4 hours",       # a document line claimed as the JD's
              document_quote="Answer escalations within 8 hours"),
    _conflict(document="other.pdf"),                                  # no such document
    _conflict(jd_quote=""),
    _conflict(jd_quote="Support Lead. Own renewals for your assigned accounts. Answer escalations within 8 hours. "
                       "Maintain an accurate renewal forecast"),        # too long to be a quote worth showing
])
def test_a_conflict_with_an_unverifiable_quote_is_dropped(bad):
    assert _conflicts({"conflicts": [bad]}) == []


def test_conflicts_are_capped_and_deduplicated():
    jd = JD + " Log every call. Review the forecast monthly. Handle expansion."
    doc = PLAYBOOK + " Log calls when useful. Review the forecast quarterly. Expansion is sales-owned."
    raw = [
        _conflict(),
        _conflict(),  # duplicate
        _conflict(about="call logging", jd_quote="Log every call", document_quote="Log calls when useful"),
        _conflict(about="forecast cadence", jd_quote="Review the forecast monthly",
                  document_quote="Review the forecast quarterly"),
        _conflict(about="expansion", jd_quote="Handle expansion", document_quote="Expansion is sales-owned"),
    ]
    out = rex.conflict_questions({"conflicts": raw}, jd_text=jd, documents=[("playbook.txt", doc)],
                                 question_allowed=rex.numbers_in(jd))
    assert len(out) == rex._MAX_CONFLICTS == 3
    assert [q["question"].split(" about ")[1].split(".")[0] for q in out] == [
        "escalation response time", "call logging", "forecast cadence"]


def test_conflicts_do_not_eat_the_question_budget():
    # Three ordinary questions still fit their own cap of 3 beside three conflicts.
    items = [{"section": "responsibility", "measure": "judged", "title": "Own renewals", "meets": "On track."}]
    parsed = {
        "items": items,
        "questions": [{"item_index": 0, "topic": t, "question": f"Q about {t}?"} for t in ("scope", "wording", "measure", "other")],
        "conflicts": [_conflict()] * 1,
    }
    _, questions, _ = rex.sanitize_composed(parsed, corpus_text=JD, source_available=True,
                                            extra_numbers_text=PLAYBOOK)
    # sanitize_composed never reads "conflicts"...
    assert [q["topic"] for q in questions] == ["scope", "wording", "measure"]
    # ...and the conflicts arrive on their own, not spilled into questions.
    conflicts = _conflicts(parsed)
    assert len(conflicts) == 1 and all("disagree" not in q["question"] for q in questions)


def test_a_conflict_ask_never_carries_a_document_only_number_but_its_why_does():
    (q,) = _conflicts({"conflicts": [_conflict(about="the 4 hour escalation window")]})
    assert "4" not in q["question"] and q["question"].startswith("The job description and an attached document disagree.")
    assert "within 4 hours" in q["why"]
    # A document name with digits the job description doesn't state stays out of the ask too,
    # so POST /drafts (which re-checks the ask against the JD and notes only) keeps the question.
    (q,) = rex.conflict_questions({"conflicts": [_conflict(document="Q3 playbook 2026.txt")]}, jd_text=JD,
                                  documents=[("Q3 playbook 2026.txt", PLAYBOOK)], question_allowed=rex.numbers_in(JD))
    assert rex.unsupported_numbers(q["question"], rex.numbers_in(JD)) == set()
    assert "Q3 playbook 2026.txt" in q["why"]


def test_no_job_description_text_means_no_conflict_can_be_verified():
    assert rex.conflict_questions({"conflicts": [_conflict()]}, jd_text=None, documents=DOCS,
                                  question_allowed=set()) == []


# ── the prompt ───────────────────────────────────────────────────────────

def _prompt(**kw):
    return rex._compose_prompt(jd_text=JD, role_hint="Support Lead, level 2", ladders_block=None, org_values=[],
                               sibling_block="", include_identity=False, **kw)


def test_documents_and_the_ignore_instruction_reach_the_prompt_labelled():
    p = _prompt(documents=DOCS, ignore="The travel requirement")
    assert "[Document: playbook.txt]\n" + PLAYBOOK in p
    assert "rank BELOW the job description" in p and "never sets a target" in p
    assert '"conflicts": [' in p
    assert "IGNORE THE FOLLOWING" in p and "The travel requirement" in p
    plain = _prompt()
    assert "[Document:" not in plain and '"conflicts"' not in plain and "IGNORE" not in plain


# ── the endpoint ─────────────────────────────────────────────────────────

class _DB:
    def table(self, _n):
        return self

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return SimpleNamespace(data=[])


@pytest.fixture
def client(monkeypatch):
    main.app.dependency_overrides[utils.get_authenticated_client] = lambda: ("u1", _DB())
    sent = []
    monkeypatch.setattr(analytics, "capture", lambda uid, ev, props=None: sent.append((ev, props)))
    monkeypatch.setattr(rex, "_fetch_role", lambda _s, _i: {"id": "rl1", "job_role": "Support Lead", "job_level": 2,
                                                            "role_family_id": None})
    monkeypatch.setattr(rex, "_compute_coverage", lambda _s: {"roles": []})
    monkeypatch.setattr(rex, "_org_values", lambda _s: [])
    utils.limiter.reset()
    yield TestClient(main.app), sent
    main.app.dependency_overrides.clear()
    utils.limiter.reset()


def _reply(seen):
    def fake(prompt, **k):
        seen["prompt"] = prompt
        return json.dumps({
            "items": [
                {"section": "responsibility", "measure": "numeric", "title": "Gross retention",
                 "responsibility": "Keeps the book renewing.", "meets": "Retention is on plan. Aims for 97% gross retention.",
                 "measurement_period": "quarter",
                 "target": {"text": "97% gross retention", "quote": "We aim for 97% gross retention"},
                 "source_quote": "We aim for 97% gross retention"},
                {"section": "responsibility", "measure": "numeric", "title": "Escalations",
                 "meets": "Answers escalations within 8 hours. Logs each call.", "measurement_period": "week",
                 "target": {"text": "within 8 hours", "quote": "Answer escalations within 8 hours"},
                 "source_quote": "Answer escalations within 8 hours"},
            ],
            "questions": [{"item_index": 0, "topic": "scope", "question": "Does retention include expansion?"}],
            "conflicts": [_conflict(), _conflict(jd_quote="Answer escalations within 2 hours")],
        })
    return fake


def test_import_with_documents_end_to_end(client, monkeypatch):
    c, sent = client
    seen = {}
    monkeypatch.setattr(rex, "generate_text", _reply(seen))
    r = c.post("/api/role-expectations/import",
               data={"text": JD, "role_level_id": "rl1", "ignore": "Anything about travel"},
               files=[("documents", ("playbook.txt", PLAYBOOK.encode(), "text/plain"))])
    assert r.status_code == 200, r.text
    body = r.json()
    assert "[Document: playbook.txt]" in seen["prompt"] and "Anything about travel" in seen["prompt"]
    retention, escalations = body["items"]
    # a target quoted from a document lands unresolved, never set, with no JD attribution
    assert retention["target"] == {"status": "unresolved"} and retention["source_quote"] is None
    # but the document's figure is real, so it stays in the wording
    assert "97% gross retention" in retention["meets"]
    # the job description still sets its own target
    assert escalations["target"]["status"] == "set" and escalations["target"]["source"] == "source"
    topics = [q["topic"] for q in body["questions"]]
    assert topics.count("scope") == 1 and topics.count("target") == 1
    conflicts = [q for q in body["questions"] if "disagree" in q["question"]]
    assert len(conflicts) == 1 and conflicts[0]["topic"] == "other"      # the unverifiable one dropped
    assert body["document_names"] == ["playbook.txt"]
    assert {"97", "4"} <= set(body["document_numbers"])
    (ev, props), = [s for s in sent if s[0] == "role_draft_composed"]
    assert props["documents"] == 1 and props["conflicts"] == 1 and props["ignore"] is True
    assert "playbook" not in json.dumps(sent) and "travel" not in json.dumps(sent)


def test_import_without_documents_is_unchanged(client, monkeypatch):
    c, _ = client
    seen = {}
    monkeypatch.setattr(rex, "generate_text", _reply(seen))
    r = c.post("/api/role-expectations/import", data={"text": JD, "role_level_id": "rl1"})
    assert r.status_code == 200
    body = r.json()
    assert "[Document:" not in seen["prompt"]
    assert body["document_names"] == [] and body["document_numbers"] == []
    assert "97" not in body["items"][0]["meets"]
    assert not any("disagree" in q["question"] for q in body["questions"])


def test_documents_need_a_job_description(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(rex, "generate_text", lambda *a, **k: pytest.fail("model called"))
    r = c.post("/api/role-expectations/import", data={"context": "She owns renewals.", "role_level_id": "rl1"},
               files=[("documents", ("playbook.txt", PLAYBOOK.encode(), "text/plain"))])
    assert r.status_code == 422 and "job description" in r.json()["detail"]


def test_document_limits(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(rex, "generate_text", lambda *a, **k: pytest.fail("model called"))
    six = [("documents", (f"d{i}.txt", PLAYBOOK.encode(), "text/plain")) for i in range(6)]
    assert c.post("/api/role-expectations/import", data={"text": JD, "role_level_id": "rl1"}, files=six).status_code == 422
    tiny = [("documents", ("scan.txt", b"hi", "text/plain"))]
    r = c.post("/api/role-expectations/import", data={"text": JD, "role_level_id": "rl1"}, files=tiny)
    assert r.status_code == 422 and "scan.txt" in r.json()["detail"]
    monkeypatch.setattr(rex, "_MAX_UPLOAD_BYTES", 1000)
    two = [("documents", (f"d{i}.txt", b"x" * 600, "text/plain")) for i in range(2)]
    r = c.post("/api/role-expectations/import", data={"text": JD, "role_level_id": "rl1"}, files=two)
    assert r.status_code == 413 and "25MB in total" in r.json()["detail"]
    r = c.post("/api/role-expectations/import", data={"text": JD, "role_level_id": "rl1", "ignore": "x" * 2001})
    assert r.status_code == 413


def test_long_documents_are_trimmed_and_the_manager_is_told(client, monkeypatch):
    c, _ = client
    seen = {}
    monkeypatch.setattr(rex, "generate_text", _reply(seen))
    monkeypatch.setattr(rex, "_MAX_DOCUMENTS_TEXT", 100)
    r = c.post("/api/role-expectations/import", data={"text": JD, "role_level_id": "rl1"},
               files=[("documents", ("playbook.txt", PLAYBOOK.encode(), "text/plain")),
                      ("documents", ("second.txt", (PLAYBOOK * 2).encode(), "text/plain"))])
    assert r.status_code == 200
    assert "[Document: second.txt]" not in seen["prompt"]
    assert any("only the first part" in n for n in r.json()["notes"])


# ── POST /drafts keeps a document figure in wording, still no target ────

class _DraftDB:
    def __init__(self):
        self.inserted = None

    def table(self, _n):
        return self

    def select(self, *_a):
        return self

    def eq(self, *_a):
        return self

    def insert(self, row):
        self.inserted = row
        return self

    def execute(self):
        return SimpleNamespace(data=[self.inserted] if self.inserted else [])


def _create(monkeypatch, **body):
    monkeypatch.setattr(rex, "ensure_org", lambda *a, **k: "org1")
    monkeypatch.setattr(rex, "get_email_from_token", lambda a: "m@example.com")
    monkeypatch.setattr(rex, "_fetch_role", lambda _s, _i: {"id": "rl1", "job_role": "Support Lead", "job_level": 2,
                                                            "job_responsibilities": None})
    monkeypatch.setattr(rex, "_approved_configs", lambda _s, _i: {})
    monkeypatch.setattr(rex, "_org_values", lambda _s: [])
    monkeypatch.setattr(rex, "_open_decisions", lambda _s, _i: [])
    monkeypatch.setattr(rex, "_present_draft", lambda _s, d: {"draft": d})
    item = {"key": "n-aaaaaaaaaaaa", "section": "responsibility", "measure": "numeric", "title": "Gross retention",
            "meets": "Retention is on plan. Aims for 97% gross retention.",
            "target": {"text": "97% gross retention", "quote": "We aim for 97% gross retention"}}
    (conflict,) = _conflicts({"conflicts": [_conflict()]})
    return rex.create_draft(rex.DraftCreateIn(role_level_id="rl1", source_text=JD, items=[item],
                                              questions=[conflict], **body),
                            auth=("u1", _DraftDB()), authorization="Bearer x")["draft"]


def test_drafts_keep_a_document_figure_only_with_the_document_numbers(monkeypatch):
    draft = _create(monkeypatch, document_numbers=["97", "4", "not-a-number", "1e5"])
    (item,) = draft["items"]
    assert "97%" in item["meets"] and item["target"] == {"status": "unresolved"}
    assert any("disagree" in q["question"] for q in draft["questions"])     # the conflict survives /drafts
    assert "document_numbers" not in json.dumps(draft)                      # nothing about documents is stored
    draft = _create(monkeypatch)
    assert draft["items"][0]["meets"] == "Retention is on plan."
