> **ARCHIVED — historical, not current intent.** The S1–S5 build sessions this sequenced are all complete.

# Team Setup — Build Session Prompts

**How to use:** four paste-ready prompts, one per fresh Claude session, in build order **S3 → S2 → S1 → S4/S5**. Run them in order — later sessions assume earlier ones are merged and pushed. Each session ends with a commit + push and a short report; paste that report back into the review session (Cowork) for final review after all four are done. Any migration a session produces must be run in the Supabase SQL editor before testing live.

---

## Session 1 — S3: Expectations coverage map + AI draft

```
**Project**
The Same Page — a management OS for first-time managers. Next.js frontend (frontend/), FastAPI backend (backend/), Supabase Postgres with RLS (database/schema.sql). Repo root is this folder; live deploys via GitHub push (Vercel frontend, Railway backend).

**Objective for this session**
Build Plan S3 from docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md §6: an expectations coverage grid plus per-role "Draft with AI" that turns each role's stored job description into draft metrics/skills/values for review-then-commit, and org-wide values support.

**Source of truth**
docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md (§6, Plan S3) is the spec — read it in full before coding. Also read CLAUDE.md, docs/ENGINEERING.md (architecture + conventions), and database/schema.sql (metric_configs / skill_configs / value_configs, all keyed by role_level_id; role_levels.job_responsibilities holds the JD text).

**Active folders and files**
backend/routes/settings.py (expectations CRUD lives here; add new endpoints here or in a new backend/routes/expectations_ai.py registered in main.py), frontend/app/app/settings/page.tsx (Expectations section), frontend/lib/api.ts.

**What is already decided**
Do not relitigate scope — build exactly S3. Endpoints: POST /api/expectations/draft (returns draft, persists nothing), batch-create for committing a reviewed draft, GET /api/expectations/coverage (per-role_level counts of metrics/skills/values). Coverage grid replaces the blind role dropdown as the section's entry point; click a cell to edit. Org-wide values = value_configs.role_level_id NULL (column is already nullable — no migration expected); the role-expectations fetch helper (grep fetch_role_expectations) must union org-wide values into every role's set. AI drafting follows the app's existing draft-then-review pattern (see wrap-up extraction / assessment drafts for the Anthropic client usage); AI failure degrades to the manual forms, never blocks them. No scale definitions in drafts this session.

**What is already completed**
All expectations CRUD, role_levels with JD text, the Settings section shell, rate limiting (slowapi), and the AI client plumbing. Reuse; don't rebuild.

**Constraints and cautions**
RLS: use the security definer current_org_id() pattern; never inline users subqueries in policies. No new UI dependencies. Verify with: python3 -m py_compile on touched backend files, npx tsc --noEmit, and a full npm install + npx next build in an isolated copy. Update docs/SESSION_HISTORY.md with a session entry. Then git add / commit / push to GitHub.

**Immediate next task**
Read docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md §6 Plan S3, then implement GET /api/expectations/coverage first — the grid is the skeleton the rest hangs on. End by writing a short report (what shipped, files touched, migrations to run [expected: none], deviations from the plan) for the review session.
```

---

## Session 2 — S2: Role ladders (role families)

```
**Project**
The Same Page — a management OS for first-time managers. Next.js frontend (frontend/), FastAPI backend (backend/), Supabase Postgres with RLS (database/schema.sql + database/migrations/). Live deploys via GitHub push (Vercel + Railway).

**Objective for this session**
Build Plan S2 from docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md §6: introduce role families so 13 flat role·level cards become ~5 ladders — one card per family, levels as rows inside, "Add L{n+1}" pre-filled from L{n}, JDs collapsed, plus a merge tool for near-duplicate names.

**Source of truth**
docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md (§6, Plan S2) is the spec — read it in full first. Also CLAUDE.md, docs/ENGINEERING.md, database/schema.sql (role_levels: job_role free text + job_level int, org-scoped RLS).

**Active folders and files**
database/schema.sql + new database/migrations/2026-08-XX_role_families.sql; backend/routes/ (new role_families CRUD file registered in main.py; role_levels endpoints gain role_family_id passthrough); frontend/app/app/settings/page.tsx (Roles & Levels section rework + grouped role selects in the Team and Expectations sections); frontend/lib/api.ts.

**What is already decided**
New role_families table (id, org_id, name, created_at), org-scoped RLS; role_levels.role_family_id uuid references role_families(id) on delete set null. The migration backfills one family per distinct (org_id, job_role) and links existing rows; near-duplicates (the "Senior …" variants) are merged manually in the UI afterwards via "Move to another ladder…" on a level row (a PUT changing role_family_id is the whole merge mechanic). Display: family name takes over ("Corporate CSM · L3"); job_role remains as an optional per-level title override. Role dropdowns app-wide (Settings→Team, Expectations coverage grid from Session 1, Capacity work units) become selects grouped by family. Empty families are deletable; orphaned levels fall into an "Ungrouped" bucket.

**What is already completed**
Session 1 (S3) shipped the expectations coverage grid — group its rows by family, don't rebuild it. role_levels CRUD and RLS patterns exist.

**Constraints and cautions**
RLS: current_org_id() security definer pattern only; never inline users subqueries. Schema changes go in BOTH the migration file AND schema.sql (kept on HEAD). Test schema by running the full schema.sql, then the migration, against a local Postgres. The migration must be run manually in the Supabase SQL editor — flag it prominently in your report; nothing works live until it runs. Verify: py_compile, npx tsc --noEmit, isolated next build. Update docs/SESSION_HISTORY.md. Commit + push.

**Immediate next task**
Read docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md §6 Plan S2, then write the migration (table + column + backfill) and mirror it into schema.sql before touching any UI. End with a report: files touched, the migration to run, deviations.
```

---

## Session 3 — S1: Guided team-setup flow ("People")

```
**Project**
The Same Page — a management OS for first-time managers. Next.js frontend (frontend/), FastAPI backend (backend/), Supabase Postgres with RLS. Live deploys via GitHub push (Vercel + Railway).

**Objective for this session**
Build Plan S1 from docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md §6: rebuild Settings → Team as a roster-first "People" section that walks people → teams → roles → expectations in one place — progress header, inline creation of roles/teams from the pickers, and a fix for Quick add's dead-end free-text Role field.

**Source of truth**
docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md (§6, Plan S1) is the spec — read it in full first. Also CLAUDE.md, docs/ENGINEERING.md, database/schema.sql (direct_reports has role_level_id, org_unit_id, and legacy role_title free text).

**Active folders and files**
frontend/app/app/settings/page.tsx (Team section → People, promoted to right after Profile & Company); frontend/app/app/dashboard/page.tsx (Quick add modal, Direct report tab); frontend/components/ZoneMap.tsx (Foundation door's "not finished" state); backend: new GET /api/setup-status (reuses Session 1's coverage query); frontend/lib/api.ts.

**What is already decided**
Roster table: one row per person — name, role picker, team picker, expectations chip (✓ / "role has none → draft" deep-linking into the Expectations section / amber "no role"). Pickers are typeahead selects grouped by role family (Session 2) / org unit, each with "+ Create new…" opening an inline modal — no navigation away. Add-person row at the bottom (name + optional email). Progress header: four steps (people / teams / roles / expectations) with counts, deep-linking. Quick add's free-text "Role (optional)" becomes the same role typeahead; STOP writing direct_reports.role_title — existing values render only as a hint next to an unassigned picker ("was: 'Account Executive'"); do not drop the column this session. setup-status feeds the header, the roster badges, and the Foundation door (replaces its static hook). Per-person capacity overrides stay on the person page — this surface is wiring, not tuning.

**What is already completed**
Sessions 1–2 (S3 coverage endpoint + AI draft; S2 role families + grouped selects). Both assign helpers in frontend/lib/api.ts already preserve the sibling field (role↔org_unit) on PUT — keep that invariant. Org unit CRUD, direct report CRUD, and RLS all exist; no policy changes needed (role_levels/org_units org-scoped, direct_reports manager-scoped).

**Constraints and cautions**
No new UI dependencies. Verify: py_compile, npx tsc --noEmit, isolated next build. Update docs/SESSION_HISTORY.md. Commit + push. No migration expected.

**Immediate next task**
Read docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md §6 Plan S1, then build GET /api/setup-status first — every UI piece reads it. End with a report: what shipped, files touched, migrations [expected: none], deviations, and a timed note on the golden-path walkthrough (add fake person → role → team → AI-draft expectations; target under 5 minutes).
```

---

## Session 4 — S4/S5: Visibility + naming pass

```
**Project**
The Same Page — a management OS for first-time managers. Next.js frontend (frontend/), FastAPI backend (backend/), Supabase Postgres with RLS. Live deploys via GitHub push (Vercel + Railway).

**Objective for this session**
Build Plan S4+S5 from docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md §6: make half-configured setup state visible everywhere a person appears, and rename/consolidate the setup surfaces.

**Source of truth**
docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md (§6, Plan S4+S5) is the spec — read it in full first. Also CLAUDE.md and docs/ENGINEERING.md.

**Active folders and files**
frontend/app/app/reports/[id]/page.tsx (person page), frontend/app/app/team/page.tsx (roster cards), frontend/app/app/org/page.tsx (member counts), frontend/app/app/settings/page.tsx (section merge + renames), frontend/components/ZoneMap.tsx (nav labels — labels are centralized here since the Session-37 nav; update once). Possibly one small backend addition for org-unit member counts if no cheap client-side join exists.

**What is already decided**
Person page: the expectations block ALWAYS renders — when no role, show "No role assigned" with an inline role picker (assign without leaving the page; preserve org_unit_id on the PUT — the api.ts helpers already do); hide or reword "Score them against their role's expectations" until a role exists. /app/team roster cards get a role · team chip and an amber "no role" badge (read Session 3's setup-status). /app/org units show member counts ("US Success · 3 people") from direct_reports grouped by org_unit_id, clicking through to People filtered to that unit. Settings sections become: Profile & Company / People / Roles & expectations / Capacity — i.e. Roles & Levels and Expectations merge into one role-centric section (pick a ladder → its levels, JD, and expectations coverage together; Sessions 1–2 built both halves, this session consolidates the layout). /app/org keeps its name; blurb becomes "Your teams and departments — the structure everything rolls up through." Sweep stale cross-reference copy (e.g. "Assigning people to roles and teams now lives in Team").

**What is already completed**
Sessions 1–3 (coverage + AI draft, role families, People flow + setup-status). Reuse setup-status for every badge — do not recompute completeness locally.

**Constraints and cautions**
Mostly frontend; no migration expected. No new UI dependencies. Verify: npx tsc --noEmit, isolated next build, plus a click-through of every renamed surface from the zone map checking for orphaned links/labels. py_compile if backend touched. Update docs/SESSION_HISTORY.md. Commit + push.

**Immediate next task**
Read docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md §6 Plan S4+S5, then start with the person-page expectations block (highest trust payoff), and do the Settings consolidation last so everything else is stable under it. End with a report: what shipped, files touched, renames applied, deviations — then the project returns to the Cowork review session for final review of all four builds.
```

---

## Session 5 — Polish pass: People management, trust details, values story

*(Added 2026-08-18 after the post-build review — see docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md §7. Sessions 1–4 are shipped and live.)*

```
**Project**
The Same Page — a management OS for first-time managers. Next.js frontend (frontend/), FastAPI backend (backend/), Supabase Postgres with RLS (database/schema.sql + database/migrations/). Live deploys via GitHub push (Vercel + Railway).

**Objective for this session**
Build the polish pass from docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md §7.3 (Pass A + Pass B combined): person management on Settings → People (edit, open profile, archive), a People-row layout rethink, data-trust fixes on tiles/labels/links, the org-wide values story, and a ladder-merge nudge.

**Source of truth**
docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md §7 (findings P1–P5 and §7.3) is the spec — read it in full first. Also CLAUDE.md, docs/ENGINEERING.md, docs/SESSION_HISTORY.md (Sessions covering the team-setup builds), database/schema.sql.

**Active folders and files**
frontend/app/app/settings/page.tsx (People section + Roles & expectations section), frontend/app/app/reports/[id]/page.tsx, frontend/app/app/org/page.tsx, backend/routes/direct_reports.py + the expectations/values routes, frontend/lib/api.ts, database/migrations/ + schema.sql (one new migration: archived_at).

**What is already decided**
(1) ARCHIVE, NOT DELETE — decided explicitly. Migration adds direct_reports.archived_at timestamptz null (update schema.sql too). Archived people keep all history (1:1s, assessments, goals, metric entries) but disappear from rosters, People rows (behind a "Show archived (N)" toggle with unarchive), rollups, capacity, and setup counts. Do NOT build a hard delete in the UI. Audit every query/rollup that lists direct reports and exclude archived — including the SECURITY DEFINER rollup functions in schema.sql if they count people.
(2) People row rework: two-line layout — line 1: full name as a link to /app/reports/[id] (never truncate the name) + status chip on the right; line 2: role picker + team picker. Per-row ⋯ menu: Edit name & email (inline or small modal), Open profile, Archive (confirm states history is kept).
(3) Tile fixes: second tile becomes "6 teams · 2 departments" style (count unit_type='team' separately — never call departments teams); clarify the expectations tile label (e.g. "1/13 roles have expectations"); all four tiles become links (People→rows below, Teams→/app/org, Roles/Expectations→Roles & expectations section).
(4) Deep links: the "Draft expectations" chip on a People row opens the AI-draft modal for that person's role·level directly (navigate to Roles & expectations with the modal open), not just the section.
(5) Coverage grid: level rows under a family header show "L1"/"L2" style labels, not the full repeated family name.
(6) Org page: units with zero people show "0 people"; member counts link to Settings → People (filtered or scrolled to that unit's people if cheap — plain link acceptable).
(7) Person page: role · team subtitle under the H1 once assigned.
(8) Values story: backend + UI treat value_configs.role_level_id NULL as ORG-WIDE values — an "Org-wide values" block at the top of the Values view in Roles & expectations, with its own "Draft with AI" (drafts from company name/context, not a JD); the role-expectations fetch helper (grep fetch_role_expectations) unions org-wide values into every role's expectation set (prep grounding + person page + assessments all inherit this). Per-role values remain possible as overrides/additions.
(9) Merge nudge: on Roles & expectations, a dismissible one-line hint when a 1-level family's name contains another family's name or a "Senior/Lead/Staff " prefix variant of it ("Senior Corporate CSM looks like a level of Corporate Customer Success Manager — use Move… to merge"). Heuristic + dismiss only; no auto-merge.
(10) Copy fixes: the Roles & expectations header still says assigning people "lives in Team" — it must say People; re-sweep all setup surfaces for stale section names.
(11) Role selects on People rows and the person page get optgroup grouping by family. No typeahead this session.

**What is already completed**
Sessions 1–4: coverage grid + AI draft (works well), role families + ladder UI + Move…, People section + setup tiles + fixed Quick add, person-page inline assign + roster chips + org counts + section renames. Don't rebuild any of it — this session refines.

**Constraints and cautions**
RLS: current_org_id() security definer pattern; never inline users subqueries in policies. Schema changes in BOTH the migration file and schema.sql; test by running full schema.sql + migration against a local Postgres. The migration must be run manually in the Supabase SQL editor — flag it prominently in your report. Preserve the role↔org_unit sibling-preserving PUT invariant in api.ts assign helpers. No new UI dependencies. Verify: python3 -m py_compile on touched backend files, npx tsc --noEmit, isolated npm install + npx next build. Update docs/SESSION_HISTORY.md. Commit + push.

**Immediate next task**
Read docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md §7, then start with the archived_at migration + backend filtering (it touches the most call sites), then the People row rework, then the smaller items in the order above. End with a report: what shipped, files touched, the migration to run, and any deviations — for final review back in the Cowork session.
```
