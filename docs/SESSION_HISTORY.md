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

## Session 56 — 2026-08-22

**Goal:** Close out the last open item from Session 54's UX review — give AppNav's header and
Sidebar's top row a shared height token so the nav chrome reads as one coordinated strip — then open
a new UX discussion about excessive white space/margins across the app, bring a concrete before/after
direction, and (once approved) build it.

**What was done:**
- `frontend/components/ZoneMap.tsx` — added `NAV_STRIP_HEIGHT = "h-14"`, a shared height token
  importable by both nav components instead of each deriving its height independently from padding +
  tallest child (previously off by ~4px). `AppNav.tsx`'s header inner div and `Sidebar.tsx`'s top row
  both now use it; AppNav's roster-switcher sticky offset (`top-[55px]` → `top-14`) follows the same
  fixed value.
- Published a "White Space Audit" comparison canvas (Claude Design skill,
  https://claude.ai/code/artifact/4727ef04-4a36-422d-a931-de015dadc36e) proposing two directions
  against real content: tightened page-level vertical rhythm via one shared spacing token, and a wider
  `PageShell` tier for grid-heavy pages. Andrew approved both ("i am good with this - lets
  change/update").
- Added `SECTION_GAP = "mt-5"` to `ZoneMap.tsx` and a new `8xl` (`max-w-[1600px]`) tier to
  `PageShell.tsx`'s `MAX_WIDTHS`; also tightened `PageShell`'s own vertical padding (`py-10` → `py-8`).
- Replaced ad hoc `mt-4/5/6/8/10` page-level transition margins with `SECTION_GAP` across 13 pages
  (dashboard, goals, projects, team, capacity, org, context, assessments, 1-1s, settings,
  reports/[id], reports/[id]/log, reports/[id]/prep) and widened Dashboard/Goals/Projects/Team to the
  new `8xl` tier. Deliberately left untouched any spacing that was already internally consistent
  rather than drifting ad hoc (Team's and 1-1s' inter-section `space-y-10`, the assessment scorecard's
  `mt-10`, nested column-internal spacing on the Person page and prep step 2, and Settings' internal
  sub-section spacing) — each exception is documented inline in that file's own header comment.

**Decisions made / locked:**
- Nav chrome height is now a single named token (`NAV_STRIP_HEIGHT`) rather than an emergent property
  of independently-chosen padding — prevents this specific 4px drift from recurring as either
  component changes.
- `SECTION_GAP` (`mt-5`) is the app-wide standard for page-level block transitions, chosen because it
  was already the tightest value in active use (`reports/[id]`) rather than an invented number — it's
  for the "compounding independent per-block choice" pattern the audit measured, not for tight
  same-thought-group spacing or already-uniform internal rhythm, which stay as-is by design.
- Four grid-heavy pages (Dashboard, Goals, Projects, Team) get a new `8xl` (1600px) `PageShell` tier to
  close the dead space measured on wide monitors; narrower content pages (Capacity, Org, Context,
  Settings, Assessments, 1-1s, reports/[id]) keep their existing widths.

**Verification:** Frontend-only change (17 files, no schema/backend touch). Repo tarred from the
device's working copy and rebuilt in the cloud sandbox (device_bash's ~45s cap is too short for `next
build`): fresh `npm install`, `npx tsc --noEmit` clean, `next build` clean (all 19 routes, no
type/lint errors) — run twice, once for the height-token fix alone and once for the full white-space
change set. All 15 content-changed files (PageShell.tsx, ZoneMap.tsx, plus 13 page files) written back
to Andrew's disk via the device bridge, mtime-guarded.

**Next step:** Andrew to dogfood the tightened rhythm and wider grid pages live, especially on a wide
monitor where the 8xl tier matters most. `KpiStrip` remains duplicated across team/goals/projects
pages (a pre-existing Session 53 choice) — worth a shared-component pass if a 4th page ever needs it.

---

## Session 55 — 2026-08-22

**Goal:** Finish the one open item from Session 54's UX review: whether Mission Control's pastel
"Your people/The work/Foundation" summary cards should move onto the same bold gradient-tile
convention as the Team/Goals/Projects KPI strips. Andrew wasn't sure, so asked to see both first.

**What was done:**
- Built a two-artboard comparison canvas via the Claude Design skill — `CurrentBaseline.dc.html`
  (today's pastel cards, recreated pixel-for-pixel from `ZoneMap.tsx`'s real `HUE_STYLES`/
  `TONE_TEXT`/icon paths) and `Main.dc.html` (the same real content restyled as gradient tiles:
  indigo/emerald/violet gradients, white text). Both used the actual live door-state content (9
  people, 8 due, 5 goals, 241h free, etc.) rather than placeholder numbers. Published as an Artifact
  (`mission-control-card-styles.html`) for Andrew to review side by side; he picked the gradient
  option ("the right one").
- Implemented the chosen direction in `frontend/components/ZoneMap.tsx`: added `HUE_GRADIENT` (a
  from/to/shadow token set per hue, separate from `HUE_STYLES`) and `TONE_TEXT_ON_GRADIENT` (warn/
  risk/setup colors picked to stay readable across all three gradients, not just one hue's pastel).
  Rewrote the `ZoneMap()` render to use `bg-gradient-to-br` tiles with white group titles/blurbs,
  translucent-white icon/item-row backgrounds, and the new gradient-aware tone colors. `HUE_STYLES`
  and `TONE_TEXT` (the original pastel tokens) are untouched — `Sidebar.tsx` still reads `HUE_STYLES`
  for its active-state chips, so that pastel token set stays canonical for nav chrome; only the
  Mission Control card row itself changed visual language.
- No changes to `doorStates` computation, icons, group copy, or any data-fetching logic — this was a
  pure restyle of an already-correct real-data component.

**Decisions made / locked:**
- Mission Control's summary cards now match Team/Goals/Projects' gradient-tile convention rather
  than staying a deliberately calmer "home" treatment — resolves the question Session 54 left open.
- The pastel `HUE_STYLES`/`TONE_TEXT` tokens remain the source of truth for nav chrome (sidebar chips,
  breadcrumbs) even though ZoneMap's cards no longer use them directly — two different UI surfaces,
  not a conflicting restyle.
- Show-a-mockup-before-touching-code (via the Design skill, using real fetched data rather than
  placeholder numbers) is confirmed as the right call for a visually subjective decision like this one.

**Verification:** Frontend-only change (1 file). Cloud sandbox already had the repo from Session
54's build; re-verified there: `npx tsc --noEmit` clean, `npx next build` clean (full route table
built with no type/lint errors). Delivered via the device bridge and committed straight to
`frontend/components/ZoneMap.tsx` on Andrew's disk before this push.

**Next step:** The other item flagged in Session 54's original UX review is still open: give the
sidebar's top row and AppNav's header an explicit shared height token so the rail and header read as
one coordinated unit. Otherwise, Andrew to eyeball the live gradient Mission Control cards in the
running app and confirm the final look holds up outside the mockup.

---

## Session 54 — 2026-08-22

**Goal:** Andrew reviewed Session 53's Goals/Projects rebuild live and flagged that alignment/spacing
felt "not perfect" now that Session 51/52 added the persistent header + sidebar. Asked me to review
as a product/UX lead and identify what to fix; after the review, asked me to act on the top finding.

**What was done:**
- Audited every `/app/*` page's top-level `<main>` wrapper against `AppNav.tsx`'s header container.
  Confirmed by grep: `AppNav`'s header uses `mx-auto max-w-7xl px-6 sm:px-8`; every page except
  Dashboard used `px-6` with no `sm:` bump, and top/bottom padding was scattered (`py-10` Dashboard,
  `py-16` most pages, `py-12` the direct-report detail page, `py-24` login/ic) — drift accumulated
  across ~50 sessions of each page copying its own `<main>` line independently, invisible until
  Session 51/52 gave the app a fixed header/sidebar to visibly drift away from.
- New `frontend/components/PageShell.tsx` — one shared container: `mx-auto max-w-{size} px-6 py-10
  sm:px-8`, matching AppNav's header exactly; a `maxWidth` prop (`2xl`/`3xl`/`4xl`/`6xl`/`7xl`) lets
  each page keep its own width (that dimension varies legitimately; the padding/breakpoint recipe
  didn't).
- Migrated all 14 pages that render under the sidebar/header onto `PageShell`: `dashboard`, `team`,
  `goals`, `projects`, `capacity`, `org`, `context`, `settings`, `assessments`,
  `assessments/[reportId]`, `1-1s`, `reports/[id]`, `reports/[id]/log`, and `reports/[id]/prep`
  (which has 3 separate `<main>` branches — loading/error, step 1, step 2 — each its own
  `PageShell` instance). `login`/`ic` deliberately left untouched — they render outside
  AppNav/Sidebar entirely (`layout.tsx`'s `NO_NAV_PATHS`), so they have no header to align against.

**Decisions made / locked:**
- Standardized top/bottom padding on `py-10` app-wide (down from the `py-16` most pages had drifted
  to) — Dashboard's own pre-existing value, chosen because it was the one page that already
  (accidentally) matched the header's breakpoint padding, not a new invented number.
- Container recipe (`px-6 sm:px-8`, vertical padding) is now owned by one component; per-page
  max-width stays a prop rather than being folded into a fixed set of page "types," since widths
  vary for legitimate content reasons (a single-column form vs. a card grid).
- `login`/`ic` are explicitly out of scope for this shell — different rendering context (no
  persistent chrome above them), not an oversight.

**Verification:** Frontend-only change (14 files + 1 new component, no schema/backend touch). Repo
already present in the cloud sandbox from Session 53's tar; re-verified there: `npx tsc --noEmit`
clean, `next build` clean (21/21 routes). All 15 files written back to Andrew's disk via the device
bridge.

**Next step:** Andrew to eyeball the app again for the two follow-on items flagged in the same UX
review but deliberately not acted on this pass: (1) give the sidebar's top row and AppNav's header an
explicit shared height token so the rail and header read as one coordinated unit rather than two
independently-padded rows that happen to look close; (2) decide whether Mission Control's pastel
"Your people/The work/Foundation" summary cards should move onto the same bold gradient-tile
convention as the Team/Goals/Projects KPI strips, or stay a deliberately calmer "home" treatment.

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

## Archived sessions (compact index)

Each line below is the goal plus the key decisions locked in that session —
enough to know if it matters to what you're doing now. Full entries
(what was done, verification, deviations) are in
`docs/SESSION_HISTORY_ARCHIVE.md`, newest-first, unchanged from their
original text. Open that file when you need the full detail behind a
specific decision.

- **Session 51 — 2026-08-22:** Simplify the persistent nav (Sessions 36-38) by retiring the duplicated breadcrumb + zone-chip idiom in favor of a fully static top bar and a persistent left rail (`Sidebar.tsx`) on every page except Mission Control. **Decided:** Mission Control gets no sidebar since its own card grid + inline ZoneMap already is the map; the all-areas map overlay is retired outright, not rehomed, since the sidebar already puts every section one click away.
- **Session 50 — 2026-08-21:** Rebuild `/app/reports/[id]` from a single-column form wall into the "Command Deck" hub (identity band, KPI strip, 3-column layout, settings drawer). **Decided:** new `dr_capture_notes` is its own inbox table (not a column on `one_on_ones`); goal progress bars only render with a real check-in, never fabricated from status alone.
- **Session 49 — 2026-08-21:** Give the development plan its own dedicated, always-editable text box (Manager Notes had been accidentally absorbing the AI-assist meant for the plan itself). **Decided:** Manager notes and the development plan are genuinely separate concepts and stay on separate fields/surfaces, not merged; `/notes/revise` is reused for both rather than duplicated.
- **Session 48 — 2026-08-21:** Fix the manager-note flow being accidentally AI-gated by adding manual entry as the default everywhere, with AI as an optional assist (new "Revise with AI" alongside the existing "Draft with AI"). **Decided:** Draft (evidence-gated, can honestly return nothing) and revise (always answerable, evidence only for grounding) are intentionally different-shaped operations, not one prompt behind a flag.
- **Session 47 — 2026-08-20:** Scope and build Development (individual plans + a lightweight team "training focus" note), activating dormant `development_plans`/`dev_plan_*` schema from the original scaffold. **Decided:** Aspirations and training are never AI-drafted — only opportunities + a synthesis note, where evidence-grounding actually applies; team dev focus reuses team_callouts' exact upsert/uniqueness mechanics rather than a new pattern.
- **Session 46 — 2026-08-20:** Give projects an optional team attachment and make `/app/team`'s Goals/Initiatives cascade down from parent departments instead of exact-matching only. **Decided:** Hierarchy inheritance applies only to goals/projects on `/app/team` (commitments, roster, meeting notes, callouts stay exact-match); the leadership-rollup endpoint was deliberately left unchanged (different hierarchy concept), flagged as a follow-up.
- **Session 45 — 2026-08-19:** Add a team name + dropdown to `/app/team` so a manager leading multiple `org_units` can tell which team's data they're viewing, and filter the page by picking one. **Decided:** `team_callouts.org_unit_id` is `ON DELETE CASCADE` (not `SET NULL` like `team_meeting_notes`) — found via a real Postgres test, needed because of the two-partial-unique-index uniqueness rule; `GET /callout` changed from one object to a list, a breaking response-shape change.
- **Session 44 — 2026-08-18:** Build Role JD Import (`docs/ROLE_JD_IMPORT_SCOPING.md`): paste/drop a JD, one AI call proposes role identity + ladder match + drafts expectations, manager reviews, one commit lands it. **Decided:** No migration needed — every column this flow writes already existed; collision resolution is server-side first (draft already flags `exists`), frontend only handles manager-created collisions; the JD file is never stored (role config, not a Context Engine document).
- **Session 43 — 2026-08-18:** Polish pass (Plan §7.3, last of 5 team-setup UX sessions): People archive/edit, People-row rework, data-trust fixes, org-wide values. **Decided:** Two mutually-exclusive lists (active/archived), not one client-filtered list — archived fetch only pays when a manager expands "Show archived"; `teams_count` keeps its pre-existing meaning (total org units), tile-display split lives in two new fields instead.
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
