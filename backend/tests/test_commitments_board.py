"""The commitments table (GET /api/commitments/board) and editing a
commitment (PATCH /api/commitments/{id}), plus the team writer's owner rule.

Uses the in-memory Supabase stand-in from test_team_meetings, extended with
gte(). It applies the owner/manager filters each route passes, so scoping is
exercised rather than assumed.
"""
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import analytics
from routes.commitments import CommitmentUpdate, build_board, commitments_board, update_commitment
from routes.team import TeamCommitmentIn, create_team_commitment
from test_team_meetings import _DB, _Query

MANAGER = "manager-1"
OTHER = "manager-2"


def _gte(self, col, val):
    self.filters.append(lambda r: r.get(col) is not None and r.get(col) >= val)
    return self


_Query.gte = _gte


def _iso(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _c(id, **kw):
    row = {
        "id": id, "owner_id": MANAGER, "title": None, "description": id, "status": "open",
        "committed_by": "manager", "direct_report_id": None, "outside_person_id": None,
        "org_unit_id": None, "is_team_commitment": False, "source_type": "manual", "source_id": None,
        "due_date": None, "created_at": _iso(-5), "completed_at": None,
    }
    row.update(kw)
    return row


def _seed():
    db = _DB()
    db.tables = {
        "direct_reports": [
            {"id": "dr-leah", "manager_id": MANAGER, "name": "Leah Welborn", "org_unit_id": "ou-cs", "archived_at": None},
            {"id": "dr-jordan", "manager_id": MANAGER, "name": "Jordan Breedlove", "org_unit_id": "ou-cs", "archived_at": None},
            {"id": "dr-gone", "manager_id": MANAGER, "name": "Gone Person", "org_unit_id": "ou-cs", "archived_at": _iso(-40)},
            {"id": "dr-theirs", "manager_id": OTHER, "name": "Not yours", "org_unit_id": None, "archived_at": None},
        ],
        "outside_people": [{"id": "op-boss", "owner_id": MANAGER, "name": "Priya Boss"}],
        "org_units": [{"id": "ou-cs", "name": "Customer Success"}],
        "one_on_ones": [{"id": "oo-1", "manager_id": MANAGER, "direct_report_id": "dr-leah",
                         "scheduled_at": "2026-10-02T12:00:00+00:00", "created_at": "2026-09-30T09:00:00+00:00"}],
        "team_meetings": [{"id": "tm-1", "manager_id": MANAGER, "scheduled_at": "2026-10-06T12:00:00+00:00",
                           "org_unit_id": "ou-cs"}],
        "outside_meetings": [{"id": "om-1", "owner_id": MANAGER, "title": "Skip-level with Priya",
                              "scheduled_at": "2026-10-01T12:00:00+00:00"}],
        "goals": [{"id": "g-1", "owner_id": MANAGER, "title": "Raise NRR"}],
        "projects": [],
        "commitments": [
            _c("mine-1on1", direct_report_id="dr-leah", source_type="one_on_one", source_id="oo-1", due_date="2026-10-01"),
            _c("leah-owes", committed_by="direct_report", direct_report_id="dr-leah", source_type="one_on_one", source_id="oo-1"),
            _c("team-jordan", committed_by="direct_report", direct_report_id="dr-jordan", is_team_commitment=True,
               source_type="team_meeting", source_id="tm-1", org_unit_id="ou-cs"),
            _c("team-mine", is_team_commitment=True, source_type="team_meeting", source_id="tm-1", org_unit_id="ou-cs"),
            _c("boss-owes", committed_by="counterpart", outside_person_id="op-boss", source_type="outside_meeting", source_id="om-1"),
            _c("mine-to-boss", outside_person_id="op-boss", source_type="outside_meeting", source_id="om-1"),
            _c("goal-mine", source_type="goal", source_id="g-1"),
            _c("deleted-src", source_type="project", source_id="p-gone"),
            _c("archived", committed_by="direct_report", direct_report_id="dr-gone"),
            _c("done-recent", status="done", completed_at=_iso(-3)),
            _c("done-old", status="done", completed_at=_iso(-60)),
            _c("dropped", status="dropped"),
            _c("not-mine", owner_id=OTHER),
        ],
    }
    return db


def _auth(db, user=MANAGER):
    return (user, db)


@pytest.fixture(autouse=True)
def _no_analytics(monkeypatch):
    sent = []
    monkeypatch.setattr(analytics, "capture", lambda *a, **k: sent.append(a))
    return sent


# --- the board ---------------------------------------------------------------

def test_board_holds_open_and_recently_done_only():
    board = commitments_board(auth=_auth(_seed()))
    ids = {c["id"] for c in board["commitments"]}
    assert "done-recent" in ids
    assert not ids & {"done-old", "dropped", "not-mine", "archived"}
    assert [p["name"] for p in board["people"]] == ["Jordan Breedlove", "Leah Welborn"]   # archived & others' left out


def test_board_says_who_owes_it_and_who_it_is_with():
    rows = {c["id"]: c for c in commitments_board(auth=_auth(_seed()))["commitments"]}
    assert (rows["mine-1on1"]["owner"], rows["mine-1on1"]["owner_name"], rows["mine-1on1"]["with_name"]) == ("you", None, "Leah Welborn")
    assert (rows["leah-owes"]["owner"], rows["leah-owes"]["owner_name"]) == ("report", "Leah Welborn")
    assert (rows["team-jordan"]["owner"], rows["team-jordan"]["owner_name"]) == ("report", "Jordan Breedlove")
    assert (rows["team-mine"]["owner"], rows["team-mine"]["with_name"]) == ("you", None)
    assert (rows["boss-owes"]["owner"], rows["boss-owes"]["owner_name"]) == ("counterpart", "Priya Boss")
    assert (rows["mine-to-boss"]["owner"], rows["mine-to-boss"]["with_name"]) == ("you", "Priya Boss")


def test_board_resolves_where_each_was_made():
    rows = {c["id"]: c for c in commitments_board(auth=_auth(_seed()))["commitments"]}
    assert rows["mine-1on1"]["source"] == {"type": "one_on_one", "label": "1:1 with Leah", "date": "2026-10-02",
                                          "href": "/app/reports/dr-leah?conversation=oo-1"}
    assert rows["team-jordan"]["source"]["label"] == "Customer Success meeting"
    assert rows["team-jordan"]["source"]["href"] == "/app/team/meetings/tm-1"
    assert rows["mine-to-boss"]["source"]["label"] == "Skip-level with Priya"
    assert rows["goal-mine"]["source"]["label"] == "Goal: Raise NRR"
    assert rows["deleted-src"]["source"] == {"type": "project", "label": "A project, no longer available", "date": None, "href": None}
    assert rows["done-recent"]["source"]["label"] == "Added by you"


def test_board_team_falls_back_to_the_owners_team():
    rows = {c["id"]: c for c in commitments_board(auth=_auth(_seed()))["commitments"]}
    assert rows["leah-owes"]["org_unit_id"] == "ou-cs"      # none stored, Leah's team
    assert rows["goal-mine"]["org_unit_id"] is None


def test_build_board_never_labels_a_source_the_manager_cannot_read():
    row = _c("x", source_type="team_meeting", source_id="someone-elses")
    [out] = build_board([row], reports={}, outside={}, sources={"team_meeting": {}}, units={})
    assert out["source"]["href"] is None and "no longer available" in out["source"]["label"]


# --- editing -------------------------------------------------------------------

def _row(db, id):
    return next(r for r in db.tables["commitments"] if r["id"] == id)


def test_change_and_clear_the_due_date():
    db = _seed()
    update_commitment("goal-mine", CommitmentUpdate(due_date=date(2026, 10, 20)), auth=_auth(db))
    assert _row(db, "goal-mine")["due_date"] == "2026-10-20"
    update_commitment("goal-mine", CommitmentUpdate(due_date=None), auth=_auth(db))
    assert _row(db, "goal-mine")["due_date"] is None


def test_wording_change_is_trimmed_and_never_blank():
    db = _seed()
    update_commitment("goal-mine", CommitmentUpdate(description="  Send the deck  "), auth=_auth(db))
    assert _row(db, "goal-mine")["description"] == "Send the deck"
    with pytest.raises(HTTPException) as exc:
        update_commitment("goal-mine", CommitmentUpdate(description="   "), auth=_auth(db))
    assert exc.value.status_code == 422


def test_status_only_body_still_works_and_is_counted(_no_analytics):
    db = _seed()
    update_commitment("mine-1on1", CommitmentUpdate(status="done", surface="table"), auth=_auth(db))
    assert _row(db, "mine-1on1")["status"] == "done" and _row(db, "mine-1on1")["completed_at"]
    assert _no_analytics[-1][1:] == ("commitment_status_changed", {"status": "done", "owner": "you", "surface": "table"})
    update_commitment("mine-1on1", CommitmentUpdate(status="open"), auth=_auth(db))
    assert _row(db, "mine-1on1")["completed_at"] is None


def test_a_one_on_one_row_flips_sides_but_keeps_its_person():
    db = _seed()
    update_commitment("mine-1on1", CommitmentUpdate(owner="direct_report"), auth=_auth(db))
    assert (_row(db, "mine-1on1")["committed_by"], _row(db, "mine-1on1")["direct_report_id"]) == ("direct_report", "dr-leah")
    with pytest.raises(HTTPException):
        update_commitment("mine-1on1", CommitmentUpdate(owner="direct_report", direct_report_id="dr-jordan"), auth=_auth(db))


def test_a_team_row_moves_between_people_and_you():
    db = _seed()
    update_commitment("team-jordan", CommitmentUpdate(owner="manager"), auth=_auth(db))
    assert (_row(db, "team-jordan")["committed_by"], _row(db, "team-jordan")["direct_report_id"]) == ("manager", None)
    update_commitment("team-jordan", CommitmentUpdate(owner="direct_report", direct_report_id="dr-leah"), auth=_auth(db))
    assert (_row(db, "team-jordan")["committed_by"], _row(db, "team-jordan")["direct_report_id"]) == ("direct_report", "dr-leah")
    with pytest.raises(HTTPException) as exc:
        update_commitment("team-jordan", CommitmentUpdate(owner="direct_report", direct_report_id="dr-theirs"), auth=_auth(db))
    assert exc.value.status_code == 404


def test_a_counterpart_row_cannot_be_reassigned():
    db = _seed()
    with pytest.raises(HTTPException) as exc:
        update_commitment("boss-owes", CommitmentUpdate(owner="manager"), auth=_auth(db))
    assert exc.value.status_code == 422


def test_someone_elses_commitment_is_not_found():
    with pytest.raises(HTTPException) as exc:
        update_commitment("not-mine", CommitmentUpdate(status="done"), auth=_auth(_seed()))
    assert exc.value.status_code == 404


def test_an_empty_patch_is_refused():
    with pytest.raises(HTTPException) as exc:
        update_commitment("goal-mine", CommitmentUpdate(), auth=_auth(_seed()))
    assert exc.value.status_code == 422


# --- the team writer -------------------------------------------------------------

def test_team_page_add_names_who_owes_it():
    db = _seed()
    named = create_team_commitment(TeamCommitmentIn(description="Book the offsite", direct_report_id="dr-jordan"), auth=_auth(db))
    yours = create_team_commitment(TeamCommitmentIn(description="Open the req", direct_report_id=None), auth=_auth(db))
    assert _row(db, named["id"])["committed_by"] == "direct_report"
    assert _row(db, yours["id"])["committed_by"] == "manager"


def test_moving_a_team_row_to_you_keeps_its_team():
    db = _seed()
    _row(db, "team-jordan")["org_unit_id"] = None      # placed only through Jordan's team
    update_commitment("team-jordan", CommitmentUpdate(owner="manager"), auth=_auth(db))
    assert (_row(db, "team-jordan")["direct_report_id"], _row(db, "team-jordan")["org_unit_id"]) == (None, "ou-cs")
