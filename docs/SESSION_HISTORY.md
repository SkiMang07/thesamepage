# The Same Page — Session History

One entry per session, newest first. **Read the top entry first** — it tells you
the current state and what to do next so you don't relitigate settled decisions.

Format per entry, and nothing else:

- **Goal** — what Andrew asked for, or the problem that prompted the session
- **What was done** — specific files, functions, routes, migrations
- **Decisions made / locked** — and *why*, not just what
- **Next step** — the actual next task, named

Keep an entry to roughly 150 words. Do not narrate verification here — that it
built clean is what git history and CI are for. Record a verification detail only
when it *found* something worth remembering, and then put that finding in the
doc it belongs to.

This file holds the **5 most recent sessions in full**. Older ones appear as index
lines at the bottom; the last 20 keep their locked decisions, everything before
that keeps its goal alone. Full text of every archived entry lives unchanged in
`docs/archive/SESSION_HISTORY_ARCHIVE.md`. `tsp-push` maintains all of this
automatically.

---

## Session 62 — 2026-08-23

**Goal:** Turn 1:1 prep into a recurring management loop: set the meeting date, repeat every 1–4
weeks, complete the call, and begin the next occurrence with confirmed commitments and follow-ups.

**What was done:** Activated `one_on_ones.scheduled_at` end to end and added manager-scoped
`one_on_one_series`, a scheduled derived state, date/repeat controls in prep, upcoming-session
surfacing on the 1:1 and person pages, and automatic rollover from the scheduled date. Wrap-up now
drafts a separate manager-reviewed carry-forward list; recurring calls place confirmed topics on the
next occurrence, while non-recurring calls use the capture inbox. Open commitments remain live and
are pulled dynamically rather than copied. Added route/helper tests, full schema/RLS verification,
and applied the additive migration to production Supabase.

**Decisions made / locked:** Recurrence belongs to a series; each meeting remains its own occurrence.
The current release schedules a date and says “Repeat,” never “invite,” until calendar sync exists.
Logging late advances to the next future date without changing the series rhythm. AI may suggest
follow-ups but cannot carry them forward until the manager confirms the wrap-up. The final prep is
generated near the meeting rather than immediately after the prior call, so it can include current
commitment state and newer context.

**Next step:** Dogfood a complete recurring cycle in production, including reschedule, stop-repeat,
late-log, and no-follow-up cases; then scope calendar-provider sync against this series/occurrence
boundary.

---

## Session 61 — 2026-08-23

**Goal:** Turn Session 60's approved action-first Mission Control direction into a buildable plan,
then implement it end to end once Andrew approved the plan, including the live Supabase migration.

**What was done:** Added the pure deterministic recommendation engine, reference fixtures, brief /
event / reconcile / optional-explanation routes, and the action-brief UI with normal, busy, early,
empty, all-clear, partial, stale, loading, and AI-failure states. Reworked the persistent sidebar to
People / Work / Workspace with Settings separate. Added append-only `mission_control_events`, folded
the cadence and Scribe schema drift into `schema.sql`, applied the migration to production Supabase,
and updated the current-state Mission Control and engineering references. The previous dashboard and
AI insight endpoint remain behind the rollback flag.

**Decisions made / locked:** Eligibility and cross-domain ordering remain deterministic and
inspectable; AI can only paraphrase an already-selected recommendation. Addressed, Snooze, Not
relevant, and setup dismissal suppress an exact evidence fingerprint and never update a source
record. Actual logged time off can corroborate a dated commitment but cannot create a capacity
priority. Linked goal/project review chains use one slot. Partial core coverage cannot produce an
all-clear. Age alone never removes the brief: source writes refresh it automatically and 24 hours
only adds an optional refresh prompt. Rollback is an environment switch, not a data reversal.

**Next step:** Dogfood the shipped brief, then run the five-manager first-session comprehension test
defined in the implementation plan before tuning thresholds or provisional copy.

---

## Session 60 — 2026-08-23

**Goal:** Review the proposed action-first Mission Control, resolve its product trade-offs with the
advisory board, approve a bounded-synthesis mockup, and lock the direction without changing code.

**What was done:** Reviewed the live shell, UX/GTM/brand references, Aug 22 analysis and first mockup.
Customer, Marketing, Product & Technology, and People & Management lenses completed an independent
pass plus challenge round. Andrew approved the revised three-state mockup. Created
`docs/Redesign Scoping/MISSION_CONTROL_ACTION_FIRST_DECISION.md` and added the approved-but-not-
shipped direction to `docs/DESIGN.md`. Preserved the exact approved interactive reference as
`docs/Redesign Scoping/mission-control-bounded-synthesis.html`, making the decision portable into a
fresh implementation session. Product code and current-state subsystem docs are untouched.

**Decisions made / locked:** Mission Control becomes a manager's action brief: one deterministic,
evidence-linked Suggested focus, up to two secondary priorities, and one factual truth signal. The
zone map is removed when built. AI may explain but does not silently rank unrelated domains. Why
this? / Addressed / Snooze / Not relevant are distinct learning signals. Setup appears only when it
blocks value and is dismissible for the day. Sparse accounts get an early-use state; detailed
onboarding is separate. Current dogfood data is placeholder-thin, not realistic priority evidence.

**Next step:** Build an implementation plan against coherent normal-week, busy-week and early-use
reference data; review ranking, persistence and partial-failure behavior before changing code.

---

## Session 59 — 2026-08-23

**Goal:** Andrew's read on the live product after Session 58: the frame is right, but the app is a
light interface and he wants the dark, composed, premium shell of the approved mockup
(`docs/Redesign Scoping/mission-control-action-first.html`). Strictly a visual pass — no changes to
content, IA, routes, data or workflows.

**What was done:** Rewrote the colour layer as two themes rather than one. `tailwind.config.js` now
declares every colour as `rgb(var(--c-*) / <alpha-value>)`; the values live in `app/globals.css` in
two blocks, `:root` (light) and `.theme-dark` (dark). `app/app/layout.tsx` applies `theme-dark` once,
to the authenticated shell. New tokens in `lib/tokens.ts`: `elevated`, `on-brand`/`on-critical`/
`on-attention`/`on-info`, `identity-1..6` + `on-identity`, `FEATURE_SURFACE`, `ELEVATED`, `SCRIM`,
`BTN_GHOST`, `BTN_SCRIBE`, `STATUS_GLYPH`. 27 files; the last hardcoded hexes (AppNav, Sidebar) are
gone. Also: KPI tiles off gradients onto surfaces, Mission Control's zone cards off gradients, and
the person page's blue identity band onto the one feature gradient.

**Decisions made / locked:**
- **Two scopes, one token set — no `dark:` variants anywhere.** A component is written once and is
  correct in both themes because `bg-surface` resolves differently inside `.theme-dark`. This is also
  what keeps marketing, `/app/login` and `/invite` light with zero overrides: they never render
  inside that element. A `dark:` prefix per component would have meant 27 files of paired classes and
  a guaranteed drift.
- **The ramps are re-authored for a dark ground, not inverted hex-for-hex, but they keep their
  direction of meaning:** 50–200 is always "a tint you put behind something", 700–900 always "the ink
  you put on it". That single property is why `bg-amber-50 text-amber-700` — the at-risk badge,
  declared once — is legible in both themes.
- **`text-on-brand`, not `text-white`, on any brand fill.** The mockup puts white on `#50B7B0` at
  2.40:1; a deep carbon-teal measures 7.50:1. This is the one deliberate break from the mockup, and
  the same reasoning gives `on-critical` / `on-attention` / `on-info`.
- **Gradients are spent once, not per card.** `FEATURE_SURFACE` (deep teal into carbon) is for
  identity bands and hero summaries only. Session 55's bold-gradient tile *shape* is superseded —
  three saturated slabs read as emphasis on white and as glare on carbon, and the approved mockup has
  none.
- **KPI tiles are neutral by default; the tone sits on the value, not the tile.** "Active
  initiatives", "Due this week" and "Until next meeting" were blue purely so the row had four
  colours — blue is Scribe's, and a count is not a status.
- **Inputs are recessed (`bg-sunken`), not flush.** A white field on a white card was already
  identifiable only by its border; on a dark card that is nothing at all. `control` is `#77848C`,
  ≥3:1 against every surface in both themes (WCAG 1.4.11).

**Found along the way:** Session 58's "zero hardcoded hexes remain" was true of plain utilities but
not of arbitrary-value classes — `AppNav.tsx` carried seven (`bg-[#F5F8FA]`, `border-[#DDE0E3]`,
`bg-[#222B32]`, …) and `Sidebar.tsx` three. Both are on tokens now.

**Next step:** Andrew to dogfood the dark shell against real data — this was verified by `tsc` and
`next build` only, not rendered, so contrast was checked numerically rather than by eye. Specifically
worth a look: the Scribe drawer, Settings' modals, and empty/loading/disabled states. Chrome autofill
is overridden in `globals.css`; confirm it behaves on the login form.

---

## Session 58 — 2026-08-23

**Goal:** Andrew had settled the brand with ChatGPT in another session — Current & Carbon (palette
#11) and the T10-C logo — and asked to get both into the live app. His words: the layout and frame
are right, "the colors are all over the place."

**What was done:** Measured it first — 12 hue families live across the app (Team alone used ten),
`theme.extend` empty, no `public/` at all. Built `frontend/tailwind.config.js` into the colour system
(OKLCH ramps pinned so each locked hex reproduces exactly) and `frontend/lib/tokens.ts` for the
recurring class strings. Migrated 31 files, 1,395 substitutions; zero hardcoded hexes remain under
`app/` or `components/`. Vector-traced the logo — `components/Logo.tsx` plus `public/` masters,
favicon and app icons. Collapsed the three zone hues in `ZoneMap.tsx`/`Sidebar.tsx`. New
`docs/systems/brand.md`.

**Decisions made / locked:**
- **Five colour roles, nothing else:** brand teal, attention amber, critical red, info blue, inert
  carbon. **Blue is reserved for Scribe, AI surfaces and focus rings** — the palette README names
  blue creep as the specific way this palette goes generic, so blue is never a status or a zone.
- **The locked success green `#24745B` is not used; teal absorbs "good".** It measures dE2000 = 8.8
  from brand teal — the same colour to the eye. Keeping both meant one was decoration pretending to
  be meaning.
- **The ink scale's floor for real text is `ink-muted` (5.2:1).** This was a defect, not a taste
  call: Tailwind `gray-400` was the app's most-used text colour at 232 usages and sits at 2.54:1 on
  white — every metadata line a manager was expected to read.
- **Zone hues dropped**; zones are told apart by icon, label and position. Teal, blue and carbon
  minus reserved blue left no third zone colour that wouldn't dilute the brand. Session 55's bold
  gradient tile *shape* stands — only its per-hue colouring is superseded.
- **`tailwind.config.js` remaps the stock gray/green/indigo/rose/sky/cyan families onto brand ramps**,
  so a missed `text-rose-500` renders as on-brand red. The palette is closed by construction rather
  than by everyone remembering the rule.
- Andrew waived the usual mockup-first step for this one and asked to build straight through.

**Found along the way:** T10-C's negative channels close up below ~32px and it reads as a blob — the
limitation `docs/branding/tsp/README.md` predicted. `public/tsp-mark-small.svg` (widened channels) and
`public/favicon.svg` (knocked out of a teal tile) are the small-size cuts; recorded in
`docs/systems/brand.md`.

**Next step:** Andrew to dogfood the recolour against real data — the sandbox has no Supabase creds,
so only the static marketing route and a throwaway token proof page were rendered. Two build tarballs
are stranded in `_to_delete/` (gitignored; device_bash can't delete). Wordmark lockups, the typeface
pairing and trademark clearance are all still open.

---

## Archived sessions (compact index)

The 20 most recent archived sessions keep their goal plus the decisions locked
that session — enough to know if one matters to what you're doing now. Older
lines keep the goal alone. Full entries
(what was done, verification, deviations) are in
`docs/archive/SESSION_HISTORY_ARCHIVE.md`, newest-first, unchanged from their
original text. Open that file when you need the full detail behind a
specific decision.

- **Session 57 — 2026-08-22:** Reorganize the project references so current-state docs stay compact and historical narrative moves to the session archive. **Decided:** reference docs describe the present; nothing is deleted, only moved; every tenth session gets a documentation GC pass.

- **Session 56 — 2026-08-22:** Close the last nav-alignment item and standardize excessive page whitespace. **Decided:** AppNav and Sidebar share `NAV_STRIP_HEIGHT`; `SECTION_GAP` (`mt-5`) owns page-level transitions; Dashboard/Goals/Projects/Team use the 1600px `8xl` shell while narrower pages keep their existing tiers.

- **Session 55 — 2026-08-22:** Move Mission Control's “Your people/The work/Foundation” summary cards to the bold gradient-tile convention after a real-data mockup comparison. **Decided:** gradient tiles over pastel; pastel tokens remained canonical for nav chrome; mockup-before-code confirmed for subjective visual decisions.
- **Session 54 — 2026-08-22:** UX review of alignment/spacing after the persistent header+sidebar landed; built and migrated 14 pages onto a shared PageShell. **Decided:** one component owns the container recipe (`px-6 sm:px-8` + vertical padding), per-page max-width stays a prop since widths vary for real content reasons; `login`/`ic` are explicitly out of the shell's scope, not an oversight.
- **Session 53 — 2026-08-22:** Build Goals and Projects per Session 52's locked Option A — KPI strip, `border-l-4` card grid, inline-SVG progress ring. **Decided:** only the on-track *fraction* tile takes the dynamic gray/amber/green tone — a fraction tile must never render a fixed success colour, since "0/N on track" is not success; the progress ring keeps a fixed stroke regardless of status, an exact port of Team's status-agnostic ring rather than a new per-status recolouring convention.
- **Session 52 — 2026-08-22:** Give Mission Control the persistent sidebar after all, and scope Goals/Projects into Team's visual language via a 3-option design canvas. **Decided:** every authenticated page shows the same rail — Session 51's "already the map" exclusion read as inconsistent in use, not as deliberate simplification; Goals/Projects locked to Option A (KPI strip + border-l-4 card grid + progress ring), level tabs kept as a pill filter.
- **Session 51 — 2026-08-22:** Simplify the persistent nav (Sessions 36-38) by retiring the duplicated breadcrumb + zone-chip idiom in favor of a fully static top bar and a persistent left rail (`Sidebar.tsx`) on every page except Mission Control. **Decided:** Mission Control gets no sidebar since its own card grid + inline ZoneMap already is the map; the all-areas map overlay is retired outright, not rehomed, since the sidebar already puts every section one click away.
- **Session 50 — 2026-08-21:** Rebuild `/app/reports/[id]` from a single-column form wall into the "Command Deck" hub (identity band, KPI strip, 3-column layout, settings drawer). **Decided:** new `dr_capture_notes` is its own inbox table (not a column on `one_on_ones`); goal progress bars only render with a real check-in, never fabricated from status alone.
- **Session 49 — 2026-08-21:** Give the development plan its own dedicated, always-editable text box (Manager Notes had been accidentally absorbing the AI-assist meant for the plan itself). **Decided:** Manager notes and the development plan are genuinely separate concepts and stay on separate fields/surfaces, not merged; `/notes/revise` is reused for both rather than duplicated.
- **Session 48 — 2026-08-21:** Fix the manager-note flow being accidentally AI-gated by adding manual entry as the default everywhere, with AI as an optional assist (new "Revise with AI" alongside the existing "Draft with AI"). **Decided:** Draft (evidence-gated, can honestly return nothing) and revise (always answerable, evidence only for grounding) are intentionally different-shaped operations, not one prompt behind a flag.
- **Session 47 — 2026-08-20:** Scope and build Development (individual plans + a lightweight team "training focus" note), activating dormant `development_plans`/`dev_plan_*` schema from the original scaffold. **Decided:** Aspirations and training are never AI-drafted — only opportunities + a synthesis note, where evidence-grounding actually applies; team dev focus reuses team_callouts' exact upsert/uniqueness mechanics rather than a new pattern.
- **Session 46 — 2026-08-20:** Give projects an optional team attachment and make `/app/team`'s Goals/Initiatives cascade down from parent departments instead of exact-matching only. **Decided:** Hierarchy inheritance applies only to goals/projects on `/app/team` (commitments, roster, meeting notes, callouts stay exact-match); the leadership-rollup endpoint was deliberately left unchanged (different hierarchy concept), flagged as a follow-up.
- **Session 45 — 2026-08-19:** Add a team name + dropdown to `/app/team` so a manager leading multiple `org_units` can tell which team's data they're viewing, and filter the page by picking one. **Decided:** `team_callouts.org_unit_id` is `ON DELETE CASCADE` (not `SET NULL` like `team_meeting_notes`) — found via a real Postgres test, needed because of the two-partial-unique-index uniqueness rule; `GET /callout` changed from one object to a list, a breaking response-shape change.
- **Session 44 — 2026-08-18:** Build Role JD Import (`docs/archive/scoping/ROLE_JD_IMPORT_SCOPING.md`): paste/drop a JD, one AI call proposes role identity + ladder match + drafts expectations, manager reviews, one commit lands it. **Decided:** No migration needed — every column this flow writes already existed; collision resolution is server-side first (draft already flags `exists`), frontend only handles manager-created collisions; the JD file is never stored (role config, not a Context Engine document).
- **Session 43 — 2026-08-18:** Polish pass (Plan §7.3, last of 5 team-setup UX sessions): People archive/edit, People-row rework, data-trust fixes, org-wide values. **Decided:** Two mutually-exclusive lists (active/archived), not one client-filtered list — archived fetch only pays when a manager expands "Show archived"; `teams_count` keeps its pre-existing meaning (total org units), tile-display split lives in two new fields instead.
- **Session 42 — 2026-08-18:** Build Plan S4+S5 (last of the four S1-S5 setup-UX sessions, `docs/archive/scoping/TEAM_SETUP_UX_REVIEW.md` §6) — make half-configured setup state visible everywhere a person appears, and rename/consolidate the setup surfaces (Roles & Levels + Expectations merged into one "Roles & expectations" tab).
- **Session 41 — 2026-08-18:** Build Plan S1 — rebuild Settings → Team as a roster-first "People" section (progress header, inline role/team creation, fix for Quick add's free-text Role dead-end). **Decided:** `role_has_expectations` is null (not false) when no role is assigned, distinguishing "nothing to check" from "checked, found nothing"; inline role/team creation always creates new (no fuzzy-match merge — Roles & Levels' existing merge tool stays the one place for that); email on create is fire-and-forget, no auto-invite.
- **Session 40 — 2026-08-18:** Build Plan S2 — role families, so 13 flat role_levels cards become ~5 ladders (one card per family, levels as rows, "Add L{n+1}" pre-filled, merge tool for near-duplicates). **Decided:** Family name takes over as primary display once a level has one, `job_role` stays as an optional per-level override title; new role creation splits into "+ Add a new ladder" (family+L1 together) vs. "+ Add L{n+1}" (pre-filled, existing ladder); family deletion allowed regardless of level count, UI just steers toward emptying it first.
- **Session 39 — 2026-08-18:** Build Plan S3 — expectations coverage grid + per-role "Draft with AI" (role's stored JD → draft metrics/skills/values, review-then-commit) + org-wide values. **Decided:** Org-wide values = `value_configs.role_level_id IS NULL` — no migration (column already nullable, RLS org-scoped, not role_level-scoped); AI draft leans conservative on role-specific values — prefer empty, company values live in the org-wide block, not duplicated 13x; all new logic in new `expectations_ai.py` on top of settings.py's unchanged CRUD (same shape as assessments.py on direct_reports.py).
- **Session 38 — 2026-08-17:** Polish pass on the persistent nav shipped in Sessions 36/37: top-bar alignment fix, a sticky-nav scroll bug found during verification, Scribe toggle prominence, and a first-ever avatar menu (Settings + Sign out). **Decided:** Nav content aligns to `max-w-7xl` (matching Dashboard/Team); Scribe toggle prominence solved with styling only, no second toggle location; avatar menu is Settings + Sign out only, no multi-org items.
- **Session 36 — 2026-08-16:** Nav rework pass 1 (tracked in code comments and DESIGN.md as Session 36/37; documented here retroactively — Andrew asked to hold… **Decided:** all six recorded directly in `docs/DESIGN.md`'s 2026-08-16 rows — hub & orbit locked in from nav_redesign_options.md; ZoneMap.tsx….
- **Session 37 — 2026-08-16:** Nav rework pass 2 (tracked in code comments as Session 38 — see `docs/archive/scoping/ONE_ON_ONES_PAGE_SPEC.md`, the canonical spec for this pass). **Decided:** `resolve_cadence_days()` returns `(days, source)` rather than a bare int — a deliberate deviation from the spec's literal…; `one_on_ones` still has no status column — status stays derived (`planned` = prep_guide set + summary null; `completed` = summary….
- **Session 35 — 2026-08-16:** Widen the Scribe drawer from its fixed 400px to roughly 25–33% of the viewport width, so the conversation and draft cards get more room without…
- **Session 34 — 2026-08-13:** S3 of the Scribe build plan (`docs/archive/scoping/AGENT_SCRIBE_SCOPING.md`): Hardening + close-out.
- **Session 33 — 2026-08-13:** S2 of the Scribe build plan (`docs/archive/scoping/AGENT_SCRIBE_SCOPING.md`): Drawer UI + confirm flow.
- **Session 32 — 2026-08-13:** S1 of the Scribe build plan (`docs/archive/scoping/AGENT_SCRIBE_SCOPING.md`): agent loop + eval harness, no UI.
- **Session 31 — 2026-08-12:** Build Session VI of the Context Engine build plan (`docs/archive/scoping/CONTEXT_ENGINE_BUILD_PLAN.md`): staleness + precedence surfacing — the final session of the….
- **Session 30 — 2026-08-12:** Build Session V of the Context Engine build plan (`docs/archive/scoping/CONTEXT_ENGINE_BUILD_PLAN.md`): the Brain visualization.
- **Session 29 — 2026-08-12:** Build Session IV of the Context Engine build plan (`docs/archive/scoping/CONTEXT_ENGINE_BUILD_PLAN.md`): retrieval + agent integration, backend only.
- **Session 28 — 2026-08-12:** Build Session II (extraction + Librarian pipeline, backend) and, same session, Session III (confirm-card UX, frontend) of the Context Engine build….
- **Session 27 — 2026-08-12:** Move the Context Engine (Session 25's framework, `docs/archive/scoping/CONTEXT_ENGINE.md`) from settled concept to buildable.
- **Session 26 — 2026-08-11:** Started as an open brainstorm from Andrew — goals and initiatives feel inert on Mission Control (cards can't be interacted with, no visible progress,….
- **Session 25 — 2026-08-09:** COO agent brainstorm round 2 (follow-up to the Session ~9 agent-hierarchy idea, whose "wait until the data models exist" objection is now resolved).
- **Session 24 — 2026-08-09:** Visual/layout redesign of `/app/team` (Team Mission Control), Andrew's explicit ask after dogfooding Session 22/23's 3-column grid — captured at the….
- **Session 23 — 2026-08-09:** Follow-up on Session 22's Team Mission Control — extend the meeting-notes column with a surfaced "next meeting's agenda" distinct from logged past….
- **Session 22 — 2026-08-08:** Expand the `/app/team` page built Session 21 into "Team Mission Control" — a 3-column team-wide surface (roster/priorities left, company+team goal….
- **Session 21 — 2026-08-08:** Andrew asked what's next; Claude's read of the project memory (the `team_space_brainstorm` note from 2026-08-03) suggested Team View was the most….
- **Session 20 — 2026-08-08:** Andrew asked to work through `foundation_weaknesses.md` (the 6 structural weaknesses flagged in Session 19) and confirm they're all still active….
- **Session 19 — 2026-08-07:** Andrew reviewed Session 18's Mission Control page and wanted it reworked into a grid — three sections across the top, per his original design intent….
- **Session 18 — 2026-08-06:** Andrew asked for a few options for next steps given everything built so far.
- **Session 17 — 2026-08-06:** Andrew reported the Team settings page had visually overlapping text (screenshot), and separately — a much bigger concern — that he'd gone through….
- **Session 16 — 2026-08-04:** Asked what the best next step for the app was, given PRODUCT_VISION.md and everything built so far.
- **Session 15 — 2026-08-03:** Role-scoped views — Andrew picked this off the running list of "what's next" options (surfaced at the top of this session by reviewing….
- **Session 14 — 2026-08-02:** Capacity model and planning — Andrew's own framing: help managers/ dept heads understand team bandwidth, and codify how much "work" a team, individual, or department can actually handle.
- **Session 13 — 2026-08-02:** Activate `projects` — the dormant table flagged as "the next candidate in this family" after Goals (Session 10) and Org (Session 11).
- **Session 12 — 2026-08-02:** Split "Team" out of Settings' Roles & Levels into its own section, and add Edit (update-in-place) for role_levels — same "scope first" pattern as….
- **Session 11 — 2026-08-02:** Design (then build) an org hierarchy data model — team/department/ company as real entities, not free text — plus a visual org-chart builder.
- **Session 10 — 2026-08-02:** Scope how Goals fits into the product with Andrew (design/scoping conversation, not a build session at first) — then, once placement and shape were….
- **Session 9 — 2026-08-02:** Give managers access to past 1:1 activity from the DR detail page — both completed sessions and in-progress prep sheets.
- **Session 8 — 2026-08-01:** Capture what actually happens on the call.
- **Session 7 — 2026-08-01:** Make the Settings backbone pay off — surface each DR's role expectations on the detail page and ground the AI 1:1 prep in them.
- **Session 6 — 2026-08-01:** Settings page — the configuration backbone connecting people, roles, and performance expectations (pulled forward ahead of the dashboard roadmap).
- **Session 5 — 2026-08-01:** Commitment tracker UI — surface and resolve commitments (they could be created and fed into prep, but never viewed or closed anywhere).
- **Session 5b — 2026-08-01:** Dashboard → mini mission control.
- **Session 4 — 2026-07-17:** Implement real AI-assisted 1:1 prep — the core product IP.
- **Session 4b — 2026-07-21:** Wire the 1:1 prep backend to the frontend.
- **Session 4c — 2026-07-21:** Wire Supabase Auth so the full flow is end-to-end testable.
- **Session 4d — 2026-07-21:** Get Supabase running and backend deployed to Railway.
- **Session 3 — 2026-07-17:** High-fidelity mockup of all 5 core screens + full schema architecture aligned with the Miro board.
- **Session 2 — 2026-07-17:** Reset from scaffold confusion, confirm tech stack, establish documentation strategy.
- **Session 1 — 2026-07-14:** Build project scaffold.
