import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

from routes.one_on_ones import (
    LogOneOnOneIn,
    NewCommitmentIn,
    _build_prep_prompt,
    _clean_follow_up_items,
    _next_occurrence_at,
    _serialize_session,
    log_one_on_one,
)


def test_session_status_is_derived_across_scheduled_prepped_completed():
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

    def update(self, values):
        self.operation = "update"
        self.values = values
        return self

    def insert(self, values):
        self.operation = "insert"
        self.values = values
        return self

    def execute(self):
        rows = self.client.rows[self.table]
        if self.operation == "insert":
            inserted = {**self.values}
            inserted.setdefault("id", f"{self.table}-{len(rows) + 1}")
            inserted.setdefault("created_at", "2026-08-23T16:00:00+00:00")
            inserted.setdefault("summary", None)
            inserted.setdefault("prep_guide", None)
            inserted.setdefault("carry_forward_items", [])
            rows.append(inserted)
            return SimpleNamespace(data=[{**inserted}])

        matched = [row for row in rows if all(predicate(row) for predicate in self.filters)]
        if self.limit_count is not None:
            matched = matched[: self.limit_count]
        if self.operation == "update":
            for row in matched:
                row.update(self.values)
        return SimpleNamespace(data=[{**row} for row in matched])


class _MemoryClient:
    def __init__(self):
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
    result = asyncio.run(
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
            ),
            auth=("manager", client),
        )
    )

    assert result["meeting"]["status"] == "completed"
    assert result["next_session"]["status"] == "scheduled"
    assert result["next_session"]["scheduled_at"] == "2026-09-08T12:00:00+00:00"
    assert result["next_session"]["carry_forward_items"] == ["Revisit renewal confidence"]
    assert client.rows["commitments"][0]["source_id"] == "current"
