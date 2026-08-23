import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from routes.dashboard import MissionControlEventIn, MissionControlEventsIn, record_mission_control_events


class _Result:
    def __init__(self, data):
        self.data = data


class _AppendOnlyClient:
    def __init__(self):
        self.tables = []
        self.inserted = []

    def table(self, name):
        self.tables.append(name)
        if name != "mission_control_events":
            raise AssertionError(f"Disposition touched source table {name}")
        return _AppendOnlyQuery(self)


class _AppendOnlyQuery:
    def __init__(self, client):
        self.client = client

    def insert(self, rows):
        self.client.inserted.extend(rows)
        return self

    def update(self, *_args, **_kwargs):
        raise AssertionError("Disposition attempted an update")

    def delete(self, *_args, **_kwargs):
        raise AssertionError("Disposition attempted a delete")

    def execute(self):
        return _Result(
            [
                {**row, "id": str(uuid.uuid4())}
                for row in self.client.inserted
            ]
        )


def _event(event_type: str, snoozed_until: str | None = None) -> MissionControlEventIn:
    return MissionControlEventIn(
        brief_id=str(uuid.uuid4()),
        event_type=event_type,
        candidate_key="commitment_follow_up:person-id",
        evidence_fingerprint="abc123",
        candidate_type="commitment_follow_up",
        entity_type="direct_report",
        entity_id=str(uuid.uuid4()),
        rank=1,
        score=35,
        snoozed_until=snoozed_until,
        metadata={"reason_codes": ["due_commitments"], "private_note": "must be dropped"},
    )


def test_dispositions_only_append_events_and_never_mutate_source_records():
    client = _AppendOnlyClient()
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    body = MissionControlEventsIn(
        events=[
            _event("addressed"),
            _event("snoozed", tomorrow),
            _event("not_relevant"),
        ]
    )

    result = asyncio.run(
        record_mission_control_events(body, auth=(str(uuid.uuid4()), client))
    )

    assert client.tables == ["mission_control_events"]
    assert [row["event_type"] for row in client.inserted] == ["addressed", "snoozed", "not_relevant"]
    assert all("private_note" not in row["metadata"] for row in client.inserted)
    assert len(result["events"]) == 3
