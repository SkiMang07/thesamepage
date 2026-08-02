# The Same Page — Session History

One entry per session. Read the most recent entry first — it tells you the
current state and what to do next so you don't relitigate past decisions.

Format per entry:
- **Date + session goal**
- **What was done**
- **Decisions made / locked**
- **Next step**

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
