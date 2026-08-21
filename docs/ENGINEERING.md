# The Same Page — Engineering Reference

Read this doc for any session involving backend code, API design, database
schema, auth, AI integration, or infrastructure.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | FastAPI (Python) | This app will grow real complexity — multiple AI pipelines, background jobs, evolving data model. Python/FastAPI handles that better than serverless functions. |
| Database + Auth | Supabase (Postgres + RLS + Auth) | Row-level security handles multi-tenant isolation without custom middleware. Auth is built-in. |
| Frontend | Next.js App Router | Marketing pages need to rank on Google — Next.js gives SSG/SSR for public pages and a normal SPA for the auth-gated app, all in one project. Not Vite (no SSR). |
| AI | Anthropic Claude | Called exclusively through `ai_core.py`. |
| Backend hosting | Railway | Same as Prism Tree. Proven. |
| Frontend hosting | Vercel | Native Next.js platform. |

The plumbing (`utils.py`, `ai_core.py`) is a direct port of patterns proven in
a separate, more complex project (Prism Tree). Don't reinvent them.

**Deploy (confirmed Session 10):** both Railway and Vercel auto-deploy on
push — no separate deploy step needed. (This doc previously listed
production deploy as "not yet configured"; that was stale.)

---

## Conventions

### Auth

Every protected backend route receives an `Authorization: Bearer <token>` header
and calls `get_authenticated_client(authorization)` from `utils.py`. This:
1. Verifies the token against Supabase `/auth/v1/user`
2. Returns a Supabase client scoped to that user via RLS

**Never query user data with the service-role client from a request path.**
Service-role is for background jobs and webhook handlers only.

**Token verification cache:** `verify_token_with_supabase()` caches the verified
user payload in `utils.py`'s `_token_cache` (keyed by raw token, TTL'd to the
token's own `exp` claim) so a burst of requests on the same token doesn't hit
Supabase's `/auth/v1/user` every time. As of Session 20, `_evict_expired_tokens()`
sweeps expired entries on every call, so the cache stays bounded by
currently-valid tokens rather than growing forever. Still per-process/in-memory —
not shared across instances if this ever runs on more than one Railway dyno; fine
at today's single-instance scale.

### AI calls

All Anthropic calls go through `ai_core.py`'s `generate_text()`. Route modules
import and call that function — they never import the Anthropic SDK directly.

`AI_DEFAULT_MODEL_HEAVY` and `AI_DEFAULT_MODEL_LIGHT` in `config.py` must always
be valid Anthropic model name strings. The fallback path in `ai_core.py` only
triggers on 5xx errors, not 4xx — a bad model name will not gracefully degrade,
it will error hard.

One addition (Session 32): `call_anthropic_with_tools()` in `ai_core.py` — the raw
tool-use call used only by `assistant_engine.py` for the Scribe agent loop. Anthropic-only
by design (the tool-use message format is provider-specific); no fallback path, same
timeout/error pattern as `_call_anthropic`.

### Rate limiting (Session 20, 2026-08-08)

Every AI-calling endpoint must be rate-limited — `slowapi` was a `requirements.txt`
dependency for several sessions before anything actually used it. The shared
`limiter` lives in `utils.py` (not `main.py`, to avoid a circular import with the
route modules) and is registered on the app in `main.py` via `app.state.limiter` +
`SlowAPIMiddleware`. To add the limit to a new route: give the endpoint function a
`request: Request` parameter and stack `@limiter.limit("10/minute")` directly above
it, below the `@router.*` decorator — see `/prep`/`/wrapup` in `one_on_ones.py`,
`/draft` in `assessments.py`, or `/insight` in `dashboard.py` for the pattern.
Limiting is **per remote IP**, not per user — slowapi's `key_func` runs before
`get_authenticated_client()` resolves `user_id`, so it can't key on the
authenticated user without re-parsing the bearer token itself. Coarser (an office
NAT shares one bucket) but sufficient to stop a runaway loop or script, which is
the actual risk today.

### Frontend → Backend boundary

All calls from the Next.js frontend to the FastAPI backend go through
`frontend/lib/api.ts`. Components never call `fetch()` directly. When you add a
new backend endpoint, add the corresponding client function to `api.ts` first.

### Settings section state

Settings (`frontend/app/app/settings/page.tsx`) renders exactly one section component at a time,
conditionally (`section === "expectations" && <ExpectationsSection .../>`), so switching sections
unmounts the previous one. Any state a section needs to survive switching away and back — a selected
role, a selected tab, a filter — must live in `SettingsPage` itself and be passed down as props, not
declared locally inside the section component. `roleLevels`/`reports`/`orgUnits` already followed
this pattern; `ExpectationsSection`'s role/kind picker didn't until Session 17, when the reset-on-
switch looked exactly like data loss to Andrew (the underlying DB rows were fine — confirmed via live
network inspection).

### RLS

Every table has RLS enabled. Core tables scope by `auth.uid()` directly
(`manager_id` / `owner_id`); the RLS-scoped client from
`get_authenticated_client()` enforces this automatically — you don't need to
add `WHERE user_id = ?` to every query.

Org-scoped tables (role_levels, *_configs, assessment_levels, organizations)
scope through `public.current_org_id()` — a SECURITY DEFINER function that
reads `users.org_id` without re-invoking RLS. **Never write a policy with an
inline `(select org_id from users ...)` subquery**: on the `users` table it's
self-referencing ("infinite recursion detected in policy", 42P17), and it
takes every dependent policy down with it. Learned the hard way in Session 6.

Org bootstrap: users have no `organizations` row until they first save
Settings → Profile (or add their first org unit, Session 11). `ensure_org()`
in `utils.py` (moved there from `routes/settings.py` when `org_units.py`
needed the same bootstrap-on-write behavior; `settings.py` keeps `_ensure_org`
as a local alias) creates the org + links `users.org_id` on any org-scoped
write (org insert uses `returning="minimal"` since the select policy can't
see an unlinked org yet).

**Gotcha (Session 10):** `goals`/`projects` policies in schema.sql are named
`"goals_all_own_org"` / `"projects_all_own_org"` but actually scope by
`owner_id = auth.uid()`, not `org_id = current_org_id()` — the naming is
misleading, don't assume org-scoping from the policy name alone. Like
`direct_reports`/`one_on_ones`, routes on these tables don't need
`_ensure_org()` or to populate `org_id` for isolation to work.

### Local verification (schema/RLS changes)

`database/local_verify_stub.sql` (checked in, Session 43) is a reusable stub — bare `auth`/
`storage` schemas, the `anon`/`authenticated`/`service_role` roles, and the grants real Supabase
sets by default — that lets the *actual* `database/schema.sql` (and any migration file) run
against a throwaway local Postgres end to end. Use it, don't rebuild it: `dropdb --if-exists
tsp_verify && createdb tsp_verify`, then `psql tsp_verify -f database/local_verify_stub.sql`,
then `psql tsp_verify -f database/schema.sql` (+ migration if testing one), then the public-schema
grants — full command sequence and the gotchas it already solves (`raw_user_meta_data`, the
storage stub, RLS/RETURNING bootstrap ordering) are in the file's own header comment. Write a
throwaway functional-test `.sql` on top of it (`set role authenticated`, `set_config
('app.current_user_id', ...)`) to actually exercise whatever policy or SECURITY DEFINER function
changed — the stub only proves the schema applies, not that the policy does what you think.

Always start from a freshly dropped/recreated database — reusing one across runs produces
duplicate-key errors that look like real bugs and aren't (Session 43 lost real time to this
before catching it).

---

## Database schema (36 tables — aligned with Miro board)

Full schema with indexes and RLS policies: `database/schema.sql`.

**Core tables (MVP feature set lives here):**
```
organizations        -- org-level config; one_on_one_cadence_days (Session 37/38) — org-wide
                        1:1 cadence default, itself defaulting to 21
users                -- manager_id self-ref for hierarchy; role: manager/director/vp/ic
manager_report_connections  -- explicit join table for hierarchy traversal (was on Miro board)
direct_reports       -- the manager's team; user_id nullable, now claimable via the invite flow
                        (Session 22) — see direct_report_invites below and the Team Mission Control
                        section. No IC-facing view consumes it yet.
                        one_on_one_cadence_days (Session 37/38) — per-report cadence override,
                        null means inherit the org default; see resolve_cadence_days() in utils.py
one_on_ones          -- 1:1 logs; notes private to writing manager (RLS)
commitments          -- polymorphic source_type (one_on_one/goal/project/manual) + source_id;
                        is_team_commitment (Session 23) flags a commitment (still assigned to one
                        direct_report_id) for Team Mission Control's team-wide commitments list
goals                -- activated Session 10; parent_goal_id self-ref; level: company/department/team/individual;
                        org_unit_id (Session 11) names which specific team/department a team/dept goal is for
projects             -- activated Session 13; goal_id (optional, on delete set null) + direct_report_id (optional,
                        on delete cascade). No level/org_unit_id of its own — "goals=what, projects=how"
check_ins            -- new Session 26; the temporal layer for goals AND projects (one shared table, exactly one
                        parent enforced via num_nonnulls check): status + optional manual progress % + note per row.
                        Backend write-throughs status to the parent; progress/trend/staleness derived from here
capacity_profiles    -- activated Session 14; per-direct-report override of capacity_settings' org defaults
time_off_entries     -- activated Session 14; PTO/sick/holiday/other per direct report, subtracted per-period
team_messages        -- new Session 21; free-text update log per direct report, manager-scoped. STORE-ONLY
                        (no delivery mechanism) — no IC-facing view exists yet to read it
direct_report_invites -- new Session 22; one-time magic-link invite token per direct report, manager-
                        scoped, 7-day TTL. Claimed via accept_direct_report_invite() (SECURITY DEFINER)
team_meeting_notes   -- new Session 22; standalone team-wide meeting-notes log, manager-scoped, no
                        attendee tagging — separate from one_on_ones and team_messages. Session 45:
                        gained org_unit_id (nullable, ON DELETE SET NULL) — null means "all teams"
team_callouts        -- new Session 24; ONE manager-authored text block per manager, overwritten in
                        place on every edit — not a dated log like team_meeting_notes. "Key updates"
                        revived, deliberately small. Session 45: now one row per (manager, org_unit)
                        pair via org_unit_id (ON DELETE CASCADE, not SET NULL — see below), replacing
                        the old plain `unique` on manager_id with two partial unique indexes
subscriptions        -- Stripe billing
```

**Configuration tables (set up once per org, not written to constantly):**
```
org_units                   -- activated Session 11; team/department entities, self-ref parent_unit_id.
                                "company" is NOT a row here — the organizations row is the chart root.
                                Org-scoped (current_org_id()), replaces role_levels.functional_team as the
                                source of truth for "which team" — that column stays in schema, UI stopped
                                writing/showing it. leader_user_id (Session 15) — the role-scoped-views
                                scoping mechanism, see that section below.
role_levels                 -- central concept; links metrics/skills/values to a role+level
assessment_levels           -- stable ordinal (1-5) + configurable label per org
metric_configs              -- per role_level; order_type: primary/secondary/tertiary
metric_scale_definitions    -- evaluation points 1-4; quantitative/qualitative output; range support
skill_configs               -- same shape as metric_configs
skill_scale_definitions     -- same shape as metric_scale_definitions
value_configs               -- adds value_type: team/company/department
value_scale_definitions     -- same shape
capacity_settings           -- activated Session 14; one row per org — default_hours_per_week,
                                default_target_utilization_pct (never 100 — see Capacity model section below)
work_unit_configs           -- activated Session 14; per role_level, optional — unit_name + hours_per_unit,
                                the display translation layer (tickets/points/campaigns) on top of hours
```

**Context Engine tables (Session 27, schema only — see that section above):**
```
document_series      -- recurring-doc grouping (monthly town halls, quarterly updates) + cadence
documents             -- one row per uploaded doc; Librarian-assigned category/freshness_class/
                        effective_date/summary_card/novelty_score fill in as the pipeline (Session
                        II) runs; confirmed_at null until Session III's confirm-card is accepted
document_scopes      -- which org_unit(s) a doc applies to (a set); null org_unit_id = company-wide
document_citations   -- usage ledger, one row per agent answer that cites a doc (Session V credit
                        flow-back)
```

**Performance / assessment tables:**
```
assessments          -- activated Session 16; rolling overall rating per direct report,
                        level_ordinal scored against assessment_levels (org-configured 1-5 scale)
assessment_levels    -- activated Session 16; org-scoped 1-5 scale + label, auto-seeded with
                        5 defaults on first use (see _ensure_levels in assessments.py)
performance_reviews  -- still dormant; formal periodic review, deferred in favor of the
                        rolling assessment (Session 16 scoping decision with Andrew)
skill_assessments    -- activated Session 16; per-skill score per direct report, scored
                        against that skill_config's own evaluation_scale_min/max
value_assessments    -- activated Session 16; same shape as skill_assessments, per value
metric_entries       -- activated Session 16; time-series metric value + period per direct
                        report, scored against that metric_config's own scale
```

**Development plans (activated Session 47, 2026-08-20):** individual only —
see backend/routes/development.py for the AI-draft/assessment-linkage
details and the development_scoping project memory note for the scoping
conversation. Placement is a section on the direct report detail page, no
dedicated top-level page. Team-level counterpart is `team_dev_focus` (a
new table, mirrors `team_callouts`) — see team.py's GET/PUT /dev-focus.

Follow-up (Session 48, 2026-08-21): added `POST /{id}/notes/revise` — an always-answerable counterpart to `/draft` for manager notes. `/draft` stays evidence-gated (an honest empty result is valid); `/notes/revise` takes the manager's own already-written text as the primary input and is never blocked by thin evidence. `_fetch_evidence()`/`_role_label()` in development.py are the shared helpers both routes ground themselves in.
```
development_plans      -- one per direct report, bootstrapped on first access
dev_plan_aspirations    -- career aspiration: desired role/path + timeline; one row per
                           plan (dev_plan_aspirations_plan_uq), upserted as a unit
dev_plan_opportunities  -- areas of opportunity: skills + knowledge; source_kind/
                           source_config_id (Session 47) optionally trace an opportunity
                           back to the skill/value assessment item that prompted it
dev_plan_training       -- training needed + projected cost
dev_plan_manager_notes  -- private to manager, append-only (no edit/delete in v1)
```

**Privacy boundary (enforced by RLS):**
- `one_on_ones.notes` — visible to writing manager only
- Everything else (assessments, performance reviews, metrics, development plans,
  goals) — visible to the direct manager and up the hierarchy chain

---

## Capacity model (Session 14)

v1 is **supply only** — how much capacity exists, not what's consuming it.
No allocation/demand wiring into Projects/Goals yet; that's an explicit
follow-up, not an oversight.

**Hours are the shared currency.** `capacity_settings` (org-wide defaults)
and `capacity_profiles` (per-report override) resolve to a baseline: `hours =
contracted_hours_per_week × weeks_in_period × (target_utilization_pct /
100)`. `work_unit_configs` is an optional per-role_level display translation
on top (e.g. `hours_per_unit` for "ticket") so a team can see its native unit
without a second parallel data model.

**"Max capacity" is never 100% — two separate buffers, not one blended
number** (the second one added same session, after Andrew flagged the gap
live):
1. `target_utilization_pct` (default 75) — within-a-day overhead: meetings,
   admin, the unexpected. A knowledge-work rule of thumb, not a fixed rule.
2. `off_days_per_year` (default 21 — 15 vacation + 6 sick) — whole days not
   worked at all. **Precedence vs. `time_off_entries`, to avoid
   double-counting anyone who logs real dates:** for whatever period is
   being calculated, actual logged time off wins if any overlaps that
   period; otherwise the calculation falls back to a prorated share of the
   annual default (`off_days_per_year × hours/day × period_weeks / 52`).
   See `_effective_off_hours()` in `capacity.py` and the matching `CASE` in
   `org_unit_capacity_rollup()`. The `/overview` response surfaces which one
   won via `off_hours_source: "logged" | "assumed"` so the UI can label it.

**Two computation paths, kept in sync by hand:**
- `backend/routes/capacity.py`'s `get_overview()` — the caller's own
  `direct_reports`, RLS-scoped, computed in Python.
- `org_unit_capacity_rollup()` (schema.sql) — department/org rollup via the
  `org_units` tree, computed in SQL because it has to run SECURITY DEFINER
  across every manager in the org.

If the formula changes, change it in **both** places — there's a
cross-reference comment at each site, but nothing enforces they stay
identical.

**Why the rollup function is SECURITY DEFINER (and why that's safe today):**
`direct_reports`/`capacity_profiles`/`time_off_entries` all stay
manager-scoped (`manager_id = auth.uid()`, same as everywhere else in the
app) — there's still no cross-manager read policy on the base tables.
`org_unit_capacity_rollup()` is the one deliberate exception, mirroring
`current_org_id()`'s existing pattern: it bypasses RLS internally to sum
across managers, but its **return shape is aggregate-only by construction**
(`org_unit_id`, a count, a summed hours figure — never a row identifying a
person). There's no code path from this function back to a named individual,
so a department head/VP can see "Team A: 82 hrs available" without ever
seeing another manager's reports by name. This was Andrew's explicit call
(Session 14 scoping): full org rollup now, but aggregate-only outside your
own team.

**Session 15 update:** the "no second manager yet to build a real
permissions system against" gap is now closed — see Role-scoped views
below. `org_unit_capacity_rollup()` is gated by `led_org_unit_ids()` as of
that session; it's no longer readable by any authenticated org member.

---

## Role-scoped views (Session 15, 2026-08-03)

Closes the gap flagged in ENGINEERING.md since Session 10/11 ("role-scoped
views — schema supports it, UI doesn't exist yet") and the permissions gap
flagged in Session 14's Capacity section. See docs/SESSION_HISTORY.md and
the role_scoped_views project memory note for the full scoping conversation.

**Scoping mechanism — an explicit leader per org unit, not `users.role` or
the `manager_id` chain.** `org_units.leader_user_id` (nullable) names who
leads that unit. `public.led_org_unit_ids()` (SECURITY DEFINER, in
schema.sql) is the one shared gate every rollup function filters through:
units the caller directly leads, plus every descendant walked down the
`org_units` tree. Chosen over `users.role` (director/vp tiers — too coarse,
not tied to a specific unit) and over `users.manager_id` (the
people-reporting chain — Capacity already chose the `org_units` tree over
this same chain in Session 14; using two different scoping sources between
features would make them disagree). Any org member can assign any org
member as a unit's leader — same permissiveness `org_units` CRUD already
had; no admin/owner concept exists to gate it further yet.

**Visibility depth — aggregate-only outside your own team, no exceptions.**
Same contract as Capacity's Session 14 rollup: every rollup function
returns counts/sums per org unit, never a named individual. Four rollup
functions exist, all SECURITY DEFINER, all gated by `led_org_unit_ids()`:
- `org_unit_capacity_rollup(period_start, period_end)` — pre-existing
  (Session 14), now gated. **Behavior change:** previously any authenticated
  org member could read the whole org's rollup; now a caller who leads
  nothing gets nothing. `capacity.py`'s `get_rollup` also had to stop
  cross-joining against *every* org_unit (which would zero-fill units
  outside the caller's scope, misreading as "this team has 0 capacity"
  instead of "you can't see this team") — it now cross-joins only against
  `led_org_unit_ids()`.
- `org_unit_goals_rollup()` — status counts for department/team-level goals
  (`org_unit_id` set directly). Individual-level goals aren't included — a
  deliberate v1 scope limit.
- `org_unit_projects_rollup()` — status counts, scope derived from a
  project's goal's `org_unit_id` first, falling back to its assigned
  direct report's `org_unit_id`. **Diverges from Session 46:** projects
  gained a direct `org_unit_id` column that session, and `/app/team` /
  `/app/projects` both filter on it now — this rollup function was
  deliberately left on the old goal/assignee-derived logic (aggregate *up*
  to a leader is a different concept from `/app/team`'s cascade *down*
  from a parent team), flagged as a follow-up rather than fixed. Check
  which of the two scoping mechanisms a given surface actually needs
  before assuming they agree.
- `org_unit_people_rollup()` — headcount + a `job_role`/count breakdown
  (never a name) per unit.

**Backend routes:** `GET /api/org-units/led` (units the caller *directly*
leads — distinct from the full descendant scope `led_org_unit_ids()`
computes), `GET /api/org-units/members` (org member list for the leader
picker, via the existing `users_select_own_org` RLS policy — no new policy
needed), `GET /api/goals/rollup`, `GET /api/projects/rollup`,
`GET /api/direct-reports/rollup` (declared before `/{report_id}`, same
convention as `/overview`).

**Frontend:** the Org page gained a third "Rollup" tab (alongside
Build/Chart) showing, for each unit the signed-in user leads, a
subtree-aggregated summary (people + role breakdown, goal/project status
counts, with "at risk" called out). Build/Chart gained a leader picker per
unit and a "Led by X" badge. Capacity hours stay on their own page
(Capacity's existing "By department" section) rather than being duplicated
into Org's Rollup tab — that section now walks each led unit's subtree
instead of the whole company tree, with an empty state distinguishing "no
org units built yet" from "you don't lead any units yet."

**Verification note:** built ahead of real data, same posture as
`org_units` (Session 11) and Capacity (Session 14) — verified build-clean
(backend `py_compile` + sandboxed `main.py` import confirming all 6 new
routes register; frontend `tsc --noEmit` and `next build` both clean,
14/14 routes). Not live-tested against a second manager — none exists yet.
**Andrew needs to assign himself (or anyone) as a leader on at least one
unit in Org > Build before any rollup shows anything** — a caller who leads
nothing gets an empty scope everywhere, including Capacity's "By
department," which previously showed org-wide data with no gate at all.
That's an intentional behavior change, not a bug.

---

## Assessments (Session 16, 2026-08-04)

The ratings/status layer PRODUCT_VISION.md calls the load-bearing piece of
"Mission Control" — scoring a direct report against their role's configured
expectations (Settings > Expectations, Session 6), not just having those
expectations on record. See docs/SESSION_HISTORY.md and the
assessments_scoping project memory note for the full scoping conversation.

**Scope, decided with Andrew:** rolling assessment (not `performance_reviews`,
which stays dormant), all three expectation types together (metrics via
`metric_entries`, skills via `skill_assessments`, values via
`value_assessments`) plus an overall `level_ordinal` snapshot scored against
org-configured `assessment_levels`. AI-assisted draft, manager reviews
before anything saves — same draft-then-review rule as `one_on_ones.py`'s
wrap-up flow (Session 8).

**`backend/routes/assessments.py`** (6 routes under `/api/assessments`):
`GET/PUT /levels` (auto-seeds 5 default labels per org on first use, same
on-demand-bootstrap idea as `ensure_org()`), `GET ""` (team list with latest
overall rating, for the list page), `GET /{direct_report_id}` (the full
scorecard — role expectations + latest score per item, via
`_fetch_scorecard()`), `POST /{direct_report_id}/draft` (pure AI call,
nothing saved), `POST /{direct_report_id}` (writes the reviewed result).
`/levels` is declared before `/{direct_report_id}` so FastAPI doesn't match
it as a direct-report id, same convention as Direct Reports'
`/overview`/`/rollup`.

**Draft prompt restraint:** the AI is instructed to only score an item when
recent 1:1 summaries, commitments, or goals actually support a judgment —
never to force coverage of every configured metric/skill/value. Same
restraint already proven in the 1:1 prep prompt's expectations block
(`_format_expectations_block` in `one_on_ones.py`: "do NOT audit every
expectation in one 1:1"). Drafted `config_id`s are filtered against the
report's real configured items server-side before returning to the
frontend, so a hallucinated id from the model can't reach the save step.

**Frontend pending-state design:** the scorecard page
(`/app/assessments/[reportId]`) starts every input EMPTY rather than
pre-filled with the latest recorded score. The latest score still displays
next to each item as read-only context. This means clicking Save only logs
what the manager (or the AI draft) actually touched this pass, instead of
silently re-logging every unchanged score as a fresh timestamped row every
time the page is saved.

**Schema note — no new migration.** All 6 base tables and their RLS
policies were already present in `database/schema.sql` (dated 2026-07-21) —
same "already dormant in the original scaffold" pattern as Goals/Org/
Projects/Capacity's base tables, just never independently confirmed live
before this session. If `GET /api/assessments/levels` doesn't cleanly
return 5 seeded rows on first real use, these tables never actually landed
in Supabase and need a migration after all.

---

## Mission Control (Session 18, 2026-08-06)

`frontend/app/app/dashboard/page.tsx` replaces the old "team + 1:1 cadence" landing page with
PRODUCT_VISION.md's "mission control" surface — see docs/SESSION_HISTORY.md and the
mission_control project memory note for the scoping conversation.

**Scope, decided with Andrew (all four recommended defaults):** replaces `/app/dashboard` outright
rather than living as a separate page; only cards backed by real data today (no placeholders for Team
Health, Team/Dept Operations, or People Operations); manager view only (no Department Head rollup
toggle this pass, though Session 15's infrastructure supports one); Individual Performance shows each
report's latest rating as-is, no synthesized team score.

**Four sections, each a client-side merge of existing endpoints — no new backend routes, no schema
changes:**
- Individual Performance: `getTeamOverview()` + `getTeamAssessments()`, merged by `direct_report_id`.
- Goals: `getGoals()` filtered to non-individual levels, grouped into Organization/Department/Team.
- Key Initiatives: `getProjects()` filtered to active/on_track/at_risk.
- Capacity — this week: `getCapacityOverview()` for the current Mon–Sun week, computed with a local
  (smaller) copy of `capacity/page.tsx`'s period-range helpers.

Every section follows the "summary here, edit there" pattern already established on DR detail
(Goals/Projects/Assessment/Capacity) — a compact read view with a link to the full page for editing.

**Not built this pass:** Department Head / Team / Individual (IC) role-scoped versions of this page
(see PRODUCT_VISION.md's 4-dashboard concept); any card type without a real data model yet (Team
Health KPIs, Customer Demand/Staffing/Forecasting/Budget/Compensation, Recruiting/Employee Feedback/
Improvement Plans/formal Performance Reviews); a synthesized team-level rating rollup.

**Session 19 grid redesign (2026-08-07):** reworked into a 3-column grid across the top (Individual
Performance / Goals / Key Initiatives) with Capacity dropped to a full-width strip below —
deliberately not a 4th column, since it's a snapshot stat per person, not a scrollable triage list.
Added:
- A stat ribbon (team size, due-for-1:1 count, at-risk goal count, available hours this week) — all
  computed client-side from data the page already fetches.
- Worst-first sorting on Individual Performance: due-for-1:1 sorts before everyone who isn't, then by
  open commitment count.
- `backend/routes/dashboard.py` (new) — `GET /api/dashboard/insight`. **This supersedes the Session
  18 claim above that Mission Control has no backend routes of its own** — the AI insight banner is
  real AI-generated text (`generate_text()`, `AI_DEFAULT_MODEL_LIGHT`), not a client-side
  computation, and returns null most days by design (same restraint as Assessments' AI draft,
  Session 16). Fails quiet on any AI/parse error rather than 500ing the endpoint.
- `frontend/components/QuickAddModal.tsx` (new) — the app's first shared component (`components/` is
  a new top-level directory under `frontend/`). A type picker (Direct report / Goal / Project) with a
  minimal form per type, reusing the existing `createDirectReport`/`createGoal`/`createProject`
  functions. Scoped as a simple modal, not a global ⌘K command palette — see DESIGN.md.
- Individual Performance's inline "add a direct report" form (present since Session 18) was removed —
  Quick Add is now the only add path from this page.

**Session 20 follow-up (2026-08-08):** `/api/dashboard/insight` now caches its full result
(all 4 DB queries + the AI call) in-memory, keyed by `user_id`, 20-min TTL — a manager
refreshing Mission Control repeatedly no longer re-runs any of it. Deliberately not
invalidated on writes (logging a 1:1, resolving a commitment), so a stale insight can
persist up to 20 min after an action; revisit only if that staleness causes a real
complaint. The "no reports yet" and AI-failure paths are NOT cached, so those retry on
the next load instead of sticking for the full TTL. Also now rate-limited — see
Conventions → Rate limiting above.

---

## Team View (Session 21, 2026-08-08)

The "team space" surface Andrew floated 2026-08-03 — see docs/SESSION_HISTORY.md and the
team_space_brainstorm project memory note for the original idea and the scoping conversation that
turned it into this. Distinct from Role-scoped views above: that section is about *who can see what*
as the org grows past one manager; Team View is about having *a single home for "my team" as a unit* at
all, which mattered even before role-scoped views existed. Team data was scattered across
direct_reports/projects/goals/capacity with no page tying them together — this is that page.

**Scope, decided with Andrew:** own direct reports only (not an org_unit rollup like role-scoped
views); a roster showing each person's active projects and individual-level priorities, assembled from
data that already exists; plus a new piece, free-text messaging per report.

**`backend/routes/team.py`** (3 routes under `/api/team`): `GET ""` (the roster — `direct_reports`
joined client-side in Python with each report's active/on_track/at_risk projects and individual-level
goals, plus their latest logged message; same "a few queries + a Python merge" shape as
`direct_reports.py`'s `get_team_overview`), `GET /{report_id}/messages` (full update history, newest
first), `POST /{report_id}/messages` (log a new update).

**Why active/on_track/at_risk only:** same "what's happening now" framing as Mission Control's Key
Initiatives card (Session 18/19) — completed/cancelled work stays off the roster. Full history is still
on `/app/goals` and `/app/projects`; Team View isn't trying to replace either.

**`team_messages` — store-only by design, not a gap.** IC login is still deferred (see
`direct_reports.user_id` above and PRODUCT_VISION.md/Scope discipline below) — there is no surface for
a direct report to read anything today. So a message logged here reaches nobody but the manager who
wrote it; it's groundwork for whenever IC login ships, not a broken feature. Andrew's explicit call,
made mid-scoping, over adding an email-delivery dependency this session. RLS is manager-scoped
(`manager_id = auth.uid()`), the same pattern as `one_on_ones`/`assessments` — **not** the
`owner_id`-on-goals/projects naming gotcha documented above.

**Schema note — new migration, not yet run live.** Unlike Assessments (Session 16, tables already
dormant in the original scaffold), `team_messages` is a genuinely new table this session.
`database/migrations/2026-08-08_team_messages.sql` needs to run against Supabase before `/app/team`
will load without a query error — same "build ahead of the migration" posture as every table activated
since Org units (Session 11).

**Frontend:** `frontend/app/app/team/page.tsx` (new top-level nav item, added to Mission Control's
`NAV_LINKS`) — one card per direct report (priorities + projects columns, reusing Goals/Projects'
existing status pill styles) with a "Log update" toggle that reveals a compose box and that person's
message history. Copy is explicit that nothing is delivered, so the store-only behavior doesn't read as
broken.

**Verification note:** cloned the pushed repo into a scratch environment for a fuller check than the
usual `py_compile`-only pass, since this added a new route module and a new frontend route: backend —
fresh venv, `main` import with dummy Supabase env vars, confirmed both new routes register; frontend —
fresh `npm install`, `tsc --noEmit` clean, `next build` clean (16/16 routes, `/app/team` included). Not
live-tested against real Supabase — the migration hasn't run yet.

---

## Team Mission Control (Session 22, 2026-08-08)

Expands the Team View above into a 3-column surface — reworked `/app/team` in place, same route and
nav item, per Andrew's explicit call. See docs/SESSION_HISTORY.md and the team_mission_control project
memory note for the full scoping conversation (which covered four dimensions: how much of IC login to
build, whether "key updates" ships this pass, the meeting-notes data model, and whether to rework
`/app/team` in place vs. a new page).

**Layout:** left column is the Session 21 roster (unchanged data, condensed styling) plus a new
"Invite to log in" action per report. Middle column is company/team goal progress. Right column is a
standalone meeting-notes log. No fourth column for "key updates" — scoped, then explicitly deferred to
a follow-up session (see the Decisions log in DESIGN.md for the full reasoning).

**Goal progress (`GET /api/team/goals`, team.py):** goals filtered to `level in ('company', 'team')`
only — department stays a role-scoped-views rollup concept, individual priorities are already the left
column's per-report list. Goals are owner-scoped everywhere in this codebase (see goals.py's RLS note:
the `*_all_own_org` policy names are misleading, it's actually `owner_id = auth.uid()`), so this is
just the manager's own goals filtered by level — no org rollup function needed, unlike People/Goals/
Projects/Capacity's leader-scoped rollups (Session 15).

**Meeting notes (`GET`/`POST /api/team/notes`, new `team_meeting_notes` table):** standalone and
team-wide — deliberately not tied to any single 1:1 (`one_on_ones.summary` stays exactly where it is)
and distinct from `team_messages` (which stays a private per-report log). No attendee tagging in v1,
kept deliberately minimal. Manager-scoped RLS, same pattern as `team_messages`.

**IC login — "auth primitives now, IC view later."** Andrew explicitly rejected a lighter no-login
workaround, so this had to be a real account/claim mechanism, not a stub — but building what an IC
actually *sees* once logged in is deferred to a follow-up session. What shipped this pass:

- **`direct_report_invites`** (new table) — `manager_id`, `direct_report_id`, `invited_email`, unique
  `token`, `expires_at` (7-day TTL, set in `direct_reports.py`), `accepted_at`. Manager-scoped RLS. A
  new invite soft-expires any prior pending invite for the same report first, so an old copied link
  stops working once a fresh one is issued.
- **`direct_reports.py` `POST /{report_id}/invite`** — confirms the report belongs to this manager,
  backfills `direct_reports.email` (a second dormant column activated this session — there was
  previously no way to set it anywhere in the app; the invite form is now where a manager enters it),
  creates the invite row, returns a frontend URL. No email is sent from the backend — the manager
  copies the link and shares it themselves, same manual-delivery posture Session 21 chose for
  `team_messages`.
- **`routes/invites.py`** (new router, `/api/invites`) — `GET /{token}` is intentionally
  unauthenticated (the visitor hasn't logged in yet) and uses a plain anon-key Supabase client, NOT
  `get_admin_client()`, calling `get_invite_preview()` (below) so the "never service-role for user
  data" rule stays intact even with no authenticated user in the request. `POST /{token}/accept` runs
  after login, through the normal `get_authenticated_client()` dependency, and calls
  `accept_direct_report_invite()`.
- **Two new SECURITY DEFINER functions in schema.sql**, same pattern as `current_org_id()`/
  `led_org_unit_ids()`: `get_invite_preview(p_token)` — the one function in the schema granted to
  `anon`, not just `authenticated`, returning only a minimal non-sensitive projection (names + expiry,
  never the row itself). `accept_direct_report_invite(p_token)` — claims the `direct_reports` row for
  `auth.uid()`, re-checking `auth.email()` against `invited_email` inside the function as defense in
  depth (not just at the Python layer), and corrects the `users` row's `role` to `'ic'` (the
  `handle_new_user()` trigger defaults every new signup to `'manager'`; the check constraint has
  anticipated `'ic'` since the original schema).
- **Auth flow reuses the existing passwordless magic-link mechanism** (`supabase.auth.signInWithOtp`)
  rather than inventing password signup — no changes needed to `auth/callback/route.ts`, which already
  supported a `next` query param. `frontend/app/invite/[token]/page.tsx` (new, public — NOT under
  `/app`, so `middleware.ts`'s auth gate doesn't apply) fetches the preview and sends the magic link
  with `emailRedirectTo` pointing at `/auth/callback?next=/app/ic?invite={token}`.
  `frontend/app/app/ic/page.tsx` (new) is the landing target — protected by `middleware.ts` like every
  other `/app/*` route, calls `POST /api/invites/{token}/accept` on load, then shows a static "you're
  logged in, nothing here yet" message. Replace with a real IC view in a follow-up session.
- **`direct_reports_select_own_as_ic` RLS policy** (new, additive) — lets a claimed IC read (only)
  their own `direct_reports` row. No IC-facing view exercises this yet; included now since it's the
  natural counterpart to `user_id` actually getting set.

**Schema note — new migration, not yet run live.** `database/migrations/2026-08-08_team_mission_control.sql`
adds `direct_report_invites`, `team_meeting_notes`, their RLS policies, and the two new functions.
Depends on `2026-08-08_team_messages.sql` (Session 21) already having been run — same "build ahead of
the migration" posture as every table activated since Org units (Session 11).

**Verification note:** same scratch-clone pattern as Session 21 — backend: fresh venv, `main` import
with dummy Supabase env vars, confirmed all 4 new/changed routes register (`POST
/api/direct-reports/{report_id}/invite`, `GET /api/invites/{token}`, `POST
/api/invites/{token}/accept`, `GET /api/team/goals`, `GET`/`POST /api/team/notes`) and
`app.state.limiter` attached; `py_compile` clean on all changed files. Frontend: fresh `npm install`,
`tsc --noEmit` clean, `next build` clean — 19/19 routes including the two new ones (`/app/ic`,
`/invite/[token]`). **Also, one step beyond the usual pattern:** spun up a local Postgres 16 instance
with a minimal stub of the Supabase `auth` schema (a bare `auth.users` table + session-variable-backed
`auth.uid()`/`auth.email()`) and ran the *entire* `schema.sql` against it end to end — every table,
policy, and function in the file, not just the new ones, applied with zero errors. Then scripted the
full invite/claim flow with real SQL: created a manager + report + invite, previewed as `anon`,
signed the IC up (`handle_new_user()` fired for real), claimed via `accept_direct_report_invite()` as
`authenticated` with the IC's simulated JWT, and confirmed `direct_reports.user_id` got set,
`direct_report_invites.accepted_at` got stamped, and `users.role` flipped to `'ic'`. Also confirmed all
three error paths reject correctly: re-accepting an already-used token, accepting with a mismatched
email, and accepting an expired token. What's still unverified is the actual Supabase Auth integration
(real magic-link email delivery, real JWT signing/verification) and the live migration run — those need
Andrew's real Supabase project, which this sandbox doesn't have.

---

## Team Mission Control follow-up (Session 23, 2026-08-09)

Two additions on top of Session 22's surface, scoped via AskUserQuestion (one 4-question round, one
2-question follow-up) before building — see the team_mission_control_followup project memory note.

**Meeting-notes agenda surfacing.** `team_meeting_notes` gains a nullable `meeting_date`. Status is
derived, never stored — a note dated today-or-later is the surfaced "next meeting's agenda" hero card;
null or a past date means it's a logged past meeting, same discipline as `one_on_ones`' planned/
completed split. `GET`/`POST /api/team/notes` (team.py) pass `meeting_date` through as-is; the frontend
does the derivation. If more than one note has a future `meeting_date`, only the soonest becomes the
hero — an accepted v1 edge case, not built out.

**Past-meeting card/detail UI.** `frontend/app/app/team/page.tsx`'s `NotesColumn` replaced the flat
reverse-chron text list with a card grid (date + snippet) that opens a full-text detail modal on click.
No new endpoint — same `GET /notes` payload, client-side only.

**Team-level commitments.** Andrew's explicit call: extend `commitments` with `is_team_commitment`
(boolean, default false) rather than a new table. A commitment stays assigned to exactly one
`direct_report_id`; the flag just also surfaces it on Team Mission Control's team-wide list. New
`GET`/`POST /api/team/commitments` (team.py) — list filters `is_team_commitment = true`, create
validates the direct report belongs to the manager before inserting. Marking done/dropped reuses the
existing `PATCH /api/commitments/{id}` in commitments.py unchanged — the flag doesn't change how a
commitment resolves, only where it's listed. Frontend: new `TeamCommitmentsSection` appended below the
roster column in `page.tsx` (Andrew's explicit placement call over a 4th grid column or a separate
`/app/commitments` page).

**Schema note — new migration, not yet run live.**
`database/migrations/2026-08-09_team_agenda_and_commitments.sql` adds both columns. Depends on
`2026-08-08_team_messages.sql` and `2026-08-08_team_mission_control.sql` already being live — confirmed
with Andrew at the start of this session before writing any code.

**Verification note:** same scratch-clone pattern as Session 22 — backend `main` import with dummy
Supabase env vars confirmed `/api/team/commitments` (GET+POST) registered, `py_compile` clean; frontend
`tsc --noEmit` and `next build` both clean. Since this touched schema, went one step further: spun up a
local Postgres 16 with the same minimal Supabase `auth` schema stub as Session 22, ran the *entire*
`schema.sql` end to end with zero errors, then functionally inserted (as the `authenticated` role) a
past note, a future-dated agenda note, and a team-flagged commitment — all succeeded under RLS, and a
second manager's session correctly saw zero rows for either table. What's still unverified: the live
migration run itself.

---

## Team Mission Control layout rework (Session 24, 2026-08-09)

Full visual redesign of `/app/team`, Andrew's explicit call after dogfooding the Session 22/23 3-column
grid — see the team_page_redesign_brief and team_page_redesign_options project memory notes for the
scoping conversation (an AskUserQuestion round, four rounds of mockup review, then a build). No changes
to anything above this section — Sessions 21-23's data model carries this rework as-is, with one new
addition (team_callouts, below).

**New page structure, top to bottom:** a KPI strip (goals on track, active initiatives, commitments due
within 7 days, days until the next meeting — all computed client-side from data already being fetched);
a "this week's focus" row pairing Initiatives, Goals, and Commitments as three cards; a Meetings row
(Critical callouts to the left, Meetings on the right); the team roster, moved from a left column to a
row of cards at the very bottom that expand into a shared detail panel on click. `frontend/lib/api.ts`
gets no new types for Initiatives or the KPI strip — Initiatives reuses `getProjects()` filtered
client-side to `active`/`on_track`/`at_risk`, the same subset Mission Control's Key Initiatives card uses
(dashboard.py) — no backend change needed.

**Critical callouts — "key updates," revived.** Scoped and explicitly deferred in both Session 22 and
Session 23; Andrew revived it this session, deliberately small: ONE manager-authored text block
(`team_callouts`, unique on `manager_id`), overwritten in place on every edit — not a dated log like
`team_meeting_notes`. The frontend splits the message on newlines to render bullets; there's no per-line
CRUD or history. New `GET`/`PUT /api/team/callout` in team.py — PUT upserts on `manager_id`
(`on_conflict="manager_id"`), computing `updated_at` in Python rather than relying on the column default
(which only fires on insert, not on an upsert's update path).

**Schema note — new migration, confirmed run live by Andrew.**
`database/migrations/2026-08-09_team_callouts.sql` creates `team_callouts` + its RLS policy. Depends on
`2026-08-09_team_agenda_and_commitments.sql` already being live — confirmed with Andrew before writing
it.

**Verification note:** cloned the pushed repo (commit `94a0808`) into a scratch environment. Backend —
fresh venv, `main` import with dummy Supabase env vars confirmed `/api/team/callout` (GET+PUT)
registered, `py_compile` clean. Frontend — fresh `npm install`, `tsc --noEmit` clean, `next build` clean
(all 17 routes, `/app/team` at 8.01 kB). Schema — spun up a local Postgres 16 with the same minimal
Supabase `auth` schema stub as Sessions 22/23, this time also explicitly granting `anon`/`authenticated`
table privileges to match real Supabase's defaults (the stub was missing this, caught by a
permission-denied error on the first attempt — noted here since it'll matter for any future local RLS
verification, not just this table). Ran the *entire* `schema.sql` end to end with zero errors, then
functionally tested `team_callouts`: upsert-create, upsert-edit in place (confirmed one row, not a
duplicate), a second manager saw zero rows under RLS, and a second manager's attempted `UPDATE` against
the first manager's row affected zero rows and did not mutate it.

---

## Team dropdown scoping (Session 45, 2026-08-19)

Andrew flagged that a manager/director leading more than one `org_units` team had no way to tell,
on `/app/team`, which team they were looking at — the page always showed every direct report
combined with no label. Scoped via one AskUserQuestion round (all his recommended defaults), then
built same session — see the team_dropdown_scoping project memory note.

**Dropdown source:** `org_units` where `leader_user_id` = the caller (`GET /api/org-units/led`,
already existed from Session 15's role-scoped views) — no new "which team am I a member of" concept.
"All teams" is the default, matching today's combined view exactly.

**Filtering is mostly free.** Roster, initiatives, goals, and commitments all already carried enough
`org_unit_id` signal to filter client-side with zero backend change: roster/initiatives/commitments
key off `direct_report_id` → `direct_reports.org_unit_id`, goals already carry `org_unit_id`
directly. Only `team_meeting_notes` and `team_callouts` had no per-team signal at all, so those two
gained a real `org_unit_id` column (`database/migrations/2026-08-19_team_dropdown_scoping.sql`, not
yet run live). Null `org_unit_id` on a note/callout/goal means "applies to all teams" — shown under
every specific team's filter, not just "All teams."

**Gotcha for future schema changes:** `team_callouts.org_unit_id` uses `ON DELETE CASCADE`, not
`ON DELETE SET NULL` like `team_meeting_notes` — a deliberate, verified-not-assumed difference. A
plain `UNIQUE(manager_id, org_unit_id)` doesn't stop duplicate "all teams" rows (Postgres treats
every NULL as distinct), so uniqueness is two partial unique indexes instead
(`team_callouts_manager_unit_uq` / `team_callouts_manager_all_teams_uq`, see schema.sql). With
`SET NULL`, deleting an org_unit that has both a team-specific callout AND a manager already holding
a separate all-teams callout tries to write a second null-`org_unit_id` row and the whole
`DELETE FROM org_units` fails outright — reproduced against a real local Postgres instance before
switching to CASCADE and reproducing the fix. Anywhere else a table gets an `org_unit_id` column
alongside a per-(owner, org_unit) uniqueness rule, check this same interaction before defaulting to
`SET NULL`.

`GET /api/team/callout` changed shape because of this: it now returns every callout row for the
caller (a list — one per led team that's ever had one, plus at most one all-teams row) instead of a
single object, so the frontend can switch teams without a round trip. `PUT` does a manual
look-up-then-write keyed on `(manager_id, org_unit_id)` instead of supabase's `upsert()`, since
`on_conflict=` can't express "conflict on org_unit_id equality including null=null."

**Verification:** cloned the pushed GitHub repo (commit `bbd65c0`) into a scratch sandbox. Backend —
fresh venv, `main` import with dummy Supabase env vars confirmed all team.py routes register,
`py_compile` clean. Frontend — fresh `npm install`, `tsc --noEmit` clean, `next build` clean (all 21
routes, `/app/team` at 8.79 kB). Schema — the repo's checked-in `database/local_verify_stub.sql`
stood up a local Postgres 16, ran the full `schema.sql` + new migration end to end with zero errors,
then functionally tested as two managers: inserted notes/callouts across two led teams + an
all-teams row, confirmed both partial unique indexes reject duplicates, confirmed RLS isolation
(second manager sees 0 rows, an UPDATE against the first manager's row affects 0 rows), and
specifically exercised the org_unit-delete edge case above — reproduced the SET NULL failure, then
reproduced the CASCADE fix working — rather than just reasoning about the FK behavior.

## Team/project/goal hierarchy (Session 46, 2026-08-20)

Andrew noticed, right after Session 45 shipped, that projects had no way to attach to a specific
team, and that `/app/team`'s Goals/Initiatives sections only matched a team's `org_unit_id` exactly
— a parent department's goals/projects should cascade down to every team under it. Scoped via one
AskUserQuestion round (all his recommended defaults), then built same session — see the
team_project_goal_hierarchy project memory note.

**Projects gain a real `org_unit_id`,** same mechanism `goals.org_unit_id` has had since Session 11
(`database/migrations/2026-08-20_projects_org_unit.sql`, not yet run live — depends on Session 45's
migration being live first). Unlike goals, projects have no level enum, so the picker on
`/app/projects` isn't filtered by `unit_type`: any team or department is selectable. The migration
backfills every existing project's `org_unit_id` from its assignee's `direct_reports.org_unit_id`
(same one-time-backfill posture as Session 40's role_families migration) so nothing silently drops
out of a team-filtered view the moment this ships. `projects.py`'s `_SELECT_COLUMNS`/`_shape_rows()`
join and flatten `org_units(name)` the same way `goals.py` already did; `list_projects()` gained an
`org_unit_id` filter param.

**Hierarchy is client-side only — no new endpoint.** `frontend/app/app/team/page.tsx` gained
`ancestorChain()`, which walks `org_units.parent_unit_id` upward from the selected team using the
already-fetched `orgUnits` list, building a Set of the selected team's id plus every ancestor's id.
`visibleInitiatives`/`visibleGoals` match against that set instead of exact `org_unit_id` equality;
an item whose `org_unit_id` isn't the exact selected team is labeled "inherited from parent." To make
department-level goals eligible to surface on team pages at all, `team.py`'s
`_MISSION_CONTROL_GOAL_LEVELS` widened from `("company", "team")` to
`("company", "department", "team")` — the hierarchy filter above decides which specific teams a given
department goal actually shows on.

**Scope limit, deliberate:** hierarchy inheritance applies only to goals and projects/initiatives on
`/app/team` — commitments, roster, meeting notes, and callouts stay exact-match-only, same as Session
45. `org_unit_projects_rollup()` was NOT updated to prefer the new column — see the flagged divergence
in the Role-scoped views section above.

**Verification:** real local Postgres 16 functional test via `database/local_verify_stub.sql` (full
schema.sql + the standalone migration run separately — its `ALTER TABLE ADD COLUMN` step hit an
expected "already exists" since schema.sql already carried the final shape, but the backfill `UPDATE`
ran clean and produced correct results). Backend `py_compile` + fresh `main` import with dummy
Supabase env vars. Frontend fresh `npm install`, `tsc --noEmit` clean, `next build` clean.

---

## Check-ins (Session 26, 2026-08-11)

The progress layer for goals and projects (initiatives), built after Andrew's brainstorm about
Mission Control's goal/initiative cards feeling inert. Three primitives were missing — a computable
progress signal, a freshness/trend signal, and visible goal↔initiative linkage — and `check_ins`
supplies the first two (the third already existed via `projects.goal_id`, Session 13, and just
needed surfacing).

- **One shared table** for both parents (`goal_id` XOR `project_id`, enforced with a
  `num_nonnulls(...) = 1` check constraint) — both share the status enum and check-in shape, and
  the COO-agent temporal layer (data gap #2 in `docs/COO_AGENT_QUESTION_SET.md`) wants one place
  to diff history. Owner-scoped RLS (`owner_id = auth.uid()`), same actor as goals/projects rows.
- **Write-through:** `create_check_in()` (routes/check_ins.py — shared helpers, not a router)
  inserts the row then updates the parent's `status` column. Every pre-existing status-reading
  surface (team page KPI/ring, org-unit rollup SQL functions, DR detail sections, dashboard stat
  ribbon) keeps working with zero changes — the migration is purely additive.
- **Derived, not stored:** `progress` = latest non-null % across the parent's check-ins (a
  note-only check-in never wipes the number), `trend` = direction between the latest two non-null
  %s, `last_check_in_at`/`last_check_in_note` = newest row. Attached by `enrich_with_check_ins()`
  on every goals/projects list call — one extra query per list, grouped in Python, fine at this
  scale.
- **Progress is manual** (0-100, asserted per check-in). Structured key results were considered
  and deferred; AI-proposed status/progress from `success_metrics` + notes is deferred to the
  agent layer.
- Frontend constants: `STALE_CHECK_IN_DAYS = 14` (CheckInPanel.tsx — deliberately shorter than
  the 21-day 1:1 cadence), `DUE_SOON_DAYS = 14` (dashboard triage).

`database/migrations/2026-08-11_check_ins.sql` must run against live Supabase before deploying —
the Goals/Projects list endpoints now query `check_ins` and will 500 until it runs. No dependency
on any other migration beyond the base goals/projects tables.

---

## Context Engine (Session 27, 2026-08-12)

Schema + storage foundation for the Context Engine (the Space + the Librarian + the Brain) — see
`docs/CONTEXT_ENGINE.md` for the full framework and `docs/CONTEXT_ENGINE_BUILD_PLAN.md` for the
6-session build plan this is Session I of. No backend routes or frontend UI yet — those are
Sessions II–VI.

- **Four new tables** — `document_series`, `documents`, `document_scopes`, `document_citations` —
  plus a private Supabase Storage bucket (`context-engine-docs`) for the raw uploaded files.
- **Org-scoped (`org_id = current_org_id()`), not owner_id-scoped** — a deliberate departure from
  goals/projects/direct_reports. Docs are shared org context (strategy, values, customers,
  pricing), not one manager's private data, so any manager in the org can read/write them — same
  trust level as `org_units`/`role_levels`/`capacity_settings` today.
- **Scope is application-layer, not an RLS boundary.** `document_scopes` records which org_unit(s)
  a doc applies to (`org_unit_id = null` means company-wide — `org_units` has no "company" row,
  see `org_units.py`). This is a deliberate simplification of the build plan's resolution #5
  ("scope + RLS"): actual per-org-unit row-level RLS gating raw document text would be new ground
  for this codebase — every existing cross-manager read (capacity, goals, projects, people
  rollups) solves that problem by returning aggregates only, via `led_org_unit_ids()`-gated
  SECURITY DEFINER functions, never raw rows. Scope cascade (company → department → team) is a
  Session IV retrieval-relevance concern, not a security boundary, same "no second manager yet to
  test a real permission system against" caveat noted on `org_unit_capacity_rollup`.
- **`documents.status`** (`processing` → `pending_review` → `confirmed`, or `failed`) tracks the
  Librarian pipeline; `confirmed_at` stays null until Session III's confirm-card is accepted — only
  confirmed docs are meant to be read by retrieval (Session IV) or counted in the Brain (Session
  V). `category` is a single field for v1 (build-plan resolution #3: per-document novelty scoring,
  not per-category-question) — multi-category cross-filing for stream items is explicitly not
  built this pass.
- **`document_scopes` uniqueness:** Postgres treats every `NULL` as distinct, so a plain
  `UNIQUE(document_id, org_unit_id)` would let one document collect unlimited duplicate
  company-wide (null) rows. Two partial unique indexes cover both cases —
  `document_scopes_unique_org_unit` (non-null) and `document_scopes_unique_company_wide` (null).
- **Storage path convention** (Session II's upload endpoint must follow this):
  `{org_id}/{document_id}/{original_filename}` — `storage.objects` policies check
  `(storage.foldername(name))[1] = current_org_id()::text`, same org-isolation pattern as every
  table policy in this file.

**Verification:** local Postgres 16, extended the usual Supabase `auth` stub with a minimal
`storage` schema (`buckets`/`objects`/`foldername()` — real Supabase's is richer; this covers only
what the migration touches). Ran the *entire* `schema.sql` end to end with zero errors, then
separately verified the standalone migration applies cleanly on top of the **pre-session (HEAD)**
schema too. Functional tests: two-org RLS isolation across all four tables and `storage.objects`
(Org B sees 0 of Org A's rows), a forged cross-org insert rejected by RLS, both partial-unique-index
duplicate-scope cases rejected, all four check constraints (`file_type`, `status`, `category`,
`novelty_score` range) rejected bad values, and cascade-delete confirmed (deleting a `documents` row
removes its `document_scopes` rows). Not exercised: the real Supabase `storage` schema (the local
stub is a simplification) and real Auth integration — same caveat every session's sandbox carries.

`database/migrations/2026-08-12_context_engine.sql` must run against live Supabase before Session
II (extraction pipeline) can write to it. Depends on `org_units` (Session 11) already being live —
confirm before running.

### Session II — extraction + Librarian pipeline (Session 28, 2026-08-12)

Backend only, no schema changes, no frontend UI — see `docs/CONTEXT_ENGINE_BUILD_PLAN.md`'s
"Session II" section for the spec this implements.

- **`backend/routes/documents.py`** (new) — `POST /api/documents/upload` runs the full pipeline
  synchronously: PPTX→PDF (headless LibreOffice) → raw file to the `context-engine-docs` bucket at
  Session I's path convention → `documents` row (`status='processing'`) → one structured Librarian
  call (extraction + category/freshness_class/effective_date/summary_card/novelty_score/series,
  build-plan resolution #3 — per-document, not per-category-question) → row updated to
  `status='pending_review'`. `GET /api/documents` is a minimal list endpoint for manual verification,
  not the Session III review queue. `document_scopes` is intentionally not written here — scope is a
  user-confirmed field for Session III's confirm-card, not an AI-only proposal; a doc with no
  `document_scopes` row is invisible to Session IV's retrieval cascade until a human sets one.
- **`ai_core.py`** gained `generate_text_from_document()` (+ `_call_anthropic_with_document()`) —
  `generate_text()` only ever sent a fixed "Proceed." text message with no way to attach a file. This
  new function sends a base64 PDF as a native Claude `document` content block, which build-plan
  resolution #1 (Claude-native extraction, no separate library) actually requires. No OpenAI fallback
  on 5xx for this path — `_call_openai`'s chat-completions shape has no equivalent native PDF input.
- **`utils.py` bug fix:** `get_authenticated_client()` propagated the user's JWT to `client.postgrest`
  but never to `client.options.headers`, which `client.storage` (lazily built on first access) uses
  for its own session. Every route before this one only ever touched `.table()`/`.rpc()`, so the gap
  never surfaced. Without the fix, Storage requests would authenticate as the anon key and
  `storage.objects`' RLS (`auth.uid()`-based) would silently reject every upload. Now also sets
  `client.options.headers["Authorization"]`.
- **`backend/nixpacks.toml`** (new) — Railway's Nixpacks build needs the `libreoffice` apt/nix package
  explicitly added, or the PPTX conversion path 502s in production. Flagged tradeoff: this nixpkg is
  large and will lengthen build time/image size noticeably; accepted for this session's scope.
- `requirements.txt` — added `python-multipart` (required for FastAPI file uploads; was missing).

**Verification:** fresh venv, `py_compile` clean, `import main` with dummy env vars confirmed all
routes registered (87 total) including both new `documents` routes. Mocked-unit-tested in isolation
(no live Supabase/Anthropic calls) — prompt builders, JSON response parsing (clean/fenced/garbage),
novelty clamping, file-type inference, series resolution against a fake table client, and the
outgoing request shape of `generate_text_from_document()` against a monkeypatched `httpx.post`.
Separately confirmed the `utils.py` storage-auth fix against a real supabase-py client construction
(not a live server) — `client.storage`'s session headers carry the user JWT after the fix, the anon
key before it. **Not exercised:** an actual PPTX→PDF conversion (no `libreoffice` binary in the
build sandbox), a real Storage upload, or a live Anthropic document call — all require the real
Railway/Supabase/Anthropic environment. Confirm `libreoffice` is actually present on the Railway
service before the first real PPTX upload — this session could not verify that live.

### Session III — confirm-card UX (Session 28, 2026-08-12, same session as Session II)

Frontend + one schema migration — see `docs/CONTEXT_ENGINE_BUILD_PLAN.md`'s "Session III" section.

- **New migration `database/migrations/2026-08-12_context_engine_confirm.sql`** — adds
  `documents.confirmed_as_is` (boolean) and `documents.correction_log` (jsonb). **Not yet run against
  live Supabase** (unlike Session I's migration, which Andrew confirmed live) — must run before the
  confirm endpoint works for real. Merged into `database/schema.sql`.
- **`backend/routes/documents.py`** gained `PUT /{document_id}/confirm` and `DELETE /{document_id}`.
  Confirm validates category/freshness_class, dedupes `org_unit_ids` (at most one `null` entry,
  mirroring `document_scopes`' partial unique indexes), requires at least one scope (422 otherwise —
  see Session II's note on scopeless docs being invisible to retrieval), rejects org units outside the
  caller's org (422), diffs the submission against the Librarian's original proposal to set
  `confirmed_as_is`/`correction_log`, and replaces `document_scopes` (delete-then-insert). Delete is
  best-effort on Storage cleanup and works at any document status — not in the build plan's spec, added
  as a practical escape hatch (flagged in SESSION_HISTORY.md as a judgment call).
- **New page `frontend/app/app/context/page.tsx`** ("The Space") — upload form, a "Needs review" queue
  of inline `ConfirmCard`s (editable category/freshness/effective-date, a scope picker defaulting to
  nothing selected — not "Company-wide" — per the framework doc's "scope is user-confirmed" rule), a
  `failed`-status discard section, and a small "Recently confirmed" feedback list (not a browse view).
  Added to Mission Control's `NAV_LINKS` as "Context".
- **`frontend/lib/api.ts`** — `Document`/`DocumentScope`/`DocumentConfirmIn` types + CRUD calls, and a
  new `authedFormFetch` helper (the app's first multipart/form-data call — the existing `authedFetch`
  always forces `Content-Type: application/json`, which would corrupt a file upload body).

**Verification:** Backend — same fresh-venv `py_compile`/`import main` pass as Session II, now 89
routes total. New mocked unit tests for `_dedupe_scope_ids`, the validators, and `confirm_document`
end-to-end (confirm-as-is, confirm-with-correction, wrong-status 409, empty-scope 422,
foreign-org-unit 422) against a hand-written fake Supabase client. Schema — local Postgres 16, a scoped
stub of the pre-session `documents` table (not the full `schema.sql` — narrower than prior sessions'
verification, flagged as such) confirmed the migration applies cleanly and idempotently, with the
resulting columns checked via `\d documents`. Frontend — fresh `npm install`, `tsc --noEmit` clean,
`next build` clean (`/app/context` compiles, 5/5 static pages). **Not exercised:** any of it against a
real backend + Supabase + browser together, or a live PPTX/PDF/Anthropic call.

### Session IV — retrieval + agent integration (Session 29, 2026-08-12)

Backend only, no schema changes — see `docs/CONTEXT_ENGINE_BUILD_PLAN.md`'s "Session IV" section for
the spec this implements.

- **New `backend/context_engine.py`** — shared plumbing (not a route). `get_relevant_context(supabase,
  org_id, org_unit_id, max_docs=4)` is the two-tier retrieval helper: `_scope_cascade()` walks
  `org_units.parent_unit_id` up from the target unit (team → department) and appends the implicit
  company-wide tier (`org_unit_id is null`), most-specific first — this is the same tree
  `led_org_unit_ids()` walks down from a leader; retrieval walks it up from a leaf instead, since scope
  application ("does this doc apply here?") is the inverse question of scope leadership ("what can this
  person see?"). Candidates come from `document_scopes` joined against that cascade,
  `status='confirmed'` only (`pending_review`/`processing`/`failed` excluded, per the build plan and
  Session III's note that a scopeless/unconfirmed doc must stay invisible to retrieval). Ranking is
  (scope specificity, `novelty_score` desc, `effective_date` recency) — a documented placeholder, since
  the build plan assigns real decay-weighted ranking to Session VI, not this one. Only the top
  `max_docs` (default 4, a cost/prompt-size judgment call) get a second query for full `extracted_text`
  — tier one never touches that column. `format_context_block()` renders the result as an embeddable
  prompt section (`""` when nothing was retrieved). `record_citations()` inserts one `document_citations`
  row per document actually embedded — the only new write path this session.
- **`routes/one_on_ones.py`'s `POST /prep`** is the pilot call site (per the build plan's suggestion;
  wrapup/assessments/dashboard-insight `generate_text()` calls are not wired this session). The route
  gained an `authorization` param to resolve `org_id` via `ensure_org()`/`get_email_from_token()` (same
  pattern `documents.py` already uses, since `direct_reports`/`users.org_id` can be null for older MVP
  rows), fetches `org_unit_id` alongside the existing report select, and splices
  `format_context_block()`'s output into `_build_prep_prompt()` as a new `context_engine_block` param
  (positioned after role expectations, before the manager's raw notes). `record_citations()` fires after
  a successful `generate_text()` call with the retrieved docs' ids and a `context` label naming the
  report.
- **No AI call inside retrieval** — ranking/selection is plain Python over already-fetched
  summary/metadata rows, not a second Librarian-style `generate_text()` call. Keeps this session's
  retrieval path free of new per-request AI cost; revisit only if the heuristic proves insufficient
  against real usage.

**Verification:** `py_compile` clean on the new module and the edited route; `import main` with dummy
env vars confirmed all 89 routes still register. Hand-written fake-Supabase-client tests (same pattern
Session 28's `confirm_document` tests used) covering the scope-cascade walk (including the
no-`org_unit_id`-assigned fallback to company-wide-only), full-pipeline retrieval (excludes
`pending_review` and other-orgs' docs, ranks most-specific-scope first, `max_docs` caps the count,
tier-two `extracted_text` populated only on what's returned), `format_context_block()`'s content
rendering and empty-input behavior, `record_citations()`'s insert shape and empty-list no-op, and a
brand-new org with zero documents returning `[]` without error. Separately rendered
`_build_prep_prompt()` with a real `format_context_block()` output spliced in and confirmed placement,
content, and that an empty block leaves no stray section header. **Not exercised:** a live Supabase call
end to end (real RLS behavior on `document_scopes`/`org_units`/`documents` under a real JWT), a real
`generate_text()` call with the context block actually in the prompt, or any frontend surface — the
Context Engine still has no UI for showing which docs informed an answer.

### Session V — the Brain (Session 30, 2026-08-12)

Backend (extends `context_engine.py` + one new route) + frontend, no schema changes — see
`docs/CONTEXT_ENGINE_BUILD_PLAN.md`'s "Session V" section for the spec this implements.

- **`context_engine.py` gained `_decay_multiplier(freshness_class, effective_date, today)`** — a
  simple, linear, freshness-class-aware confidence curve (evergreen: 1.0 always; dated: full weight
  through 120 days, floors at 0.5 by 540; stream_instance: full weight only through 30 days, floors at
  0.35 by 180; missing/unrecognized freshness_class or an unparseable/missing effective_date falls back
  to a flat 0.85). Written this session because the Brain's own spec requires "dim regions by
  freshness-class-driven age curve" now — explicitly documented in the module docstring as a
  per-session placeholder, since the build plan assigns the CANONICAL decay function (shared by both
  this and Session IV's retrieval ranking) to Session VI.
- **`compute_category_coverage(supabase, org_id, today)`** — the Brain's data source. Per category (all
  five, always, in fixed order): `fill_score` = MAX decayed novelty score among that category's
  confirmed docs — not an average, matching the framework doc's "ten junk uploads move nothing; one
  current strategy doc lights a region" example directly; `doc_count`; `citations_this_week` (rolling
  7-day `document_citations` rollup, one query across all the org's confirmed docs then grouped in
  Python); a static hand-written `gap_question` per category (Librarian first-person voice, no AI call —
  matches the build plan's "static... stand-in for the deferred per-category-question scoring"); and up
  to 20 confirmed docs (a judgment call, not discussed with Andrew) for the click-through, sorted by
  decayed score descending.
- **New `GET /api/documents/coverage`** in `routes/documents.py` — thin route: resolves `org_id` via
  `ensure_org()` (same pattern `POST /upload` already uses) and calls `compute_category_coverage()`.
  Org-wide, not org_unit-scoped like Session IV's retrieval — the Brain is framed as one coverage map
  per org (per "the Space"), not a per-team lens.
- **`frontend/app/app/context/page.tsx`** gained a "The Brain" section above the upload form: a
  5-category grid of `BrainCategoryCard`s (an inline-SVG radial progress ring per category — no new
  charting dependency; opacity of the filled arc scales with `fill_score` so an empty region reads as
  barely-there and a full one as vivid, directly implementing "regions fill/brighten as real coverage
  grows"), each clickable to expand a `BrainDetailPanel` below the grid showing that category's confirmed
  docs (title, freshness, effective date, summary card, per-doc citation count) and the always-present
  `gap_question` rendered in the same "The Librarian: ..." italic voice the confirm-card already uses.
  Fetched via a separate `getContextCoverage()` call (not folded into the page's main
  `Promise.all([getDocuments(), getOrgUnits()])`) so a Brain failure can't block the upload flow — same
  fail-quiet posture as the dashboard's AI insight banner. Refreshes after a confirm or delete, since
  either changes a category's fill/doc-count. Page container widened `max-w-3xl` → `max-w-4xl` to fit
  the 5-column grid.
- **`frontend/lib/api.ts`** gained `CategoryCoverage`/`CoverageDocument` types and `getContextCoverage()`.
- **No new visualization dependency** — the build plan suggested reusing "the existing dashboard's
  orbital/radial mission control motif," but `app/dashboard/page.tsx` turned out to be a card grid with
  no actual radial component to reuse. Interpreted as "radial in spirit, visually consistent" and built
  a plain SVG ring instead — a documented judgment call, explicitly flagged (per the build plan's own
  "treat as a placeholder, not a lock-in") as open to a real design pass later.

**Verification:** Backend — `py_compile` clean on `context_engine.py` and `routes/documents.py`; `import
main` with dummy env vars confirmed all 90 routes now register, including `GET /api/documents/coverage`.
Hand-written fake-Supabase-client tests (same pattern prior Context Engine sessions used) covering the
decay curve's shape across all three freshness classes plus the unknown-date fallback;
`compute_category_coverage()` always returns all five categories in fixed order, including for a
brand-new org with zero documents (`fill_score=0` everywhere, no error); fill is confirmed to be MAX not
average via a specific case (a high-raw-novelty-but-ancient doc loses to a lower-novelty-but-current one
once both are decayed); `pending_review` docs are excluded entirely; an evergreen doc with no
`effective_date` still gets full weight; `citations_this_week` counts only rolling-7-day citations,
correctly rolled up per category; every category (even an empty one) carries a `gap_question`;
click-through docs sort by decayed score descending. Frontend — fresh `npm install`, `tsc --noEmit`
clean, `next build` clean (18/18 static pages, `/app/context` now 6.06 kB). **Not exercised:** a live
Supabase call end to end, a real `document_citations` history with actual production citations behind
it (Session IV only just started writing rows), or the Brain rendered in a real browser against a real
backend.

### Session VI — staleness + precedence surfacing (Session 31, 2026-08-12)

Backend (extends `context_engine.py` + updates the coverage route) + frontend, no schema changes — see
`docs/CONTEXT_ENGINE_BUILD_PLAN.md`'s "Session VI" section for the spec this implements. Final session
of the documented 6-session Context Engine build plan.

- **`_decay_multiplier()` promoted from Session V placeholder to canonical** — same math, no formula
  changes, just the docstring updated to drop "per-session placeholder" language now that it's shared by
  both consumers the build plan always intended: retrieval ranking and Brain fill.
- **`get_relevant_context()`'s `_sort_key()` now decay-weighted** — gained a required `today: date`
  parameter (threaded through from both call sites: `documents.py`'s coverage route already had `today`;
  `one_on_ones.py`'s prep route gained `date.today()`) and ranks by `(scope specificity, -decayed_score,
  has_date, date_rank)` instead of raw `novelty_score` — a stale-but-high-novelty doc can now lose to a
  fresher-but-lower-novelty one at the same scope tier, closing the gap Session IV's own docstring flagged
  as deferred.
- **`_format_staleness_prompt(category_label, doc)` + `staleness_prompt` field on
  `compute_category_coverage()`'s per-category output** — fires only when a category's fill-driving
  ("load-bearing" — the doc whose decayed score produced `fill_score`) doc has decayed below
  `_STALENESS_MULTIPLIER_THRESHOLD = 0.7`. Evergreen docs never trigger it (constant 1.0 multiplier);
  empty categories and fresh docs likewise never trigger it. Static Librarian-voice string formatting, no
  AI call — same restraint Session IV/V established for gap questions and citations.
- **Conflict detection is new**: `_build_unit_ancestor_chains()`, `_scopes_overlap()`, `_more_specific()`,
  `_format_conflict_message()`, and `find_scope_conflicts(supabase, org_id)`. Reuses the existing
  `_scope_cascade()` ancestor-walk (built for retrieval in Session IV) rather than new tree logic:
  precomputes each involved org_unit's ancestor-or-self id set, then two confirmed docs in the same
  category conflict when their scopes overlap (either is company-wide, or one's unit is a
  self-or-ancestor of the other's) AND their `effective_date`s differ. `_more_specific()` also flags
  `specificity_disagrees_with_recency` — true when the more-specific doc is also the *older* one (the
  framework doc's flagship "your team charter predates the pivot" tension case) — surfaced as a distinct
  sentence in `_format_conflict_message()`. Conflicts are never auto-resolved, only surfaced.
- **`GET /api/documents/coverage` response shape changed**: was a bare list of categories (Session V), now
  `{"categories": [...], "conflicts": [...]}` — a breaking shape change to an endpoint added last session,
  judged acceptable since nothing besides this session's own frontend edit consumes it yet.
- **Frontend (`app/app/context/page.tsx`)**: `BrainCategoryCard` gained a small amber "Aging" pill next to
  the citations pill when `coverage.staleness_prompt` is non-null; `BrainDetailPanel` renders the
  staleness prompt as a second "The Librarian: ..." line (amber-toned, above the neutral gray
  `gap_question` line, so an aging warning reads as higher-priority than the standing gap nudge); a new
  `ConflictBanner` component renders each `CoverageConflict.message` in an amber-bordered banner above the
  category grid, one per conflict, keyed by the pair of doc ids. `lib/api.ts` gained `CoverageConflict`
  and `ContextCoverage` types and `getContextCoverage()` now returns the nested `{categories, conflicts}`
  shape.
- **No AI call added anywhere this session** — staleness prompts and conflict messages are both static
  string formatting over already-computed data, consistent with every prior Context Engine session's
  "no AI call in supporting plumbing" restraint.

**Verification:** Backend — `py_compile` clean on `context_engine.py`, `routes/documents.py`,
`routes/one_on_ones.py`; `import main` with dummy env vars confirmed all 90 routes still register
(`GET /api/documents/coverage` present). Hand-written fake-Supabase-client tests: existing Session
IV/V scripts patched for the new `today` parameter and re-run clean (no regressions); a new script
covers three groups — decay-weighted retrieval ranking (fresher-lower-novelty beats stale-higher-novelty
at the same scope tier), `staleness_prompt` firing only on an aging load-bearing doc (never
evergreen/fresh/empty), and `find_scope_conflicts()` across four cases (overlapping team-vs-company-wide
docs with differing dates flagged with correct specificity-vs-recency tension; unrelated departments not
flagged; identical-date same-scope docs not flagged; single-doc categories produce no conflicts) plus a
zero/one-document org not erroring. Frontend — `tsc --noEmit` clean, `next build` clean (18/18 static
pages). **Not exercised:** a live Supabase call end to end, a real conflicting-document scenario created
through the actual upload/confirm UI, or any of this rendered in a real browser against a real backend.
This closes out the documented 6-session Context Engine build plan — retrieval, the Brain, and now
staleness/conflict surfacing are all backend-plus-frontend complete, none of it yet run against production
data.

---

## The Scribe — conversational data entry (Sessions 32–34, 2026-08-13)

Scoping brief (locked decisions, verb set, eval): `docs/AGENT_SCRIBE_SCOPING.md`. The Scribe
is the write-side agent: the manager talks to a persistent drawer, the agent assembles draft
entities, and nothing writes until the manager confirms — at which point the client calls the
same existing endpoint the forms use. Built across three sessions (S1 loop+eval / S2 drawer+confirm
/ S3 hardening+persistence).

**Hard rules (locked — do not relitigate):**
- The model has READ tools only (`list_goals`, `list_projects`, `list_direct_reports`,
  `list_org_units`) plus `emit_draft`. It cannot write to the database. Ever. Its "write" is a
  structured draft payload; the actual write is the client calling the normal endpoint on Confirm.
- v1 verbs are create+append only: create project, create goal, link project↔goal, log check-in,
  add commitment, add direct report. No edits, no deletes.
- Entity linking: high-confidence match → prefilled + visibly marked in the draft card; ambiguous →
  ask with candidates; no match → offer to create. Never silently guess a link.

**Backend:**
- `assistant_engine.py` — `TOOLS`, `SYSTEM_PROMPT_TEMPLATE` (six verbs + MVR schemas verified
  against schema.sql; note: projects have no success_metrics column, goals do),
  `run_assistant_turn(thread, new_message, tool_executor, today_str, page_context=None)` —
  tool loop, max 8 iterations. `page_context` is injected into the system prompt ephemerally,
  never stored in the thread.
- `routes/assistant.py` — `POST /api/assistant/message` (rate-limited 10/min; server-managed
  thread: loads from + saves to `assistant_messages`; body = `{message, page_context?}`) and
  `GET /api/assistant/thread` (hydration read). Route count after Sessions 32–34: 94.
- `routes/commitments.py` gained `POST /api/commitments` (standalone create, validates DR
  ownership, `source_type='manual'`); `routes/projects.py` gained `GET /api/projects/{project_id}`
  (registered after `/rollup` — literal path must match first).
- `assistant_messages` table (`database/migrations/2026-08-13_assistant_messages.sql`, applied
  live 2026-08-13): manager-scoped RLS (`manager_id = auth.uid()`), JSONB `drafts` column so
  draft cards re-render on hydration, index on `(manager_id, created_at asc)`.

**Frontend:**
- `app/app/layout.tsx` — first shared authenticated layout: `DrawerProvider` + `AppShell`
  (flex row, drawer as `sticky h-screen` aside, content reflows), ⌘J/Esc listener,
  fixed ✦ toggle on non-dashboard pages. Drawer width is `w-[clamp(400px,30vw,640px)]`
  (Session 35) — 400px floor unchanged, scales toward ~25-33vw on larger screens, capped
  at 640px.
- `components/ScribeDrawer.tsx` — thread UI, DraftCard (six entity types, confirm handlers
  each calling the existing form endpoint), receipts + 30s undo (project/goal only — the only
  types with frontend delete endpoints), ambiguity quick-reply chips, edit-in-card.
- `lib/drawer-context.tsx` — drawer open state (sessionStorage), thread state, `pageContext`
  registration (DR detail page sets it; cleared on unmount).

**Eval:** `eval/test_assistant.py` — 15 utterances, mocked tool executor, real Anthropic API;
exit bar ≥13/15; last full run 15/15 (Session 34). Re-run after any system-prompt or engine
change. Requires `ANTHROPIC_API_KEY` in `backend/.env` (fails fast if missing — never read
another project's .env; see Session 32's incident note).

---

## Expectations coverage + AI draft (Session 39, 2026-08-18)

Plan S3 of `docs/TEAM_SETUP_UX_REVIEW.md` §6 — first of four setup-UX sessions (S3 → S2 → S1 →
S4/S5, see `docs/TEAM_SETUP_BUILD_SESSIONS.md`). Turns the Expectations section's blind
"pick 1 of N roles from a dropdown" into a coverage grid, and turns each role's pasted
`job_responsibilities` JD text into a draft the manager reviews before anything saves.

**`backend/routes/expectations_ai.py`** (new file, `/api/expectations` — a separate prefix from
`settings.py`'s `/api/settings/expectations` CRUD, which is unchanged): `GET /coverage` (three
grouped queries — one per config table — plus role_levels, grouped in Python; returns per-role
metric/skill/value counts + `org_wide_values_count`), `POST /draft` (rate-limited 10/min, same as
`assessments.py`'s draft route; AI drafts from the role's JD text calibrated against sibling
levels — same `job_role` string, different `job_level`, since Plan S2's `role_family_id` doesn't
exist yet; falls back to role title + level alone when there's no JD text; nothing persisted),
`POST /{kind}/batch` (commits a reviewed draft — or any batch — in one insert; reuses
`settings.py`'s `_CONFIG_TABLES`/`_expectation_row`/`ExpectationIn` so the row shape can't drift
from the manual CRUD path).

**Org-wide values convention:** `value_configs.role_level_id IS NULL` means "applies to every
role" — the column was already nullable (no migration). `direct_reports.py`'s
`fetch_role_expectations()` — the shared helper behind the DR detail page, 1:1 prep grounding, and
assessments' scorecard — now fetches values with
`.or_("role_level_id.eq.<id>,role_level_id.is.null")` instead of a plain `.eq()`, so all three
consumers pick up org-wide values automatically. RLS needed no change: `value_configs`' policy is
org-scoped (`org_id = current_org_id()`), not role_level-scoped, so a null `role_level_id` was
already covered.

**Draft prompt restraint:** deliberately steers the model away from padding every category —
explicit instruction to leave role-specific VALUES empty unless the JD clearly implies a
role-specific behavioral bar beyond generic company values (those belong in the org-wide block,
not duplicated per role), same "an honest empty array beats a fabricated complete one" restraint
already proven in assessments.py's draft prompt and the 1:1 prep prompt's expectations block.

**Frontend (`app/app/settings/page.tsx`, Expectations section):** `CoverageGrid` (new default
view) — one row per role, a count pill per kind (amber at zero) opening `ExpectationDetail` (the
old section body, unchanged, now reached via "← Back to coverage" instead of being the landing
view) on click, plus a per-row "Draft with AI" button. `OrgWideValuesBlock` renders above the list
on the Values tab — writes `value_configs` rows with `role_level_id: null` via the existing
`createExpectation`/`deleteExpectation` calls, no new endpoint needed for that part.
`DraftReviewPanel` (modal) runs the AI draft on open, shows editable include-checkbox rows per
kind tab, and a "copy from another role" select as the non-AI alternative source (pulls that
role's real configs via `getExpectations`, replacing the draft rows) — "Add N expectations"
batches the included rows per kind through `/{kind}/batch`.

**Verification note:** no live Supabase access from this session (device sandbox has no network;
cloud container has network but not this project's Supabase credentials) — backend was verified
with `py_compile`, a full `main.py` import (catches import-order bugs `py_compile` alone would
miss), and functional smoke tests against a hand-rolled fake Supabase client covering
`get_coverage()`'s org-wide exclusion, `batch_create_expectations()`'s row shape, the `/draft`
route through a real `TestClient` (exercises the `@limiter.limit` decorator), and
`fetch_role_expectations()`'s new `.or_()` union — not a substitute for a live Postgres run.
Frontend verified with `tsc --noEmit` + `next build` (21/21 routes), installed and built directly
in this session's cloud container (network available here, unlike the device sandbox). Live
golden-path check (Draft with AI on a real role, commit, confirm it surfaces on the person page
and prep grounding) is still owed after deploy.

---

## Scope discipline

The schema is intentionally complete for the full vision (see PRODUCT_VISION.md).
**Build order still matters** — don't implement the competency/assessment
layer until it's actually needed. Goals shipped in Session 10, Org shipped in
Session 11, Projects shipped in Session 13 (the core 1:1 prep + commitments
flow was working and in Andrew's hands first, per the original rule).

Things explicitly not yet built:
- Stripe webhook handler + subscription-gating middleware
- Blog content pipeline (start with MDX in-repo when the time comes)
- ~~Role-scoped views~~ — **built Session 15** (org-unit leader assignment +
  aggregate rollup across People/Goals/Projects/Capacity; see the Role-scoped
  views section above). Still open: individual-level goals aren't rolled up
  (department/team only), and there's no admin/owner concept gating who can
  assign a leader (any org member can, today).
- IC login: the account/claim mechanism shipped Session 22 (invite → magic link →
  `direct_reports.user_id` set — see the Team Mission Control section above), but there's still no
  IC-facing view once someone logs in — `/app/ic` is a static placeholder. `team_messages` (Session 21)
  remains store-only because of this; a real IC view is the natural next step to unlock it.
- Commitments → project linking (`source_type='project'`, already in
  schema.sql's check constraint) — Projects (Session 13) shipped CRUD only,
  same scope discipline as Goals shipping without rollup calculation
- Goal rollup/status calculation (a parent goal's status computed from its
  children's) — PRODUCT_VISION.md's concept, not built; `goals.status` is a
  plain manually-set field today. Same is true of `projects.status`.
- `role_levels.functional_team` data migration — the column stays in the
  schema (not dropped) but the UI stopped writing/showing it as of Session
  11; existing free-text values are not backfilled into org_units.
- Cycle prevention on `org_units.parent_unit_id` — `org_units.py` only
  guards a unit becoming its own direct parent, not a deeper cycle (A's
  parent set to B when B's parent is already A). Fine for a solo manager
  hand-building a small tree; revisit if this becomes multi-editor.
- Capacity demand/allocation (Session 14) — v1 ships supply only (how much
  capacity exists). Wiring it into Projects/Goals as an actual allocation
  view (how much of that capacity is spoken for) is the natural next step,
  explicitly deferred this pass.
- ~~Per-org-unit rollup permissions~~ — **built Session 15** via
  `org_units.leader_user_id` + `led_org_unit_ids()`; see the Role-scoped
  views section above.
- ~~Ratings/assessment layer~~ — **built Session 16** (rolling assessment:
  overall rating + per-metric/skill/value scores, AI-assisted draft); see
  the Assessments section above. `performance_reviews` (formal periodic
  review) is still dormant — deferred in favor of the rolling assessment.
- ~~Mission Control dashboard~~ — **built Session 18** (manager-view-only:
  Individual Performance, Organization/Department/Team Goals, Key
  Initiatives, a Capacity snapshot; see the Mission Control section above).
  Department Head / Team / Individual (IC) role-scoped versions of this same
  page are still unbuilt, and there's no synthesized team-level rating
  rollup — just each report's latest score as-is.
- Settings UI for renaming `assessment_levels` — `PUT
  /api/assessments/levels/{ordinal}` exists but nothing in Settings calls
  it yet; the 5 auto-seeded default labels are usable as-is.

---

## File map

```
backend/
  main.py         FastAPI app init, CORS, router registration, rate-limiter wiring (Session 20)
  config.py       Settings — reads .env, exposes AI model names + Supabase keys
  utils.py        get_authenticated_client() (token cache now self-evicting, Session 20; also
                  propagates the user JWT to client.storage as of Session 28 — see Context Engine
                  Session II above), ensure_org()/get_email_from_token() (Session 11), shared
                  `limiter` (Session 20), shared helpers
                  get_org()/resolve_cadence_days() (Session 37/38) — read-only org lookup +
                  the single canonical cadence resolver (per-report override -> org default ->
                  hardcoded 21), returns (days, source) for the honesty-convention label
  ai_core.py      generate_text() — the only place Anthropic SDK is called; generate_text_from_document()
                  (Session 28) sends a base64 PDF as a native Claude document content block
  context_engine.py  Shared Context Engine plumbing, not a route. Session IV (Session 29):
                  get_relevant_context()/format_context_block()/record_citations() — two-tier
                  retrieval. Session V (Session 30): _decay_multiplier()/compute_category_coverage() —
                  the Brain's scoring. Session VI (Session 31): _decay_multiplier() promoted to
                  canonical + wired into retrieval ranking, staleness_prompt on coverage, and scope
                  conflict detection (find_scope_conflicts()). See Context Engine Session IV/V/VI above.
  nixpacks.toml   Railway build config (Session 28) — adds the `libreoffice` package for PPTX→PDF
  routes/
    direct_reports.py   GET/POST/PUT/DELETE /api/direct-reports (+ /overview, /rollup — Session 15)
    one_on_ones.py      GET/POST /api/one-on-ones, POST /prep (prep sheet — now pulls Context Engine
                          docs via context_engine.py as of Session 29), POST /wrapup (notes → draft log)
                          GET /overview (Session 37/38) — per-report is_due/days_since_last/
                          cadence_days/cadence_source/planned_session/last_completed; the single
                          canonical "who's due" computation, backs /app/1-1s and the zone map
    commitments.py      GET /api/commitments, PATCH /api/commitments/{id}
    goals.py            GET/POST/PUT/PATCH/DELETE /api/goals — full level hierarchy (Session 10) + /rollup (Session 15)
                          + GET/POST /{id}/check-ins, list enriched with progress/trend/freshness (Session 26)
    projects.py          GET/POST/PUT/PATCH/DELETE /api/projects — goal_id + direct_report_id, no level (Session 13) + /rollup (Session 15) + org_unit_id filter (Session 46)
                          + GET/POST /{id}/check-ins, list enriched with progress/trend/freshness (Session 26)
    check_ins.py         shared helpers, NOT a router (Session 26) — create_check_in (ownership 404 + status
                          write-through to the parent), list_check_ins, enrich_with_check_ins
    org_units.py         GET/POST/PUT/DELETE /api/org-units — team/department tree (Session 11) + leader_user_id, /led, /members (Session 15)
    capacity.py          /api/capacity — settings, work-units, profiles, time-off, /overview, /rollup (Session 14; /rollup gated by led scope as of Session 15)
    settings.py         /api/settings — profile, role-levels, expectations (manual CRUD only)
    expectations_ai.py   /api/expectations — GET /coverage (per-role_level metric/skill/value counts +
                          org_wide_values_count), POST /draft (AI draft from job_responsibilities,
                          nothing saved), POST /{kind}/batch (commits a reviewed draft) (Session 39).
                          Imports settings.py's _CONFIG_TABLES/_expectation_row/ExpectationIn rather than
                          duplicating the row shape — same "AI/rollup module sits on top of an existing
                          CRUD module" shape as assessments.py on direct_reports.py.
    roles_import.py      /api/roles/import — POST /draft (Session 44): JD paste or .pdf/.docx/.txt/.md
                          upload → ONE AI call → role identity + attach/create_new/exists match proposal
                          + expectations draft. Model ids never trusted (_validate_match: hallucinated
                          family → create_new; occupied level → forced to exists against that row).
                          Reuses expectations_ai's _EXPECTATION_DEFINITIONS + parse_draft_items so both
                          draft paths calibrate identically, and documents.py's convert_to_pdf
                          (generalized from _convert_pptx_to_pdf, same LibreOffice binary) for .docx.
                          Pure-AI, nothing saved, no Storage writes; commit is client-orchestrated
                          through role_families / settings role-levels / expectations batch endpoints.
    assessments.py       /api/assessments — levels, team list, per-report scorecard, AI draft, save (Session 16)
    dashboard.py          GET /api/dashboard/insight — Mission Control's AI insight banner (Session 19),
                          cached + rate-limited (Session 20)
                          Session 37/38: the insight prompt's staleness bullet now uses each report's
                          own resolve_cadence_days() result instead of one shared hardcoded threshold
    team.py               /api/team — roster + active projects/priorities per report, message log (Session 21);
                          goals, meeting notes (+ meeting_date agenda surfacing, Session 23) (Session 22);
                          commitments (Session 23); callout (Session 24)
                          Session 37/38 bug fix: get_team_goals() now calls check_ins.py's
                          enrich_with_check_ins() (previously never called it) — the KPI tile and
                          progress ring were reading a different, wrong signal than Mission Control
                          Session 45: notes/callouts gain org_unit_id (team dropdown scoping);
                          GET /callout now returns a list (one row per led team + all-teams), PUT
                          does a manual find-then-write instead of upsert()
    documents.py           /api/documents — POST /upload (Context Engine Session II, Session 28):
                          PPTX/PDF/text upload → LibreOffice PPTX→PDF → Storage → Librarian extraction
                          call → pending_review row. GET "" list for manual verification only.
                          PUT /{id}/confirm, DELETE /{id} (Session III, same session): confirm-card
                          write-back — sets category/freshness/effective_date + document_scopes +
                          confirmed_as_is/correction_log; delete is best-effort at any status.
                          GET /coverage (Session V, Session 30): the Brain's data — thin wrapper over
                          context_engine.compute_category_coverage(). Session VI (Session 31): response
                          shape changed to {"categories": [...], "conflicts": [...]} — conflicts from
                          context_engine.find_scope_conflicts().

frontend/
  app/
    (marketing)/        Public SSG pages (home, pricing, blog) — need to be indexable
    app/dashboard/      Mission Control — landing page (Session 18; grid layout Session 19): Individual Performance, Goals, Key Initiatives, Capacity strip, AI insight banner, Quick Add. Goals + Key Initiatives cards exception-first via TriageCard (Session 26). Individual Performance itself went exception-first (IndividualPerformanceCard) and the AI insight banner gained a distinct failed-vs-null state, Session 37/38
    app/1-1s/            Front door for the 1:1 loop (Session 37/38, nav rework pass 2) — Due now /
                          Prepped not yet run / Recently wrapped, sourced from GET /api/one-on-ones/overview
    app/login/          Login page
    app/goals/          Goals page — own top-level page, not under Settings (Session 10)
    app/projects/        Projects page — own top-level page, grouped by assignee (Session 13)
    app/org/            Org builder — own top-level page, tree (build/edit) + chart (Session 11) + Rollup tab (Session 15)
    app/capacity/       Capacity page — period selector, "your team" + led-scope org-unit rollup (Session 14; gated Session 15)
    app/assessments/    Team list + [reportId] scorecard — overall rating, per-item scores, AI draft (Session 16)
    app/team/            Team Mission Control — KPI strip, Initiatives/Goals/Commitments row, Critical
                          callouts + Meetings row, roster row at bottom (Session 21; 3-column rework
                          Session 22; layout rework Session 24)
                          Session 45: header gains a team-name + dropdown (leader's led org_units,
                          "All teams" default) that filters every section on the page
    app/context/         The Space (Context Engine Session III, Session 28) — upload form, inline
                          confirm-card queue (ConfirmCard component in-file), failed-upload discard
                          section, recently-confirmed feedback list. Added to Mission Control's NAV_LINKS.
                          The Brain (Session V, Session 30): coverage grid above the upload form —
                          BrainCategoryCard (inline-SVG radial ring) + BrainDetailPanel click-through,
                          both in-file. Page widened max-w-3xl → max-w-4xl. Session VI (Session 31):
                          BrainCategoryCard gained an amber "Aging" pill, BrainDetailPanel renders
                          staleness_prompt, new in-file ConflictBanner renders scope conflicts above
                          the grid.
  lib/
    api.ts              All fetch() calls live here. authedFormFetch (Session 28) is the multipart
                        variant for file uploads — authedFetch always forces JSON Content-Type.
    supabase.ts         createClientComponentClient() — browser-side auth client
  components/
    AppNav.tsx           Persistent global nav (Session 36/37, "hub & orbit") — sticky header + orbit
                        strip + zone-map overlay, rendered once from app/app/layout.tsx
    ZoneMap.tsx           Nav config (NAV_GROUPS), icons, hue/tone styling, useZoneData() (fetches every
                        door's count), <ZoneMap> — shared between AppNav's overlay and Mission Control's
                        inline map, which it replaced in place (Session 36/37)
    QuickAddModal.tsx   Mission Control's quick-add — type picker + minimal create form (Session 19)
    CheckInPanel.tsx    shared check-in strip for goal/project cards (Session 26) — progress bar/%, trend arrow,
                        staleness label, inline check-in form, lazy history; exports isStale/TrendArrow/etc.
                        reused by dashboard's TriageCard. averageProgress() (Session 37/38) — shared
                        progress-% aggregate now used by both Mission Control and /app/team's goal ring
```

---

## Open questions / not yet decided

- Stripe webhook handler + subscription-gating middleware
- Blog content pipeline (MDX in-repo is the default when we get there)
- Error monitoring (Sentry, or Railway's built-in, or nothing for now) — `sentry-sdk` is
  in `requirements.txt`, unused, same "installed ahead of being wired up" state `slowapi`
  was in before Session 20
- Automated tests — `pytest` is in `requirements.txt`, unused. No test files, `tests/`
  directory, or CI config anywhere in the repo as of Session 20. Andrew's explicit call
  (Session 20 foundation-weaknesses triage): keep flagging rather than scope a first
  pass now.
