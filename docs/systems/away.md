# Away (Settings > Operating defaults > Away)

Manager declares "I'll be out from X to Y"; every upcoming 1:1, team meeting, and
self-owned commitment/goal/project due date that falls in that window shifts
forward, so none of it sits as false delinquency while the manager is gone.

Backend: `routes/away.py`. Tables: `away_periods` + `away_period_shifts` in
`schema.sql`.

**v1 is manager-only.** A direct report's own out-of-office is a real, separate
follow-up — see the note below on why this isn't built on `time_off_entries`.

## Shift strategy

Every affected item moves forward by exactly the number of calendar days the
manager is away — away Sept 10–19 inclusive is 10 days, so a 1:1 on the 12th
becomes the 22nd. This is a flat shift, not a collapse onto the return date:
relative spacing between items is preserved.

A meeting date (1:1 or team meeting) that lands on a Saturday or Sunday after
shifting is nudged forward to the next Monday — nobody is taking a 1:1 on a
weekend. A due date is left wherever it lands; a Saturday due date is harmless.
See `_nudge_off_weekend()`.

`scheduled_at` on 1:1s and team meetings is a calendar date encoded at noon UTC
(same convention as `utils.meeting_date_of()` and the 2026-08-28 migration) — the
shift recomputes that encoding rather than doing timestamp arithmetic, so a
shifted meeting's date reads exactly like every other meeting date in the app.

## What gets swept

Only the manager's own things — never something a direct report owes:

- **1:1s** — the single upcoming, not-yet-logged occurrence per series
  (`summary IS NULL`). This app never materializes a batch of future 1:1 rows;
  each series only ever has one open occurrence at a time (see
  `one_on_ones_upcoming_idx`), so there's at most one row per direct report to
  move. Moving it is self-propagating: `_next_occurrence_at()` computes the next
  1:1 from the current occurrence's own `scheduled_at`, not from a fixed grid off
  the series' `anchor_at` — so nothing else needs to change for the cadence to
  continue correctly from the new date.
- **Team meetings** — same shape as 1:1s, via `team_meetings_open_idx`.
- **Commitments** — `committed_by = 'manager'` and `status = 'open'`. Note
  `owner_id` is always the manager (it means "who keeps the record", not "who owes
  it") — `committed_by` is the field that actually distinguishes the manager's own
  commitments from a direct report's.
- **Goals / Projects** — `direct_report_id IS NULL` (the manager's own initiative,
  not one assigned to a report) and status still open (`active`, `on_track`, or
  `at_risk`).

## Preview vs. apply

`POST /api/away/preview` computes the candidate list without writing anything.
`POST /api/away` recomputes the same sweep fresh — never trusting a client-held
preview, which can go stale between opening it and confirming (someone logs a 1:1
or marks a commitment done in between) — then writes it: one `away_periods` row,
one date update per affected row, and one `away_period_shifts` audit row per item
moved, so a manager can see exactly what changed. There is no draft/unapplied
state in `away_periods` — every row in it has already been applied
(`applied_at` defaults to `now()`).

## No notification, v1

Nothing tells a direct report their 1:1 moved. This ships as schedule hygiene for
the manager's own dashboard and lists; telling a direct report is on the manager
for now. Revisit if that turns out to matter in practice.

## Why not generalize `time_off_entries`?

`time_off_entries` (see `docs/systems/capacity.md`) is scoped to
`direct_report_id` and is a **passive** input read continuously by the capacity
hours rollup — logging a direct report's vacation there moves nothing else, on
either the scheduling or due-date side. `away_periods` is the opposite shape: it
exists purely to **trigger** one explicit, one-time sweep. Folding this into
`time_off_entries` would have meant either giving a capacity-math table an
action-shaped side effect, or adding fields (`type: pto/sick/holiday/other`,
`hours_per_day`) to this table that don't fit "I'm at a conference" cleanly. Kept
separate for now; if employee-side away-with-reschedule ever becomes a real need,
the sweep logic in `_compute_sweep()` generalizes to `direct_report_id` without
much trouble — see the entity-table map in `routes/away.py`.
