# Capacity (`/app/capacity`)

**Supply only** — how much capacity exists, not what's consuming it. No
allocation/demand wiring into projects or goals. That's an explicit follow-up, not
an oversight, and it's why the page shows available hours with no bar or meter: a
progress bar implies something to fill it against.

Backend: `routes/capacity.py` + `org_unit_capacity_rollup()` in `schema.sql`.

## Hours are the shared currency

`capacity_settings` (org-wide defaults) and `capacity_profiles` (per-report
override) resolve to:

```
hours = contracted_hours_per_week × weeks_in_period × (target_utilization_pct / 100)
```

`work_unit_configs` is an optional per-role_level display translation on top
(`hours_per_unit` for "ticket", "point", "campaign") so a team can see its native
unit without a second parallel data model.

## Max capacity is never 100% — two separate buffers

Not one blended number, because they answer different questions:

1. **`target_utilization_pct`** (default 75) — within-a-day overhead: meetings,
   admin, the unexpected. A knowledge-work rule of thumb.
2. **`off_days_per_year`** (default 21 = 15 vacation + 6 sick) — whole days not
   worked at all.

**Precedence, to avoid double-counting anyone who logs real dates:** for the
period being calculated, actual `time_off_entries` win if any overlap it;
otherwise the calculation falls back to a prorated share of the annual default
(`off_days_per_year × hours/day × period_weeks / 52`).

See `_effective_off_hours()` in `capacity.py` and the matching `CASE` in
`org_unit_capacity_rollup()`. `/overview` surfaces which one won via
`off_hours_source: "logged" | "assumed"`, and the UI labels the figure
accordingly — two sources feeding one number, so showing which won keeps it from
reading as more precise than it is.

## Two computation paths, kept in sync by hand

- `capacity.py`'s `get_overview()` — the caller's own direct reports, RLS-scoped,
  computed in Python.
- `org_unit_capacity_rollup()` — department/org rollup via the `org_units` tree,
  computed in SQL because it runs SECURITY DEFINER across every manager in the org.

**If the formula changes, change it in both.** There's a cross-reference comment
at each site, but nothing enforces it.

## Why the rollup is SECURITY DEFINER

`direct_reports` / `capacity_profiles` / `time_off_entries` stay manager-scoped;
there is no cross-manager read policy on any of them. The rollup is the deliberate
exception: it bypasses RLS internally to sum across managers, but its **return
shape is aggregate-only by construction** — an org_unit_id, a count, a summed
hours figure, never a row identifying a person. There's no code path from it back
to a named individual, so a department head sees "Team A: 82 hrs available"
without ever seeing another manager's reports by name.

It's gated by `led_org_unit_ids()`, so a caller who leads nothing gets nothing.
`get_rollup` also cross-joins only against `led_org_unit_ids()`, never every
org_unit — zero-filling units outside your scope would misread as "this team has
0 capacity" instead of "you can't see this team."

**"By department" shows an empty state until Andrew assigns a leader** on at
least one unit in Org → Build. That's intentional, not a bug.

## Placement

Per-person overrides (contracted hours, target utilization, off days) and time-off
logging live on the person page, next to the person. The Capacity page is the
read/rollup surface. Same reasoning as expectations: config that varies per person
lives with the person.

Org-wide baseline defaults and work-unit setup live in Settings → Operating
defaults, alongside the default 1:1 rhythm. The editor states the precedence
explicitly: a person-level setting on the Relationship Desk wins without
changing the shared baseline.
