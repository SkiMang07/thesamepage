from datetime import date

from mission_control_week import build_week, week_bounds

THU = date(2026, 9, 24)


def _noon(day: str) -> str:
    return f"{day}T12:00:00+00:00"


def _snapshot(**overrides):
    base = {
        "reports": [
            {"id": "r1", "name": "Beth Cambridge", "role_title": "CSM"},
            {"id": "r2", "name": "Jordan Breedlove", "role_title": None},
            {"id": "r3", "name": "David O'Brien", "role_title": None},
        ],
        "one_on_ones": [],
        "cadence": [],
        "team_meetings": [],
        "team_agenda_counts": {},
        "team_agenda_items": {},
        "outside_meetings": [],
        "outside_meeting_people": {},
        "outside_people": {},
        "commitments": [],
        "goals": [],
        "goal_check_ins": [],
        "projects": [],
        "coverage": {},
    }
    base.update(overrides)
    return base


def test_week_is_monday_to_sunday():
    assert week_bounds(THU) == (date(2026, 9, 21), date(2026, 9, 27))
    assert week_bounds(date(2026, 9, 27)) == (date(2026, 9, 21), date(2026, 9, 27))
    assert week_bounds(date(2026, 9, 28)) == (date(2026, 9, 28), date(2026, 10, 4))


def test_conversation_states_and_week_edges():
    snap = _snapshot(one_on_ones=[
        {"id": "a", "direct_report_id": "r1", "scheduled_at": _noon("2026-09-21"), "summary": "Talked", "prep_guide": None},
        {"id": "b", "direct_report_id": "r2", "scheduled_at": _noon("2026-09-24"), "summary": None, "prep_guide": {"agenda_items": [{"title": "Launch"}]}},
        {"id": "c", "direct_report_id": "r3", "scheduled_at": _noon("2026-09-25"), "summary": None, "prep_guide": None},
        {"id": "d", "direct_report_id": "r3", "scheduled_at": _noon("2026-09-22"), "summary": None, "prep_guide": None},
        {"id": "e", "direct_report_id": "r1", "scheduled_at": _noon("2026-09-27"), "summary": None, "prep_guide": None},
        {"id": "out", "direct_report_id": "r1", "scheduled_at": _noon("2026-09-28"), "summary": None, "prep_guide": None},
        {"id": "undated", "direct_report_id": "r1", "scheduled_at": None, "summary": None, "prep_guide": None},
        {"id": "archived", "direct_report_id": "gone", "scheduled_at": _noon("2026-09-23"), "summary": None, "prep_guide": None},
    ])
    week = build_week(snap, THU)
    by_id = {c["record_id"]: c for c in week["conversations"]}
    assert set(by_id) == {"a", "b", "c", "d", "e"}
    assert by_id["a"]["state"] == "completed"
    assert by_id["b"]["state"] == "prep_saved"
    assert by_id["b"]["href"] == "/app/reports/r2/prep?resume=b"
    assert by_id["b"]["agenda"] == ["Launch"]
    assert by_id["c"]["state"] == "to_prepare"
    assert by_id["d"]["state"] == "not_logged"
    # chronological order
    assert [c["date"] for c in week["conversations"]] == sorted(c["date"] for c in week["conversations"])


def test_team_and_outside_meetings_keep_their_shape():
    snap = _snapshot(
        team_meetings=[{"id": "t1", "scheduled_at": _noon("2026-09-24"), "summary": None, "agenda_note": None, "org_units": {"name": "CS"}}],
        team_agenda_counts={"t1": 2},
        team_agenda_items={"t1": ["Handoffs", "Hiring"]},
        outside_meetings=[
            {"id": "o1", "title": None, "kind": "one_on_one", "scheduled_at": _noon("2026-09-25"), "summary": None, "prep_guide": None},
            {"id": "o2", "title": "Launch sync", "kind": "group", "scheduled_at": _noon("2026-09-24"), "summary": None, "prep_guide": None},
        ],
        outside_meeting_people={"o1": ["p1"], "o2": ["p1", "p2"]},
        outside_people={"p1": {"id": "p1", "name": "Alex Chen"}, "p2": {"id": "p2", "name": "Eli Morgan"}},
    )
    week = build_week(snap, THU)
    by_id = {c["record_id"]: c for c in week["conversations"]}
    assert by_id["t1"]["kind"] == "team_meeting" and by_id["t1"]["state"] == "prep_saved"
    assert by_id["t1"]["title"] == "CS team meeting"
    assert by_id["o1"]["title"] == "Alex Chen" and by_id["o1"]["kind"] == "outside_one_on_one"
    assert by_id["o2"]["kind"] == "outside_group" and by_id["o2"]["participants"] == ["Alex Chen", "Eli Morgan"]


def test_commitment_cohort_is_exclusive_and_reconciles():
    commitments = [
        # mine
        {"id": "m1", "title": "Done this week", "direct_report_id": None, "committed_by": "manager", "status": "done", "due_date": None, "completed_at": "2026-09-22T15:00:00+00:00"},
        {"id": "m2", "title": "Done last week", "direct_report_id": None, "committed_by": "manager", "status": "done", "due_date": None, "completed_at": "2026-09-18T15:00:00+00:00"},
        {"id": "m3", "title": "Overdue", "direct_report_id": "r1", "committed_by": "manager", "status": "open", "due_date": "2026-09-22", "completed_at": None},
        {"id": "m4", "title": "Due today", "direct_report_id": None, "committed_by": "manager", "status": "open", "due_date": "2026-09-24", "completed_at": None},
        {"id": "m5", "title": "Due Sunday", "direct_report_id": None, "committed_by": "manager", "status": "open", "due_date": "2026-09-27", "completed_at": None},
        {"id": "m6", "title": "Due next week", "direct_report_id": None, "committed_by": "manager", "status": "open", "due_date": "2026-09-29", "completed_at": None},
        {"id": "m7", "title": "Undated", "direct_report_id": None, "committed_by": "manager", "status": "open", "due_date": None, "completed_at": None},
        {"id": "m8", "title": "Dropped", "direct_report_id": None, "committed_by": "manager", "status": "dropped", "due_date": None, "completed_at": "2026-09-22T15:00:00+00:00"},
        # team
        {"id": "t1", "title": "Team overdue", "direct_report_id": "r2", "committed_by": "direct_report", "status": "open", "due_date": "2026-09-01", "completed_at": None},
        {"id": "t2", "title": "Team done", "direct_report_id": "r3", "committed_by": "direct_report", "status": "done", "due_date": "2026-09-20", "completed_at": "2026-09-23T09:00:00+00:00"},
        {"id": "t3", "title": None, "description": None, "direct_report_id": "r3", "committed_by": "direct_report", "status": "open", "due_date": None, "completed_at": None},
        # excluded
        {"id": "x1", "title": "Counterpart", "direct_report_id": None, "committed_by": "counterpart", "status": "open", "due_date": "2026-09-22", "completed_at": None},
        {"id": "x2", "title": "Archived", "direct_report_id": "gone", "committed_by": "direct_report", "status": "open", "due_date": "2026-09-22", "completed_at": None},
    ]
    week = build_week(_snapshot(commitments=commitments), THU)
    records = week["commitments"]
    assert len({r["id"] for r in records}) == len(records)
    got = {(r["owner"], r["state"]): sorted(x["id"] for x in records if (x["owner"], x["state"]) == (r["owner"], r["state"])) for r in records}
    assert got[("mine", "completed")] == ["m1"]
    assert got[("mine", "overdue")] == ["m3"]
    assert got[("mine", "due")] == ["m4", "m5"]
    assert got[("team", "overdue")] == ["t1"]
    assert got[("team", "completed")] == ["t2"]
    assert week["undated_open_commitments"] == {"mine": 1, "team": 1}
    m3 = next(r for r in records if r["id"] == "m3")
    assert m3["owner_name"] == "You" and m3["about_name"] == "Beth Cambridge"


def test_goal_progress_only_from_real_check_ins():
    goals = [
        {"id": "g1", "title": "Launch", "level": "company", "status": "on_track", "due_date": None},
        {"id": "g2", "title": "Capacity baseline", "level": "team", "status": "active", "due_date": None},
        {"id": "g3", "title": "Training", "level": "team", "status": "at_risk", "due_date": None},
        {"id": "g4", "title": "Zero is real", "level": "individual", "status": "on_track", "direct_report_id": "r1", "due_date": None},
        {"id": "g5", "title": "Done", "level": "company", "status": "completed", "due_date": None},
    ]
    check_ins = [
        {"goal_id": "g1", "status": "on_track", "progress": 65, "note": "Checklist done", "created_at": "2026-09-23T10:00:00+00:00"},
        {"goal_id": "g1", "status": "on_track", "progress": 40, "note": None, "created_at": "2026-09-10T10:00:00+00:00"},
        # note-only check-in newer than the percentage
        {"goal_id": "g3", "status": "at_risk", "progress": None, "note": "Scope changed", "created_at": "2026-09-22T10:00:00+00:00"},
        {"goal_id": "g3", "status": "at_risk", "progress": 35, "note": None, "created_at": "2026-09-01T10:00:00+00:00"},
        {"goal_id": "g4", "status": "on_track", "progress": 0, "note": None, "created_at": "2026-09-20T10:00:00+00:00"},
    ]
    week = build_week(_snapshot(goals=goals, goal_check_ins=check_ins), THU)
    by_id = {g["id"]: g for g in week["goals"]}
    assert "g5" not in by_id
    assert by_id["g1"]["progress"] == 65 and by_id["g1"]["progress_at"] == "2026-09-23" and by_id["g1"]["trend"] == "up"
    assert by_id["g2"]["progress"] is None and by_id["g2"]["last_check_in_at"] is None and by_id["g2"]["stale"]
    assert by_id["g3"]["progress"] == 35 and by_id["g3"]["progress_at"] == "2026-09-01"
    assert by_id["g3"]["last_check_in_at"] == "2026-09-22" and not by_id["g3"]["stale"]
    assert by_id["g4"]["progress"] == 0  # a recorded 0 is not "not recorded"
    assert week["goals"][0]["id"] == "g3"  # at risk leads


def test_unscheduled_due_excludes_people_with_a_date():
    cadence = [
        {"direct_report_id": "r1", "name": "Beth Cambridge", "is_due": True, "planned_session": None, "days_since_last": 30, "cadence_days": 21, "cadence_source": "default"},
        {"direct_report_id": "r2", "name": "Jordan Breedlove", "is_due": True, "planned_session": {"meeting_date": _noon("2026-10-02")}},
        {"direct_report_id": "r3", "name": "David O'Brien", "is_due": False, "planned_session": None},
    ]
    week = build_week(_snapshot(cadence=cadence), THU)
    assert [p["direct_report_id"] for p in week["unscheduled_due"]] == ["r1"]


class _Q:
    def __init__(self, client, name):
        self.client, self.name = client, name

    def __getattr__(self, attr):
        if attr in {"select", "eq", "neq", "is_", "gte", "lt", "lte", "in_", "order", "limit"}:
            def chain(*args, **kwargs):
                self.client.calls.append((self.name, attr, args))
                return self
            return chain
        raise AttributeError(attr)

    def insert(self, *_a, **_k):
        raise AssertionError("week view must not insert")

    def update(self, *_a, **_k):
        raise AssertionError("week view must not update")

    def delete(self, *_a, **_k):
        raise AssertionError("week view must not delete")

    def execute(self):
        class R:
            pass
        r = R()
        r.data = self.client.data.get(self.name, [])
        return r


class _Client:
    def __init__(self, data):
        self.data, self.calls = data, []

    def table(self, name):
        return _Q(self, name)


def test_week_route_is_read_only_and_reports_coverage():
    from routes.dashboard import get_week_in_focus

    client = _Client({
        "direct_reports": [{"id": "r1", "name": "Beth Cambridge", "role_title": None, "one_on_one_cadence_days": None}],
        "one_on_ones": [{"id": "a", "direct_report_id": "r1", "scheduled_at": "2026-09-22T12:00:00+00:00", "summary": "ok", "prep_guide": None, "carry_forward_items": [], "created_at": "2026-09-01T00:00:00+00:00"}],
        "users": [],
    })
    result = get_week_in_focus(local_date=date.today().isoformat(), auth=("u1", client))
    assert set(result["coverage"].values()) == {"ok"}, result["coverage"]
    assert "commitments" in result and "goals" in result
    assert all(call[0] != "mission_control_events" for call in client.calls)
