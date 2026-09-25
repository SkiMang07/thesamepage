# Check-ins

The temporal layer under goals and projects. Without it, goal and initiative cards
are inert: no computable progress signal and no freshness/trend signal.

Backend: `routes/check_ins.py` — **shared helpers, not a router**. Frontend:
goal updates use `components/goals/`, project updates `components/projects/`
(see `projects.md`); `components/CheckInPanel.tsx` remains for Mission Control.

## One shared table for both parents

`check_ins` has `goal_id` XOR `project_id`, enforced with a
`num_nonnulls(...) = 1` check constraint. One table, not two, because both share
the status enum and check-in shape, and the COO-agent temporal layer wants one
place to diff history.

Owner-scoped RLS (`owner_id = auth.uid()`), the same actor as goals and projects.

Endpoints live on the parents: `GET`/`POST /api/goals/{id}/check-ins` and the same
under `/api/projects`.

`source_type` / `source_id` record where a check-in came from: null (entered by
hand) or `outside_meeting` (confirmed from a meeting beyond the team — see
`beyond.md`). `create_check_in()` only sends them when a source is passed, so the
goals/projects routers insert exactly what they always did. Goal and project
history responses include both columns, so a record entry can link the meeting
it came from.

## Write-through

Goal check-ins from `/app/goals` go through `record_goal_check_in()`, which does
the insert and the status write-through in one transaction and is retry-safe via
`client_request_id` (see `goals.md`). Project check-ins from `/app/projects`
(and the Scribe) go through `record_project_check_in()`, the same pattern
without a measured value (see `projects.md`). Confirmed Beyond check-ins still
use `create_check_in()`, which inserts the row, then updates the parent's
`status` column. So
status-reading surfaces such as the team KPI strip, org-unit rollup SQL, and
person-page sections stay current. Mission Control also reads the timestamped rows
for goal/project eligibility, freshness evidence, conflicts, and the weekly truth
signal.

## Derived, never stored

Attached by `enrich_with_check_ins()` on every goals/projects list call — one extra
query per list, grouped in Python.

- `progress` — the latest **non-null** % across the parent's check-ins. A
  note-only check-in never wipes the number.
- `trend` — direction between the latest two non-null %s.
- `progress_at` — when that % was recorded.
- `last_check_in_at` / `last_check_in_note` / `last_check_in_status` — newest row.
- Goals only: `latest_reading`, `recent_readings` (newest 12) and
  `reading_count`, from `measured_value` — an explicitly entered reading of the
  goal's optional numeric measure. A note-only check-in never re-dates a
  reading. Details in `goals.md`.

**Progress is manually asserted** (0–100 per check-in), which is honest about the
judgment involved. It is "completion", separate from a goal's measured value,
which can itself be a percentage. One optional numeric measure per goal exists
(`goals.md`); multi-measure key results remain deferred.
AI-proposed status/progress from `success_metrics` plus notes is deferred to the
agent layer.

**Progress bars only render with a real check-in** — never fabricated from status
alone.

## Constants

`STALE_CHECK_IN_DAYS = 14` in `CheckInPanel.tsx` (and `STALE_DAYS` in
`lib/goals.ts` / `lib/projects.ts`), deliberately shorter than the
21-day 1:1 cadence. `DUE_SOON_DAYS = 14` for dashboard triage.
