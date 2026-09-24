# A commitment may have no direct report

**Status:** Accepted — implemented in `8bdf287` (surfaced by `7bb9c99`).

## Context

`commitments.direct_report_id` has always been nullable in the schema, but every
write path required it and every read path assumed it. RLS on the table is a flat
`owner_id = auth.uid()`, so the manager — not the report — has always been the
owning principal.

Team meetings broke the assumption. A team meeting routinely produces work the
manager owns ("open the CSM req with recruiting"), and there is no
`direct_reports` row for the manager themselves. Forcing an owner would mean
either dropping those commitments on the floor during wrap-up extraction or
misattributing them to whichever report was mentioned nearby.

## Decision

**A null `direct_report_id` means the commitment is the manager's own.** It is a
real owner, not a missing value.

`POST /api/team/commitments` accepts a null, the wrap-up extractor emits null
rather than guessing, and UI owner pickers offer "You" as the first option.

## Rejected alternatives

- **Require a named report.** Wrap-up would have to discard commitments it could
  not assign, which is exactly the accountability data the feature exists to
  capture.
- **A self-referential `direct_reports` row for the manager.** Pollutes the
  roster, every rollup, and every setup count, to model an absence.
- **A separate `manager_commitments` table.** Two tables to resolve, mark done,
  and surface, for one nullable column of difference.

## Consequences

- Anything reading commitments must treat a null report as legal. Confirmed at
  the time of the decision: no route uses a PostgREST `!inner` join on
  `direct_reports`, so null-owner rows still list, and every render site already
  falls back (`?? "You"` on `/app/team`, `?? "Your initiative"` on the dashboard
  and projects, `?? "Not linked to a report"` on goals).
- **Any new commitments surface inherits this obligation** — an inner join or a
  bare `{direct_report_name}` render will silently hide or blank the manager's
  own commitments.
- Team-scoped filtering cannot derive a team from a null report. **Superseded
  2026-09-24:** showing such rows under every team leaked one team's work onto
  every other team's page, so commitments gained their own `org_unit_id` (from
  the meeting or the team selected when added). A null-report row with no
  `org_unit_id` now shows only under "All teams." See `docs/systems/team.md` →
  Team commitments.
- A 1:1 prep sheet filters by report, so these correctly never appear there.
- **Refined 2026-09-22 (Beyond the team):** `committed_by = 'counterpart'` rows —
  something an outside person owes the manager — also have a null
  `direct_report_id`. So "null report means yours" holds only for
  `committed_by <> 'counterpart'`, and any reader relying on it must exclude
  counterpart rows (Mission Control's snapshot does; Away already filters to
  `manager`). See `docs/systems/beyond.md`.

## What should reopen this

Real multi-assignee commitments (one commitment fanning out to several people).
That is a different data model, not an extension of a nullable column, and it
would subsume this decision rather than refine it.
