# Check-ins

The temporal layer under goals and projects. Without it, goal and initiative cards
are inert: no computable progress signal and no freshness/trend signal.

Backend: `routes/check_ins.py` — **shared helpers, not a router**. Frontend:
`components/CheckInPanel.tsx`.

## One shared table for both parents

`check_ins` has `goal_id` XOR `project_id`, enforced with a
`num_nonnulls(...) = 1` check constraint. One table, not two, because both share
the status enum and check-in shape, and the COO-agent temporal layer wants one
place to diff history.

Owner-scoped RLS (`owner_id = auth.uid()`), the same actor as goals and projects.

Endpoints live on the parents: `GET`/`POST /api/goals/{id}/check-ins` and the same
under `/api/projects`.

## Write-through

`create_check_in()` inserts the row, then updates the parent's `status` column. So
every pre-existing status-reading surface — team KPI strip, org-unit rollup SQL,
person-page sections, dashboard stat ribbon — kept working with zero changes. The
migration was purely additive.

## Derived, never stored

Attached by `enrich_with_check_ins()` on every goals/projects list call — one extra
query per list, grouped in Python.

- `progress` — the latest **non-null** % across the parent's check-ins. A
  note-only check-in never wipes the number.
- `trend` — direction between the latest two non-null %s.
- `last_check_in_at` / `last_check_in_note` — newest row.

**Progress is manually asserted** (0–100 per check-in), which is honest about the
judgment involved. Structured key results were considered and deferred.
AI-proposed status/progress from `success_metrics` plus notes is deferred to the
agent layer.

**Progress bars only render with a real check-in** — never fabricated from status
alone.

## Constants

`STALE_CHECK_IN_DAYS = 14` in `CheckInPanel.tsx`, deliberately shorter than the
21-day 1:1 cadence. `DUE_SOON_DAYS = 14` for dashboard triage.
