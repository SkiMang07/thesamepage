# The Same Page — Session History

One entry per session. Read the most recent entry first — it tells you the
current state and what to do next so you don't relitigate past decisions.

Format per entry:
- **Date + session goal**
- **What was done**
- **Decisions made / locked**
- **Next step**

---

## Session 14 — 2026-08-02

**Goal:** Capacity model and planning — Andrew's own framing: help managers/
dept heads understand team bandwidth, and codify how much "work" a team,
individual, or department can actually handle. Flagged up front as critical/
high-powered/complex, and correctly so — it's the "Capacity & Recruitment"
Settings tab deferred back in Session 6 as department-tier and premature for
a solo-manager MVP, now revisited with real org_units (Session 11) in place.

**What was done:**
- Read `docs/SESSION_HISTORY.md`, `PRODUCT_VISION.md`, `docs/ENGINEERING.md`,
  `docs/DESIGN.md`, `database/schema.sql`, and the settings/org_units/goals/
  projects routers + pages before proposing anything, plus the
  `settings_page`/`org_hierarchy_scoping`/`goals_scoping`/`projects_scoping`
  project memory notes. Confirmed via grep that `mockup.html` doesn't contain
  the original Miro "Capacity & Recruitment" frame — that mockup was never
  staged into this repo, only referenced in the Session 6 memory note.
- Proposed the core framing directly to Andrew before any AskUserQuestion:
  hours as the shared currency under the hood (so individual → team →
  department rollups stay mathematically honest), with a thin per-role
  translation layer on top so support can still see tickets and eng can
  still see story points. Also proposed the "max capacity isn't 100%"
  baseline (contracted hours × target utilization, minus time off) and
  flagged that true department/org rollup needs cross-manager visibility,
  which the app doesn't have today (`direct_reports` is strictly
  `manager_id = auth.uid()`-scoped) — the same reason Capacity & Recruitment
  got deferred as department-tier back in Session 6.
- Scoped with Andrew via two rounds of AskUserQuestion (7 questions total)
  before building:
  1. **Currency:** hours underneath, per-role unit translation on top
     (not native-units-only, not hours-with-no-translation).
  2. **Demand:** supply only for v1 — no allocation/demand tracking against
     Projects/Goals this pass. Explicit, acknowledged follow-up.
  3. **Rollup scope:** Andrew chose full department/org rollup now, not
     "just my own team" — overriding the more conservative default. This
     drove the second round of questions below.
  4. **Placement:** own top-level page (`/app/capacity`), same reasoning as
     Goals/Projects/Org.
  5. **Rollup source:** by the `org_units` tree, not the manager-reporting
     chain (`users.manager_id`) — matches how Goals/Org already treat
     org_units as the real structure.
  6. **Cross-team privacy:** aggregated numbers only outside your own team —
     a viewer never sees another manager's individual reports by name.
  7. **Current usage:** solo manager today; this is being built ahead of
     real multi-manager data, same as `org_units` was in Session 11.
- **My call, flagged not re-asked** (same pattern as Projects' Session 13
  scope note): the department/org rollup is implemented as a SECURITY
  DEFINER SQL function (`org_unit_capacity_rollup()`) whose return shape is
  aggregate-only by construction (org_unit_id + count + summed hours) —
  this satisfies "aggregate outside your own team" without building a new
  per-org-unit permissions system, which has nothing real to test against
  yet (answer to question 7). `direct_reports`/`capacity_profiles`/
  `time_off_entries` all stay exactly as manager-scoped as everything else
  in the app; this function is the one deliberate, narrow exception,
  mirroring how `current_org_id()` already works.

**What got built (same session, right after scoping):**
- `database/schema.sql` + `database/migrations/2026-08-02_capacity.sql`
  (new) — four tables (`capacity_settings` org-wide defaults,
  `capacity_profiles` per-report override, `time_off_entries`,
  `work_unit_configs` per-role-level translation) + RLS policies +
  `org_unit_capacity_rollup()`. **Migration not yet run against the live
  database** — nothing in this feature works until Andrew runs it in the
  Supabase SQL editor.
- `backend/routes/capacity.py` (new) — settings CRUD, work-unit CRUD,
  per-report profile GET/PUT (upsert), time-off CRUD, `/overview` (the
  caller's own team, computed in Python — RLS already scopes this) and
  `/rollup` (calls the SQL function, joins with `org_units` for display
  names). Registered in `main.py` under `/api/capacity`. The overview and
  rollup formulas must be kept in sync by hand — documented with a
  cross-reference comment in both this file and `schema.sql`.
- `frontend/lib/api.ts` — `CapacitySettings`/`CapacityProfile`/
  `TimeOffEntry`/`WorkUnitConfig`/`CapacityOverviewItem`/
  `CapacityRollupItem` types + CRUD + fetch functions.
- `frontend/app/app/capacity/page.tsx` (new) — week/month/quarter period
  selector with prev/next paging, "Your team" (full detail, your own
  reports) and "By department" (aggregate-only, org_units tree walked and
  summed bottom-up client-side — same approach the Org page already uses
  for its chart).
- `frontend/app/app/settings/page.tsx` — new "Capacity" section (org-wide
  contracted-hours/utilization defaults + work-unit-per-role config),
  following the existing "configured once" pattern from Roles & Levels /
  Expectations.
- `frontend/app/app/reports/[id]/page.tsx` — new Capacity section:
  per-person override form (blank = inherit org default) + time-off log
  (add/list/remove), placed after Expectations since it's baseline-setup
  in the same spirit, not a regularly-updated object like Goals/Projects.
- `frontend/app/app/dashboard/page.tsx` — "Capacity" nav link added.
- Docs updated: this entry, `docs/ENGINEERING.md`, `docs/DESIGN.md`.

**Verification:** `python3 -m py_compile` clean on all touched/new backend
files; imported `main.py` in a sandboxed venv with dummy env vars and
confirmed all 9 `/api/capacity/*` routes register. Frontend: assembled the
full frontend project in the sandbox (`npm install`), `npx tsc --noEmit`
clean, `npx next build` clean — `/app/capacity` compiles and prerenders
alongside all 14 routes.

**Follow-up, same session:** Andrew reviewed the v1 formula and flagged a
real gap — target utilization only buffers within-a-day overhead, nothing
accounted for whole days off (vacation/sick/holiday) unless a manager had
already logged specific dates. He proposed a second, separate customizable
default: `off_days_per_year` (org-wide default, per-person override), named
after some back-and-forth, defaulting to 21 (15 vacation + 6 sick — his
numbers). He flagged the real risk himself before Claude could: this number
has to blend with `time_off_entries` without double-counting anyone who
actually logs their PTO.

**Resolution (stated by Claude, not re-scoped via AskUserQuestion — small
enough addition to an already-agreed model to just build):** for whatever
period is being calculated, ACTUAL LOGGED TIME OFF WINS if any overlaps that
period; otherwise the calculation falls back to a prorated share of the
annual default (`off_days_per_year × hours/day × period_weeks / 52`). This
means a period with no logged time off still shows a realistic number (not
optimistically assuming zero time off just because nothing's been logged
yet), and logging real dates for a person immediately takes over for the
periods those dates fall in — no manual toggle, no double subtraction.

**What changed (same session, before the original migration ever ran
live):**
- `database/migrations/2026-08-02_capacity.sql` + `database/schema.sql` —
  amended in place (safe since neither had been run against live Supabase
  yet) to add `capacity_settings.default_off_days_per_year` (default 21)
  and `capacity_profiles.off_days_per_year` (nullable override).
  `org_unit_capacity_rollup()` restructured to compute actual logged hours
  once via a `LATERAL` join and apply the win/fallback precedence in a
  `CASE`.
- `backend/routes/capacity.py` — new `_effective_off_hours()` helper
  (mirrors the SQL `CASE`), `/settings` and `/profiles/{id}` GET/PUT now
  include the new field, `/overview`'s response replaces `time_off_hours`
  with `off_hours` + `off_hours_source: "logged" | "assumed"` so the
  frontend can label which one it's showing.
- `frontend/lib/api.ts`, `frontend/app/app/settings/page.tsx` (new "Default
  days off / year" field, explained inline as separate from target
  utilization), `frontend/app/app/reports/[id]/page.tsx` (per-person
  override field), `frontend/app/app/capacity/page.tsx` (shows "logged"
  vs. "assumed" time off per report) — all updated to match.
- Re-verified: `py_compile` clean, `main.py` imports with all
  `/api/capacity/*` routes registering, `npx tsc --noEmit` clean, `npx next
  build` clean (14/14 routes).

**How to apply:** next session should (1) confirm Andrew ran
`2026-08-02_capacity.sql` against live Supabase, (2) once live, set org
defaults in Settings > Capacity and try the per-report override + time-off
flow on a real report, (3) revisit whether v1's "supply only" framing is
still right once there's real usage — wiring capacity into Projects/Goals
as an actual allocation/demand view is the natural next payoff, same as how
role-scoped views are the flagged next step for `org_units`. Also worth a
second look once there's a real second manager: today's department/org
rollup has no real cross-manager data to prove itself against yet.

---

## Session 13 — 2026-08-02

**Goal:** Activate `projects` — the dormant table flagged as "the next
candidate in this family" after Goals (Session 10) and Org (Session 11).
Same "scope with Andrew first, then build" pattern as those sessions.

**What was done:**
- Read `PRODUCT_VISION.md`, `docs/DESIGN.md`, `docs/ENGINEERING.md`,
  `database/schema.sql`, `backend/routes/goals.py`, `frontend/lib/api.ts`,
  `frontend/app/app/goals/page.tsx`, and the reports/[id] detail page before
  proposing anything, to see how Goals/Org's shape decisions applied to
  Projects. Confirmed the Miro board tie-in: PRODUCT_VISION.md's Mission
  Control cards "Key Initiatives" (active projects) and "Reports & Dashboard"
  (linked projects/reports) map to this table; ENGINEERING.md's "goals=what,
  projects=how" framing set the scoping approach.
- Scoped with Andrew via AskUserQuestion before building:
  - Own top-level page (`/app/projects`), same reasoning as Goals/Org.
  - A project can be assigned to a specific direct report (new
    `direct_report_id` column — the table didn't have one).
  - DR detail page gets a Projects section, always-visible with an empty
    state — same call also resolves Goals' Session 10 open question
    (hidden-vs-always-visible) the same direction.
  - Commitments → project linking (`source_type='project'`, already in
    schema) stays deferred this pass.
  - Deliberately did NOT give projects their own `level`/`org_unit_id` like
    goals — a project's scope is derived from whatever it's linked to (its
    goal's level, or the report it's assigned to), not a duplicated parallel
    hierarchy. Flagged as easy to add later if a project ever needs
    independent scope.
- `database/schema.sql` + `database/migrations/2026-08-02_projects_direct_report.sql`
  (new) — added `direct_report_id uuid references direct_reports(id) on
  delete cascade` to `projects`. Everything else (`goal_id`, `status`,
  `due_date`, RLS policy) already existed from the original 28-table build
  (Session 3). **Migration not yet run against the live database.**
- `backend/routes/projects.py` (new) — GET (filters: direct_report_id,
  goal_id, status), POST, PUT, PATCH (status-only, mirrors goals.py), DELETE.
  Registered in `main.py` under `/api/projects`. Joins `direct_reports(name)`
  and `goals(title)` for display, same `_shape_rows` pattern as goals.py.
- `frontend/lib/api.ts` — `Project`/`ProjectStatus`/`ProjectIn` types (status
  reuses `GoalStatus`'s shape) + client functions incl. `updateProjectStatus`.
- `frontend/app/app/projects/page.tsx` (new) — flat list grouped by assignee
  ("Your initiatives" first, then one group per direct report), create form
  (title, description, status, due date, optional assignee picker, optional
  goal picker), inline status pill, edit-in-place (same card-swap pattern as
  Goals), delete.
- `frontend/app/app/dashboard/page.tsx` — "Projects" nav link added next to
  Goals.
- `frontend/app/app/reports/[id]/page.tsx` — new Projects section, always
  visible with empty state, same visual pattern as the Goals section
  immediately above it.
- `docs/DESIGN.md`, `docs/ENGINEERING.md` — updated (decisions log, page
  structure, schema table list, scope-discipline gaps, file map).

**Decisions locked:** see above — all confirmed with Andrew via
AskUserQuestion before building, same discipline as Sessions 10-12.

**Verified:** `python3 -m py_compile` clean on all backend files;
`python -c "import main"` succeeds and `/api/projects` (GET/POST/PUT/PATCH/
DELETE) all appear in the generated OpenAPI schema. Frontend: assembled the
full frontend project in the sandbox (`npm install`), `npx tsc --noEmit`
clean, `npx next build` clean — `/app/projects` compiles and prerenders
alongside all 13 other routes. No live Supabase run from the sandbox itself.

**Next step:**
Confirm Andrew ran `2026-08-02_projects_direct_report.sql` against live
Supabase, then dogfood Projects the same way Goals surfaced its edit-button
gap in Session 10 — expect small gaps to turn up from live use. Also worth
revisiting once real usage exists: whether commitments → project linking
earns its complexity, and whether the still-unconfirmed Session 10 Goals
question (now effectively answered by this session's Projects DR-surfacing
choice) needs an explicit sign-off from Andrew either way.

---

## Session 12 — 2026-08-02

**Goal:** Split "Team" out of Settings' Roles & Levels into its own section,
and add Edit (update-in-place) for role_levels — same "scope first" pattern
as Goals/Org.

**What was done:**
- Confirmed shape with Andrew via AskUserQuestion before touching code:
  - Team lands as a 4th item in Settings' existing left-nav (Profile &
    Company, Roles & Levels, Team, Expectations) — not a new top-level page,
    not a tab on `/app/org`.
  - Everything moves: the "who's in which role" list AND the org_unit
    (team/department) picker both move out of Roles & Levels into Team.
    Roles & Levels becomes pure role_level CRUD.
  - Edit uses the same card-swap edit-in-place pattern as Goals (Session
    10) — clicking Edit swaps the role's card for the add-role form,
    pre-filled, Save/Cancel in place — not a modal.
- `frontend/app/app/settings/page.tsx`:
  - Added `"team"` to `SectionId` and a 4th `SECTIONS` entry.
  - Extracted `RoleForm` (shared by add and edit — `initialRole` prop
    toggles edit mode), used by both the standing "Add role" form and the
    new inline edit-in-place row.
  - `RolesSection` is now pure role_level CRUD: list + Edit/Remove per row +
    `RoleForm`. No longer takes `reports`/`orgUnits` props.
  - New `TeamSection`: the "who's in which role" list + role picker + org
    unit picker, moved verbatim out of the old `RolesSection`. Takes an
    `onNavigateToRoles` callback (wired to `setSection("roles")`) so its
    copy can point back at Roles & Levels without a real page navigation,
    since both sections live inside the same client-state-driven Settings
    page.
  - No backend changes — `PUT /api/settings/role-levels/{id}`
    (`update_role_level`) and `updateRoleLevel()` in `lib/api.ts` already
    existed from earlier work and were simply wired up for the first time.
- Verified via `tsc --noEmit` and `next build` (both clean) before writing
  the file back to Andrew's machine.

**Decisions locked:**
- Team is a Settings sub-page, not a top-level nav item and not folded into
  Org — it's about "who does what," which Andrew judged closer to
  configuration than to org structure/goals.
- Role assignment + team assignment travel together as one section (Team),
  not split further.

**Next step:**
Confirm the Session 11 `org_units` migration
(`database/migrations/2026-08-02_org_units.sql`) has actually been run
against live Supabase — still unconfirmed as of this session's start. No
other open threads from this session.

---

## Session 11 — 2026-08-02

**Goal:** Design (then build) an org hierarchy data model — team/department/
company as real entities, not free text — plus a visual org-chart builder.
Same pattern as Goals: scope with Andrew first, then build once shape and
placement are agreed.

**What was done:**
- Read `database/schema.sql`, `frontend/app/app/goals/page.tsx`,
  `PRODUCT_VISION.md`, `docs/DESIGN.md`, and `docs/ENGINEERING.md` before
  proposing anything. Walked through the concrete gap with Andrew: a direct
  report (e.g. Leah Wellborn) has no structured team/department anywhere —
  the closest thing, `role_levels.functional_team`, is free text on a
  *role*, not a person, so it can't be queried and can't have a parent.
  `goals.level` has the right taxonomy but no FK to a specific unit.
- Confirmed via discussion with Andrew (not defaulted, via AskUserQuestion):
  - **Schema shape:** a single self-referencing `org_units` table
    (`unit_type` department/team, `parent_unit_id`), not three separate
    tables — mirrors `goals.parent_goal_id` and `users.manager_id`, patterns
    already in the schema, rather than introducing a new one.
  - **`role_levels.functional_team`:** replaced by `org_unit_id`, not kept
    as a parallel concept. Column stays in the schema (not dropped, no data
    migration), but the UI stops writing/showing it.
  - **Builder UI:** hybrid — a nested tree to build/edit (no new frontend
    dependency), plus a read-only visual chart rendered from the same data.
    Rejected a true drag-and-drop canvas (would need a diagramming library —
    the app's first real UI dependency, against DESIGN.md's plain-Tailwind
    stance).
  - **Placement:** `/app/org`, its own top-level nav page — same reasoning
    as Goals' placement in Session 10 (a distinct object, not a Settings
    "configure once" section, even though it's edited less often than
    Goals).
  - **Company node:** Claude proposed, Andrew confirmed, that "company" is
    NOT a stored `org_units` row — the chart root is the existing
    `organizations.name`, with top-level departments (`parent_unit_id` null)
    branching directly off it. Avoids a row duplicating what `organizations`
    already represents.
- Built the feature on top of that agreement:
  - `database/schema.sql` + new `database/migrations/2026-08-02_org_units.sql`
    — `org_units` table (org-scoped via `current_org_id()`, like
    `role_levels`, not manager-scoped like `direct_reports`/`goals`), plus
    nullable `org_unit_id` FKs on `direct_reports` and `goals` (both
    `ON DELETE SET NULL`). **Not yet run against the live database.**
  - `backend/utils.py`: pulled `ensure_org()`/`get_email_from_token()` up
    from private helpers in `settings.py` (renamed from `_ensure_org`/
    `_get_email`) since `org_units.py` needed the same org-bootstrap
    pattern. `settings.py` keeps local aliases so its call sites didn't need
    touching.
  - `backend/routes/org_units.py` (new): `GET`/`POST`/`PUT`/`DELETE`
    `/api/org-units`. Delete relies on `ON DELETE SET NULL` cascades rather
    than manual unparenting (unlike `goals.delete_goal`, which has to
    unparent manually since `parent_goal_id` has no `ON DELETE` clause).
    Update guards against a unit becoming its own direct parent; does not
    walk the tree for deeper cycles (documented limitation, acceptable for a
    solo manager hand-building a small tree). Registered in `main.py`.
  - `backend/routes/direct_reports.py`: added `org_unit_id` to
    `DirectReportIn` — flows through the existing `model_dump()` calls, no
    other route logic changed.
  - `backend/routes/goals.py`: added `org_unit_id` to `GoalIn`, joined
    `org_units(name,unit_type)` in `_SELECT_COLUMNS`, flattened to
    `org_unit_name` in `_shape_rows`, added an `org_unit_id` filter to
    `GET /api/goals` (mirrors the existing `direct_report_id` filter).
  - `frontend/lib/api.ts`: `OrgUnit`/`OrgUnitType`/`OrgUnitIn` types +
    `getOrgUnits`/`createOrgUnit`/`updateOrgUnit`/`deleteOrgUnit`;
    `org_unit_id` on `DirectReport`; `org_unit_id`/`org_unit_name` on
    `Goal`/`GoalIn`; `assignReportOrgUnit` (mirrors `assignReportRole`).
    **Caught while writing this:** `assignReportRole`'s `PUT` didn't
    preserve `org_unit_id` — since the backend route replaces the whole
    record, reassigning someone's role would have silently wiped their team
    assignment. Fixed by passing `org_unit_id: report.org_unit_id` through;
    the new `assignReportOrgUnit` symmetrically preserves `role_level_id`.
  - `frontend/app/app/org/page.tsx` (new): the hybrid builder. "Build" tab —
    nested tree, "+ Add department or team" at root and "+ Add child" per
    node, inline Edit (rename/retype/reparent) and Delete. "Chart" tab —
    read-only visual chart, pure-CSS nested-list technique via `styled-jsx`
    (ships with Next.js — no new dependency), rooted at the company name
    pulled from `getProfile()`.
  - `frontend/app/app/dashboard/page.tsx`: added an "Org" nav link between
    Goals and Settings.
  - `frontend/app/app/settings/page.tsx`: Roles & Levels — removed the
    free-text "Team (optional)" input from the add-role form and stopped
    appending `functional_team` in `roleLabel()`; "Who's in which role" list
    now has a second picker (org unit) next to the existing role picker, via
    the new `assignOrgUnit` handler.
  - `frontend/app/app/goals/page.tsx`: `GoalForm` shows an org-unit picker
    when level is Team or Department, filtered to matching `unit_type` so
    level and unit can't disagree; switching level away clears a
    now-mismatched selection (`handleLevelChange`). `GoalList` shows the
    assigned unit's name on team/department goal cards.
  - `docs/ENGINEERING.md`, `docs/DESIGN.md` — updated (schema table list,
    scope-discipline open items, file map, decisions log).
  - Saved the scoping decisions to an `org_hierarchy_scoping` project memory
    note before building, so they weren't relitigated mid-build.

**Decisions locked:**
- See "What was done" above — schema shape, the `functional_team` deprecation,
  builder interaction model, page placement, and the company-node resolution
  were all explicit calls confirmed with Andrew before code was written.
- `org_units` is org-scoped (`current_org_id()`), unlike `direct_reports`/
  `goals` which are manager-scoped (`owner_id`/`manager_id`) — team/
  department structure belongs to the org, not to one manager's private
  view of it. Documented in `org_units.py`'s module docstring.

**Verification:** `python3 -m py_compile` clean on all touched/new backend
files (`main.py`, `utils.py`, `routes/settings.py`, `routes/org_units.py`,
`routes/direct_reports.py`, `routes/goals.py`). Frontend `tsc`/`next build`
verification pending — see next step.

**Next step:**
1. Run `database/migrations/2026-08-02_org_units.sql` against the live
   Supabase database — nothing in this feature works until that lands.
2. Confirm `npx tsc --noEmit` and `next build` are clean (attempted from the
   sandbox; confirm result before/while dogfooding).
3. Once live: build out the org tree for real (Andrew's actual departments/
   teams), assign existing direct reports to units in Settings, and check
   Goals' team/department pickers against real data.
4. Role-scoped views (manager/dept-head/individual) are the natural next
   payoff now that real org_units exist — not scoped this session.

---

## Session 10 — 2026-08-02

**Goal:** Scope how Goals fits into the product with Andrew (design/scoping
conversation, not a build session at first) — then, once placement and shape
were agreed, build it.

**What was done:**
- Read `PRODUCT_VISION.md`'s Mission Control section, `database/schema.sql`'s
  `goals`/`projects` tables, `docs/DESIGN.md`, and `docs/ENGINEERING.md`
  before proposing anything. Confirmed via discussion with Andrew (not
  defaulted):
  - Goals gets its own top-level page (`/app/goals`), not folded into
    Settings — Settings is "configure once," goals get written to
    constantly.
  - DR detail page gets a new "Goals" section. Built it always-visible
    (Commitments-style empty state) rather than hidden-until-configured like
    Expectations, reasoning that goals aren't gated behind a setup
    prerequisite the way Expectations is gated behind a role assignment —
    **but this was a judgment call made mid-build, not re-confirmed with
    Andrew** (the scoping question he'd actually answered was phrased
    "mirrors Expectations — hidden if empty"). Flagged to him after the
    build; unresolved as of this entry.
  - Full company/department/team/individual hierarchy (`goals.level`) ships
    now, not narrowed to individual-only — Andrew's explicit call over the
    more conservative default. Company/department goals are usable today but
    have no distinct dept-head/VP audience yet, since role-scoped views
    aren't built (ENGINEERING.md open question) — acknowledged gap, not an
    oversight.
  - `projects` stays dormant this pass. Rollup/status calculation (a parent
    goal's status computed from its children, per PRODUCT_VISION) is
    explicitly out of scope — `status` is a plain manually-set field.
  - Discovered while reading schema.sql: the `goals`/`projects` RLS policies
    are named `*_all_own_org` but actually scope by `owner_id = auth.uid()`,
    not `org_id = current_org_id()` — unlike role_levels/*_configs. So (like
    direct_reports/one_on_ones) the new router does not populate `org_id` or
    do the Settings org-bootstrap dance; it isn't required for isolation.
- Built the feature on top of that agreement:
  - `backend/routes/goals.py` (new): `GET /api/goals` (list, filters:
    level/direct_report_id/status), `POST`, `PUT` (full edit), `PATCH`
    (status-only, mirrors `commitments.py`'s pattern), `DELETE` (unparents
    any child goals first — `parent_goal_id` has no `ON DELETE` clause, so
    deleting an unreferenced-child guard avoids an FK error). Registered in
    `backend/main.py` under `/api/goals`.
  - `frontend/lib/api.ts`: `Goal`/`GoalLevel`/`GoalStatus`/`GoalIn` types +
    `getGoals`/`createGoal`/`updateGoal`/`updateGoalStatus`/`deleteGoal`.
  - `frontend/app/app/goals/page.tsx` (new): level tabs (Individual/Team/
    Department/Company — individual defaults first since that's what
    connects most directly to existing direct-report data), individual tab
    sub-grouped by direct report, add-goal form (title/level/direct report
    when individual/parent goal/status/due date/description), inline status
    select per goal (the field that changes constantly), delete.
  - `frontend/app/app/reports/[id]/page.tsx`: new "Goals" section between
    Expectations and Open Commitments — summary/read surface only, links out
    to `/app/goals` for actual create/edit/delete.
  - `frontend/app/app/dashboard/page.tsx`: added a "Goals" link in the header
    next to Settings.
  - Saved the scoping decisions to a `goals_scoping` project memory note so
    they carry into future sessions without re-litigating.

**Decisions locked:**
- See "What was done" above — placement, DR surfacing, hierarchy scope, and
  the projects/rollup deferrals were all explicit calls made with Andrew
  before code was written.
- `goals`/`projects` RLS is owner_id-scoped, not org-scoped, despite the
  policy names — documented in `goals.py`'s module docstring and
  ENGINEERING.md's RLS section so the next session doesn't get confused by
  the "_all_own_org" naming.

**Follow-up (same session): `success_metrics` field.**
Before any dogfooding happened, Andrew asked for a SMART-framework anchor —
title/description already cover Specific, due_date covers Time-bound, but
nothing captured Measurable. Added `success_metrics`: a single free-text
column, deliberately unstructured (no new metric_configs-style table) since
it's meant to be read by AI/agents rather than parsed or scored, and a rigid
structure would just produce blank fields for goals that don't fit it.
- New migration: `database/migrations/2026-08-02_goals_success_metrics.sql`
  (`alter table goals add column if not exists success_metrics text`) —
  **not yet run against the live database.** `database/schema.sql` updated
  to match for future reads.
- `backend/routes/goals.py`: added to `GoalIn` and `_SELECT_COLUMNS`; create/
  update/patch all pass it through via the existing `model_dump()` calls, no
  other route logic changed.
- `frontend/lib/api.ts`: added to `Goal`/`GoalIn` types.
- `frontend/app/app/goals/page.tsx`: new optional "Success metric" textarea
  in the add-goal form (below Description), rendered on each goal card when
  present. Not added to the DR detail page's Goals section — that stays a
  lean summary surface (title/status/due date only), consistent with why it
  was kept minimal in the first place.
- Verified: `python -m py_compile` clean, `main.py` still imports and all 5
  `/api/goals` routes register; `npx tsc --noEmit` and `next build` both
  clean (`/app/goals` still compiles/prerenders as its own route).
- Also fixed while in these docs: ENGINEERING.md's "Production deploy not
  yet configured" line was stale — Andrew confirmed both Vercel and Railway
  auto-deploy on push. Corrected in the Stack section and removed from both
  "not yet built" lists.

**Follow-up (same session): goal editing.**
Andrew pushed this to Vercel/Railway and started dogfooding on the live
`thesamepage-blush.vercel.app` deploy — first real live use of the feature.
Caught a real gap immediately: status has an inline select and there's a
Delete button, but no way to fix a typo in a title or update a description
once a goal exists. Added an Edit action:
- `frontend/app/app/goals/page.tsx`: `GoalForm` now takes an optional
  `initialGoal` prop and pre-fills from it; submit label switches between
  "Add goal"/"Save changes". Each goal card gets an "Edit" button next to
  Delete — clicking it swaps that list item in place for the same form
  (pre-filled), rather than a modal or a separate page. Reused
  `frontend/lib/api.ts`'s existing `updateGoal` (PUT) — it was already built
  in the initial pass but never wired to a UI action.
- Verified: `npx tsc --noEmit` and `next build` both clean again, `/app/goals`
  still compiles/prerenders.

**Next step:**
Andrew is now dogfooding live (first real use, not just build-verified).
Confirm the success_metrics migration actually landed (unclear from what's
visible so far — the goals shown in his first screenshot have metrics typed
directly into the description, from before this field existed, not the new
dedicated field) and that editing works end to end on the deployed app.
Report back before any further Goals work (activating `projects`, rollup/
status calculation, or resolving the still-open DR-surfacing question
flagged above) gets scoped.

---

## Session 9 — 2026-08-02

**Goal:** Give managers access to past 1:1 activity from the DR detail page —
both completed sessions and in-progress prep sheets. Andrew's pain point: he
preps for a 1:1 a day or two out, then has no way back into that sheet
without regenerating it from scratch.

**What was done:**
- `POST /prep` now persists. Confirmed it was a pure AI call with no DB write
  before starting (per its own docstring). It now saves the full prep
  response — `situation_summary`, `agenda_items`, and the
  `open_commitments_to_check` snapshot — into `one_on_ones.prep_guide`, with
  `summary`/`notes` left null. Status is derived, not stored: a row is
  "planned" when `prep_guide` is set and `summary` is null, "completed" once
  `summary` is set. No schema change needed — `prep_guide jsonb` already
  existed on the table, just never written to.
- Upsert, not insert-every-time: `_find_planned_session()` looks for an
  existing planned row for the report before creating one. Re-running prep
  for the same report updates that row's `prep_guide` in place rather than
  piling up duplicate planned sessions. At most one planned session per
  report is the assumed shape — fits a solo-manager cadence where there's
  one upcoming 1:1 at a time per person.
- `POST /` (log) now accepts an optional `one_on_one_id`. When the meeting
  was prepped, saving fills in that SAME row's `summary`/`notes` (planned →
  completed) instead of inserting a second row. Threaded through
  `prep/page.tsx` → `wrap-up-review.tsx` → `logOneOnOne()`. The standalone
  `/log` flow never sets it, so ad-hoc logs are unaffected — still a plain
  insert.
- New `GET /api/one-on-ones/session/{id}` (single session, for resuming) and
  `DELETE /api/one-on-ones/session/{id}` (dismiss a planned session that
  isn't happening — refuses on a completed one, that's real history).
  `GET /{direct_report_id}/history` now returns each row through
  `_serialize_session()`, adding `status` and `display_summary`.
- **Bug caught before it shipped:** once `/prep` writes rows, a planned
  session (no `summary` yet) would otherwise count as "the last 1:1" in two
  places — the prep prompt's recency logic and the dashboard's 21-day
  cadence badge (`direct_reports.py` → `/overview`) — going stale the moment
  a manager preps. Both now filter to completed meetings only
  (`summary` set) before computing recency. These two intentionally still
  share the threshold per CLAUDE.md; fixed together, not separately.
- `frontend/app/app/reports/[id]/page.tsx`: "1:1 History" → "1:1 Sessions",
  now lists planned + completed with a status badge. A planned row links to
  `/prep?resume={id}`; a "Not happening" link dismisses it. Header CTA
  becomes "Resume prep sheet →" (instead of "Start 1:1 prep →") when a
  planned session already exists, so the fix reaches the pain point from the
  top of the page too, not just the list at the bottom.
- `frontend/app/app/reports/[id]/prep/page.tsx`: reads `?resume={id}`, loads
  the stored session, and renders step 2 directly from `prep_guide` — no
  regenerating. `useSearchParams` requires the `<Suspense>` wrapper pattern
  already used in `app/login/page.tsx`; followed it here (`PrepPage` wraps
  `PrepFlow`).
- Verified: `npx tsc --noEmit` clean, `next build` succeeds (all routes
  compile and prerender, including the new Suspense boundary). Backend:
  `python -m py_compile` + importing `main.py` with the exact pinned
  `requirements.txt` in a venv, both clean. No live Supabase run in this
  session — no DB access from here.

**Decisions locked:**
- Status is always derived from `prep_guide`/`summary`, never a stored
  column — one less thing that can drift out of sync.
- "Deferred" (from the original ask's planned/completed/deferred sketch) is
  NOT a tracked status — there's no trigger in the app that would set it
  automatically (no scheduling UI, `scheduled_at` stays unused). Implemented
  the practical version instead: "Not happening" deletes the planned row.
  Revisit if Andrew wants deferred sessions kept as a record rather than
  removed.
- Prep resume shows the prep sheet exactly as generated, including a
  point-in-time snapshot of `open_commitments_to_check` — it does not
  re-fetch current commitment status live. A commitment resolved between
  prepping and resuming will still show as open on the resumed sheet. Live
  open commitments remain correct everywhere else (DR detail's commitments
  section, a freshly generated prep sheet).

**Open item — not resolved this session:**
`2026-08-01_commitments_committed_by.sql` (Session 8) — still needs
confirmation it's been run in Supabase. This session's work doesn't touch
`committed_by`, so it isn't blocked by it, but it's the standing caution
from CLAUDE.md and remains unconfirmed.

**Next step:**
Run this in Supabase-connected env, dogfood: prep a 1:1, close the tab,
come back via the DR detail page's planned entry (and via the header
"Resume prep sheet →" button), confirm it resumes without a second AI call,
then complete the wrap-up and confirm the row transitions to "Completed"
with no duplicate row left behind. Also confirm the "Not happening" dismiss
action and the dashboard's 21-day badge stay correct once a planned session
exists.

---

## Session 8 — 2026-08-01

**Goal:** Capture what actually happens on the call. Andrew's observation:
the prep sheet existed and logging existed, but there was nowhere to take
notes DURING the 1:1 — and the log step asked him to re-type everything from
memory.

**What was done:**
- Prep step 2 is now a two-column screen (desktop): prep sheet on the left,
  a "Call notes" pane on the right — type live during the call, or paste
  notes/transcript from Granola or any recorder afterward.
- New `POST /api/one-on-ones/wrapup` (`_build_wrapup_prompt()`): raw call
  notes → AI-drafted `{summary, commitments[]}`. Pure draft — nothing saved.
  Commitments are extracted for BOTH sides (`committed_by`: manager /
  direct_report), phrased verb-first, with ISO due dates only when stated
  (relative dates resolved from today's date). Explicit rule: topics
  discussed ≠ commitments; empty list is valid; never invent.
- New review screen (`wrap-up-review.tsx`, shared component): editable
  summary, commitment rows with You/{firstName} owner toggle, optional due
  date, remove/add. Save → `POST /api/one-on-ones` which now also stores the
  raw notes on `one_on_ones.notes` (column already existed; private to the
  writing manager per RLS).
- Standalone log flow (closes the Session 5b roadmap item):
  `/app/reports/[id]/log` — same notes → wrap-up → review, no prep needed.
  "Log a 1:1" secondary button added next to "Start 1:1 prep" on DR detail.
- `committed_by` threaded through: migration
  `2026-08-01_commitments_committed_by.sql` (default 'manager' backfills old
  rows), schema.sql patched, commitments list endpoint selects it, prep
  prompt marks each open commitment with who owes it ("[Leah owes] ..."),
  framework #1 now tells the manager to proactively give status on their own
  items. DR detail + prep sheet show a name chip on report-owned commitments.
- `LogOneOnOneIn.new_commitments` changed from `list[str]` to structured
  `{description, committed_by, due_date}` objects (frontend is the only
  caller; updated in the same change).

**Decisions locked:**
- Wrap-up is draft-then-review: AI output never enters the record without
  the manager seeing it. Review screen requires a non-empty summary (an
  extraction failure yields an empty draft + a "write one below" nudge, not
  an error).
- Commitments are two-sided (`committed_by`); `owner_id` stays the manager
  (record-keeper) so RLS is untouched.
- Notes capture is paste-or-type only for now. **Deferred integration:**
  Google Drive meeting-notes import (search by manager + rep name, match on
  date, pull the doc) — revisit when core loop is validated; Granola et al.
  covered by paste in the meantime.
- Manual one-per-line commitment entry is gone — the review screen's
  structured rows replace it.

**Next step:**
Run the migration in Supabase, deploy, and dogfood a real 1:1 end to end
(prep → live notes → wrap-up → check the DR page). Then back to the
dashboard/roadmap — or Stripe-gating conversations if dogfooding feels solid.

---

## Session 7 — 2026-08-01

**Goal:** Make the Settings backbone pay off — surface each DR's role
expectations on the detail page and ground the AI 1:1 prep in them.

**What was done:**
- `backend/routes/direct_reports.py`: added `fetch_role_expectations(supabase,
  role_level_id)` — returns the role_level (id, job_role, job_level,
  functional_team, job_responsibilities) plus its metric/skill/value configs
  (ordered primary→secondary→tertiary, then name), or `None` when no role is
  assigned or the role row is gone. `GET /{report_id}` now returns the DR row
  with an `expectations` key built from it (no new endpoint).
- `backend/routes/one_on_ones.py`: `/prep` fetches the DR's `role_level_id`,
  calls the shared helper, and passes the result into `_build_prep_prompt()`.
  New `_format_expectations_block()` renders a "ROLE EXPECTATIONS — what good
  looks like" section between OPEN COMMITMENTS and the manager's notes, with
  an instruction to ground performance/feedback/growth questions and SBI
  phrasing in the named expectations — and to pull in only what the notes make
  relevant, never audit all of them. Role assigned but zero configs → a short
  "ROLE CONTEXT" note instead (no instruction pointing at nothing). No role →
  section omitted entirely; prompt reads as before.
- `frontend/lib/api.ts`: new `RoleExpectations` type; `DirectReport` gains
  optional `expectations` (detail endpoint only).
- `frontend/app/app/reports/[id]/page.tsx`: "Expectations" section between
  About and Open commitments — role + level (+ team) line, then Metrics /
  Skills / Values groups (name + expectation/description). Hidden entirely
  when no role is assigned; role with no configs shows a one-line nudge
  linking to Settings.

**Decisions locked:**
- Expectations ride on `GET /api/direct-reports/{id}` rather than a separate
  endpoint — the detail page already fetches it, and prep reuses the same
  helper server-side.
- Prompt behavior: expectations are grounding context, not an agenda — the
  prompt explicitly forbids auditing every expectation in one 1:1.
- Graceful degradation contract: no role → no section, no prompt block, no
  errors (per the standing constraint).

**Next step:**
Resume the dashboard roadmap: standalone log-a-meeting flow ("Log a 1:1"
button on the DR detail page straight to the summary + commitments form,
reusing prep step 3) for ad-hoc conversations that happen without prep.
Deploy note: backend + frontend changes ship together (the page tolerates a
missing `expectations` key, so ordering isn't critical, but the section only
appears once the backend is live).

---

## Session 6 — 2026-08-01

**Goal:** Settings page — the configuration backbone connecting people, roles,
and performance expectations (pulled forward ahead of the dashboard roadmap).

**What was done:**
- Reviewed the original Settings mockup on the Miro board (4 frames: Job,
  Company, Capacity & Recruitment, Project — each with Edit Access +
  Create/Update cards) and agreed the v1 section structure with Andrew.
- Created `backend/routes/settings.py` (registered under `/api/settings`):
  - `GET/PUT /profile` — manager name + company; first save bootstraps an
    `organizations` row and links `users.org_id` (`_ensure_org()`).
  - `GET/POST/PUT/DELETE /role-levels` — role_levels CRUD. Delete manually
    cleans up `direct_reports.role_level_id` and the three config tables
    (no FK cascade on role_level_id).
  - `GET/POST/PUT/DELETE /expectations/{metrics|skills|values}` — one
    handler over metric_configs / skill_configs / value_configs.
- `direct_reports.py`: `DirectReportIn` accepts `role_level_id`.
- Created `frontend/app/app/settings/page.tsx` — three sections with left
  nav: Profile & Company, Roles & Levels (incl. "who's in which role"
  assigner), Expectations (role-level picker + Metrics/Skills/Values tabs).
- `lib/api.ts`: Profile/RoleLevel/Expectation types + calls; dashboard got a
  Settings link (top right).
- Migrations (both run in Supabase):
  - `2026-08-01_settings_policies.sql` — organizations INSERT/UPDATE policies
    (profile save needs to create the org).
  - `2026-08-01_fix_users_rls_recursion.sql` — HOTFIX: `users_select_own_org`
    subqueried `users` inside its own policy → Postgres "infinite recursion
    detected in policy" (42P17). Every `/api/settings/*` call 503'd (surfaced
    as CORS "Failed to fetch") while the rest of the app worked, since only
    settings routes touch users/org-scoped tables. Fix: SECURITY DEFINER
    `public.current_org_id()`; all org-scoped policies rebuilt on it.
    `schema.sql` patched to match so fresh installs never hit it.
- Verified live end to end: profile loads with the signup-trigger users row,
  roles/expectations sections work.

**Decisions locked:**
- v1 Settings = Profile & Company, Roles & Levels, Expectations. Deferred
  entirely (no placeholder nav): evaluation weighting, scale definitions,
  capacity/recruitment, project settings, Edit Access/permissions — all
  department-tier; today's user is a solo manager.
- Depth: UI-first, minimal table activation. Newly active tables:
  organizations, users, role_levels, metric_configs, skill_configs,
  value_configs. Scale-definition and assessment tables stay dormant.
- Org-scoped RLS must go through `public.current_org_id()` — never inline
  `(select org_id from users ...)` subqueries in policies.
- Expectations attach to a role_level, not a person — a DR inherits
  expectations via their role assignment (Settings > Roles & Levels).

**Next step:**
Either resume the dashboard roadmap (standalone log-a-meeting flow, per
Session 5b) or make expectations visible where they matter: surface the
assigned role's expectations on the DR detail page and feed them into the
1:1 prep prompt — that's the first payoff of the Settings backbone.

---

## Session 5 — 2026-08-01

**Goal:** Commitment tracker UI — surface and resolve commitments (they could
be created and fed into prep, but never viewed or closed anywhere).

**What was done:**
- Created `backend/routes/commitments.py`:
  - `GET /api/commitments` — lists the manager's commitments, optional
    `direct_report_id` and `status` query filters, joins `direct_reports(name)`
    and flattens it to `direct_report_name` (for future dashboard use).
  - `PATCH /api/commitments/{id}` — set status to open/done/dropped; sets
    `completed_at` on done, clears it otherwise. Scoped by `owner_id`.
- Registered the router in `backend/main.py` under `/api/commitments`.
- `frontend/lib/api.ts`: extended `Commitment` type (status union includes
  `dropped`, added `created_at`, `completed_at`, `direct_report_id`,
  `direct_report_name`), added `getCommitments()` and `updateCommitment()`.
  `PrepResponse.open_commitments_to_check` narrowed to
  `Pick<Commitment, "description" | "due_date">[]` to match what the backend
  actually returns.
- `frontend/app/app/reports/[id]/page.tsx`: new "Open commitments" section
  between About and 1:1 History — checkbox marks done, "Drop" link for
  no-longer-relevant items, red "overdue" styling when `due_date` is past,
  collapsible "Show resolved" list with reopen action.

**Decisions locked:**
- Commitment resolution is checkbox-style on the DR detail page (no separate
  tracker page yet — dashboard rollup is the natural next step).
- `dropped` is a first-class status (already in schema) — dropping is distinct
  from done so accountability data stays honest. Both are reversible via Reopen.
- List endpoint flattens the joined DR name to `direct_report_name` — keeps
  the API shape flat for the frontend.

**Next step (completed in same session — see 5b below):**
Dashboard → mini mission control. Done.

---

## Session 5b — 2026-08-01

**Goal:** Dashboard → mini mission control.

**What was done:**
- Added `GET /api/direct-reports/overview` to `backend/routes/direct_reports.py`:
  every DR with `last_one_on_one_at` and `open_commitment_count`. Three queries
  merged in Python (fine at MVP scale). Declared BEFORE `/{report_id}` so
  FastAPI doesn't match "overview" as an id — keep it that way.
- `frontend/lib/api.ts`: added `TeamOverviewItem` type + `getTeamOverview()`.
- Rewrote `frontend/app/app/dashboard/page.tsx`: per-DR cards (whole card links
  to DR detail) showing role, last-1:1 recency in words, open commitment count,
  and an amber "Time for a 1:1" badge when >21 days or never. Header sub-line
  summarizes how many people are due. Add-report form kept, now with
  loading/disabled state.

**Decisions locked:**
- 1:1 cadence threshold is 21 days everywhere — dashboard badge matches the
  prep prompt's recency logic in `one_on_ones.py`. If one changes, change both.
- Dashboard stays single-column cards (calm > dense grid) until team sizes
  demand otherwise.
- No new endpoint for commitments on the dashboard — the overview endpoint
  carries the count; the DR detail page remains the place to resolve them.

**Next step:**
Standalone log-a-meeting flow: a "Log a 1:1" button on the DR detail page that
goes straight to the summary + commitments form (reuse prep step 3), for
ad-hoc conversations that happen without prep.

---

## Session 4 — 2026-07-17

**Goal:** Implement real AI-assisted 1:1 prep — the core product IP.

**What was done:**
- Rewrote `_build_prep_prompt()` in `backend/routes/one_on_ones.py` with real
  management frameworks: commitment accountability, SBI feedback scaffolding,
  GROW coaching for obstacles, situational signal logic, and a mandatory closing
  question.
- Updated `PrepResponse` Pydantic model: replaced flat `prep_questions` /
  `talking_points` lists with `situation_summary` (str) + `agenda_items`
  (list of `AgendaItem` with `title`, `rationale`, `suggested_questions`).
- Added `AgendaItem` Pydantic model.
- Updated the `/prep` route to query recent 1:1 history (last 3 summaries) and
  compute `days_since_last` — both fed into the prompt for context.
- Prompt now uses `AI_DEFAULT_MODEL_HEAVY` explicitly with `max_tokens=2000`.
- Fixed `log_one_on_one` to include `source_type`/`source_id` on commitment
  inserts (aligns with the polymorphic commitments schema from Session 3).

**Decisions locked:**
- Prep output shape: `situation_summary` + `agenda_items[]` (not flat Q&A lists).
  Frontend should render each item as a collapsible card with title, rationale,
  and questions.
- Closing question is mandatory — always the last agenda item.
- Commitment review is always the first agenda item when commitments exist.
- `max_tokens=2000` for prep (up from default 1500) to give room for 3–5
  structured items.

**Next step (completed in same session — see below):**
Wire the `/prep` endpoint to the frontend. Done.

---

## Session 4b — 2026-07-21

**Goal:** Wire the 1:1 prep backend to the frontend.

**What was done:**
- Added `GET /{report_id}` endpoint to `backend/routes/direct_reports.py` (was missing).
- Updated `frontend/lib/api.ts`:
  - Added TypeScript types: `DirectReport`, `OneOnOne`, `Commitment`, `AgendaItem`, `PrepResponse`.
  - Added `getDirectReport(id)` and `getOneOnOneHistory(directReportId)` functions.
  - Typed return values on all existing functions.
- Created `frontend/app/app/reports/[id]/page.tsx` — DR detail page showing name,
  role, notes, and full 1:1 history list. "Start 1:1 prep →" button links to prep page.
- Created `frontend/app/app/reports/[id]/prep/page.tsx` — 3-step prep flow:
  - Step 1: freeform notes input + "Generate prep sheet" button
  - Step 2: `situation_summary` (blue card), open commitments reminder (amber card if any),
    and collapsible `agenda_items` cards (first open by default)
  - Step 3: log the meeting (summary textarea + new commitments one-per-line → parsed into
    individual commitment rows on save), redirects to DR detail on success.

**Decisions locked:**
- Agenda items render as collapsible cards with rationale as italic subtext and
  suggested questions as indented list. First card open by default.
- New commitments on log step are split by newline — simplest UX, avoids a
  dynamic "add another" form that adds complexity.
- On successful log, redirect to DR detail page (not dashboard) so history is visible.

**Next step (completed in same session — see below):**
Backend deployed to Railway. Frontend Vercel deploy is next.

---

## Session 4c — 2026-07-21

**Goal:** Wire Supabase Auth so the full flow is end-to-end testable.

**What was done:**
- Created `frontend/app/auth/callback/route.ts` — server route handler that
  exchanges the Supabase magic link `code` param for a session cookie and
  redirects to `/app/dashboard`. Without this, clicking a magic link 404s.
- Created `frontend/middleware.ts` — Next.js middleware that:
  - Runs on all `/app/*` routes
  - Calls `supabase.auth.getUser()` on every request to refresh stale tokens
  - Redirects unauthenticated users hitting protected routes to `/app/login`
  - Redirects authenticated users hitting `/app/login` to `/app/dashboard`
- Updated `frontend/app/app/login/page.tsx`:
  - Added `emailRedirectTo: ${origin}/auth/callback` to the `signInWithOtp` call
    (required — without it Supabase uses the site URL root, which doesn't handle
    the code exchange)
  - Added loading state + error handling on the auth call
  - Reads `?error=auth_failed` query param from failed callback redirects and
    shows a friendly message
  - "Use a different email" link resets the form after a send

**Decisions locked:**
- Magic link only (no password). Revisit if conversion data says otherwise.
- `/auth/callback` is the canonical redirect URL — must be added to the
  Supabase project's "Redirect URLs" allow-list (Auth → URL Configuration).
  Add both `http://localhost:3000/auth/callback` (dev) and the Vercel prod URL.

**Next step (completed in same session — see below):**
Backend deployed to Railway. Frontend Vercel deploy is next.

---

## Session 4d — 2026-07-21

**Goal:** Get Supabase running and backend deployed to Railway.

**What was done:**
- Fixed `database/schema.sql` — forward reference error (organizations policy
  referenced users before it was created). Restructured to tables-first,
  policies-last. Schema now runs clean in Supabase.
- Additional schema fixes: renamed `full_name` → `name` on direct_reports,
  added `summary` column to one_on_ones, made `org_id` nullable on core tables,
  made `commitments.title` nullable, added `handle_new_user()` trigger to
  auto-create public.users row on auth signup.
- Fixed backend column name mismatches: `user_id` → `manager_id` in
  direct_reports.py and one_on_ones.py; `user_id` → `owner_id` in commitments
  insert.
- Initialized git repo, pushed to github.com/SkiMang07/thesamepage.
- Created `backend/Procfile` (`web: uvicorn main:app --host 0.0.0.0 --port $PORT`).
- Added `backend/.python-version` pinned to 3.11 (pydantic-core build failed
  on Railway without it).
- Backend deployed successfully to Railway.

**Decisions locked:**
- Use Supabase legacy API keys (`eyJ...` format) — new `sb_publishable_` format
  not confirmed compatible with SDK versions in requirements.txt.
- Python 3.11 pinned via `.python-version` for Railway builds.
- `FRONTEND_URL` in Railway set to placeholder — must be updated to real Vercel
  domain after frontend deploy, then Railway redeployed.

**Next step:**
Deploy frontend to Vercel:
1. vercel.com → New Project → import SkiMang07/thesamepage → root dir: `frontend`
2. Env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy),
   NEXT_PUBLIC_BACKEND_URL (Railway domain)
3. After deploy: update FRONTEND_URL in Railway to real Vercel domain → redeploy.
4. Add `https://your-app.vercel.app/auth/callback` to Supabase Auth → URL
   Configuration → Redirect URLs.

---

## Session 3 — 2026-07-17

**Goal:** High-fidelity mockup of all 5 core screens + full schema architecture
aligned with the Miro board.

**What was done:**
- Created `mockup.html` — self-contained interactive HTML mockup with Tailwind
  CDN covering all 5 screens: Marketing Home, Manager Dashboard, Direct Report
  Detail (Priya Patel), 1:1 Prep (3-step flow), and Commitment Tracker.
- Reviewed the Miro board (`https://miro.com/app/board/uXjVNh7GuDE=/`) directly.
- Rewrote `database/schema.sql` from 4 tables to 28 tables to fully reflect the
  Miro board's data model.
- Answered all pre-build architecture questions (hierarchy, privacy, goals, etc.)

**Decisions locked:**
- Schema expanded from 4 → 28 tables. See ENGINEERING.md for full table list.
- Hierarchy: `users.manager_id` self-ref. Director/VP sees everything except
  1:1 notes. 1:1 notes are private to the writing manager only.
- `manager_report_connections` join table is explicit (was on the Miro board) —
  not inferred from the users tree.
- Role levels (`role_levels` table) are the central connecting concept for
  metrics, skills, and values configs.
- Metric/Skill/Value configs follow identical pattern: a config table + a
  `_scale_definitions` companion table with evaluation points 1–4 (quantitative
  output, qualitative output, optional numeric range).
- Goals: `parent_goal_id` self-ref; levels are company/department/team/individual.
- Commitments: polymorphic `source_type` + `source_id` (one_on_one/goal/
  project/manual).
- Assessment levels: stable ordinal (1–5) + configurable label per org.
- Development plans: separate tables for aspirations, opportunities
  (skills/knowledge), training (with projected cost), and manager notes.
- IC login: infrastructure is in schema (`user_id` nullable on `direct_reports`),
  but not built for MVP.
- Stripe is still NOT next.

**Next step:**
Begin backend implementation on top of the new schema. First priority is
`_build_prep_prompt()` in `backend/routes/one_on_ones.py` — the AI-assisted
1:1 prep endpoint. The prompt should incorporate real management frameworks
(commitment review, situational question logic, feedback scaffolding), not
generic questions. Confirm with Andrew before starting in case priorities shifted.

---

## Session 2 — 2026-07-17

**Goal:** Reset from scaffold confusion, confirm tech stack, establish
documentation strategy.

**What was done:**
- Clarified project identity: "The Same Page" = the new management tool.
  A separate agent-builder project with the same name will eventually be
  renamed. No code changes needed now.
- Confirmed the July 14 scaffold is valid and in the right folder
  (`/01 Projects/The Same Page/`).
- Restructured documentation system:
  - `CLAUDE.md` → short TOC/index (read first, routes to other docs)
  - `docs/ENGINEERING.md` → stack, conventions, auth, AI call patterns, scope rules
  - `docs/GTM.md` → pricing, ICP, growth strategy, content plan, competitive landscape
  - `docs/DESIGN.md` → design framework, principles, decisions log
  - `docs/SESSION_HISTORY.md` → this file

**Decisions locked:**
- Tech stack confirmed: FastAPI + Supabase backend (Railway), Next.js frontend
  (Vercel), Tailwind CSS, Anthropic Claude via `ai_core.py`.
- Documentation structure above is the canonical system going forward.
  New decisions belong in the relevant doc, not in CLAUDE.md directly.
- Stripe is explicitly NOT next — it's premature until there's a working product.

**Next step (superseded by Session 3):**
Build the first real feature: AI-assisted 1:1 prep (`_build_prep_prompt()`).
See Session 3 for current state.

---

## Session 1 — 2026-07-14

**Goal:** Build project scaffold.

**What was done:**
- Created full project folder structure (`backend/`, `frontend/`, `database/`)
- Implemented FastAPI backend with `main.py`, `config.py`, `utils.py`, `ai_core.py`
- Implemented routes: `direct_reports.py` (full CRUD), `one_on_ones.py` (list,
  create, AI-assisted prep endpoint stubbed)
- Created `database/schema.sql` with 4 tables and RLS policies
- Created Next.js frontend with App Router, `(marketing)/` pages (home, pricing,
  blog), `app/` pages (login, dashboard), `lib/api.ts`, `lib/supabase.ts`
- Wrote `CLAUDE.md` (engineering reference) and `PRODUCT_VISION.md` (full vision
  pulled from Andrew's Miro board)

**Decisions locked:**
- Stack: FastAPI + Supabase + Next.js (see ENGINEERING.md for rationale)
- 4-table schema: direct_reports, one_on_ones, commitments, subscriptions
- `get_authenticated_client()` pattern for all protected routes
- All AI calls through `ai_core.py`

**Next step (at time):** Fill out `_build_prep_prompt()` with real frameworks
OR wire Stripe. (Resolved in Session 2 — 1:1 prep content is next.)
