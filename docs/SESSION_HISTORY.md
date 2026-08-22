# The Same Page — Session History

One entry per session. Read the most recent entry first — it tells you the
current state and what to do next so you don't relitigate past decisions.

Format per entry:
- **Date + session goal**
- **What was done**
- **Decisions made / locked**
- **Next step**

This file keeps the **5 most recent sessions in full detail**. Older sessions
are compacted below to their goal plus key locked decisions; older sessions
are archived in full at `docs/SESSION_HISTORY_ARCHIVE.md`. The tsp-push skill
maintains this split automatically — it appends new entries here and rolls
the oldest full entry into the archive (with a fresh compact summary left
behind) each time the count exceeds 5.

---

## Session 53 — 2026-08-22

**Goal:** Build Goals and Projects per the Option A direction Session 52 locked (KPI strip + border-l-4
card grid + inline-SVG progress ring), matching the visual language Team (Session 24) and the Person
page (Session 50) already shipped. A build session, not a design session — direction was pre-approved
via the published "Goals and Projects Redesign Options" canvas.

**What was done:**
- `frontend/app/app/goals/page.tsx` — widened `max-w-3xl` → `max-w-7xl`; added a `KpiStrip` (4
  gradient tiles: goals on track, at risk, due this week, no initiative attached — scoped to
  whichever level tab is currently selected, so the strip moves with the tab the same way Team's
  strip moves with its team-selector filter); kept the level-tab pill row, unretired; replaced the
  plain bordered `<ul>` list with a responsive `GoalGrid` of `border-l-4` accented cards
  (`STATUS_BORDER`/`STATUS_STYLES` ported verbatim from `team/page.tsx`, same hex values), each
  carrying its own inline-SVG `ProgressRing` (same donut path/stroke as Team's `GoalsCard` ring, but
  driven by the single goal's own `progress` instead of an aggregate — renders an honest em-dash when
  no check-in exists rather than a fabricated 0%). `CheckInPanel` reused as-is inside each card;
  add/edit forms untouched, just refit (the edit form now spans the full grid row).
- `frontend/app/app/projects/page.tsx` — same treatment, no level tabs (flat list grouped by
  assignee, unchanged from before). `KpiStrip`'s 4th tile is "no goal attached" — the inverse of
  Goals' "no initiative attached," completing the goals=what/projects=how cross-check from the other
  direction. `ProjectGrid` mirrors `GoalGrid`'s card shape exactly.

**Decisions made / locked:**
- Only the on-track fraction tile gets the dynamic gray/amber/green tone (Team's exact data-trust
  rule: a fraction tile must never render a fixed "success" color — "0/N on track" is not success);
  the other 3 tiles (at risk, due this week, no-initiative/no-goal) use a fixed tone regardless of
  count, matching how Team's own `KpiStrip` treats its non-fraction tiles.
- The progress ring stays a fixed green stroke regardless of goal/project status — an exact port of
  Team's ring, which is status-agnostic — rather than inventing a per-status recoloring convention
  the source doesn't have.
- Card left-accent uses `border-l-4` plus the ported `STATUS_BORDER` class with no competing
  all-sides border class on the card (same technique Team's list items use), so the ported hex
  values apply unmodified instead of needing a new directional-border map.

**Verification:** Frontend-only change (no schema/backend touch). Repo tarred from the device's
working copy (git status clean going in) and rebuilt in the cloud sandbox since `next build` exceeds
device_bash's ~45s per-call cap: fresh `npm install`, `npx tsc --noEmit` clean, `next build` clean
(21/21 routes, `/app/goals` and `/app/projects` both compiled with no errors). Both files written back
to Andrew's disk via the device bridge (mtime-guarded).

**Next step:** Andrew to dogfood both pages live — confirm the KPI counts read right against real
data, and decide whether a level tab with zero goals needs a Person-page-style empty state (currently
still just plain text, unchanged from before this pass).

---

## Session 52 — 2026-08-22

**Goal:** Andrew saw the new persistent sidebar (Session 51) and initially read Mission Control's
missing rail as an oversight, then clarified he knew it was a deliberate Session 51 call ("that page
already is the map") but wanted it reversed anyway — every other page has the rail, and that read as
inconsistent rather than as a deliberate simplification. Also asked to bring Goals and Projects into
the same visual language Team (Session 24) and the Person page (Session 50) already share.

**What was done:**
- `frontend/components/Sidebar.tsx` — now renders on Mission Control too; only `ctx.kind === "none"`
  (login/IC) still suppresses it. The Home link takes an "active" treatment (`bg-black/5 font-semibold
  text-gray-900`) since none of `NAV_GROUPS`' items apply on the home page itself. Header comment
  rewritten to record why Session 51's original call got reversed.
- `frontend/components/AppNav.tsx` — one comment line updated to stop saying the sidebar skips Mission
  Control.
- Goals/Projects: no code touched this session. Scoped via one AskUserQuestion round (Andrew picked
  "mockups first," same process as Team/Person) — mined real tokens from `frontend/app/app/team/page.tsx`
  (KpiStrip's gradient tiles, STATUS_BORDER/STATUS_STYLES hex values, the inline-SVG donut ring) and
  published a 3-option design canvas, "Goals and Projects Redesign Options"
  (https://claude.ai/code/artifact/16006c11-c6ad-49a0-985f-717731b4001e): Option A (direct KPI-strip/
  card port of the Team page pattern), Option B (hierarchy made visually explicit via nested/indented
  company→department→team→individual groups, tabs retired), Option C (exception-first triage mirroring
  Mission Control's own Goals card, plus a scope switcher folding in the org-unit rollup need) — plus
  one Projects artboard applying Option A's treatment as a concrete example.

**Decisions made / locked:**
- Mission Control gets the sidebar after all — Session 51's "already the map" reasoning was sound on
  paper but read as inconsistent in practice; every authenticated page now shows the same rail.
- Goals/Projects redesign direction: **Option A** — KPI strip (4 gradient tiles) + card grid using the
  border-l-4 status accent + inline-SVG progress ring, level tabs on Goals kept as a pill-style filter
  rather than retired. Locked in; not yet built.

**Verification:** Frontend-only change (Sidebar/AppNav), no schema/backend touch. Repo tarred from the
device's working copy (git status was clean going in — Session 51's own changes were already committed,
its stale `.git/index.lock` resolved before this session started) and rebuilt in the cloud sandbox since
`next build` exceeds device_bash's ~45s per-call cap: fresh `npm install`, `npx tsc --noEmit` clean,
`next build` clean (21/21 routes). The mockup canvas is exploration only — no build/type verification
applies to it.

**Next step:** Build Goals and Projects per Option A — KPI strip + border-l-4 card grid, matching the
token values in the published canvas and in `frontend/app/app/team/page.tsx`. Widen both pages from
`max-w-3xl` to `max-w-7xl`. Leave the add/edit forms alone this pass (out of scope per the canvas
brief) — just fit the "+ Add" affordance into the new layout.

---

## Session 51 — 2026-08-22

**Goal:** Andrew flagged that the persistent nav (Sessions 36-38's "hub & orbit") felt cluttered —
the header's breadcrumb and the orbit strip's zone chip both restated the same "where am I" context
in two different idioms stacked on top of each other. Worked through it as a design exploration first
(a multi-artboard "Top Nav Options" canvas comparing four directions), landed on a combined approach,
then built it.

**What was done:**
- Explored via a published Claude Design canvas ("Top Nav Options") comparing four directions against
  the real AppNav.tsx tokens, then a rough combined-approach pass across Mission Control/Team/an
  individual page plus a collapsible-sidebar mockup — Andrew approved the combined direction: a fully
  static top bar everywhere, a persistent left rail on every page except Mission Control, and the
  roster switcher kept only on person-kind pages.
- `frontend/components/AppNav.tsx` reworked: removed the breadcrumb ("here" slot) entirely, removed
  the zone-chip + item-switcher row and the all-areas map overlay (`mapOpen` state and its Escape
  handler) since the sidebar now covers that job; added a global "+ Quick add" button (moved from the
  dashboard) next to Scribe. The roster switcher row is unchanged in markup, but now renders only for
  `ctx.kind === "person"` (previously also rendered, with a zone chip, for "item" kind).
- `frontend/components/Sidebar.tsx` (new) — persistent left rail built from `ZoneMap.tsx`'s existing
  `NAV_GROUPS`/`HOME_ITEM`/`HUE_STYLES` (no new nav config, no duplicated route list): a "Mission
  Control" link, a divider, then every group's items flattened into one list, active item tinted by
  its group's hue. Collapses to a 56px icon-only rail (native `title` tooltips) via a toggle button;
  not rendered on `ctx.kind === "home"` or `"none"`.
- `frontend/lib/sidebar-context.tsx` (new) — collapse state, persisted to `localStorage` (a durable
  per-device preference, unlike `drawer-context.tsx`'s sessionStorage-backed open state).
- `frontend/lib/quick-add-context.tsx` (new) — Quick Add's open/close state, lifted out of the
  dashboard page (mirrors `drawer-context.tsx`'s shape). AppNav renders the actual `<QuickAddModal>`
  (reusing `useZoneData()`'s already-fetched roster for the `directReports` prop, no new fetch); other
  pages just call `useQuickAdd().open()`.
- `frontend/app/app/layout.tsx` — added `SidebarProvider`/`QuickAddProvider`, renders `<Sidebar />` as
  a flex sibling of the main-content column (same shape as the Scribe drawer on the other side), gated
  by the same `showNav` check as AppNav.
- `frontend/app/app/dashboard/page.tsx` — removed the local `quickAddOpen` state, the page's own
  "+ Quick add" button, and the `<QuickAddModal>` render; the "add your first direct report" empty
  state now calls the shared `useQuickAdd().open()`.

**Decisions made / locked:**
- Mission Control gets no sidebar — it already is the map (its own card grid + inline `ZoneMap` are
  the between-section navigation), so a persistent rail there would restate what's already on screen.
  Every other page gets one.
- The all-areas map overlay (opened from the old zone chip) is retired, not preserved behind a new
  trigger — the sidebar already puts every section one click away from anywhere, so a separate
  "jump to any zone" sheet no longer earns its keep. Flagged to Andrew rather than silently dropped.
- Quick Add's `onCreated` now calls `router.refresh()` instead of the dashboard's own `loadDashboard()`
  reload — a known, accepted regression: pages with client-fetched data (dashboard, team, goals, ...)
  won't auto-refresh after a global Quick Add the way the dashboard-local button used to. Worth a
  follow-up if it's annoying in practice; not worth a global data-refresh bus for this pass.
- Collapsed-sidebar labels use native `title` tooltips, not a custom tooltip component — a reasonable
  v1, flagged to Andrew at mockup time (docs/DESIGN.md's entry has the rest).

**Verification:** frontend-only change, no schema/backend touch, so no migration and no Postgres test
this pass. Cloned the repo into the cloud sandbox (device_bash's ~45s cap is too short for `next
build`) at the exact commit the device-side working copy was on, applied all six file changes there,
then: fresh `npm install`, `npx tsc --noEmit` clean, `next build` clean (19/19 routes — Mission
Control, Team, Goals, Projects, Capacity, Org, Knowledge, Settings, and Assessments all statically
generated without throwing, which exercises the new AppNav/Sidebar/provider tree on every one of
them). Runtime smoke-testing via `next start` wasn't possible in the sandbox (no live Supabase
credentials), so middleware-gated pages weren't hit with a real request — build-time render + tsc are
the verification for this pass.

**Known snag:** the device-side working copy has a stale, zero-byte `.git/index.lock` that this
session's device-bash bridge can't delete (no delete permission on the mount) — git refuses `add`/
`commit` until it's cleared. Not caused by this session's changes; the six file writes themselves
landed fine via the file bridge (confirmed with `git status --short`/`diff --stat` showing exactly the
expected diff, nothing else). Andrew needs to delete that lock file himself before running the commit
block (a plain `rm .git/index.lock` in his own terminal, where he has full permissions).

**Next step:** Andrew: delete the stale `.git/index.lock`, then run the commit block. After that,
dogfood the new nav for real — try the sidebar collapse toggle, jump between a couple of sections,
open a direct report's page and confirm the roster strip still switches people correctly, and open
Quick Add from a page other than Mission Control to confirm it still works end-to-end.

---

## Session 50 — 2026-08-21

**Goal:** Rebuild `/app/reports/[id]` (the individual DR detail page) from a single-column wall of
~10 form-heavy sections into an engaging hub, per the "Command Deck" mockup Andrew approved the same
day (see the person_page_redesign project memory note and the "Person Page" mockup artifact).

**What was done:**
- `frontend/app/app/reports/[id]/page.tsx` rebuilt in place: an indigo identity band (avatar
  initials, name, rating pill from `scorecard.overall`, role · team subtitle, About note, Log 1:1 /
  Resume-or-Start prep CTAs, a gear button); a 4-tile KPI strip (last 1:1 + days to next resolved-
  cadence-aware, open commitments + overdue count, goals on track with the same data-trust-aware tone
  logic as `/app/team`'s KpiStrip, capacity available this week via `getCapacityOverview` over a
  rolling 7-day window); three columns — Conversation (Next-1:1 cockpit with derived "Worth raising"
  talking points + one-click "+ Agenda", a between-sessions capture box, private Manager Notes), Work
  (Goals/Initiatives with status-border accents + progress bars only where check-in data exists,
  Recent 1:1 sessions capped at 6), Person (Open commitments, an inline-SVG Assessment ring, the rest
  of Development, Expectations as chips instead of paragraph lists — role-assignment flow preserved
  unchanged). Admin inputs (1:1 cadence, capacity, time off) moved behind the gear into a settings
  drawer, off the main flow.
- New `dr_capture_notes` table (`database/migrations/2026-08-21_dr_capture_notes.sql`, folded into
  `database/schema.sql`) — the capture box's storage, scoped via one AskUserQuestion round before
  writing the migration (new small table vs. attaching to the planned one_on_ones row; the table won
  because a capture can happen before any planned session exists, and a planned row today is only
  ever created BY `/prep`). Flat `manager_id = auth.uid()` RLS policy, same pattern as `commitments`.
- `backend/routes/one_on_ones.py` — 3 new endpoints: `GET`/`POST /{direct_report_id}/captures`,
  `DELETE /captures/{capture_id}`. Kept in this router rather than a new file since captures are
  tightly coupled to `/prep`, which already owns it.
- `frontend/lib/api.ts` — `CaptureNote` type + `getCaptureNotes`/`createCaptureNote`/`deleteCaptureNote`.
- `frontend/app/app/reports/[id]/prep/page.tsx` — step 1's raw-notes textarea now prefills from
  unconsumed captures for that report (oldest first) and deletes them once a sheet generates
  (best-effort, non-blocking on failure) — this is how a capture "lands on the next prep sheet."

**Decisions made / locked:**
- `dr_capture_notes` is its own small inbox table, not a column on `one_on_ones` — see above; avoids
  a new "draft planned session with no prep_guide yet" state the rest of the app doesn't model.
- `DevelopmentSection` (Session 47-49) keeps ALL its original state/handlers in one component but now
  takes a `section: "notes" | "growth"` prop and renders only half its JSX per mount — private
  manager notes in Col 1, plan/aspiration/opportunities/training in Col 3 — rather than being split
  into two components that would each need their own copy of the bundle-mutate-refetch logic.
- "Worth raising" talking points and the KPI strip are entirely derived client-side from data the
  page already fetches (overdue commitments, at-risk goals, dev plan text, last 1:1 summary) — no new
  backend computation, matching the scoping note's explicit constraint.
- Goal progress bars only render where `progress` is non-null (a real check-in exists) — same Session
  19 restraint precedent, not fabricated from status alone.

**Verification:** unusually thorough given the size of the change and device_bash's ~45s per-call
cap (too short for a full `next build` or fresh `npm ci`/`pip install`) — reconstructed both the
frontend and backend in the cloud sandbox from the connected folder instead. `npx tsc --noEmit`
clean; fresh `npm ci` + `next build` clean (19/19 routes, no type/lint errors); `python3 -m py_compile`
clean on every touched + dependent backend file; a sandboxed `main.py` import (fresh venv, dummy
`.env`) confirmed 121 → 124 routes with the 3 new capture endpoints and zero path collisions; a real
local Postgres 16 test via `database/local_verify_stub.sql`'s documented flow, run TWO ways — fresh
`schema.sql` with the table baked in, and the ORIGINAL pre-session `schema.sql` + the standalone
migration file (what actually happens against live Supabase) — both clean; an RLS functional test
(two managers, `set role authenticated` + `set_config`) confirmed manager-scoped isolation and that a
spoofed insert (wrong `manager_id`) is blocked by the policy's `WITH CHECK`.

**Next step:** Run `database/migrations/2026-08-21_dr_capture_notes.sql` against live Supabase — the
capture box and "+ Agenda" buttons error until the table exists. Then Andrew dogfoods: try the capture
box, a few "+ Agenda" clicks, the settings drawer, and sanity-check the assessment ring and goal
progress bars against a real report.

---

## Session 49 — 2026-08-21

**Goal:** Andrew's second round of feedback on Development (Sessions 47/48): the AI-assist he asked
for had landed on Manager Notes (private commentary he explicitly said is fine as-is), not on the
actual development plan. He wants a dedicated place to write and build the plan itself, with Draft
with AI / Revise with AI as optional assists on that surface specifically.

**What was done:**
- New `development_plans.plan_text` column (migration `2026-08-21_development_plan_text.sql`) — a
  single freeform field, upserted in place (unlike the append-only `dev_plan_manager_notes`), the
  primary always-writable plan narrative.
- `backend/routes/development.py`: new `PUT /{direct_report_id}/plan` — updates `plan_text` via
  `_get_or_create_plan` plus a plain update, same "update the one row" shape as `upsert_aspiration`
  but simpler (no separate table). `DevelopmentDraft.manager_note` renamed `plan_note` (draft
  prompt's JSON key/wording updated to match) so `/draft`'s synthesis suggestion targets the
  plan-text box, not manager notes. `POST /{id}/notes/revise` is now dual-purpose — the same
  evidence-grounded, always-answerable revise operation backs both the plan-text box and the
  (unchanged) manager-notes box, since the operation doesn't care which field the text belongs to.
- `frontend/lib/api.ts`: `DevelopmentPlan.plan_text`, new `updateDevPlanText()`,
  `DevelopmentDraft.plan_note`, `reviseDevManagerNote` renamed `reviseDevText` (generic, shared by
  both surfaces now).
- `frontend/app/app/reports/[id]/page.tsx`'s `DevelopmentSection`: new "Development plan" text box
  at the top of the section, under the "Draft with AI" header button — always editable, `Save`
  (enabled only when dirty), `Revise with AI`, and an "AI suggested" callout with "Use this"/
  "Dismiss" when `runDraft()` returns a `plan_note`. Manager Notes reverted to exactly its Session
  48 shape (textarea, Add, Revise with AI) minus the AI-suggestion callout that had been misrouted
  there.

**Decisions made / locked:**
- Manager notes and the development plan are two genuinely separate concepts — private commentary
  vs. the actual plan artifact — and stay on separate DB fields/UI surfaces rather than merging, per
  Andrew's explicit correction.
- `/notes/revise` is intentionally reused, not duplicated into a second endpoint, for both surfaces
  — revising text the manager already wrote is the same operation regardless of destination field;
  only the frontend caller differs.
- Opportunities/Training/Aspiration were left untouched — legitimate structured sub-objects
  (assessment-linked, budget/career decisions) that the freeform plan-text box complements rather
  than replaces.

**Verification:** `python3 -m py_compile` clean; sandboxed `main.py` import confirms 121 total
routes with the new `PUT /api/development/{direct_report_id}/plan` registered, no collisions.
Frontend: `npx tsc --noEmit` and `next build` both clean (19/19 routes). Schema: fresh `schema.sql`
apply against a local Postgres 16 (Supabase auth/storage stub) — zero errors, `plan_text` column
present with the right type/nullability; migration applies and is idempotent on re-run. Functional:
bootstrapped a plan, updated `plan_text` in place, confirmed a second manager sees zero rows (RLS
isolation holds).

**Next step:** Run `database/migrations/2026-08-21_development_plan_text.sql` against live Supabase
— the plan-text box 500s until that column exists. Then Andrew dogfoods the new box directly: write
a plan from scratch on a thin-evidence report, try "Draft with AI" (should suggest into the new box,
not Manager Notes), try "Revise with AI" on hand-typed text.

---

## Archived sessions (compact index)

Each line below is the goal plus the key decisions locked in that session —
enough to know if it matters to what you're doing now. Full entries
(what was done, verification, deviations) are in
`docs/SESSION_HISTORY_ARCHIVE.md`, newest-first, unchanged from their
original text. Open that file when you need the full detail behind a
specific decision.

- **Session 48 — 2026-08-21:** Fix the manager-note flow being accidentally AI-gated by adding manual entry as the default everywhere, with AI as an optional assist (new "Revise with AI" alongside the existing "Draft with AI"). **Decided:** Draft (evidence-gated, can honestly return nothing) and revise (always answerable, evidence only for grounding) are intentionally different-shaped operations, not one prompt behind a flag.
- **Session 47 — 2026-08-20:** Scope and build Development (individual plans + a lightweight team "training focus" note), activating dormant `development_plans`/`dev_plan_*` schema from the original scaffold. **Decided:** Aspirations and training are never AI-drafted — only opportunities + a synthesis note, where evidence-grounding actually applies; team dev focus reuses team_callouts' exact upsert/uniqueness mechanics rather than a new pattern.
- **Session 46 — 2026-08-20:** Give projects an optional team attachment and make `/app/team`'s Goals/Initiatives cascade down from parent departments instead of exact-matching only. **Decided:** Hierarchy inheritance applies only to goals/projects on `/app/team` (commitments, roster, meeting notes, callouts stay exact-match); the leadership-rollup endpoint was deliberately left unchanged (different hierarchy concept), flagged as a follow-up.
- **Session 45 — 2026-08-19:** Add a team name + dropdown to `/app/team` so a manager leading multiple `org_units` can tell which team's data they're viewing, and filter the page by picking one. **Decided:** `team_callouts.org_unit_id` is `ON DELETE CASCADE` (not `SET NULL` like `team_meeting_notes`) — found via a real Postgres test, needed because of the two-partial-unique-index uniqueness rule; `GET /callout` changed from one object to a list, a breaking response-shape change.
- **Session 44 — 2026-08-18:** Build Role JD Import (`docs/ROLE_JD_IMPORT_SCOPING.md`): paste/drop a JD, one AI call proposes role identity + ladder match + drafts expectations, manager reviews, one commit lands it. **Decided:** No migration needed — every column this flow writes already existed; collision resolution is server-side first (draft already flags `exists`), frontend only handles manager-created collisions; the JD file is never stored (role config, not a Context Engine document).
- **Session 43 — 2026-08-18:** Polish pass (Plan §7.3, last of 5 team-setup UX sessions): People archive/edit, People-row rework, data-trust fixes, org-wide values, ladder-merge nudge. **Decided:** Two mutually-exclusive lists (active/archived), not one client-filtered list — archived fetch only pays when a manager expands "Show archived"; `teams_count` keeps its pre-existing meaning (total org units), tile-display split lives in two new fields instead.
- **Session 42 — 2026-08-18:** Build Plan S4+S5 (last of the four S1-S5 setup-UX sessions, `docs/TEAM_SETUP_UX_REVIEW.md` §6) — make half-configured setup state visible everywhere a person appears, and rename/consolidate the setup surfaces (Roles & Levels + Expectations merged into one "Roles & expectations" tab).
- **Session 41 — 2026-08-18:** Build Plan S1 — rebuild Settings → Team as a roster-first "People" section (progress header, inline role/team creation, fix for Quick add's free-text Role dead-end). **Decided:** `role_has_expectations` is null (not false) when no role is assigned, distinguishing "nothing to check" from "checked, found nothing"; inline role/team creation always creates new (no fuzzy-match merge — Roles & Levels' existing merge tool stays the one place for that); email on create is fire-and-forget, no auto-invite.
- **Session 40 — 2026-08-18:** Build Plan S2 — role families, so 13 flat role_levels cards become ~5 ladders (one card per family, levels as rows, "Add L{n+1}" pre-filled, merge tool for near-duplicates). **Decided:** Family name takes over as primary display once a level has one, `job_role` stays as an optional per-level override title; new role creation splits into "+ Add a new ladder" (family+L1 together) vs. "+ Add L{n+1}" (pre-filled, existing ladder); family deletion allowed regardless of level count, UI just steers toward emptying it first.
- **Session 39 — 2026-08-18:** Build Plan S3 — expectations coverage grid + per-role "Draft with AI" (role's stored JD → draft metrics/skills/values, review-then-commit) + org-wide values. **Decided:** Org-wide values = `value_configs.role_level_id IS NULL` — no migration (column already nullable, RLS org-scoped, not role_level-scoped); AI draft leans conservative on role-specific values — prefer empty, company values live in the org-wide block, not duplicated 13x; all new logic in new `expectations_ai.py` on top of settings.py's unchanged CRUD (same shape as assessments.py on direct_reports.py).
- **Session 38 — 2026-08-17:** Polish pass on the persistent nav shipped in Sessions 36/37: top-bar alignment fix, a sticky-nav scroll bug found during verification, Scribe toggle prominence, and a first-ever avatar menu (Settings + Sign out). **Decided:** Nav content aligns to `max-w-7xl` (matching Dashboard/Team); Scribe toggle prominence solved with styling only, no second toggle location; avatar menu is Settings + Sign out only, no multi-org items.
- **Session 36 — 2026-08-16:** Nav rework pass 1 (tracked in code comments and DESIGN.md as Session 36/37; documented here retroactively — Andrew asked to hold… **Decided:** all six recorded directly in `docs/DESIGN.md`'s 2026-08-16 rows — hub & orbit locked in from nav_redesign_options.md; ZoneMap.tsx….
- **Session 37 — 2026-08-16:** Nav rework pass 2 (tracked in code comments as Session 38 — see `docs/ONE_ON_ONES_PAGE_SPEC.md`, the canonical spec for this pass). **Decided:** `resolve_cadence_days()` returns `(days, source)` rather than a bare int — a deliberate deviation from the spec's literal…; `one_on_ones` still has no status column — status stays derived (`planned` = prep_guide set + summary null; `completed` = summary….
- **Session 35 — 2026-08-16:** Widen the Scribe drawer from its fixed 400px to roughly 25–33% of the viewport width, so the conversation and draft cards get more room without…
- **Session 34 — 2026-08-13:** S3 of the Scribe build plan (`docs/AGENT_SCRIBE_SCOPING.md`): Hardening + close-out. **Decided:** **Thread is now fully server-managed.** The client no longer passes a thread to the backend; it only sends the new message + optional page context.; **Page context is ephemeral, not stored.** It's injected into the system prompt per request, not into the `assistant_messages` table..
- **Session 33 — 2026-08-13:** S2 of the Scribe build plan (`docs/AGENT_SCRIBE_SCOPING.md`): Drawer UI + confirm flow. **Decided:** **Commitment confirm path:** `POST /api/commitments` (new endpoint) rather than reusing `POST /api/team/commitments` (which always sets `is_team_commitment = true`).; **`link_project_goal` confirm:** two API calls (GET project, then PUT with goal_id)..
- **Session 32 — 2026-08-13:** S1 of the Scribe build plan (`docs/AGENT_SCRIBE_SCOPING.md`): agent loop + eval harness, no UI. **Decided:** **MVR schema verification:** all six verb schemas were verified against `schema.sql` before locking the system prompt.; **`emit_draft` as the write primitive:** the model calls `emit_draft` (a tool returning `{"ok": true}`) to stage drafts rather than emitting JSON in its text output..
- **Session 31 — 2026-08-12:** Build Session VI of the Context Engine build plan (`docs/CONTEXT_ENGINE_BUILD_PLAN.md`): staleness + precedence surfacing — the final session of the… **Decided:** Staleness threshold set at decay multiplier < 0.7 — a judgment call, not discussed with Andrew; picked because it sits…; Both staleness prompts and scope conflicts reuse the app's existing amber "needs attention" convention rather than inventing a….
- **Session 30 — 2026-08-12:** Build Session V of the Context Engine build plan (`docs/CONTEXT_ENGINE_BUILD_PLAN.md`): the Brain visualization. **Decided:** No new charting/visualization dependency — build-plan Session V suggested reusing "the existing dashboard's orbital/radial…; Decay curve is per-session-simple by design (see above) — real canonical decay weighting stays Session VI's job, not pulled….
- **Session 29 — 2026-08-12:** Build Session IV of the Context Engine build plan (`docs/CONTEXT_ENGINE_BUILD_PLAN.md`): retrieval + agent integration, backend only. **Decided:** `max_docs=4` for tier-two `extracted_text` fetches — a judgment call, not discussed with Andrew: decks can run long and this is a…; Ranking is a documented placeholder (specificity → novelty → recency), not the final design — decay weighting is explicitly….
- **Session 28 — 2026-08-12:** Build Session II (extraction + Librarian pipeline, backend) and, same session, Session III (confirm-card UX, frontend) of the Context Engine build… **Decided:** Extraction call has no OpenAI fallback (see above) — an Anthropic 5xx just fails the upload (`status='failed'`); the user re-uploads.; `document_scopes` stays empty until confirm — a document with no scope row is invisible to Session IV's retrieval cascade until a human sets one..
- **Session 27 — 2026-08-12:** Move the Context Engine (Session 25's framework, `docs/CONTEXT_ENGINE.md`) from settled concept to buildable. **Decided:** All 5 build-plan resolutions above..
- **Session 26 — 2026-08-11:** Started as an open brainstorm from Andrew — goals and initiatives feel inert on Mission Control (cards can't be interacted with, no visible progress,… **Decided:** Check-ins cover both goals and projects in ONE shared table — same status enum, same shape, and the COO-agent temporal layer…; Progress is a manually-asserted % per check-in — honest about the judgment involved..
- **Session 25 — 2026-08-09:** COO agent brainstorm round 2 (follow-up to the Session ~9 agent-hierarchy idea, whose "wait until the data models exist" objection is now resolved). **Decided:** Agent roster (COO + culture/L&D/performance/strategy&ops) is brand, not architecture — one COO agent with per-domain context loaders, split only if quality degrades..
- **Session 24 — 2026-08-09:** Visual/layout redesign of `/app/team` (Team Mission Control), Andrew's explicit ask after dogfooding Session 22/23's 3-column grid — captured at the… **Decided:** Write access stays manager-authored with the team viewing only — the brief's "team member adds their own agenda items" framing is…; Initiatives reuses `getProjects()` filtered client-side to active/on_track/at_risk (Mission Control's existing Key Initiatives….
- **Session 23 — 2026-08-09:** Follow-up on Session 22's Team Mission Control — extend the meeting-notes column with a surfaced "next meeting's agenda" distinct from logged past… **Decided:** Agenda vs. past meeting is derived from `meeting_date`, never a stored status field — same discipline as `one_on_ones`, and…; Team commitments reuse the existing `commitments` table via a flag rather than a new table or true multi-assignee model — a….
- **Session 22 — 2026-08-08:** Expand the `/app/team` page built Session 21 into "Team Mission Control" — a 3-column team-wide surface (roster/priorities left, company+team goal… **Decided:** IC login ships in two passes: the account/claim mechanism now, the IC-facing view as a follow-up.; "Key updates" is scoped conceptually (a manager-authored broadcast feed, distinct from `team_messages`) but has no code yet —….
- **Session 21 — 2026-08-08:** Andrew asked what's next; Claude's read of the project memory (the `team_space_brainstorm` note from 2026-08-03) suggested Team View was the most… **Decided:** Team View v1 is scoped to the caller's own direct reports, matching Mission Control rather than role-scoped views' org_unit…; Messaging ships as store-only groundwork this session rather than deferred to a separate pass — Andrew's explicit call,….
- **Session 20 — 2026-08-08:** Andrew asked to work through `foundation_weaknesses.md` (the 6 structural weaknesses flagged in Session 19) and confirm they're all still active… **Decided:** Rate limiting is per-IP, not per-user, going forward — see the Rate limiting convention in ENGINEERING.md.; The insight cache uses a flat TTL, not write-path invalidation — accepted tradeoff rather than threading cache invalidation into….
- **Session 19 — 2026-08-07:** Andrew reviewed Session 18's Mission Control page and wanted it reworked into a grid — three sections across the top, per his original design intent… **Decided:** AI insight is real AI-generated, not rule-based — Andrew's explicit call, since the insight is meant to be the page's "magic."…; Quick add is a single modal, not a global command palette — Andrew's explicit call, matching the app's current size (not enough….
- **Session 18 — 2026-08-06:** Andrew asked for a few options for next steps given everything built so far. **Decided:** see the 4 scoping answers above — all now reflected in the page's header comment block in `dashboard/page.tsx` and in….
- **Session 17 — 2026-08-06:** Andrew reported the Team settings page had visually overlapping text (screenshot), and separately — a much bigger concern — that he'd gone through… **Decided:** Any Settings sub-section with its own "currently selected X" state should default to lifting that state to `SettingsPage`, not….
- **Session 16 — 2026-08-04:** Asked what the best next step for the app was, given PRODUCT_VISION.md and everything built so far.
- **Session 15 — 2026-08-03:** Role-scoped views — Andrew picked this off the running list of "what's next" options (surfaced at the top of this session by reviewing… **Decided:** See the four AskUserQuestion answers above — all confirmed with Andrew, not defaulted.; **My call, flagged not re-asked** (same pattern as prior sessions' scope notes): any org member can assign any org member as a….
- **Session 14 — 2026-08-02:** Capacity model and planning — Andrew's own framing: help managers/ dept heads understand team bandwidth, and codify how much "work" a team, individual, or department can actually handle.
- **Session 13 — 2026-08-02:** Activate `projects` — the dormant table flagged as "the next candidate in this family" after Goals (Session 10) and Org (Session 11). **Decided:** see above — all confirmed with Andrew via AskUserQuestion before building, same discipline as Sessions 10-12..
- **Session 12 — 2026-08-02:** Split "Team" out of Settings' Roles & Levels into its own section, and add Edit (update-in-place) for role_levels — same "scope first" pattern as… **Decided:** Team is a Settings sub-page, not a top-level nav item and not folded into Org — it's about "who does what," which Andrew judged…; Role assignment + team assignment travel together as one section (Team), not split further..
- **Session 11 — 2026-08-02:** Design (then build) an org hierarchy data model — team/department/ company as real entities, not free text — plus a visual org-chart builder. **Decided:** See "What was done" above — schema shape, the `functional_team` deprecation, builder interaction model, page placement, and the…; `org_units` is org-scoped (`current_org_id()`), unlike `direct_reports`/ `goals` which are manager-scoped….
- **Session 10 — 2026-08-02:** Scope how Goals fits into the product with Andrew (design/scoping conversation, not a build session at first) — then, once placement and shape were… **Decided:** See "What was done" above — placement, DR surfacing, hierarchy scope, and the projects/rollup deferrals were all explicit calls…; `goals`/`projects` RLS is owner_id-scoped, not org-scoped, despite the policy names — documented in `goals.py`'s module docstring….
- **Session 9 — 2026-08-02:** Give managers access to past 1:1 activity from the DR detail page — both completed sessions and in-progress prep sheets. **Decided:** Status is always derived from `prep_guide`/`summary`, never a stored column — one less thing that can drift out of sync.; "Deferred" (from the original ask's planned/completed/deferred sketch) is NOT a tracked status — there's no trigger in the app….
- **Session 8 — 2026-08-01:** Capture what actually happens on the call. **Decided:** Wrap-up is draft-then-review: AI output never enters the record without the manager seeing it.; Commitments are two-sided (`committed_by`); `owner_id` stays the manager (record-keeper) so RLS is untouched..
- **Session 7 — 2026-08-01:** Make the Settings backbone pay off — surface each DR's role expectations on the detail page and ground the AI 1:1 prep in them. **Decided:** Expectations ride on `GET /api/direct-reports/{id}` rather than a separate endpoint — the detail page already fetches it, and…; Prompt behavior: expectations are grounding context, not an agenda — the prompt explicitly forbids auditing every expectation in….
- **Session 6 — 2026-08-01:** Settings page — the configuration backbone connecting people, roles, and performance expectations (pulled forward ahead of the dashboard roadmap). **Decided:** v1 Settings = Profile & Company, Roles & Levels, Expectations.; Depth: UI-first, minimal table activation..
- **Session 5 — 2026-08-01:** Commitment tracker UI — surface and resolve commitments (they could be created and fed into prep, but never viewed or closed anywhere). **Decided:** Commitment resolution is checkbox-style on the DR detail page (no separate tracker page yet — dashboard rollup is the natural…; `dropped` is a first-class status (already in schema) — dropping is distinct from done so accountability data stays honest..
- **Session 5b — 2026-08-01:** Dashboard → mini mission control. **Decided:** 1:1 cadence threshold is 21 days everywhere — dashboard badge matches the prep prompt's recency logic in `one_on_ones.py`.; Dashboard stays single-column cards (calm > dense grid) until team sizes demand otherwise..
- **Session 4 — 2026-07-17:** Implement real AI-assisted 1:1 prep — the core product IP. **Decided:** Prep output shape: `situation_summary` + `agenda_items[]` (not flat Q&A lists).; Closing question is mandatory — always the last agenda item..
- **Session 4b — 2026-07-21:** Wire the 1:1 prep backend to the frontend. **Decided:** Agenda items render as collapsible cards with rationale as italic subtext and suggested questions as indented list.; New commitments on log step are split by newline — simplest UX, avoids a dynamic "add another" form that adds complexity..
- **Session 4c — 2026-07-21:** Wire Supabase Auth so the full flow is end-to-end testable. **Decided:** Magic link only (no password). Revisit if conversion data says otherwise.; `/auth/callback` is the canonical redirect URL — must be added to the Supabase project's "Redirect URLs" allow-list (Auth → URL Configuration)..
- **Session 4d — 2026-07-21:** Get Supabase running and backend deployed to Railway. **Decided:** Use Supabase legacy API keys (`eyJ...` format) — new `sb_publishable_` format not confirmed compatible with SDK versions in…; Python 3.11 pinned via `.python-version` for Railway builds..
- **Session 3 — 2026-07-17:** High-fidelity mockup of all 5 core screens + full schema architecture aligned with the Miro board. **Decided:** Schema expanded from 4 → 28 tables. See ENGINEERING.md for full table list.; Hierarchy: `users.manager_id` self-ref..
- **Session 2 — 2026-07-17:** Reset from scaffold confusion, confirm tech stack, establish documentation strategy. **Decided:** Tech stack confirmed: FastAPI + Supabase backend (Railway), Next.js frontend (Vercel), Tailwind CSS, Anthropic Claude via…; Documentation structure above is the canonical system going forward..
- **Session 1 — 2026-07-14:** Build project scaffold. **Decided:** Stack: FastAPI + Supabase + Next.js (see ENGINEERING.md for rationale); 4-table schema: direct_reports, one_on_ones, commitments, subscriptions.
