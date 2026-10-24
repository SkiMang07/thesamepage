#!/usr/bin/env python3
"""
eval/test_wrapup_transcript.py — the 1:1 wrap-up drafting from notes plus a
call transcript, against the real model (call transcription session 4).

Three fictional calls, run through the real /wrapup route on an in-memory
database (no Supabase):

  1. two_track     the manager's mic and the report's call tab. Owners must
                   come from the speaker labels; a "we should sometime" must
                   not become a commitment.
  2. mic_only      one microphone heard both people. Every commitment from
                   the call must ask the manager to confirm its owner; one
                   that is only in the notes keeps its owner.
  3. off_record    a two-track call with an off-the-record stretch. Nothing
                   said in it, and nothing in the off-the-record notes, may
                   reach the prompt; a commitment made inside it must not be
                   drafted; the ones around it must.

Usage:
  cd <repo-root>
  python eval/test_wrapup_transcript.py

Requires ANTHROPIC_API_KEY (backend/.env or the shell). Exit 0 when every
check passes, 1 otherwise.
"""
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

_ENV_PATH = Path(__file__).parent.parent / "backend" / ".env"
try:
    from dotenv import load_dotenv as _load_dotenv
    if _ENV_PATH.exists():
        _load_dotenv(_ENV_PATH, override=True)
except ImportError:
    pass

if not os.environ.get("ANTHROPIC_API_KEY") or os.environ["ANTHROPIC_API_KEY"] in ("test",) or os.environ["ANTHROPIC_API_KEY"].startswith("your-"):
    print("\nERROR: ANTHROPIC_API_KEY not set (backend/.env or the shell).\n", file=sys.stderr)
    sys.exit(1)
for _k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    if not os.environ.get(_k):
        os.environ[_k] = f"https://dummy.{_k.lower()}.invalid"

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import routes.one_on_ones as mod  # noqa: E402
from routes.one_on_ones import WrapUpRequest, wrap_up_one_on_one  # noqa: E402

REPORT = "Jordan Lee"
OFF_RECORD_SPEECH = "Marisol Quintero"          # said only inside the off-the-record stretch
OFF_RECORD_NOTE = "Tarrant Valley relocation"    # typed only as an off-the-record note


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.single_row, self.n = db, table, [], False, None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, value):
        self.filters.append((col, value))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self.n = n
        return self

    def single(self):
        self.single_row = True
        return self

    def update(self, values):
        self.values = values
        return self

    def execute(self):
        rows = [r for r in self.db[self.table] if all(r.get(c) == v for c, v in self.filters)]
        if self.single_row:
            return SimpleNamespace(data=rows[0] if rows else None)
        return SimpleNamespace(data=[dict(r) for r in rows[: self.n or None]])


def _db(segments, gaps):
    return {
        "direct_reports": [{"id": "report", "manager_id": "manager", "name": REPORT}],
        "one_on_ones": [{"id": "meeting", "manager_id": "manager", "direct_report_id": "report"}],
        "call_transcripts": [{
            "id": "t1", "owner_id": "manager", "one_on_one_id": "meeting", "team_meeting_id": None,
            "outside_meeting_id": None, "status": "ready", "capture_mode": "tab",
            "started_at": "2026-10-23T16:00:00+00:00", "ended_at": "2026-10-23T16:32:00+00:00",
        }],
        "call_transcript_segments": [
            {"seq": 0, "track": track, "owner_id": "manager", "transcript_id": "t1", "offset_ms": 0,
             "lines": [{"t_ms": t, "text": text} for t, text in lines]}
            for track, lines in segments.items()
        ],
        "call_transcript_gaps": [{"transcript_id": "t1", **g} for g in gaps],
    }


def m(minutes, seconds=0):
    return (minutes * 60 + seconds) * 1000


CASES = {
    "two_track": {
        "notes": "Northwind renewal: not shopping around, they want a usage review first. This is the big one.\nQBR template pilot went well with Bluepeak.",
        "segments": {
            "self": [
                (m(0, 20), "Morning. How was the week?"),
                (m(2, 5), "Let's start with Northwind. What's the real story on the renewal?"),
                (m(3, 40), "Can you pull together the usage review for them?"),
                (m(8, 10), "And I'll send you the QBR deck from the offsite by Friday so you can reuse the charts."),
                (m(14, 2), "On the team-lead thing, we should think about that sometime. No rush."),
                (m(20, 30), "Great. Anything else?"),
            ],
            "other": [
                (m(1, 0), "Busy but good. Bluepeak loved the one-page QBR template."),
                (m(2, 40), "They're not shopping around. They just want proof people use it before they sign."),
                (m(3, 55), "Yes, I'll have the usage review ready by next Wednesday."),
                (m(9, 0), "That would help a lot, thanks."),
                (m(15, 0), "Sure, maybe next quarter."),
                (m(21, 0), "Could you introduce me to Priya on the product team?"),
                (m(21, 30), "I want to ask her about the usage dashboard."),
            ],
        },
        "extra_self": [(m(21, 15), "Yes, I'll do that intro this week.")],
        "gaps": [],
        "expect": [
            {"match": ["usage review"], "committed_by": "direct_report", "due": True},
            {"match": ["deck"], "committed_by": "manager", "due": True},
            {"match": ["priya"], "committed_by": "manager"},
        ],
        "forbid": ["team-lead", "team lead"],
        "mic_only": False,
    },
    "mic_only": {
        "notes": "In person, coffee. Onboarding checklist is out of date.\nMe: book the training budget review with finance.",
        "segments": {
            "mixed": [
                (m(0, 30), "Thanks for grabbing coffee."),
                (m(1, 10), "The onboarding checklist is really out of date, new hires keep asking me things it should cover."),
                (m(1, 40), "Could you send me the current version so I can mark it up?"),
                (m(1, 50), "Yes, I'll send it to you this afternoon."),
                (m(4, 0), "And I'll rewrite the first-week section by the end of next week."),
                (m(4, 20), "Perfect, that's the part that matters most."),
            ],
        },
        "gaps": [],
        "expect": [
            {"match": ["checklist"], "unsure": True, "source": "call"},
            {"match": ["first-week", "first week"], "unsure": True, "source": "call"},
            {"match": ["training budget"], "committed_by": "manager", "unsure": False, "source": "notes"},
        ],
        "forbid": [],
        "mic_only": True,
    },
    "off_record": {
        "notes": "Renewals: Acme is fine, Globex at risk.",
        "private_notes": f"{OFF_RECORD_NOTE}. Check in quietly next month.",
        "segments": {
            "self": [
                (m(1, 0), "How are the renewals looking?"),
                (m(3, 0), "Can you send me the Globex risk summary by Thursday?"),
                (m(12, 30), f"I'm sorry to hear about {OFF_RECORD_SPEECH}. I'll cover your on-call shifts in November."),
                (m(18, 0), "Back on the record. I'll set up a call with the Globex sponsor next week."),
            ],
            "other": [
                (m(2, 0), "Acme signed. Globex is wobbly, their champion left."),
                (m(3, 20), "Yes, I'll get you the risk summary by Thursday."),
                (m(11, 0), f"Can we go off the record? It's about {OFF_RECORD_SPEECH}, my sister."),
                (m(13, 0), "Thank you, that really helps."),
                (m(18, 30), "Great, I'll join that call."),
            ],
        },
        "gaps": [{"start_ms": m(10, 30), "end_ms": m(17, 0), "kind": "off_record"}],
        "expect": [
            {"match": ["risk summary"], "committed_by": "direct_report", "due": True},
            {"match": ["sponsor"], "committed_by": "manager"},
        ],
        "forbid": ["on-call", "on call", "november"],
        "mic_only": False,
    },
}


def run_case(name, case):
    segments = {k: list(v) for k, v in case["segments"].items()}
    if case.get("extra_self"):
        segments["self"] = sorted(segments["self"] + case["extra_self"])
    db = _db(segments, case["gaps"])
    prompts = []
    real = mod.generate_text

    def capture(prompt, **kw):
        prompts.append(prompt)
        return real(prompt, **kw)

    mod.generate_text = capture
    try:
        # The meeting screen sends call notes only. The off-the-record note is
        # offered as an extra field to prove the request can't carry it.
        req = WrapUpRequest.model_validate({
            "direct_report_id": "report", "raw_notes": case["notes"], "transcript_id": "t1",
            **({"private_notes": case["private_notes"]} if case.get("private_notes") else {}),
        })
        draft = wrap_up_one_on_one.__wrapped__(SimpleNamespace(), req, auth=("manager", SimpleNamespace(table=lambda n: _Query(db, n))))
    finally:
        mod.generate_text = real

    failures = []
    prompt = str(prompts[0]) if prompts else ""
    for secret in (OFF_RECORD_SPEECH, OFF_RECORD_NOTE):
        if secret in prompt:
            failures.append(f"off-the-record text reached the prompt: {secret!r}")

    if bool(draft.transcript and draft.transcript.mic_only) != case["mic_only"]:
        failures.append(f"mic_only should be {case['mic_only']}")

    found = []
    for exp in case["expect"]:
        hits = [c for c in draft.commitments if any(k in c.description.lower() for k in exp["match"])]
        if not hits:
            failures.append(f"missing commitment matching {exp['match']}")
            continue
        c = hits[0]
        found.append(c)
        if "committed_by" in exp and c.committed_by != exp["committed_by"]:
            failures.append(f"{c.description!r}: committed_by {c.committed_by}, expected {exp['committed_by']}")
        if "unsure" in exp and c.owner_unsure != exp["unsure"]:
            failures.append(f"{c.description!r}: owner_unsure {c.owner_unsure}, expected {exp['unsure']}")
        if "source" in exp and c.source != exp["source"]:
            failures.append(f"{c.description!r}: source {c.source}, expected {exp['source']}")
        if exp.get("due") and not c.due_date:
            failures.append(f"{c.description!r}: a stated deadline came back without a due date")
        if c.source == "call" and c.source_ms is None:
            failures.append(f"{c.description!r}: from the call but no time")
    for c in draft.commitments:
        if any(f in c.description.lower() for f in case["forbid"]):
            failures.append(f"drafted a commitment it shouldn't have: {c.description!r}")
    if not draft.summary.strip():
        failures.append("empty summary")
    return draft, failures


def main():
    total_fail = 0
    for name, case in CASES.items():
        draft, failures = run_case(name, case)
        status = "PASS" if not failures else "FAIL"
        print(f"\n[{status}] {name}")
        print(f"  summary: {draft.summary}")
        for c in draft.commitments:
            where = f"call {c.source_ms // 1000}s" if c.source == "call" and c.source_ms is not None else (c.source or "-")
            print(f"  - {c.committed_by:13} {'?' if c.owner_unsure else ' '} {c.due_date or '----------'}  [{where}] {c.description}")
        print(f"  follow-ups: {json.dumps(draft.follow_up_items)}")
        for f in failures:
            print(f"  ✗ {f}")
        total_fail += len(failures)
    print(f"\n{'All checks passed' if not total_fail else f'{total_fail} check(s) failed'}.")
    sys.exit(0 if not total_fail else 1)


if __name__ == "__main__":
    main()
