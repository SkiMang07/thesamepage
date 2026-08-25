# Mission Control (`/app/dashboard`)

The authenticated landing page is a manager's action brief. It chooses one
deterministic Suggested focus, up to two quieter secondary priorities, and one
factual progress or all-clear signal. The persistent sidebar owns wayfinding;
Mission Control no longer duplicates it with a zone map.

## Management runway

The mature brief presents its ranked candidates as a selectable management
runway: **Now**, **Next**, and **Watch**. The labels expose the existing rank as
a suggested sequence without turning it into a mandatory task queue; the
manager can select any candidate and act in a different order. Selection is
presentation state only — it does not rerank candidates, write a disposition,
or change an underlying source record.

Only the selected candidate opens into the feature surface. Its deterministic
evidence is visible before interaction, while `Why this?` expands the complete
source, freshness, ranking basis, boundaries, and optional AI paraphrase. The
exact-workflow CTA and Addressed / Snooze / Not relevant controls retain their
existing event semantics.

Below the runway, a compact conversation runway keeps the current 1:1 rhythm
visible beside the factual truth signal. Recent recorded changes remain quieter
supporting context below both. This hierarchy replaces the former peer-card
composition; it does not change candidate eligibility, ranking, or coverage.

Frontend: `frontend/app/app/dashboard/page.tsx` and
`frontend/components/mission-control/ActionBrief.tsx`.
Backend: `backend/routes/dashboard.py` and
`backend/mission_control_engine.py`.

## Brief and ranking

`GET /api/dashboard/brief` loads conversations, commitments, goals, projects,
check-ins, expectations coverage, logged time off, and prior dispositions
independently. Each domain reports `ok`, `partial`, or `unavailable`; incomplete
core coverage can never produce an all-clear.

The pure engine establishes eligibility before ranking:

- saved 1:1 prep;
- due 1:1 prep from the existing per-person/org/default cadence;
- open dated commitments due within seven days;
- active goals/projects that are explicitly at risk, due within 14 days,
  stale beyond 14 days, or inconsistent with their latest check-in.

Missing dates never become urgent. Capacity never creates a candidate: actual
logged time off can only corroborate an already-eligible dated commitment.
Assessment scores, capture-note content, private 1:1 notes, and inferred employee
risk do not enter the brief.

Scheduled dates now come from the recurring 1:1 workflow. A saved prep with a
date uses that fact directly and no longer carries the old "no scheduled meeting
date" boundary. A date-only scheduled shell without a generated prep sheet is
visible on `/app/1-1s`, but does not become a Mission Control candidate by
itself; cadence still determines whether starting prep needs attention.

Eligible items share one domain-neutral score based on date urgency, explicit
status/integrity, staleness, saved-prep momentum, corroboration, and whether the
CTA opens the exact workflow. Ties break by strongest date bucket, evidence
count, exact-workflow availability, oldest attention date, then stable candidate
key. Person items deduplicate to one action; a linked goal/project review chain
uses one slot. The engine is clock-injected and AI-free, so identical records and
local date always return the same order.

## Evidence and AI boundary

Every candidate includes factual evidence, fixed source labels, computed
freshness, human-readable rank components, and any relevant boundary (for
example, default cadence or logged-time-off limits). `Why this?` exposes these
deterministic facts.

`POST /api/dashboard/explain` is optional and rate-limited. It recomputes the
candidate and exact evidence fingerprint before asking the light model for a
one-sentence paraphrase. AI cannot select, reorder, add facts, infer causes, or
write a source record. Failure leaves the deterministic brief unchanged.

## Dispositions and analytics

`mission_control_events` is append-only and manager-scoped. RLS permits only
selecting and inserting the authenticated manager's rows; there is no update or
delete policy. It records impressions, explanation opens, CTA clicks,
Addressed, Snooze, Not relevant, setup dismissal, AI result, and inferred
downstream completion.

Addressed and Not relevant suppress only the exact
`candidate_key + evidence_fingerprint`. Snooze suppresses that instance until
Tomorrow, next Monday, or one week. The optional early-use role-grounding prompt
can be dismissed until the next local day. None of these handlers calls a 1:1,
goal, project, commitment, assessment, capacity, expectation, or setup writer.
Addressed explicitly does not close or update the underlying record.

`POST /api/dashboard/reconcile` can append a completion event when later records
honestly establish one: new prep after a start-prep click, a specifically
included commitment resolved after its click, or a later goal/project check-in.
It never mutates those records.

## States and rollout

The brief has normal-week, busy-week, early-use, empty, all-clear, loading,
partial-source, AI-failure, and aged-response states. Early use makes no team
judgment. Empty accounts receive one Add direct report action. Confirmed source
writes in the same browser refresh the brief automatically, including writes from
another tab. After 24 hours the full brief remains usable and gains a quiet,
optional refresh prompt; content never disappears merely because time passed.

`MISSION_CONTROL_ACTION_FIRST_MODE=off|allowlist|on` is the rollback switch, with
`MISSION_CONTROL_ACTION_FIRST_ALLOWLIST` for a manager UUID allowlist. The old
dashboard component and `GET /api/dashboard/insight` remain available while the
flag exists. Turning the mode off restores the previous UI without reversing the
additive event table or changing source data.

## Quick add

`components/QuickAddModal.tsx` remains the lightweight create path for a direct
report, goal, or project. It is not a global command palette.
