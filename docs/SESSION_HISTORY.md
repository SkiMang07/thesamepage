# The Same Page — Session History

One entry per session. Read the most recent entry first — it tells you the
current state and what to do next so you don't relitigate past decisions.

Format per entry:
- **Date + session goal**
- **What was done**
- **Decisions made / locked**
- **Next step**

---

## Session 26 — 2026-08-11

**Goal:** Started as an open brainstorm from Andrew — goals and initiatives feel inert on Mission Control (cards can't be interacted with, no visible progress, no sense of how they connect to the team), and the free-text `success_metrics` decision from Session 10 makes any rollup a "rollup of vibes." Diagnosed as three missing primitives: a computable progress signal, a freshness/trend signal, and visible goal↔initiative↔people linkage. Andrew said "I'll take your lead"; scoped via one AskUserQuestion round (all four recommendations accepted) and built same session.

**What was done:**
- New `check_ins` table (`database/migrations/2026-08-11_check_ins.sql` + schema.sql) — the temporal layer for goals AND projects: one shared table, each row status + optional manual progress % (0-100) + optional one-line note, exactly one parent (`num_nonnulls(goal_id, project_id) = 1` check), owner-scoped RLS, `(parent, created_at desc)` indexes. Depends only on the base goals/projects tables.
- `backend/routes/check_ins.py` (new — shared helpers, not a router): `create_check_in()` (ownership 404 + **write-through of the check-in's status to the parent's `status` column**, so every pre-existing status-reading surface keeps working unchanged), `list_check_ins()`, `enrich_with_check_ins()` (decorates list responses with `progress` = latest non-null %, `trend` up/down/flat from the latest two non-null %s, `last_check_in_at`/`last_check_in_note`). goals.py and projects.py each mount `GET`/`POST /{id}/check-ins` and enrich their list endpoints.
- `frontend/components/CheckInPanel.tsx` (new, shared by goal and project cards): progress bar + %, trend arrow, freshness label (amber past 14 days — a stale green is more dangerous than an honest yellow), inline quick check-in form (status defaults to current, % defaults to last asserted), lazy-loaded history. Wired into `/app/goals` and `/app/projects` per card; both pages mirror the write-through in list state without a refetch.
- Goal cards on `/app/goals` now list the initiatives serving them (the `goal_id` link existed end-to-end since Session 13 — this session just made it visible; no schema change needed).
- Mission Control's Goals + Key Initiatives cards reworked **exception-first** (new shared `TriageCard` in dashboard/page.tsx): attention rows first — at-risk, overdue / due within 14 days, stale (no check-in in 14 days / never), and for goals "No initiative" (a "what" with no "how") — each with status dot, %, trend arrow, and reason chips, clicking through to the owning page; healthy items collapse to a "Show N on track" toggle. Completed/cancelled goals sit out of triage.
- `frontend/lib/api.ts` — `CheckIn`/`CheckInIn`/`CheckInDerived` types + the four check-in client functions; `Goal`/`Project` extended with the derived fields.

**Decisions made / locked:**
- Check-ins cover both goals and projects in ONE shared table — same status enum, same shape, and the COO-agent temporal layer (data gap #2 in `docs/COO_AGENT_QUESTION_SET.md`) wants one place to diff history. This closes that gap.
- Progress is a manually-asserted % per check-in — honest about the judgment involved. Structured key results (metric/current/target rows with computed attainment) considered and deferred; a note-only check-in never wipes the last asserted %.
- Write-through status (not derived-only) so zero existing surfaces needed changes — the migration is additive.
- STALE_CHECK_IN_DAYS = 14, deliberately shorter than the dashboard's 21-day 1:1 cadence — goals drift faster than relationships. DUE_SOON_DAYS = 14.
- AI-derived status/progress (reading `success_metrics` + check-in notes, draft-then-review) deferred to the agent layer — a COO-agent feature, not a blocker for this pass.

**Verification:** backend — fresh venv, `main` import with dummy env vars confirmed all 4 new check-in routes registered, `py_compile` clean. Frontend — fresh `npm install`, `tsc --noEmit` clean, `next build` clean (19/19 routes). Schema — local Postgres 16 + the Sessions 22-24 auth stub: full `schema.sql` end-to-end clean, then functional tests all PASS (exactly-one-parent and 0-100 constraints, RLS owner-sees-3 / other-manager-sees-0 / forged-owner insert rejected, goal-delete cascade, newest-first ordering); also verified the migration applies cleanly on top of the pre-session (HEAD) schema.

**Next step:** Run `database/migrations/2026-08-11_check_ins.sql` against live Supabase BEFORE deploying — the Goals/Projects pages now query `check_ins` on load and will error until it runs (no dependency on any other pending migration). Then dogfood: the check-in cadence itself (is a weekly check-in per goal sustainable solo?), the exception-first cards, and the trend/staleness signals. Deferred ideas queued from the brainstorm: structured key results, AI-proposed check-ins, `/app/team`'s progress ring computing from real %s instead of status counts.

---

## Session 25 — 2026-08-09

**Goal:** COO agent brainstorm round 2 (follow-up to the Session ~9 agent-hierarchy idea, whose "wait until the data models exist" objection is now resolved). No code.

**What was done:** Drafted an 18-question eval suite for the agent layer, readiness-rated 🟢/🟡/🔴 against today's schema, saved to `docs/COO_AGENT_QUESTION_SET.md` (committed with Session 26's push). Identified and ranked 5 data gaps: (1) no demand-side capacity / person↔initiative assignment, (2) no temporal/history layer — closed by Session 26's check-ins, (3) no context-docs feature, (4) no structured career-aspiration field, (5) no team-health signal.

**Decisions made / locked:** Agent roster (COO + culture/L&D/performance/strategy&ops) is brand, not architecture — one COO agent with per-domain context loaders, split only if quality degrades. Mode A (on-demand consultation) ships before Mode B (proactive background work). Context-docs agreed as a future first-class data model. Eval-suite-first: don't ship 🔴 questions until their gap closes.

**Next step:** was "pick which gap to close first" — Session 26 closed gap #2 (temporal layer) via check-ins.

---

## Session 24 — 2026-08-09

**Goal:** Visual/layout redesign of `/app/team` (Team Mission Control), Andrew's explicit ask after dogfooding Session 22/23's 3-column grid — captured at the end of Session 23 as its own follow-up session, not built straight from the brief. Requested as a design-exploration pass first: propose a few layout options and let Andrew pick before writing any code.

**What was done:**
- Read the brief (team_page_redesign_brief project memory note) and the current page.tsx/api.ts, then ran an AskUserQuestion scoping round: (1) write access — **manager-authored, team just views**, no new IC-facing write UI this pass (IC login still has no real view, only auth primitives); (2) visual style — **stay close to today's calm aesthetic for most options, but at least one pushed more visual/engaging** (Andrew wanted 4 options minimum, not the 2-4 range originally proposed).
- Built and sent 4 static HTML mockups (fake data, tab-switcher, no live code): A · Refined Grid (closest to today), B · Unified Strip (merged goals+commitments card, accordion meetings list), C · Working Board (goals+commitments mixed into a status-grouped mini-kanban, meetings as a feed), D · Command Center (KPI stat strip, radial goal progress, gradient meeting hero + carousel — the requested "more visual" option).
- Andrew picked **D**, then asked for three changes: move the roster from a left rail into a row at the very bottom; add a new "Initiatives" card into the top row alongside Goals and Commitments; add a "Critical callouts" panel to the left of Meetings, in the whitespace freed up once the roster moved. Sent a refined mockup reflecting all three, flagging two assumptions for confirmation: Initiatives = reusing Mission Control's existing "Key Initiatives" concept (`getProjects()` filtered to active/on_track/at_risk), Critical callouts = reviving "key updates" (deferred Sessions 22/23) as a small always-visible panel. Andrew confirmed both.
- Built the approved layout in `frontend/app/app/team/page.tsx`: a KPI strip (goals on track, active initiatives, commitments due within 7 days, days until next meeting); a "this week's focus" row with Initiatives/Goals/Commitments cards; a Meetings row with Critical callouts to the left (past-meetings restyled from a 2-col grid to a horizontal carousel, detail modal kept); the roster as a row of cards at the bottom that expand into a shared detail panel on click.
- **Critical callouts** needed one new piece: `team_callouts` table (unique on `manager_id`, RLS manager-scoped same pattern as `team_messages`/`team_meeting_notes`), new `GET`/`PUT /api/team/callout` in `team.py` (PUT upserts on `manager_id`), new `TeamCallout` type + `getTeamCallout()`/`updateTeamCallout()` in `lib/api.ts`. Before writing the migration, confirmed with Andrew via AskUserQuestion that Session 23's migration was already live (project convention — never touch schema further without checking).
- New migration `database/migrations/2026-08-09_team_callouts.sql`. Andrew ran it against live Supabase after the build was verified.
- Updated `docs/ENGINEERING.md` (new "Team Mission Control layout rework" section, core-tables list, file map) and `docs/DESIGN.md` (4 new decision rows).

**Decisions made / locked:**
- Write access stays manager-authored with the team viewing only — the brief's "team member adds their own agenda items" framing is deliberately not built this pass, not decided against, just deferred until IC login has a real view.
- Initiatives reuses `getProjects()` filtered client-side to active/on_track/at_risk (Mission Control's existing Key Initiatives subset) rather than a new team-scoped endpoint — no new data source needed.
- Critical callouts is ONE overwritten text block per manager, not a dated history log — deliberately smaller than the original "key updates" broadcast-feed idea that got deferred twice, to avoid the same rushed-verification concern that deferred it before.
- Roster moved from a left column to a bottom row; clicking a card opens a shared detail panel below the row instead of expanding the card in place — same data/actions, different location, to make room for the new Initiatives card up top.

**Verification:** cloned the pushed repo (commit `94a0808`) into a scratch environment, copied the 5 changed/new files in. Backend — fresh venv, `main` import with dummy Supabase env vars confirmed `/api/team/callout` (GET+PUT) registered, `py_compile` clean. Frontend — fresh `npm install`, `tsc --noEmit` clean, `next build` clean (all 17 routes, `/app/team` at 8.01 kB). Schema — spun up a local Postgres 16 with the same minimal Supabase `auth` schema stub as Sessions 22/23, this time also explicitly granting `anon`/`authenticated` table privileges to match real Supabase's defaults (missing from the stub, caught by a permission-denied error on the first attempt); ran the *entire* `schema.sql` end to end with zero errors, then functionally tested `team_callouts` — upsert-create, upsert-edit in place (one row, not a duplicate), a second manager saw zero rows under RLS, and a second manager's attempted `UPDATE` against the first manager's row affected zero rows and didn't mutate it.

**Next step:** Migration is confirmed live (Andrew ran it before this push). Highest-value next steps: (1) dogfood the new layout for real — KPI numbers, Initiatives card, Critical callouts, and the roster-as-row interaction all deserve real use before the next visual pass; (2) revisit whether Critical callouts should ever grow beyond one overwritten block (a short history, multiple pinned items) if the single-block version feels too limiting in practice — deliberately not built this session; (3) IC login still has no real view once someone logs in (`/app/ic` is a static placeholder) — the wider "team member adds their own agenda items" framing from the original brief stays blocked on that.

---

## Session 23 — 2026-08-09

**Goal:** Follow-up on Session 22's Team Mission Control — extend the meeting-notes column with a
surfaced "next meeting's agenda" distinct from logged past meetings, switch the past-meeting list from
a flat reverse-chron text list to a card view that opens into a detail view on click, and add
team-level commitments (assigned to individual direct reports but tracked at the team level too).
Confirmed with Andrew first that both Session 21/22 migrations are live on Supabase before touching
schema further.

**What was done:**
- Scoped via one AskUserQuestion round (4 questions: migration status, agenda-vs-log model,
  past-meeting UI shape, commitments data model) plus a 2-question follow-up (commitments UI placement,
  whether to fold in "key updates"): (1) migrations confirmed live; (2) agenda vs. logged past meeting —
  **date-based, derived status**, mirroring `one_on_ones`' planned/completed split; (3) past-meeting UI —
  **card + snippet, opens a detail modal**; (4) team commitments — **extend `commitments`** with a flag,
  not a new table; (5) commitments UI — **new section in an existing column** (below the roster); (6)
  "key updates" — **stayed deferred**.
- **Meeting-notes agenda surfacing** — `team_meeting_notes` gains a nullable `meeting_date`.
  `GET`/`POST /api/team/notes` (team.py) pass it through; the frontend derives "upcoming" (today or
  later) vs. "past" client-side, no stored status column.
- **Past-meeting card/detail UI** — `frontend/app/app/team/page.tsx`'s `NotesColumn` reworked: a hero
  "Next meeting" card (soonest upcoming note) + a collapsible "Plan next meeting" form (date + agenda
  text), the existing "Log a past meeting" compose box kept as-is, and past notes now render as a card
  grid (date + snippet) opening a full-text detail modal on click.
- **Team-level commitments** — `commitments` table gains `is_team_commitment` (boolean, default false).
  New `GET`/`POST /api/team/commitments` (team.py): list filters the flag, create validates the direct
  report belongs to the manager before inserting. Marking done/dropped reuses the existing
  `PATCH /api/commitments/{id}` unchanged. Frontend: new `TeamCommitmentsSection` appended below
  `RosterColumn` — open commitments list (assignee, due date, mark-done) + an inline add form.
- **`frontend/lib/api.ts`** — `TeamNote` gains `meeting_date`; `createTeamNote` takes an optional
  meeting-date arg; new `TeamCommitment` type + `getTeamCommitments()`/`createTeamCommitment()`.
- New migration `database/migrations/2026-08-09_team_agenda_and_commitments.sql` (two additive
  columns; depends on both `2026-08-08_team_messages.sql` and `2026-08-08_team_mission_control.sql`
  already being live, confirmed with Andrew before writing any code).
- Updated `docs/ENGINEERING.md` (new "Team Mission Control follow-up" section, core-tables list,
  file map) and `docs/DESIGN.md` (5 new decision rows).

**Decisions made / locked:**
- Agenda vs. past meeting is derived from `meeting_date`, never a stored status field — same discipline
  as `one_on_ones`, and avoids a second status column to keep in sync as dates pass.
- Team commitments reuse the existing `commitments` table via a flag rather than a new table or true
  multi-assignee model — a commitment already has exactly one `direct_report_id`; the flag only changes
  where it's visible, not the underlying shape.
- Team commitments live with the roster (per-person accountability), not as a 4th grid column or a new
  top-level page — the 3-column grid already fits Mission Control's existing visual weight.
- "Key updates" stayed deferred a second time — kept this session to three new pieces instead of four,
  same rushed-verification concern that deferred it in Session 22.

**Verification:** cloned the pushed repo into a scratch environment, same pattern as Session 22.
Backend — fresh venv, `main` import with dummy Supabase env vars confirmed `/api/team/commitments`
(GET+POST) registered; `py_compile` clean. Frontend — fresh `npm install`, `tsc --noEmit` clean,
`next build` clean (all routes including `/app/team`). Since this touched schema, went one step
further: spun up a local Postgres 16 with a minimal Supabase `auth` schema stub (`auth.users` with
`raw_user_meta_data`, session-variable-backed `auth.uid()`/`auth.email()`, `anon`/`authenticated` roles
+ grants), ran the *entire* `schema.sql` end to end with zero errors, then functionally inserted as the
`authenticated` role: a past note (no `meeting_date`), an upcoming agenda note (`meeting_date` =
today+3), and a team-flagged commitment tied to a direct report — all succeeded under RLS. Confirmed
RLS isolation: a second manager's session saw 0 rows for both tables. What's still unverified: the live
migration run itself and real Supabase Auth integration (same gap every session's sandbox has).

**Next step:** Andrew needs to run `database/migrations/2026-08-09_team_agenda_and_commitments.sql`
against the live Supabase database (after confirming Session 21/22's migrations already ran, which he
confirmed at the start of this session). Once live, the highest-value next steps are: (1) dogfood the
agenda/card-detail/commitments UI for real, (2) pick up "key updates" as its own scoped pass if still
wanted, (3) revisit team commitments as true multi-assignee (one commitment fanning out to several
people) only if it's actually needed — this session's flag deliberately doesn't build that.

---

## Session 22 — 2026-08-08

**Goal:** Expand the `/app/team` page built Session 21 into "Team Mission Control" — a 3-column
team-wide surface (roster/priorities left, company+team goal progress middle, a running meeting-notes
log right), plus decide how much of IC login to build now. This is PRODUCT_VISION.md's "Team Mission
Control" dashboard concept, picked up directly from the handoff at the end of Session 21.

**What was done:**
- Scoped via one AskUserQuestion round (4 questions) plus a follow-up clarification on the "key
  updates" question: (1) IC login — **auth primitives now, IC view later**, not a full build and not
  deferred again; (2) "key updates" (manager broadcast feed) — **deferred to a follow-up**, after Claude
  flagged that a 4th new subsystem in one pass risked rushed verification on everything else; (3)
  meeting notes — **standalone team-wide log**, not a unified feed pulling in `one_on_ones`; (4)
  `/app/team` — **reworked in place**, not a new route.
- **IC login auth primitives** — new `direct_report_invites` table (manager-scoped RLS, 7-day TTL
  tokens) + two SECURITY DEFINER functions (`get_invite_preview`, granted to `anon` since the visitor
  hasn't logged in yet; `accept_direct_report_invite`, which claims the `direct_reports` row and
  corrects the `users` row's role to `'ic'`). `direct_reports.py` gets `POST /{report_id}/invite`
  (also backfills `direct_reports.email`, a second dormant column with no prior UI to set it — the
  invite form is now that UI). New `routes/invites.py` (`GET`/`POST /api/invites/{token}`). Frontend
  reuses the existing passwordless magic-link flow (`supabase.auth.signInWithOtp`) end to end — no
  changes needed to `auth/callback/route.ts`, which already supported a `next` param. New public page
  `frontend/app/invite/[token]/page.tsx` and a minimal stub landing page `frontend/app/app/ic/page.tsx`
  (protected by the existing `middleware.ts` gate). No email is sent from the backend — the manager
  copies the generated link and sends it themselves, same manual-delivery posture Session 21 chose for
  `team_messages`. Building what an IC actually sees once logged in is explicitly deferred.
- **Goal progress column** — `GET /api/team/goals` (team.py), filtered to `level in ('company',
  'team')` only. Goals are owner-scoped everywhere in this codebase already, so no new rollup function
  was needed — just a level filter on the manager's own goals.
- **Meeting notes column** — new `team_meeting_notes` table (manager-scoped RLS) + `GET`/`POST
  /api/team/notes`. Standalone, no attendee tagging, deliberately separate from `one_on_ones` (stays
  per-report) and `team_messages` (stays per-report).
- **`/app/team` reworked in place** — Session 21's roster becomes the left column (condensed styling,
  same data) with a new "Invite to log in" action per report; middle column renders goal progress;
  right column renders the meeting-notes log with a compose box. Same route, same nav item.
- **`frontend/lib/api.ts`** — `TeamGoal`/`TeamNote`/`InvitePreview` types + `getTeamGoals()`,
  `getTeamNotes()`, `createTeamNote()`, `inviteDirectReport()`, `getInvitePreview()`, `acceptInvite()`;
  extended `TeamMember` with `email`/`user_id`.
- New migration `database/migrations/2026-08-08_team_mission_control.sql` (depends on Session 21's
  `2026-08-08_team_messages.sql` already having run).
- Updated `docs/ENGINEERING.md` (new Team Mission Control section, core-tables list, Open Questions'
  IC-login line) and `docs/DESIGN.md` (7 new decision rows).

**Decisions made / locked:**
- IC login ships in two passes: the account/claim mechanism now, the IC-facing view as a follow-up.
  Andrew's explicit prior rejection of a lighter no-login workaround ruled out skipping the real
  mechanism, but scoping both a manager-facing rework AND a new IC view in one session risked doing
  neither well.
- "Key updates" is scoped conceptually (a manager-authored broadcast feed, distinct from
  `team_messages`) but has no code yet — explicitly deferred, not built partially.
- Meeting notes stays a separate table/feed from `one_on_ones`, not merged into one chronological view
  — keeps 1:1 history exactly where managers already expect to find it.

**Verification:** cloned the pushed repo into a scratch environment, same pattern as Session 20/21.
Backend — fresh venv, installed `requirements.txt`, imported `main` with dummy Supabase env vars,
confirmed all 5 new/changed routes registered and `app.state.limiter` attached; `py_compile` clean on
every changed file. Frontend — fresh `npm install`, `tsc --noEmit` clean, `next build` clean, 19/19
routes including the two new ones (`/app/ic`, `/invite/[token]`). Went one step further than usual
given the new SQL functions: spun up a local Postgres 16 with a minimal Supabase `auth` schema stub,
ran the full `schema.sql` against it (zero errors, every table/policy/function — not just the new
ones), then scripted the entire invite/claim flow with real SQL — preview as `anon`, IC signup firing
`handle_new_user()` for real, claim via `accept_direct_report_invite()`, confirming
`direct_reports.user_id`/`accepted_at`/`users.role` all land correctly, plus all three error paths
(re-accept, wrong email, expired token) reject as expected. What's still unverified: the real Supabase
Auth integration (actual magic-link email + JWT signing) and the live migration run — both need
Andrew's real Supabase project.

**Next step:** Andrew needs to run `database/migrations/2026-08-08_team_mission_control.sql` against
the live Supabase database (after confirming `2026-08-08_team_messages.sql` from Session 21 already
ran) before `/app/team`'s new columns or the invite flow will work. Once live, the highest-value next
steps are: (1) walk the invite flow end to end with a real email to confirm the magic-link → claim
path works outside dummy credentials, (2) build the actual IC-facing view now that accounts can be
claimed, (3) pick up "key updates" as its own scoped pass.

---

## Session 21 — 2026-08-08

**Goal:** Andrew asked what's next; Claude's read of the project memory (the `team_space_brainstorm`
note from 2026-08-03) suggested Team View was the most natural pick — the most recently flagged,
unscoped item not gated on real user growth like Session 20's remaining foundation-weakness flags.
Scoped via the usual AskUserQuestion round, then built same session.

**What was done:**
- Scoped via 6 total AskUserQuestion rounds (4 up front, 2 follow-up once messaging's IC-login
  dependency surfaced): (1) build both the "team home" read surface AND messaging groundwork this
  session, not defer messaging to a later pass as the brainstorm note had recommended; (2) v1 scope is
  the caller's own direct reports only, not an org_unit rollup like role-scoped views; (3) show a
  roster with each person's active projects + individual priorities; (4) own top-level nav item, not
  folded into Mission Control; (5) since IC login isn't built, messaging is STORE-ONLY — a manager logs
  a free-text update per report, nothing is delivered anywhere (no email dependency added); (6) message
  shape is free text, not a structured priorities list.
- **New table `team_messages`** (`manager_id`, `direct_report_id`, `message`, `created_at`) —
  manager-scoped RLS (`manager_id = auth.uid()`), same pattern as `one_on_ones`/`assessments`, not the
  `owner_id`-on-goals/projects naming gotcha. Added to `database/schema.sql` and as a standalone
  migration, `database/migrations/2026-08-08_team_messages.sql`, **not yet run against the live
  database** — same "build ahead of the migration" posture as every prior new-table session.
- **`backend/routes/team.py`** (new) — `GET /api/team` (roster assembled from `direct_reports` +
  each report's active/on_track/at_risk projects and individual-level goals, filtered the same way
  Mission Control's Key Initiatives card filters — "what's happening now," not a full archive — plus
  each report's latest logged message; three queries + a Python merge, same shape as
  `direct_reports.py`'s `get_team_overview`), `GET /{report_id}/messages` (full update history,
  newest first), `POST /{report_id}/messages` (log a new free-text update). Registered in `main.py`.
- **`frontend/lib/api.ts`** — `TeamWorkItem`/`TeamMessage`/`TeamMember` types + `getTeam()`,
  `getTeamMessages()`, `sendTeamMessage()`.
- **`frontend/app/app/team/page.tsx`** (new) — roster of cards (name/role, priorities column, projects
  column, both with status pills reusing Goals/Projects' existing style constants), each with a "Log
  update" toggle that reveals a compose box + that person's update history. Copy is deliberately
  explicit that nothing is delivered ("Not sent anywhere yet — just kept on record here until reports
  can log in.") so the store-only nature doesn't read as a bug once IC login ships and someone asks
  where their updates went.
- Added a "Team" link to Mission Control's `NAV_LINKS` (first item, before Assessments).

**Decisions made / locked:**
- Team View v1 is scoped to the caller's own direct reports, matching Mission Control rather than
  role-scoped views' org_unit rollup — the team_space_brainstorm note's original recommendation.
- Messaging ships as store-only groundwork this session rather than deferred to a separate pass —
  Andrew's explicit call, overriding the brainstorm note's original two-pass recommendation. Delivery
  mechanism (email, or actual IC login) is unscoped follow-up work, not decided here.
- Team View's roster shows active/on_track/at_risk work only, same "what's happening now" framing as
  Mission Control's Key Initiatives card — full history stays on `/app/goals` and `/app/projects`.

**Verification:** cloned the pushed repo into a scratch environment for a full check (not just
`py_compile`, since this touched routing + a new frontend route): backend — fresh venv, installed
`requirements.txt`, imported `main` with dummy Supabase env vars, confirmed `/api/team` and
`/api/team/{report_id}/messages` both registered and `app.state.limiter` attached; frontend — fresh
`npm install`, `tsc --noEmit` clean, `next build` clean, all 16 routes including the new `/app/team`
built successfully. Not live-tested against real Supabase credentials — `team_messages` doesn't exist
in the live database yet (see Next step).

**Next step:** Andrew needs to run `database/migrations/2026-08-08_team_messages.sql` against the live
Supabase database before `/app/team` will load without erroring (same "migration not yet run live" gap
as every prior new-table session — Org units, Capacity, Role-scoped views all shipped this way).
Follow-up candidates once he's dogfooded it: an actual delivery mechanism for messages (email, or wait
for IC login), and whether Team View should eventually gain the same org_unit-rollup toggle Session 15
gave People/Goals/Projects/Capacity.

---

## Session 20 — 2026-08-08

**Goal:** Andrew asked to work through `foundation_weaknesses.md` (the 6 structural weaknesses flagged
in Session 19) and confirm they're all still active given how the app is doing, deciding fix-now vs.
keep-flagging one item at a time.

**What was done:**
- Verified all 6 items against the current code before triaging any of them — none had changed since
  Session 19 wrote them (confirmed via file mtimes + `git log`).
- **#1 fixed:** `backend/routes/dashboard.py` — in-memory cache on `/insight`, keyed by `user_id`,
  20-min TTL. A cache hit skips all 4 DB queries AND the AI call, not just the AI call. Deliberately
  NOT cached: the "no reports yet" and AI-failure early returns (so those retry next load instead of
  sticking empty for the TTL), and no invalidation on writes (flat TTL — up to 20 min of staleness
  after logging a 1:1 or resolving a commitment is accepted).
- **#3 fixed, partially:** `backend/utils.py` — `_token_cache` now evicts expired entries on every
  call (`_evict_expired_tokens()`), bounded by currently-valid tokens instead of leaking forever.
  Still per-process/in-memory, NOT shared across instances if this ever runs on more than one Railway
  dyno — that half of the flag is unchanged, would need something like Redis, not worth it at today's
  single-instance scale.
- **#4 fixed:** wired up `slowapi` — a `requirements.txt` dependency since before this session, never
  actually used. Shared `limiter` now lives in `utils.py` (avoids a circular import with `main.py`),
  registered via `app.state.limiter` + `SlowAPIMiddleware`. `@limiter.limit("10/minute")` added to the
  4 AI-calling endpoints: `/api/one-on-ones/prep`, `/api/one-on-ones/wrapup`,
  `/api/assessments/{direct_report_id}/draft`, `/api/dashboard/insight`. Per-remote-IP, not per-user —
  slowapi's `key_func` runs before `get_authenticated_client()` resolves `user_id`.
- **#2, #5, #6 kept flagged** — Andrew's explicit call on each. All three remain gated on real user
  growth (a second manager in the org, more report/history volume) rather than anything code-level
  changing since Session 19. Full reasoning per item in the `foundation_weaknesses` project memory
  note, which was updated with the fixed/still-flagged outcome for all 6.
- Updated `docs/ENGINEERING.md`: a new "Rate limiting" convention under Conventions → Auth, a token-
  cache note in the same section, a Session 20 addendum under the Mission Control section documenting
  the insight cache, File map updates for `main.py`/`utils.py`/`dashboard.py`, and two new Open
  Questions bullets (`sentry-sdk` and `pytest` are both installed-but-unused dependencies, same pattern
  `slowapi` was in before today).

**Verification:** `py_compile` clean on all 5 changed backend files (`main.py`, `utils.py`,
`routes/dashboard.py`, `routes/one_on_ones.py`, `routes/assessments.py`), plus a full import-time
smoke test — fresh venv, installed `requirements.txt`, imported `main` with dummy Supabase env vars,
confirmed no circular-import or decorator-ordering errors, confirmed all 4 rate-limited routes
registered and `app.state.limiter` attached. One step beyond the usual py_compile-only pass, since this
changed request wiring across multiple files rather than one function body. Not live-tested against
real Supabase/Anthropic credentials or an actual 429 response — would need mocking the Supabase auth
call, judged disproportionate for this pass.

**Decisions made / locked:**
- Rate limiting is per-IP, not per-user, going forward — see the Rate limiting convention in
  ENGINEERING.md. Revisit only if IP-sharing (e.g. an office NAT) causes a real false-positive
  complaint.
- The insight cache uses a flat TTL, not write-path invalidation — accepted tradeoff rather than
  threading cache invalidation into every route that touches 1:1/commitment/goal signals.
- #2 (client-side merge / no pagination), #5 (owner- vs org-scoped RLS split), and #6 (no automated
  tests) all stay flagged, not fixed. All three are either structural (span multiple files, or an
  actual RLS migration) or open-ended (test scope/CI setup) rather than contained patches, and none has
  a real trigger yet — still a single user on a single Railway instance.

**Next step:** Andrew should dogfood the cache/rate-limit behavior (won't be visible day-to-day — it's
infrastructure, not UI) and push. When #2/#5/#6 do get picked up later: #5 needs an actual RLS
migration on `goals`/`projects` (not a quick patch); #6 would start with the cadence/overdue-date math
and today's new cache/rate-limit logic as the highest-value first test targets.

---

## Session 19 — 2026-08-07

**Goal:** Andrew reviewed Session 18's Mission Control page and wanted it reworked into a grid —
three sections across the top, per his original design intent — plus best-practice UX/design ideas
from apps that have broken through. Asked for a static mockup first (no code changes), reviewed and
approved it, then scoped and asked to build it for real.

**What was done:**
- Delivered a static HTML mockup (sent directly to Andrew, not committed to the repo) showing a
  3-column grid, a stat ribbon, one AI insight banner, worst-first sorting, and a ⌘K quick-add
  placeholder, with a "design notes" section explaining each UX choice (Linear/Attio/Notion-style
  patterns: worst-first ordering, progressive disclosure, dot-vs-pill status, one insight not two).
- Scoped the real build via two rounds of AskUserQuestion: (1) the AI insight banner should be real
  AI-generated text, not a rule-based string; (2) quick add should be a simple modal, not a global
  ⌘K command palette.
- Built `backend/routes/dashboard.py` (new) — `GET /api/dashboard/insight`, registered in `main.py`.
  Gathers per-report days-since-last-1:1, open/overdue commitment counts, and at-risk goals
  (company/department/team level), then asks `generate_text()` (`AI_DEFAULT_MODEL_LIGHT`) to name at
  most ONE noteworthy thing or return null. Fails quiet on any AI/parse error — returns an empty
  insight rather than a 500, since this should never be the reason a dashboard load breaks.
- Added `getDashboardInsight()` + `DashboardInsight` type to `lib/api.ts`.
- Built `frontend/components/QuickAddModal.tsx` (new) — the app's first shared component and first
  `components/` directory. A type picker (Direct report / Goal / Project) with a minimal form per
  type, reusing the existing `createDirectReport`/`createGoal`/`createProject` functions. No new
  dependency.
- Rewrote `frontend/app/app/dashboard/page.tsx`: 3-column grid (Individual Performance / Goals / Key
  Initiatives) + a full-width Capacity strip below (deliberately not a 4th column — it's a snapshot
  stat, not a triage list); a stat ribbon (team size, due-for-1:1, at-risk goals, available hours);
  worst-first sort on Individual Performance (due-for-1:1 first, then by open commitment count); the
  AI insight banner wired to the new endpoint, dismissible; the full nav link row
  (Assessments/Goals/Projects/Capacity/Org/Settings) restored in the new header — the reviewed
  mockup had dropped it, which Andrew caught before any code was written.
- Removed the inline "add a direct report" form from Individual Performance (Session 18's location)
  — Quick Add is now the single way to create a direct report, goal, or project from Mission Control.

**Decisions made / locked:**
- AI insight is real AI-generated, not rule-based — Andrew's explicit call, since the insight is
  meant to be the page's "magic." Uses `AI_DEFAULT_MODEL_LIGHT` (haiku), not HEAVY — one sentence of
  triage, not a structured sheet.
- Quick add is a single modal, not a global command palette — Andrew's explicit call, matching the
  app's current size (not enough surface area yet to justify a ⌘K palette or a new dependency).
- Individual Performance's status stays binary (due for a 1:1, or not) plus a raw commitment count —
  NOT the mockup's 3-tier on-track/needs-check-in/at-risk status. Building that for real would mean
  inventing a status the data doesn't back; same restraint as Assessments' "leave unscored rather
  than force coverage" (Session 16).
- Capacity stays a full-width strip below the grid, not a 4th column — it's a snapshot number per
  person, not a scrollable triage list.

**Verification:** Full copy of backend + frontend staged and mirrored into a scratch build.
`python3 -m py_compile` clean on `main.py` + `routes/dashboard.py`. Fresh `npm install`,
`npx tsc --noEmit` clean, `npx next build` clean — 15/15 routes, `/app/dashboard` at 5.87 kB. All 5
changed/new files written to Andrew's local repo via `device_commit_files`.

**Also flagged (not fixed this session):** a prioritized list of foundation/scalability weaknesses
spotted while building — saved to project memory (`foundation_weaknesses.md`), not this doc, since
none of them are Mission-Control-specific. Highlights: the new insight endpoint has no response
caching (fires a real AI call on every dashboard load); no rate limiting on any AI-calling endpoint;
the client-side-merge pattern doesn't paginate; the owner-scoped vs org-scoped RLS split (already
partly documented in ENGINEERING.md) will need resolving before Department Head/Team rollups can
share goals/projects data; no automated tests anywhere in the codebase.

**Next step:** Andrew should dogfood the new grid, then push. Natural follow-ons: add a lightweight
cache/TTL on the insight endpoint before real usage; if Quick Add proves useful, consider whether
it's worth extending to Commitments or graduating to a real command palette later.

---

## Session 18 — 2026-08-06

**Goal:** Andrew asked for a few options for next steps given everything built so far. Recommended
options: (1) dogfood what's already shipped rather than build more, (2) build the "Mission Control"
dashboard PRODUCT_VISION.md calls the product's endgame, (3) scope the "team space" idea from Session
3, (4) revisit the manager-agent-hierarchy brainstorm now that Capacity/Projects data models exist,
(5) smaller cleanup items. Andrew picked Mission Control and asked to scope it.

**Scoped via one round of AskUserQuestion (4 questions) before building — Andrew picked the
recommended default on all four:**
1. **Placement:** Mission Control replaces `/app/dashboard` as the landing page, rather than living as
   a separate new page. Today's "who needs a 1:1" list doesn't get its own page anymore — it folds
   into the new Individual Performance card.
2. **Card scope:** only cards backed by real data today (Organization/Department/Team Goals,
   Individual Performance, Key Initiatives, a Capacity snapshot). No placeholder/"coming soon" cards
   for Team Health, Team/Dept Operations, or People Operations — matches the existing precedent from
   Settings (deferred sections get no placeholder nav entries).
3. **View scope:** manager view only. Department Head rollups (Session 15's `led_org_unit_ids()` +
   the 4 rollup functions) exist but aren't wired into this page this pass. Team/Individual (IC)
   views stay out of scope entirely — IC login was explicitly deferred in Session 3.
4. **Ratings rollup:** Individual Performance lists each report's latest assessment rating as-is (name
   + rating + last-assessed date). No synthesized team-level score — matches the app's existing
   pattern of surfacing real records rather than derived numbers.

**What got built (same session, right after scoping):** `frontend/app/app/dashboard/page.tsx`
rewritten in place (route unchanged, content replaced) as the Mission Control page — four sections,
each following the "summary here, edit there" pattern already used on DR detail's Goals/Projects/
Assessment/Capacity sections:
- **Individual Performance** — merges `getTeamOverview()` (1:1 cadence, open commitments — what the
  old dashboard already showed) with `getTeamAssessments()` (latest rating) client-side by
  `direct_report_id`. Keeps the existing "add a direct report" quick-add form and the "N people due
  for a 1:1" line.
- **Goals** — `getGoals()` filtered to `level !== "individual"`, grouped into Organization/Department/
  Team subsections. Individual-level goals stay off this page; they're on the report's own page.
- **Key Initiatives** — `getProjects()` filtered to `status` in (active, on_track, at_risk) — a status
  board, not an archive.
- **Capacity — this week** — `getCapacityOverview()` for the current Monday–Sunday week (local
  `startOfWeek`/`addDays`/`toISODate` helpers, a minimal subset of `capacity/page.tsx`'s period logic
  since Mission Control only ever needs "this week"). Shows total available hours across the team +
  a per-person line.

**No new backend routes and no schema changes.** Every card is a client-side merge of endpoints that
already existed — `getTeamOverview`, `getTeamAssessments`, `getGoals`, `getProjects`,
`getCapacityOverview`. This is the first feature session with zero backend changes.

**My call, flagged not re-asked:** the "add a direct report" form stays on Mission Control (where it
lived on the old dashboard) rather than moving into Settings → Team — out of scope for this pass, and
it's a working pattern already.

**Verification:** frontend-only change. Fresh `npm install`, `npx tsc --noEmit` clean, `npx next
build` clean — 15/15 routes including `/app/dashboard` at 4.31 kB. No backend verification needed
(no backend files touched). File committed to Andrew's local TheSamePage folder via
`device_commit_files`.

**Decisions made / locked:** see the 4 scoping answers above — all now reflected in the page's header
comment block in `dashboard/page.tsx` and in `docs/ENGINEERING.md`'s new Mission Control section.

**Next step:** Andrew should dogfood the new landing page and confirm it reads well with real data,
then `git push`. Natural follow-ons once there's live usage: wiring in the Department Head rollup
toggle (Session 15's infrastructure already supports it), and revisiting whether Individual
Performance should surface anything from Team Health once that data model exists.

---

## Session 17 — 2026-08-06

**Goal:** Andrew reported the Team settings page had visually overlapping text (screenshot), and
separately — a much bigger concern — that he'd gone through and set expectations for every role on
the team, saved them, and they were all gone when he navigated away and back.

**What was done:**
- Reproduced the "lost expectations" report live against the deployed app (Chrome automation):
  added a test metric, confirmed via network inspection the `POST /api/settings/expectations/{kind}`
  call returned 200 and the row genuinely persisted (visible again after reselecting the same role,
  and after a full page reload). The data was never lost — it was a UI state bug. `ExpectationsSection`
  owned its own `roleLevelId`/`kind` state; Settings renders exactly one section at a time and
  unmounts the rest, so switching to another Settings tab (e.g. Team) and back reset the role picker
  to the first role alphabetically and the kind tab to Metrics — which, after filling out many roles
  in sequence, looked exactly like everything had been wiped.
- Fix: lifted `expRoleLevelId`/`expKind` state up to `SettingsPage`, passed down as props — same
  lifted-state pattern already used for `roleLevels`/`reports`/`orgUnits`. Selection now survives
  switching sections; only a hard page reload resets it.
- Fixed the Team section overlap from the screenshot: the role/team `<select>`s had no width
  constraint, so a long selected option (e.g. "Enterprise Producer CSM · L2") could balloon the
  select's rendered width and squeeze the sibling name/role_title column down to near-zero, wrapping
  it into unreadable slivers. Added fixed widths (`w-48`/`w-44`) + `truncate` to both selects, and
  `truncate` to the name/role_title text.
- Cleaned up test data (`TEST DEBUG METRIC`, `TEST DEBUG METRIC 2`, `TEST ROLE2 METRIC`) created
  during live reproduction before handing back to Andrew.
- Created a new skill (`tsp-push`, delivered as a file — not yet confirmed saved) that combines a
  paste-ready git command with this same doc-sync step, triggered by "let's push this."

**Decisions made / locked:**
- Any Settings sub-section with its own "currently selected X" state should default to lifting that
  state to `SettingsPage`, not owning it locally — see ENGINEERING.md → Conventions.

**Next step:** None outstanding from this session — fix is written to
`frontend/app/app/settings/page.tsx`, awaiting Andrew's `git push`. Confirm the `tsp-push` skill got
saved (delivered via file, no save confirmation available) before relying on it next session.

---

## Session 16 — 2026-08-04

**Goal:** Asked what the best next step for the app was, given
PRODUCT_VISION.md and everything built so far. Read PRODUCT_VISION.md,
ENGINEERING.md, and every project-memory note back through Session 6 before
answering. The read: Goals/Org/Projects/Capacity/Role-scoped views cover
most of the scaffolding the vision calls for, but the **ratings/assessment
layer** — the piece PRODUCT_VISION.md calls load-bearing ("a mission
control... that removes ambiguity about how someone is performing against
explicit expectations") — was still completely untouched. `assessments`,
`performance_reviews`, `skill_assessments`, `value_assessments`, and
`metric_entries` were dormant tables; Settings' expectations framework
(Session 6) existed only to feed this layer, and nothing did yet. Andrew
agreed and asked to scope and build it in the same session.

**Scoped with Andrew via one round of AskUserQuestion (4 questions) before
building — he picked the larger option on 3 of 4:**
1. **Assessment type:** rolling assessment (`assessments` +
   `skill_assessments` + `value_assessments`, ongoing) — not
   `performance_reviews` (formal periodic). That table stays dormant.
2. **Scoring input:** AI-assisted draft, manager reviews before anything
   saves — same draft-then-review rule as the 1:1 wrap-up flow (Session 8).
3. **Placement:** own top-level page (`/app/assessments`) + a summary
   section on DR detail — same two-tier pattern as Capacity.
4. **Scope:** **all three** expectation types together — skills, values,
   AND metrics (`metric_entries`) in the same pass, not skills/values first
   with metrics deferred (the recommended default). Bigger scope, one pass.

**What got built (same session, right after scoping):**
- `backend/routes/assessments.py` (new, 6 routes, registered in `main.py`
  under `/api/assessments`):
  - `GET/PUT /levels` — org's `assessment_levels` (1-5 scale for the overall
    rating); auto-seeds 5 defaults ("Needs Improvement" → "Outstanding") on
    first use per org, same on-demand-bootstrap idea as `ensure_org()`.
    Labels renameable via PUT.
  - `GET ""` — team list: every direct report + their latest overall
    rating, for the `/app/assessments` list page.
  - `GET /{direct_report_id}` — the full scorecard: role expectations
    (metrics/skills/values + their scale definitions from Settings) each
    paired with the latest recorded score.
  - `POST /{direct_report_id}/draft` — pure AI-call route, nothing saved.
    Prompt pulls recent completed 1:1 summaries, open + recently-done
    commitments, and individual goals as evidence; explicitly instructed to
    leave an item unscored rather than force coverage — same restraint
    already proven in the 1:1 prep prompt's expectations block. Drafted
    `config_id`s are filtered against the report's actual configured items
    server-side before returning, so a hallucinated id can't reach the save
    step.
  - `POST /{direct_report_id}` — writes whatever the manager kept/edited:
    inserts into `assessments` (overall), `skill_assessments`,
    `value_assessments`, `metric_entries` as applicable.
- `frontend/lib/api.ts` — `AssessmentLevel`, `TeamAssessmentItem`,
  `ScoredItem`, `Scorecard`, `AssessmentDraft` types + client functions.
- `frontend/app/app/assessments/page.tsx` (new) — team list, current rating
  badge per report.
- `frontend/app/app/assessments/[reportId]/page.tsx` (new) — the scorecard:
  overall rating picker, per-skill/value scale-point buttons (rendered from
  each config's own `scale_definitions` when configured, else a bounded
  number range), per-metric value+period inputs, "Draft with AI" button.
  Pending inputs start empty (not pre-filled from the latest score) so
  Save only logs what was actually touched this pass — the latest score
  shows alongside each item as read-only context, not as a silent default.
- `frontend/app/app/reports/[id]/page.tsx` — new read-only Assessment
  summary section (current rating + date, link to the scorecard page),
  same "summary here, edit there" pattern as Goals/Projects.
- `frontend/app/app/dashboard/page.tsx` — "Assessments" nav link.
- Docs: this entry, `docs/ENGINEERING.md`, `docs/DESIGN.md`.

**Schema note — no new migration for table structure.** All 6 base tables
(`assessment_levels`, `assessments`, `performance_reviews`,
`skill_assessments`, `value_assessments`, `metric_entries`) plus their RLS
policies were already present in `database/schema.sql`, dated 2026-07-21 —
the same "already dormant in the original scaffold, just needed activating"
pattern as Goals/Org/Projects/Capacity's base tables. Unlike those features,
nothing in any session-memory note or migration file ever separately
created these tables, which is why this reads as pre-Session-6 scaffold
rather than something built along the way. **Not independently confirmed
against live Supabase from the sandbox** — if `GET /api/assessments/levels`
404s or errors instead of returning 5 default rows on first real use, that
means these tables never actually landed in the live database and need a
migration after all; flag it back here if so.

**Verification:** backend `py_compile` clean on all touched files; sandboxed
`main.py` import in a fresh venv confirms all 6 new `/api/assessments`
routes register alongside the other 61 (no collisions from the `/levels`
vs. `/{direct_report_id}` path-ordering, same care as Direct Reports'
`/overview`/`/rollup`). Frontend: fresh `npm install` (no lockfile to pin
against, same as every prior session), `npx tsc --noEmit` clean, `npx next
build` clean — 15/15 routes including both new `/app/assessments` routes.
No live Supabase run from the sandbox itself.

**Not built / deferred:**
- `performance_reviews` (formal periodic review) — Andrew explicitly chose
  rolling assessment first.
- Rolling up assessment scores into the goals/projects/capacity rollups or
  a real "Mission Control" dashboard that ties everything together —
  PRODUCT_VISION.md's endgame, not attempted this pass. This session
  activates the data layer the dashboard would eventually read from.
- Server-side validation that a drafted/saved `config_id` actually belongs
  to the direct report's assigned role (currently trusts the frontend to
  only submit ids it received from the scorecard endpoint) — same level of
  trust the rest of the app extends elsewhere (e.g. goals.py's PUT).
- Settings UI for renaming assessment levels — the PUT endpoint exists but
  nothing in Settings calls it yet; defaults are usable as-is.

**Next step:** confirm the schema note above (first real
`GET /api/assessments/levels` call either seeds 5 defaults cleanly or
surfaces a missing-table error), then dogfood the AI draft flow on a real
report with real 1:1 history to see whether the evidence-only restraint
produces useful drafts or mostly empty ones. If it's mostly empty, the
prompt likely needs more/better evidence sources (e.g. pulling private
`one_on_ones.notes`, not just summaries) rather than a scoping change.

---

## Session 15 — 2026-08-03

**Goal:** Role-scoped views — Andrew picked this off the running list of
"what's next" options (surfaced at the top of this session by reviewing
[[capacity_scoping]], [[org_hierarchy_scoping]], [[projects_scoping]], and
[[goals_scoping]]'s "how to apply" notes plus ENGINEERING.md's scope
discipline section). Mid-session, Andrew also floated a separate "team
space" concept (members + projects + priorities + eventual messaging) —
captured as its own brainstorm note ([[team_space_brainstorm]]), explicitly
NOT conflated with this session's work.

**What was done:**
- Read `docs/ENGINEERING.md`, `database/schema.sql`, `backend/utils.py`,
  `backend/routes/org_units.py`, `backend/routes/direct_reports.py` before
  proposing anything, to ground the scoping questions in what already
  exists (`users.role` unused for permissions, `org_units` tree already
  the source of truth for structure, Capacity's Session 14 rollup as the
  only existing cross-manager precedent).
- Scoped with Andrew via one round of AskUserQuestion (4 questions) before
  building:
  1. **Scoping mechanism:** an explicit per-unit "leader"
     (`org_units.leader_user_id`) — not `users.role` tiers, not the
     `users.manager_id` reporting chain. Matches Capacity's Session 14
     choice of the `org_units` tree over the manager chain.
  2. **Visibility depth:** aggregate-only outside your own team, everywhere,
     no per-data-type exception — extends Capacity's existing precedent
     uniformly.
  3. **Scope of work:** Andrew picked all four candidate surfaces (People,
     Projects, Capacity's permission gate, Goals), not a narrower first
     slice.
  4. **Verification approach:** build ahead of real data, same posture as
     `org_units` (Session 11) and Capacity (Session 14) — no second real
     manager exists yet to test cross-manager visibility against.
- Built the same session, right after scoping:
  - `database/migrations/2026-08-03_org_unit_leaders.sql` (new) +
    `database/schema.sql` updated to match — `org_units.leader_user_id`
    column; `led_org_unit_ids()` (SECURITY DEFINER, recursive walk down
    from units the caller leads); `org_unit_capacity_rollup()` updated
    in place to gate through it (previously readable by any authenticated
    org member — a known gap flagged in Session 14, now closed); three new
    SECURITY DEFINER functions — `org_unit_goals_rollup()` (department/
    team-level goals only, by design — individual goals aren't included),
    `org_unit_projects_rollup()` (scope derived the same way Projects
    derives scope everywhere else: goal's org_unit_id first, falling back
    to the assigned report's), `org_unit_people_rollup()` (headcount + a
    job_role/count breakdown, never a name). **Not yet run against live
    Supabase** — nothing in this feature works until Andrew runs it.
  - `backend/routes/org_units.py` — `leader_user_id` added to `OrgUnitIn`;
    new `GET /led` (units the caller directly leads) and `GET /members`
    (org member list for the leader picker, via the existing
    `users_select_own_org` RLS policy — no new policy needed).
  - `backend/routes/goals.py`, `backend/routes/projects.py`,
    `backend/routes/direct_reports.py` — each gained a `GET /rollup`
    calling its new SQL function and joining `org_units` for display
    names, mirroring `capacity.py`'s existing `get_rollup`.
    `direct_reports.py`'s is declared before `/{report_id}`, same
    convention as `/overview`.
  - `backend/routes/capacity.py` — `get_rollup` now also fetches
    `led_org_unit_ids()` and cross-joins only against that scope instead
    of every `org_unit` in the org; returning early with `[]` when the
    caller leads nothing. (Cross-joining the full org list here would have
    zero-filled units outside the caller's scope, misreading as "this team
    has 0 capacity" instead of "you can't see this team.")
  - `frontend/lib/api.ts` — `OrgUnit`/`OrgUnitIn` gained `leader_user_id`;
    new `OrgMember`/`getOrgMembers`, `getLedOrgUnits`,
    `GoalsRollupItem`/`getGoalsRollup`,
    `ProjectsRollupItem`/`getProjectsRollup`,
    `PeopleRollupItem`/`getPeopleRollup`.
  - `frontend/app/app/org/page.tsx` — `UnitForm` gained a leader picker
    (org members dropdown); Build/Chart nodes show a "Led by X" badge.
    New third "Rollup" tab: for each unit the signed-in user directly
    leads, renders its whole subtree with aggregate people/goal/project
    counts (goals/projects call out an "at risk" count specifically).
    Empty state when the caller leads nothing, pointing back to Build to
    self-assign.
  - `frontend/app/app/capacity/page.tsx` — "By department" section now
    walks each led unit's subtree (via the new `/led` endpoint) instead of
    the whole company tree from root. Empty state distinguishes "no org
    units built yet" from "you don't lead any units yet" — the latter is a
    deliberate, intentional behavior change from previously showing the
    whole org's rollup to any member.
  - Docs updated: `docs/ENGINEERING.md` (new "Role-scoped views" section;
    both previously-open scope-discipline items marked built),
    `docs/DESIGN.md` (4 new decisions log rows), this file.
- **Verified in sandbox (no live Supabase access):** assembled the full
  repo (backend + frontend) from a device snapshot, overlaid the session's
  edits. Backend: `python3 -m py_compile` clean on all touched files;
  imported `main.py` in a sandboxed venv against the pinned
  `requirements.txt`, confirmed all 6 new routes register
  (`/api/org-units/led`, `/api/org-units/members`, `/api/goals/rollup`,
  `/api/projects/rollup`, `/api/direct-reports/rollup`,
  `/api/capacity/rollup`) and that the wildcard-vs-static-path ordering is
  correct. Frontend: fresh `npm install` (no lockfile to pin against, same
  situation as Session 11), `npx tsc --noEmit` clean, `npx next build`
  clean — 14/14 routes including `/app/org` and `/app/capacity` compile and
  prerender.

**Decisions locked:**
- See the four AskUserQuestion answers above — all confirmed with Andrew,
  not defaulted.
- **My call, flagged not re-asked** (same pattern as prior sessions' scope
  notes): any org member can assign any org member as a unit's leader — no
  admin/owner concept exists to gate this further, and org_units CRUD
  already had this same permissiveness level before this session.
- **My call, flagged not re-asked:** individual-level goals are NOT
  included in the goals rollup (only goals with `org_unit_id` set directly
  — department/team level). Folding individual goals in via
  `direct_reports.org_unit_id` is a reasonable follow-up but adds real
  query complexity for a v1 that's already covering the exact gap
  ENGINEERING.md flagged (department/team goals with no distinct
  dept-head/VP audience).
- Capacity hours were deliberately kept off the Org page's new Rollup tab
  (they stay on Capacity's own page) to avoid duplicating the same data on
  two pages with two maintenance sites.

**Next step:**
1. Confirm Andrew ran `2026-08-03_org_unit_leaders.sql` against live
   Supabase — nothing in this feature does anything until he does.
2. Once live, assign a leader (himself, most likely) to at least one org
   unit in Org > Build, then check the Rollup tab and Capacity's "By
   department" section both populate correctly — this is also the first
   real exercise of `led_org_unit_ids()`'s recursive descent, still only
   verified by reading the SQL, not by running it.
3. Revisit whether individual-level goals should roll up too, once there's
   a real leader using this and finding department/team-only goals
   incomplete.
4. The "team space" idea Andrew floated mid-session ([[team_space_brainstorm]])
   is unscoped — pick it up as its own scoping conversation, not bundled
   into this feature.

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

**What changed:**
- `database/schema.sql` updated in place (it's the canonical end-state, not
  a migration) to add `capacity_settings.default_off_days_per_year`
  (default 21) and `capacity_profiles.off_days_per_year` (nullable
  override). `org_unit_capacity_rollup()` restructured to compute actual
  logged hours once via a `LATERAL` join and apply the win/fallback
  precedence in a `CASE`.
- **Migration correction:** Claude initially amended
  `2026-08-02_capacity.sql` in place to add these columns, wrongly assuming
  it hadn't been run live yet — Andrew had already run it. Re-running the
  amended file against live Supabase failed with `42P07: relation
  "capacity_settings" already exists` (the file's `CREATE TABLE` tried to
  recreate an existing table). Fixed by reverting `2026-08-02_capacity.sql`
  to exactly match what Andrew actually ran, and moving the off-days
  addition into a new, separate migration —
  `database/migrations/2026-08-02_capacity_off_days.sql` — same convention
  as `2026-08-02_goals_success_metrics.sql` shipping separately from the
  base goals table. **Lesson:** never amend a migration file in place on
  the assumption it hasn't run live yet — when in doubt, always ship a new
  migration file instead.
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

**How to apply:** Andrew has already run `2026-08-02_capacity.sql` against
live Supabase; next session should (1) confirm he's also run
`2026-08-02_capacity_off_days.sql` (the off-days columns + updated rollup
function), (2) once live, set org defaults in Settings > Capacity and try
the per-report override + time-off flow on a real report, (3) revisit
whether v1's "supply only" framing is still right once there's real usage —
wiring capacity into Projects/Goals as an actual allocation/demand view is
the natural next payoff, same as how
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
