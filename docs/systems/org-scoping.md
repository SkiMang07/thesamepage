# Org units and role-scoped views

How "who sees what" works as the org grows past one manager. Distinct from
`team.md`, which is about one manager's own reports.

Backend: `routes/org_units.py`. Surface: `/app/org` (Build / Chart / Rollup tabs).

## The tree

`org_units` — team and department entities, self-referencing `parent_unit_id`,
org-scoped (`current_org_id()`).

**"Company" is not a row here.** The `organizations` row is the chart root, with
top-level departments (`parent_unit_id` null) branching off it — a company row
would just duplicate what `organizations` already represents.

`org_units` replaced `role_levels.functional_team` as the source of truth for
"which team." That column still exists; the UI stopped writing and showing it, and
existing free-text values were never backfilled.

Cycle prevention only blocks a unit becoming its own direct parent, not a deeper
cycle (A→B when B→A). Fine for one person hand-building a small tree.

## Scoping mechanism: an explicit leader per unit

`org_units.leader_user_id` (nullable) names who leads a unit.
`public.led_org_unit_ids()` is the one shared gate every rollup filters through:
units the caller directly leads, plus every descendant walked down the tree.

Chosen over two alternatives:

- **`users.role`** (director/vp tiers) — too coarse, not tied to a specific unit.
- **`users.manager_id`** (the people-reporting chain) — capacity already chose the
  `org_units` tree over this chain; using two different scoping sources between
  features would make them disagree.

Any org member can assign any org member as a leader — same permissiveness
`org_units` CRUD already had. No admin/owner concept exists to gate it.

## Visibility depth: aggregate-only, no exceptions

Every rollup returns counts and sums per org unit, never a named individual. Four
functions, all SECURITY DEFINER, all gated by `led_org_unit_ids()`:

| Function | Returns | Note |
|---|---|---|
| `org_unit_capacity_rollup(start, end)` | headcount + summed available hours | see `capacity.md` |
| `org_unit_goals_rollup()` | status counts for department/team-level goals | individual-level goals are not included — a v1 scope limit |
| `org_unit_projects_rollup()` | status counts | scope derived from the project's goal's `org_unit_id`, falling back to its assignee's — **not** `projects.org_unit_id`, see below |
| `org_unit_people_rollup()` | headcount + `job_role`/count breakdown | never a name |

**The projects rollup divergence is deliberate.** Projects gained a direct
`org_unit_id` column and `/app/team` and `/app/projects` both filter on it, but
this function was left on the older goal/assignee-derived logic: aggregating *up*
to a leader is a different question from `/app/team`'s cascade *down* from a
parent team. Check which of the two a surface actually needs before assuming they
agree.

## Endpoints

`GET /api/org-units/led` — units the caller **directly** leads, distinct from the
full descendant scope `led_org_unit_ids()` computes. Backs the team dropdown.

`GET /api/org-units/members` — the org member list for the leader picker, via the
existing `users_select_own_org` policy; no new policy needed.

Plus `GET /api/goals/rollup`, `/api/projects/rollup`,
`/api/direct-reports/rollup`, all declared before their `/{id}` siblings.

## Frontend

The Org page has three tabs. **Build** is a nested tree to add/edit/delete units
and set parents, with a leader picker and "Led by X" badge per unit. **Chart** is
a read-only visual rendered from the same data, using styled-jsx for a pure-CSS
nested-list chart — chosen over a drag-and-drop canvas specifically to avoid
adding the app's first diagramming dependency. **Rollup** shows, per unit the
signed-in user leads, a subtree-aggregated summary with "at risk" called out.

Capacity hours stay on the Capacity page rather than being duplicated into the
Rollup tab.
