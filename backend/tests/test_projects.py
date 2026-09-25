"""Projects — the retry-safe check-in write, link ownership checks and the
manager's private next move. Reuses the in-memory Supabase stand-in from
test_goals. The SQL function, the one-open index and RLS are verified against
local Postgres (see docs/systems/projects.md)."""
import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

import routes.projects as projects
from test_goals import _DB, _Query, _Result, _Rpc

ME = "manager-1"
OTHER = "manager-2"


class _FTQuery(_Query):
    """Adds the partial unique index (one open move per owner + project)."""

    def execute(self):
        if self.name == "project_follow_throughs" and self.op in ("insert", "update"):
            table = self.db.tables.setdefault(self.name, [])
            if self.op == "insert":
                candidates = [dict(r) for r in self.payload]
                others = table
            else:
                match = [r for r in table if all(f(r) for f in self.filters)]
                candidates = [{**r, **self.payload} for r in match]
                ids = {r["id"] for r in match}
                others = [r for r in table if r["id"] not in ids]
            for c in candidates:
                if c.get("status", "open") == "open" and any(
                    o["status"] == "open" and o["owner_id"] == c["owner_id"] and o["project_id"] == c["project_id"]
                    for o in others
                ):
                    raise APIError({"code": "23505", "message": "duplicate key"})
        if self.db.fail_table == self.name:
            raise APIError({"code": "42P01", "message": "relation does not exist"})
        return super().execute()


class _ProjectRpc(_Rpc):
    def execute(self):
        self.db.rpc_calls.append((self.name, self.params))
        if self.db.rpc_error:
            raise APIError(self.db.rpc_error)
        return _Result([{
            "id": "ci-new", "goal_id": None, "project_id": self.params["p_project_id"],
            "status": self.params["p_status"], "progress": self.params["p_progress"],
            "note": self.params["p_note"], "created_at": "2026-09-25T12:00:00+00:00",
        }])


class _PDB(_DB):
    fail_table = None

    def table(self, name):
        return _FTQuery(self, name)

    def rpc(self, name, params):
        return _ProjectRpc(self, name, params)


def _seed():
    return _PDB({
        "direct_reports": [
            {"id": "dr-maya", "manager_id": ME, "name": "Maya"},
            {"id": "dr-theirs", "manager_id": OTHER, "name": "Theirs"},
        ],
        "goals": [
            {"id": "g-mine", "owner_id": ME, "title": "Consistent handoffs"},
            {"id": "g-theirs", "owner_id": OTHER, "title": "Not yours"},
        ],
        "org_units": [{"id": "ou-cs", "name": "Customer Success", "unit_type": "team"}],
        "projects": [
            {"id": "p-mine", "owner_id": ME, "title": "Handoff", "status": "at_risk", "created_at": "2026-09-01"},
            {"id": "p-closed", "owner_id": ME, "title": "Guide", "status": "completed", "created_at": "2026-08-01"},
            {"id": "p-theirs", "owner_id": OTHER, "title": "Theirs", "status": "active", "created_at": "2026-09-01"},
        ],
        "check_ins": [],
        "project_follow_throughs": [],
    })


def _auth(db):
    return (ME, db)


def _body(**kw):
    return projects.ProjectIn(**{"title": "A project", "status": "active", **kw})


# --- check-in write ---------------------------------------------------------------

def test_check_in_goes_through_the_transactional_function_with_zero_kept():
    db = _seed()
    key = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
    row = projects.create_project_check_in(
        "p-mine", projects.ProjectCheckInIn(status="on_track", progress=0, note="reset", client_request_id=key),
        auth=_auth(db),
    )
    name, params = db.rpc_calls[0]
    assert name == "record_project_check_in"
    assert params["p_progress"] == 0 and params["p_client_request_id"] == key
    assert row["progress"] == 0
    # Status write-through happens inside the function, never as a second call.
    assert ("check_ins", "insert") not in db.queries and ("projects", "update") not in db.queries


def test_scribe_style_body_without_a_key_still_works():
    db = _seed()
    projects.create_project_check_in("p-mine", projects.ProjectCheckInIn(status="at_risk", note="x"), auth=_auth(db))
    params = db.rpc_calls[0][1]
    assert params["p_client_request_id"] is None and params["p_progress"] is None


@pytest.mark.parametrize("code,status", [("22023", 422), ("P0002", 404)])
def test_function_errors_become_clear_http_errors(code, status):
    db = _seed()
    db.rpc_error = {"code": code, "message": "Project not found"}
    with pytest.raises(HTTPException) as exc:
        projects.create_project_check_in("p-theirs", projects.ProjectCheckInIn(status="on_track"), auth=_auth(db))
    assert exc.value.status_code == status


def test_out_of_range_completion_is_refused_before_writing():
    db = _seed()
    with pytest.raises(HTTPException) as exc:
        projects.create_project_check_in("p-mine", projects.ProjectCheckInIn(status="on_track", progress=101), auth=_auth(db))
    assert exc.value.status_code == 422 and db.rpc_calls == []


def test_status_only_edit_adds_no_check_in():
    db = _seed()
    projects.update_project_status("p-mine", projects.ProjectStatusUpdate(status="on_track"), auth=_auth(db))
    assert db.tables["check_ins"] == [] and db.rpc_calls == []


# --- links are the caller's own --------------------------------------------------

@pytest.mark.parametrize("field,value", [("direct_report_id", "dr-theirs"), ("goal_id", "g-theirs"), ("org_unit_id", "ou-missing")])
def test_links_to_records_you_cannot_see_are_refused(field, value):
    db = _seed()
    with pytest.raises(HTTPException) as exc:
        projects.create_project(_body(**{field: value}), auth=_auth(db))
    assert exc.value.status_code == 422
    assert len(db.tables["projects"]) == 3


def test_own_links_standalone_and_cleared_dates_are_accepted():
    db = _seed()
    projects.create_project(_body(direct_report_id="dr-maya", goal_id="g-mine", org_unit_id="ou-cs"), auth=_auth(db))
    row = projects.update_project("p-mine", _body(title="  Renamed  ", due_date="", goal_id=None), auth=_auth(db))
    assert row["title"] == "Renamed" and row["due_date"] is None and row["goal_id"] is None


def test_blank_title_is_refused():
    with pytest.raises(HTTPException):
        projects.create_project(_body(title="   "), auth=_auth(_seed()))


# --- private follow-through ------------------------------------------------------

def _ft(db, project="p-mine", text="Agree first-call ownership"):
    return projects.create_project_follow_through(project, projects.FollowThroughIn(body=text), auth=_auth(db))


def test_next_move_is_owner_scoped():
    db = _seed()
    with pytest.raises(HTTPException) as exc:
        _ft(db, project="p-theirs")
    assert exc.value.status_code == 404
    assert db.tables["project_follow_throughs"] == []


def test_one_open_move_retry_returns_it_and_different_text_is_refused():
    db = _seed()
    first = _ft(db)
    assert first["status"] == "open" and first["owner_id"] == ME
    assert _ft(db)["id"] == first["id"]  # a retried submit
    with pytest.raises(HTTPException) as exc:
        _ft(db, text="Something else")
    assert exc.value.status_code == 409
    assert len(db.tables["project_follow_throughs"]) == 1


def test_done_then_next_keeps_the_completed_move_and_never_touches_status():
    db = _seed()
    first = _ft(db)
    done = projects.update_project_follow_through(first["id"], projects.FollowThroughUpdate(status="done"), auth=_auth(db))
    assert done["status"] == "done" and done["completed_at"]
    second = _ft(db, text="Confirm the pilot date")
    history = projects.list_project_follow_through("p-mine", auth=_auth(db))
    assert [h["id"] for h in history][0] == second["id"] and len(history) == 2
    assert db.tables["projects"][0]["status"] == "at_risk"
    assert ("projects", "update") not in db.queries


def test_reopen_conflicting_with_a_newer_open_move_is_refused():
    db = _seed()
    first = _ft(db)
    projects.update_project_follow_through(first["id"], projects.FollowThroughUpdate(status="done"), auth=_auth(db))
    _ft(db, text="Newer move")
    with pytest.raises(HTTPException) as exc:
        projects.update_project_follow_through(first["id"], projects.FollowThroughUpdate(status="open"), auth=_auth(db))
    assert exc.value.status_code == 409


def test_someone_elses_move_cannot_be_changed():
    db = _seed()
    db.tables["project_follow_throughs"].append(
        {"id": "ft-x", "owner_id": OTHER, "project_id": "p-theirs", "body": "x", "status": "open", "completed_at": None}
    )
    with pytest.raises(HTTPException) as exc:
        projects.update_project_follow_through("ft-x", projects.FollowThroughUpdate(status="done"), auth=_auth(db))
    assert exc.value.status_code == 404


def test_list_attaches_open_moves_including_on_closed_projects():
    db = _seed()
    _ft(db, project="p-closed", text="Send the thank-you note")
    rows = {r["id"]: r for r in projects.list_projects(auth=_auth(db))}
    assert rows["p-closed"]["next_move"]["body"] == "Send the thank-you note"
    assert rows["p-mine"]["next_move"] is None and rows["p-mine"]["next_move_available"] is True
    assert "p-theirs" not in rows


def test_follow_through_read_failure_is_unavailable_not_empty():
    db = _seed()
    db.fail_table = "project_follow_throughs"
    rows = projects.list_projects(auth=_auth(db))
    assert rows and all(r["next_move_available"] is False for r in rows)
