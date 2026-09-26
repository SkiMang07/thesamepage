import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from routes.one_on_ones import (
    LogOneOnOneIn,
    NewCommitmentIn,
    _build_prep_prompt,
    _clean_follow_up_items,
    _next_occurrence_at,
    _serialize_session,
    log_one_on_one,
    parse_prep_output,
)


def _resolve(result):
    """Route handlers are plain `def` unless they await (file uploads), so a
    call returns either the value or a coroutine to run."""
    return asyncio.run(result) if asyncio.iscoroutine(result) else result


def test_session_status_is_derived_across_gathering_scheduled_prepped_completed():
    gathering = _serialize_session({
        "id": "gathering",
        "summary": None,
        "prep_guide": None,
        "scheduled_at": None,
        "carry_forward_items": ["Revisit scope"],
    })
    assert gathering["status"] == "gathering"
    assert gathering["display_summary"] == "Revisit scope"

    scheduled = _serialize_session({
        "id": "scheduled",
        "summary": None,
        "prep_guide": None,
        "scheduled_at": "2026-08-27T12:00:00+00:00",
        "carry_forward_items": ["Revisit scope"],
        "one_on_one_series": {"interval_weeks": 2, "timezone": "America/New_York", "active": True},
    })
    assert scheduled["status"] == "scheduled"
    assert scheduled["display_summary"] == "Revisit scope"
    assert scheduled["recurrence_weeks"] == 2

    planned = _serialize_session({
        "id": "planned",
        "summary": None,
        "prep_guide": {"situation_summary": "Renewal risk is rising"},
        "carry_forward_items": [],
    })
    assert planned["status"] == "planned"
    assert planned["display_summary"] == "Renewal risk is rising"

    completed = _serialize_session({
        "id": "completed",
        "summary": "Agreed on the recovery plan.",
        "prep_guide": None,
        "carry_forward_items": [],
    })
    assert completed["status"] == "completed"
    assert completed["display_summary"] == "Agreed on the recovery plan."


def test_meeting_date_is_the_scheduled_date_and_falls_back_to_row_creation():
    """scheduled_at is the meeting date. created_at is only the safety net for
    rows the 2026-08-28 backfill could not reach, and no surface should ever
    have to make that choice for itself again."""
    dated = _serialize_session({
        "id": "dated",
        "summary": "Talked through the territory plan.",
        "prep_guide": None,
        "carry_forward_items": [],
        "scheduled_at": "2026-08-26T12:00:00+00:00",
        "created_at": "2026-08-02T14:09:52+00:00",
    })
    assert dated["meeting_date"] == "2026-08-26T12:00:00+00:00"

    legacy = _serialize_session({
        "id": "legacy",
        "summary": "Talked through the territory plan.",
        "prep_guide": None,
        "carry_forward_items": [],
        "scheduled_at": None,
        "created_at": "2026-08-02T14:09:52+00:00",
    })
    assert legacy["meeting_date"] == "2026-08-02T14:09:52+00:00"


def test_next_occurrence_preserves_anchor_and_skips_past_dates():
    now = datetime(2026, 8, 23, 16, tzinfo=timezone.utc)
    assert _next_occurrence_at("2026-08-20T12:00:00Z", 2, now) == "2026-09-03T12:00:00+00:00"
    assert _next_occurrence_at("2026-07-30T12:00:00Z", 2, now) == "2026-08-27T12:00:00+00:00"


def test_follow_up_items_are_trimmed_deduplicated_and_bounded():
    items = ["  Revisit scope  ", "revisit scope", "", *[f"Topic {i}" for i in range(20)]]
    cleaned = _clean_follow_up_items(items)
    assert cleaned[0] == "Revisit scope"
    assert len(cleaned) == 10
    assert len({item.casefold() for item in cleaned}) == len(cleaned)


def test_confirmed_follow_ups_are_explicit_prep_grounding():
    prompt = _build_prep_prompt(
        report_name="Maya Chen",
        raw_notes="",
        open_commitments=[],
        recent_summaries=[],
        days_since_last=14,
        cadence_days=14,
        carry_forward_items=["Check whether the Acme risk changed"],
    )
    assert "CONFIRMED FOLLOW-UPS FROM THE LAST 1:1" in prompt
    assert "Check whether the Acme risk changed" in prompt
    assert "No additional notes were added" in prompt


def test_reviewed_workspace_signals_are_explicit_prep_grounding():
    prompt = _build_prep_prompt(
        report_name="Maya Chen",
        raw_notes="",
        open_commitments=[],
        recent_summaries=[],
        days_since_last=14,
        cadence_days=14,
        suggested_topics=["Development: explore a product rotation"],
    )
    assert "CURRENT SIGNALS SELECTED FOR THIS 1:1" in prompt
    assert "Development: explore a product rotation" in prompt


class _MemoryQuery:
    def __init__(self, client, table):
        self.client = client
        self.table = table
        self.filters = []
        self.operation = "select"
        self.values = None
        self.limit_count = None

    def select(self, *_args):
        return self

    def eq(self, field, value):
        self.filters.append(lambda row, f=field, v=value: row.get(f) == v)
        return self

    def is_(self, field, value):
        expected = None if value == "null" else value
        self.filters.append(lambda row, f=field, v=expected: row.get(f) is v)
        return self

    def limit(self, count):
        self.limit_count = count
        return self

    def order(self, *_args, **_kwargs):
        return self

    def update(self, values):
        self.operation = "update"
        self.values = values
        return self

    def insert(self, values):
        self.operation = "insert"
        self.values = values
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def execute(self):
        rows = self.client.rows[self.table]
        if self.table in self.client.fail_on and self.operation in self.client.fail_on[self.table]:
            raise RuntimeError(f"simulated {self.operation} failure on {self.table}")
        if self.operation == "insert":
            batch = self.values if isinstance(self.values, list) else [self.values]
            out = []
            for values in batch:
                inserted = {**values}
                inserted.setdefault("id", f"{self.table}-{len(rows) + 1}")
                inserted.setdefault("created_at", "2026-08-23T16:00:00+00:00")
                inserted.setdefault("summary", None)
                inserted.setdefault("prep_guide", None)
                inserted.setdefault("carry_forward_items", [])
                rows.append(inserted)
                out.append({**inserted})
            return SimpleNamespace(data=out)
        if self.operation == "delete":
            keep = [row for row in rows if not all(predicate(row) for predicate in self.filters)]
            removed = [row for row in rows if row not in keep]
            self.client.rows[self.table] = keep
            return SimpleNamespace(data=removed)

        matched = [row for row in rows if all(predicate(row) for predicate in self.filters)]
        if self.limit_count is not None:
            matched = matched[: self.limit_count]
        if self.operation == "update":
            for row in matched:
                row.update(self.values)
        return SimpleNamespace(data=[{**row} for row in matched])


class _MemoryClient:
    def __init__(self):
        # {table: {operation, ...}} — makes that call raise, to exercise the
        # partial-failure path.
        self.fail_on: dict[str, set[str]] = {}
        self.rows = {
            "one_on_ones": [
                {
                    "id": "current",
                    "manager_id": "manager",
                    "direct_report_id": "report",
                    "series_id": "series",
                    "scheduled_at": "2026-08-25T12:00:00+00:00",
                    "summary": None,
                    "prep_guide": {"situation_summary": "Current prep"},
                    "carry_forward_items": [],
                    "created_at": "2026-08-23T12:00:00+00:00",
                }
            ],
            "one_on_one_series": [
                {
                    "id": "series",
                    "manager_id": "manager",
                    "direct_report_id": "report",
                    "interval_weeks": 2,
                    "timezone": "America/New_York",
                    "active": True,
                    "anchor_at": "2026-08-25T12:00:00+00:00",
                }
            ],
            "commitments": [],
            "dr_capture_notes": [],
        }

    def table(self, name):
        return _MemoryQuery(self, name)


def test_logging_recurring_call_completes_current_and_starts_next_occurrence():
    client = _MemoryClient()
    result = _resolve(
        log_one_on_one(
            LogOneOnOneIn(
                direct_report_id="report",
                one_on_one_id="current",
                summary="Aligned on the recovery plan.",
                notes="Raw notes",
                new_commitments=[
                    NewCommitmentIn(
                        description="Send the recovery plan",
                        committed_by="manager",
                        due_date="2026-08-28",
                    )
                ],
                carry_forward_items=["Revisit renewal confidence"],
                meeting_date="2026-08-25",
            ),
            auth=("manager", client),
        )
    )

    assert result["meeting"]["status"] == "completed"
    assert result["meeting"]["meeting_date"] == "2026-08-25T12:00:00+00:00"
    assert result["meeting"]["logged_at"]
    assert result["next_session"]["status"] == "scheduled"
    # Two weeks on from the SCHEDULED date, stepping past any date already
    # gone — so the expectation is computed, not a hard-coded date that goes
    # stale (it did: "2026-09-08" failed from Sep 9 on).
    expected = datetime(2026, 8, 25, 12, tzinfo=timezone.utc) + timedelta(weeks=2)
    while expected <= datetime.now(timezone.utc):
        expected += timedelta(weeks=2)
    assert result["next_session"]["scheduled_at"] == expected.isoformat()
    assert result["next_session"]["carry_forward_items"] == ["Revisit renewal confidence"]
    assert client.rows["commitments"][0]["source_id"] == "current"


def test_logging_ad_hoc_call_completes_workspace_and_creates_undated_next_one():
    client = _MemoryClient()
    client.rows["one_on_ones"][0].update({
        "series_id": None,
        "scheduled_at": None,
        "prep_guide": None,
    })
    client.rows["one_on_one_series"] = []

    result = _resolve(
        log_one_on_one(
            LogOneOnOneIn(
                direct_report_id="report",
                summary="Talked through the new territory plan.",
                carry_forward_items=["Check how the territory transition landed"],
                meeting_date="2026-08-24",
            ),
            auth=("manager", client),
        )
    )

    assert result["meeting"]["id"] == "current"
    assert result["meeting"]["status"] == "completed"
    # The day the manager said they talked, not the day the workspace shell
    # happened to be created. This is the regression that filed an August 26
    # conversation under August 2.
    assert result["meeting"]["meeting_date"] == "2026-08-24T12:00:00+00:00"
    assert result["next_session"]["status"] == "gathering"
    assert result["next_session"]["scheduled_at"] is None
    assert result["next_session"]["carry_forward_items"] == [
        "Check how the territory transition landed"
    ]
    assert client.rows["dr_capture_notes"] == []


def test_ad_hoc_log_leaves_a_prepped_workspace_alone():
    """The destructive case. A manager who has prep saved for an upcoming 1:1
    and then logs a hallway chat used to have that prepped occurrence quietly
    marked completed with the hallway notes: the prep was gone and the chat
    was filed under the upcoming meeting's date. The ad-hoc path no longer
    consumes a prepped workspace — the conversation logs as its own
    occurrence, and the prep stays waiting where the manager left it."""
    client = _MemoryClient()

    result = _resolve(
        log_one_on_one(
            LogOneOnOneIn(
                direct_report_id="report",
                summary="Quick catch-up after standup.",
                carry_forward_items=["Circle back on the renewal"],
                meeting_date="2026-08-24",
            ),
            auth=("manager", client),
        )
    )

    assert result["meeting"]["id"] != "current"
    assert result["meeting"]["status"] == "completed"
    assert result["meeting"]["meeting_date"] == "2026-08-24T12:00:00+00:00"
    # Ad-hoc, so deliberately not one of the recurring slots.
    assert result["meeting"].get("series_id") is None

    workspace = next(row for row in client.rows["one_on_ones"] if row["id"] == "current")
    assert workspace["summary"] is None
    assert workspace["prep_guide"] == {"situation_summary": "Current prep"}
    assert workspace["scheduled_at"] == "2026-08-25T12:00:00+00:00"
    assert workspace["series_id"] == "series"
    # It is still the next conversation, so it collects the carry-forward.
    assert workspace["carry_forward_items"] == ["Circle back on the renewal"]
    assert result["next_session"]["id"] == "current"
    assert result["next_session"]["status"] == "planned"


def test_separate_occurrence_opts_out_even_when_the_workspace_is_unprepped():
    """"A different conversation" is the manager's answer, not an inference.
    An unprepped workspace would otherwise be consumed, so the flag has to be
    honoured on its own."""
    client = _MemoryClient()
    client.rows["one_on_ones"][0]["prep_guide"] = None

    result = _resolve(
        log_one_on_one(
            LogOneOnOneIn(
                direct_report_id="report",
                summary="Grabbed ten minutes before the offsite.",
                meeting_date="2026-08-21",
                separate_occurrence=True,
            ),
            auth=("manager", client),
        )
    )

    assert result["meeting"]["id"] != "current"
    workspace = next(row for row in client.rows["one_on_ones"] if row["id"] == "current")
    assert workspace["summary"] is None
    assert workspace["scheduled_at"] == "2026-08-25T12:00:00+00:00"


def test_explicit_workspace_id_still_completes_a_prepped_occurrence():
    """The other half of the same question. When the manager says "that is the
    meeting I prepped", the Log page sends the occurrence id and it completes
    normally — the guard above must not make a prepped meeting unloggable."""
    client = _MemoryClient()

    result = _resolve(
        log_one_on_one(
            LogOneOnOneIn(
                direct_report_id="report",
                one_on_one_id="current",
                summary="Ran the prepped agenda.",
                meeting_date="2026-08-25",
            ),
            auth=("manager", client),
        )
    )

    assert result["meeting"]["id"] == "current"
    assert result["meeting"]["status"] == "completed"
    assert result["next_session"]["id"] != "current"


def test_log_response_carries_the_saved_commitments_and_confirmed_topics():
    """The receipt is built from what was saved, not what was submitted: blank
    rows are dropped and each returned commitment is linked to the meeting."""
    client = _MemoryClient()
    result = _resolve(
        log_one_on_one(
            LogOneOnOneIn(
                direct_report_id="report",
                one_on_one_id="current",
                summary="Agreed the handoff owner.",
                new_commitments=[
                    NewCommitmentIn(description="Confirm the owner", committed_by="manager"),
                    NewCommitmentIn(description="   ", committed_by="manager"),
                    NewCommitmentIn(description="Test the checklist", committed_by="direct_report", due_date="2026-09-28"),
                ],
                carry_forward_items=["  How did the outline land? ", "How did the outline land?"],
                meeting_date="2026-09-25",
            ),
            auth=("manager", client),
        )
    )
    saved = result["commitments"]
    assert [c["description"] for c in saved] == ["Confirm the owner", "Test the checklist"]
    assert {c["source_type"] for c in saved} == {"one_on_one"}
    assert {c["source_id"] for c in saved} == {"current"}
    assert saved[1]["committed_by"] == "direct_report"
    assert result["carry_forward_items"] == ["How did the outline land?"]
    assert len(client.rows["commitments"]) == 2


def test_failed_commitment_write_undoes_the_completed_occurrence():
    """A failure after the meeting write must not leave a half-logged meeting
    that a retry can't complete: the prepared occurrence goes back to
    unfinished, with its prep and date, and nothing else is written."""
    client = _MemoryClient()
    client.fail_on = {"commitments": {"insert"}}
    before = {**client.rows["one_on_ones"][0]}
    try:
        _resolve(
            log_one_on_one(
                LogOneOnOneIn(
                    direct_report_id="report",
                    one_on_one_id="current",
                    summary="Aligned.",
                    new_commitments=[NewCommitmentIn(description="Send the plan")],
                    meeting_date="2026-09-20",
                ),
                auth=("manager", client),
            )
        )
        raise AssertionError("expected the log to fail")
    except Exception as exc:  # HTTPException
        assert getattr(exc, "status_code", None) == 500
    row = client.rows["one_on_ones"][0]
    assert row["summary"] is None
    assert row["scheduled_at"] == before["scheduled_at"]
    assert row["prep_guide"] == before["prep_guide"]
    assert len(client.rows["one_on_ones"]) == 1
    assert client.rows["commitments"] == []

    # The retry now succeeds against the same occurrence, once.
    client.fail_on = {}
    result = _resolve(
        log_one_on_one(
            LogOneOnOneIn(
                direct_report_id="report",
                one_on_one_id="current",
                summary="Aligned.",
                new_commitments=[NewCommitmentIn(description="Send the plan")],
                meeting_date="2026-09-20",
            ),
            auth=("manager", client),
        )
    )
    assert result["meeting"]["id"] == "current"
    assert len(client.rows["commitments"]) == 1


def test_failed_next_occurrence_write_removes_an_inserted_ad_hoc_meeting_and_its_commitments():
    client = _MemoryClient()
    client.fail_on = {"one_on_ones": {"update"}}
    try:
        _resolve(
            log_one_on_one(
                LogOneOnOneIn(
                    direct_report_id="report",
                    summary="Hallway chat.",
                    separate_occurrence=True,
                    new_commitments=[NewCommitmentIn(description="Share the doc")],
                ),
                auth=("manager", client),
            )
        )
        raise AssertionError("expected the log to fail")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 500
    # Only the original prepared occurrence remains, untouched.
    assert [row["id"] for row in client.rows["one_on_ones"]] == ["current"]
    assert client.rows["one_on_ones"][0]["summary"] is None
    assert client.rows["commitments"] == []


# ---------------------------------------------------------------------------
# The carried-forward opening line (B2)
# ---------------------------------------------------------------------------

def test_kept_opening_line_leads_the_prep_prompt():
    prompt = _build_prep_prompt(
        report_name="Maya Chen",
        raw_notes="",
        open_commitments=[],
        recent_summaries=[],
        days_since_last=14,
        cadence_days=14,
        carry_forward_items=["Renewal forecast"],
        opening_line="Last time we said the forecast by the 3rd. Where did it land?",
    )
    assert "SUGGESTED OPENING LINE" in prompt
    assert "Where did it land?" in prompt.body          # per-report, never in the cached prefix
    assert "SUGGESTED OPENING LINE" not in _build_prep_prompt(
        report_name="Maya Chen", raw_notes="", open_commitments=[], recent_summaries=[],
        days_since_last=14, cadence_days=14,
    )


def test_log_saves_the_kept_opening_line_on_the_next_occurrence():
    client = _MemoryClient()
    result = _resolve(
        log_one_on_one(
            LogOneOnOneIn(
                direct_report_id="report",
                one_on_one_id="current",
                summary="Aligned on the recovery plan.",
                opening_line="  Last time we agreed the recovery plan by Friday.   Where did it land? ",
                meeting_date="2026-08-25",
            ),
            auth=("manager", client),
        )
    )
    assert result["opening_line"] == "Last time we agreed the recovery plan by Friday. Where did it land?"
    assert result["next_session"]["opening_line"] == result["opening_line"]


def test_an_empty_opening_line_writes_nothing_and_keeps_an_existing_one():
    client = _MemoryClient()
    client.rows["one_on_ones"][0].update({"series_id": None, "scheduled_at": None, "prep_guide": None})
    client.rows["one_on_ones"].append({
        "id": "prepped-next", "manager_id": "manager", "direct_report_id": "report", "series_id": None,
        "scheduled_at": "2026-09-30T12:00:00+00:00", "summary": None, "prep_guide": {"situation_summary": "x"},
        "carry_forward_items": [], "opening_line": "Kept from before", "created_at": "2026-08-24T12:00:00+00:00",
    })
    client.rows["one_on_ones"][0]["prep_guide"] = {"situation_summary": "Current prep"}
    result = _resolve(
        log_one_on_one(
            LogOneOnOneIn(direct_report_id="report", summary="A hallway chat.", separate_occurrence=True,
                          opening_line="   "),
            auth=("manager", client),
        )
    )
    assert result["opening_line"] is None
    kept = [row for row in client.rows["one_on_ones"] if row["id"] == "prepped-next"][0]
    assert kept["opening_line"] == "Kept from before"


def test_prep_output_parser_takes_the_json_and_never_raises():
    summary, agenda = parse_prep_output(
        'Here you go:\n```json\n{"situation_summary": "S", "agenda_items": ['
        '{"title": "T", "rationale": "R", "suggested_questions": ["Q", 3]}, "junk"]}\n```'
    )
    assert summary == "S"
    assert agenda == [{"title": "T", "rationale": "R", "suggested_questions": ["Q", "3"]}]
    assert parse_prep_output("no json at all") == ("Unable to generate summary — please try again.", [])
    assert parse_prep_output("[1, 2]")[1] == []


def test_wrap_up_drafts_an_opening_line_and_allows_none(monkeypatch):
    import routes.one_on_ones as mod
    from routes.one_on_ones import WrapUpRequest, wrap_up_one_on_one

    class _One:
        def __getattr__(self, _name):
            return lambda *a, **k: self

        def execute(self):
            return SimpleNamespace(data={"name": "Maya"})

    client = SimpleNamespace(table=lambda _n: _One())
    replies = iter([
        '{"summary": "S", "commitments": [], "follow_up_items": [], '
        '"opening_line": "Last time we said the deck by the 3rd. Where did it land?"}',
        '{"summary": "S", "commitments": [], "follow_up_items": [], "opening_line": 7}',
    ])
    prompts = []
    monkeypatch.setattr(mod, "generate_text", lambda p, **k: prompts.append(p) or next(replies))
    # __wrapped__ skips the rate limiter, which needs a real Request.
    request = SimpleNamespace()
    draft = wrap_up_one_on_one.__wrapped__(request, WrapUpRequest(direct_report_id="r", raw_notes="n"), auth=("m", client))
    assert draft.opening_line == "Last time we said the deck by the 3rd. Where did it land?"
    assert "opening_line" in prompts[0].prefix and "don't forget" in prompts[0].prefix.lower()
    draft = wrap_up_one_on_one.__wrapped__(request, WrapUpRequest(direct_report_id="r", raw_notes="n"), auth=("m", client))
    assert draft.opening_line == ""
