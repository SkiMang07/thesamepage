"""E7: ai_draft_resolved carries enums and counts only, the edit bucket
means what the docs say, the browser route refuses anything else, and the two
server-side surfaces (assessment items, role suggestions) report once per
proposal."""
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")

from datetime import datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import analytics  # noqa: E402
import main  # noqa: E402
import utils  # noqa: E402
from routes.assessment_reviews import _draft_resolution  # noqa: E402

ALLOWED_PROPS = {
    "surface", "outcome", "edited_before_save", "edit_bucket", "seconds_to_confirm",
    "items_drafted", "items_kept", "items_added",
}


@pytest.fixture
def sent(monkeypatch):
    calls = []
    monkeypatch.setattr(analytics, "capture", lambda uid, event, props=None: calls.append((uid, event, props)))
    return calls


# ── the bucket ──────────────────────────────────────────────────────────

def test_edit_bucket_thresholds():
    draft = " ".join(f"w{i}" for i in range(100))
    assert analytics.edit_bucket(draft, draft) == "none"
    assert analytics.edit_bucket(draft, draft.upper()) == "none"  # case and spacing aren't edits
    assert analytics.edit_bucket(draft, draft.replace("w5 ", "x5 ")) == "light"
    assert analytics.edit_bucket(draft, " ".join(draft.split()[:75])) == "moderate"
    assert analytics.edit_bucket(draft, "entirely new text") == "heavy"
    assert analytics.edit_bucket("", "something") == "heavy"


def test_seconds_since_is_capped_and_tolerant():
    ten_ago = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
    assert 9 <= analytics.seconds_since(ten_ago) <= 12
    assert analytics.seconds_since("2020-01-01T00:00:00Z") == analytics.MAX_SECONDS_TO_CONFIRM
    assert analytics.seconds_since(None) is None
    assert analytics.seconds_since("not a date") is None


# ── the event ───────────────────────────────────────────────────────────

def test_event_carries_only_fixed_properties(sent):
    analytics.ai_draft_resolved("u1", surface="one_on_one_wrapup", outcome="accepted",
                                edit_bucket="moderate", seconds_to_confirm=90,
                                items_drafted=4, items_kept=3, items_added=1)
    [(uid, event, props)] = sent
    assert (uid, event) == ("u1", "ai_draft_resolved")
    assert props == {"surface": "one_on_one_wrapup", "outcome": "accepted", "edited_before_save": True,
                     "edit_bucket": "moderate", "seconds_to_confirm": 90,
                     "items_drafted": 4, "items_kept": 3, "items_added": 1}


def test_discard_is_never_edited_and_unknown_values_send_nothing(sent):
    analytics.ai_draft_resolved("u1", surface="team_wrapup", outcome="discarded", edit_bucket="heavy")
    assert sent[0][2]["edited_before_save"] is False and sent[0][2]["edit_bucket"] == "none"
    analytics.ai_draft_resolved("u1", surface="Jack's review notes", outcome="accepted")
    analytics.ai_draft_resolved("u1", surface="team_wrapup", outcome="kept it")
    assert len(sent) == 1


# ── the browser route ───────────────────────────────────────────────────

@pytest.fixture
def client():
    utils.limiter.reset()
    main.app.dependency_overrides[utils.get_authenticated_client] = lambda: ("u1", None)
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()
    utils.limiter.reset()


def _body(**over):
    return {"surface": "development_plan", "outcome": "accepted", "edit_bucket": "light",
            "seconds_to_confirm": 42, **over}


def test_route_sends_the_event(client, sent, monkeypatch):
    r = client.post("/api/telemetry/ai-draft", json=_body(items_drafted=3))
    assert r.status_code == 200, r.text
    [(_, event, props)] = sent
    assert event == "ai_draft_resolved" and set(props) <= ALLOWED_PROPS
    assert props["surface"] == "development_plan" and props["items_drafted"] == 3


@pytest.mark.parametrize("bad", [
    {"draft_text": "Jack will own the migration"},          # any extra field
    {"surface": "free text"},
    {"edit_bucket": "a lot"},
    {"seconds_to_confirm": -1},
    {"surface": "assessment_item"},                         # server-side surfaces aren't the browser's to report
    {"surface": "document_extraction"},
])
def test_route_refuses_anything_but_enums_and_counts(client, sent, bad):
    r = client.post("/api/telemetry/ai-draft", json=_body(**bad))
    assert r.status_code == 422
    assert sent == []


# ── server-side surfaces ────────────────────────────────────────────────

def _ai_item(**extra):
    stamp = (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat()
    proposal = {"point": 3, "reason": "Closed every renewal on time this quarter"}
    return {"proposal": proposal,
            "decision": {"state": "include", "origin": "ai", **proposal, "updated_at": stamp}, **extra}


def test_assessment_accepting_a_proposal_is_unedited():
    res = _draft_resolution("accept_proposal", _ai_item(), {})
    assert res["outcome"] == "accepted" and res["edit_bucket"] == "none"
    assert 29 <= res["seconds_to_confirm"] <= 33


def test_assessment_override_is_an_edit():
    res = _draft_resolution("set", _ai_item(), {"point": 2, "reason": "Two renewals slipped past their date"})
    assert res["outcome"] == "accepted" and res["edit_bucket"] in ("moderate", "heavy")


def test_assessment_unassessing_a_proposal_is_a_discard():
    assert _draft_resolution("unassessed", _ai_item(), {})["outcome"] == "discarded"


def test_assessment_reports_once_per_proposal():
    touched = _ai_item()
    touched["decision"]["origin"] = "manager"
    assert _draft_resolution("set", touched, {"point": 1}) is None
    assert _draft_resolution("set", {"decision": {"origin": "ai"}, "proposal": None}, {}) is None


def test_assessment_revision_apply_and_dismiss():
    item = _ai_item(revision={"point": 4, "created_at": datetime.now(timezone.utc).isoformat()})
    item["decision"]["origin"] = "manager"
    assert _draft_resolution("apply_revision", item, {})["outcome"] == "accepted"
    assert _draft_resolution("dismiss_revision", item, {})["outcome"] == "discarded"


def test_role_suggestions_are_stamped_when_proposed():
    import inspect
    from routes import role_expectations
    src = inspect.getsource(role_expectations)
    assert src.count('"status": "pending", "created_at": _now_iso()}') == 3
    assert 'surface="role_suggestion"' in inspect.getsource(role_expectations.act_on_suggestion)


def test_document_extraction_bucket_counts_corrected_fields():
    from routes.documents import extraction_edit_bucket
    assert [extraction_edit_bucket(n) for n in range(4)] == ["none", "moderate", "heavy", "heavy"]
