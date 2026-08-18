# Team Setup UX Review — people, roles, teams, expectations

**Date:** 2026-08-18 · **Method:** walked the live deploy (thesamepage-blush.vercel.app) as a first-time manager doing initial setup, then as a PM/UX reviewer; cross-checked against `database/schema.sql`, `settings/page.tsx`, `org/page.tsx`, and the Quick add flow.
**Companion doc:** the 2026-08-12 product review (three-lens). This review goes one level deeper on its #1 finding — the setup/onboarding path — because setup is where a paying manager either succeeds in the first 30 minutes or churns.

---

## 1. The verdict in one paragraph

All the pieces exist and technically work: people, roles + levels, teams/departments, expectations, capacity. But they were built in separate sessions and it shows — setup is currently a scavenger hunt across four surfaces (Quick add, Settings → Roles & Levels, Settings → Team, /app/org), in an order the UI never tells you, with a free-text trap that silently defeats the whole chain. The proof is in our own dogfood data: after months of building, the live org has **13 roles defined, 0 expectations configured on any of them, and 2 of 3 people with no role assigned**. If the founder's own team isn't fully wired up, a paying manager with 14 people and 13 near-unique roles has no chance. This is not a functionality gap; it's an assembly-experience gap — and it's fixable with focused UX work, not a rebuild.

## 2. The manager's mental model vs. the app's layout

What a manager arriving with a real team wants to do, in their words:

> "Here are my people. Each person has a job at a level, and sits on a team. For each job, here's what good looks like. Now help me manage them."

One job. The app currently splits it like this:

| Step in the manager's head | Where it actually lives | How you'd know |
|---|---|---|
| Add my people | Quick add on Mission Control (also roster is on /app/team, but there's no add there) | You wouldn't — nothing points here |
| Define my teams | **/app/org** (Foundation zone, called "Org," framed as departments/chart) | Settings → Team mentions it in passing ("set up in Org") |
| Define the jobs | Settings → Roles & Levels | Reachable, but flat list |
| Connect person → role and person → team | Settings → **Team** ("Who's in which role") | Third place, different section name than the concept |
| Define what good looks like | Settings → Expectations, per role·level, three tabs | Fourth place; starts blank |

Five stops, four pages, no prescribed order, and the dependencies run backwards from how you discover the pages: you meet Quick add first, but it can't do the things Settings needs; Settings → Team needs roles and org units to already exist; Expectations needs roles to exist and is 13 × 3 empty buckets when they do.

## 3. Findings

### F1 — The Quick add "Role" field is a trap (severity: critical)
Quick add → Direct report asks for **Name** and **"Role (optional)"** — a free-text field (`direct_reports.role_title`). It looks exactly like "assign this person their role." It is not. It's a legacy string connected to nothing: not to `role_levels`, not to expectations, not to assessments, not to AI prep. A new manager types "Account Executive," believes setup is done, and every downstream promise (expectations on the person page, grounded 1:1 prep, assessments) silently degrades. There are effectively **three role-ish fields** on a person — `role_title` (free text, dead end), `role_level_id` (the real one), `org_unit_id` (team) — and the UI leads with the dead one.

### F2 — Our own data shows the funnel failing (severity: critical)
Live org state observed: 13 role·levels, 6 org units across 2 departments, 3 people. Heloisa: team but **no role**. Jordan: **no role, no team**. Leah: role + team, but her page reads *"No expectations configured for this role yet. Add them in Settings."* Zero of the 13 roles have a single metric, skill, or value configured. Meanwhile the Roles & Levels section holds thousands of words of pasted job descriptions — the raw material for expectations is sitting *right there*, in a field nothing downstream reads.

### F3 — Roles & Levels is a wall, not a ladder (severity: high)
The section renders 13 flat cards sorted alphabetically, each with a full pasted JD (hundreds of words, unscannable, duplicated across levels — the L2 cards literally say "PLUS everything an L1 is responsible for" and then repeat the entire L1 text). The data model has no role-family concept: `job_role` is free text + `job_level` int, so "Corporate Customer Success Manager · L1/L2" and "Senior Corporate CSM · L3" — one real career ladder — are unrelated strings. There's no grouping, no collapse, no "add next level," no de-duplication. At Andrew-scale (13 roles) it's already painful; the mockup vision (scales, weighting, comp bands — fields that exist in the schema unused) will make each card heavier still.

### F4 — Expectations is a blank-page problem times 39 (severity: high)
The Expectations section is: pick 1 of 13 role·levels from a dropdown → three tabs (Metrics/Skills/Values) → empty form. No coverage overview (which roles are done?), no copy-from-another-level, no copy-from-another-role, no AI draft from the JD text already stored on the role, no org-wide values (values are per-role·level, so a 4-value company needs 52 manual entries). Nothing tells you expectations are the payoff of the whole chain — the section that makes prep sheets, assessments, and "the same page" actually work. This directly contradicts the product's core promise: the app's judgment layer should be doing this lifting.

### F5 — Assignment UI won't survive contact with 14 people (severity: medium)
Settings → Team is a flat list of person rows with two unlabeled-group dropdowns (13 flat role options; unit options prefixed "Team ·"/"Dept ·"). No grouping by team, no filter, no indication of which people are unassigned (no warning state), no way to add a person here, no way to create a missing role from here — if the role doesn't exist yet you bounce to another section, then come back. At 3 people it's tolerable; at 14 with near-1:1 person-to-role mapping it's a spreadsheet chore with extra steps.

### F6 — The state of being half-set-up is invisible (severity: medium)
Nothing surfaces "your setup is incomplete" where you'd feel it: the /app/team roster cards show name + avatar only (no role/team chip, no "no role" badge); the person page for a role-less report shows **no expectations section at all** — not even "No role assigned — assign one," it just isn't there; the same page still offers "Score them against their role's expectations," a link into a flow that can't work for that person. The Foundation zone's "Settings — not finished" hook exists but leads to the maze above, not a path.

### F7 — Naming pulls the map apart (severity: medium)
"Org" (the page where you make *teams*), "Team" (the page that's actually team *mission control*), Settings → "Team" (person↔role wiring), "Roles & Levels" and "Expectations" (two halves of one concept — a job and what good looks like in it). A manager looking for "where do I set up my team" faces three things called team/org, none of which is the whole answer. The IA is sound underneath (zones from the nav redesign are right); it's the setup surfaces that don't map to any single noun a user has.

### F8 — Structural questions worth deciding on purpose (severity: flag, not fix)
(a) **Roles have no team affiliation** — since `functional_team` was deprecated in favor of `org_unit_id` on the *person*, a role can't be scoped or filtered by team; with 13 roles across 6 teams the dropdowns can't narrow. (b) **Role cardinality ≈ 1 person** in orgs like Andrew's — the per-role setup cost must approach the per-person cost, or managers will skip roles entirely. (c) **Values are per-role·level** — almost certainly wrong grain; company values are org-level with maybe per-role expression. (d) `role_levels` carries dormant comp fields (salary bands, bonus) that add schema weight but no UX — fine for now, but every future Roles UI decision should know they're coming.

## 4. What's already right (don't break these)

The three-anchor model itself — person / role·level / org unit — is correct, and correctly separated (two people in one role on different teams works; org-scoped roles and units vs manager-scoped reports is the right RLS split). The Settings → Team blurb ("Connect each direct report to a role… so their expectations follow them, and to a team… so goals and reporting can be scoped correctly") is *exactly the right sentence* — the mental model exists in copy, just not in the UX. And the downstream consumers (person page expectations block, prep grounding, assessments, capacity work-units) are all wired and waiting; nothing here requires re-architecting them.

---

## 5. Proposed scope items

Ordered by leverage. S1–S3 are the core; S4–S5 harden it. Each becomes a full scoped plan in §6 once agreed.

### S1 — One "Set up your team" flow (the golden path)
A single guided surface — likely a rebuilt Settings → Team, promoted to the front of Settings and linked from every empty state — that walks the whole chain in the natural order: **people → teams → roles → expectations**, showing progress and never bouncing you to another page to create a dependency (create a team or role inline, right where you need it). Roster-first layout: one row per person with Role, Team, and Expectations-status inline-editable. This is also the answer to the Aug-12 review's #1 item (golden-path onboarding) for the team-configuration half. *Includes:* kill or convert the Quick add free-text Role field (typeahead against real roles + "create new role…"), and a setup-completeness model (per-person: has role / has team / role has expectations) that the checklist, roster badges, and Foundation door all read from.

### S2 — Role ladders (group levels under a role family)
Restructure Roles & Levels around the family: one card per role, levels as rows inside it. "Add L3" pre-fills from L2. Collapse JD text by default. Minimal-schema path: add `role_levels.role_family_id` (or a `roles` parent table) with a migration that groups existing rows by exact `job_role` match and lets Andrew merge the near-matches (e.g. the "Senior …" variants) in the UI once. This is what makes 13 roles feel like 5 ladders.

### S3 — Expectations: coverage map + AI draft
Two halves. (1) A coverage overview replacing the blind dropdown: grid of roles × (metrics/skills/values) with counts and empty-state warnings, so "what's left" is one glance. (2) **"Draft with AI"** per role: feed the stored `job_responsibilities` JD (plus org context via the Context Engine, later) → draft metrics/skills/values for review-then-commit, same draft-then-review pattern as wrap-up extraction and assessments. Plus: copy-from-level / copy-from-role, and move values to org-level with optional per-role overrides (small migration). This converts Andrew's thousands of pasted JD words into the payoff layer in minutes, and is the single biggest setup-time win for a 13-role org.

### S4 — Make half-set-up visible everywhere it hurts
Person page: always render the Expectations block — "No role assigned → [assign]" inline (assign without leaving the page); hide or reword "score against expectations" when impossible. Team roster cards: role · team chip, amber "no role" badge. Org page: member counts per unit (click-through to those people). Cheap, mostly frontend, huge trust payoff; several items are one-liners once S1's completeness model exists.

### S5 — Naming and placement pass on the setup surfaces
Decide the nouns once: e.g. Settings → Team becomes **"People"** (or absorbs into S1's flow), /app/org stays "Org" but its blurb says "your teams and departments," Roles & Levels + Expectations either merge into **"Roles & expectations"** (one section, role-centric: pick a role, see its levels, JD, and expectations together) or stay adjacent with hard cross-links. Small build, but do it *with* S1/S2/S3 so the new flow lands with the right names.

**Suggested sequencing:** S2 → S3 → S1 → S4/S5 if we want data-model-first (ladders and AI-draft make the guided flow's steps cheap), or S1-lite first if we want the demo-able golden path sooner. My lean: **S3 first** — it's the highest-value, most differentiated piece (AI turns JDs into expectations), it makes our own org's data real, and S1's checklist is more compelling when the expectations step takes minutes instead of hours.

---

## 6. Scoped plans (agreed 2026-08-18: all of S1–S5, build order S3 → S2 → S1 → S4/S5)

Sequencing rationale: S3 makes expectations real for the 13 existing roles (highest payoff, fills our own data); S2 restructures roles underneath before more UI is built on the flat list; S1 assembles the guided flow on top of both; S4/S5 propagate the finished model outward. Each is roughly one build session; S1 may run to 1.5.

### Plan S3 — Expectations: coverage map + AI draft (build 1st)

**User story.** A manager who has defined roles (with pasted JDs) gets every role's metrics, skills, and values drafted by AI and committed after review — minutes per role, not an hour — and can always see at a glance which roles are covered.

**Schema / migrations.** Almost none. `value_configs.role_level_id` is already nullable — adopt `NULL = org-wide value` as the convention (backend + UI change only). Optional 1-line migration if we want a CHECK or partial index; otherwise no SQL this session.

**Backend.**
- `POST /api/expectations/draft` (settings.py or new `expectations_ai.py`): body `{role_level_id}` → loads `job_role`, `job_level`, `job_responsibilities` (+ sibling levels' existing configs for calibration) → Claude call (same client/pattern as wrap-up extraction and assessment drafts; slowapi rate limit applies) → returns draft `{metrics[], skills[], values[]}` with name / order_type / expectation / measurement_period. **Not persisted** — commit happens through existing create endpoints.
- `POST /api/expectations/{kind}/batch` : create many configs in one call (the review screen commits a whole draft at once).
- `GET /api/expectations/coverage` : counts of metric/skill/value configs per role_level (single grouped query) — feeds the coverage grid and later S1's completeness model.
- Values endpoints accept `role_level_id: null` for org-wide; `fetch_role_expectations` (prep grounding) unions org-wide values into every role's expectation set.

**Frontend (settings/page.tsx, Expectations section).**
- Coverage grid replaces the blind dropdown as the entry point: one row per role·level (grouped by ladder after S2), three count cells (M/S/V), empty cells amber. Click a cell → the existing editor, scoped to that role+kind.
- Per-role **"Draft with AI"** button → review panel: draft items as editable rows with include-checkboxes, per-tab, then "Add N expectations" → batch commit → grid updates. Empty-JD fallback: AI drafts from role title + org context, with a note that pasting responsibilities improves it.
- "Copy from…" menu per role (choose another role·level; pre-checks the review panel with that role's items).
- New "Org-wide values" block at top of the Values tab.

**States.** No roles yet → existing pointer to Roles & Levels. Draft in flight → skeleton rows + cancel. AI failure → inline error, manual forms untouched (AI is an accelerant, never a gate).

**Verification.** `py_compile` all touched backend; `tsc --noEmit`; isolated `next build`; live: run Draft with AI on one real role (e.g. Corporate CSM · L1), commit, confirm Leah-equivalent person page renders the expectations block and 1:1 prep grounding picks them up.

**Open questions.** (a) Do drafts also propose scale definitions now or post-scales-work? Lean: not yet. (b) Should committing a draft mark `job_responsibilities` as "source" for provenance? Nice-to-have, skip v1.

### Plan S2 — Role ladders (build 2nd)

**User story.** Thirteen role·levels read as ~5 ladders: one card per role family, levels inside it, next level pre-filled from the previous one, JDs collapsed.

**Schema / migrations** (`2026-08-XX_role_families.sql`).
- `role_families` (id, org_id, name, created_at) + RLS via `current_org_id()` (same pattern as role_levels — no inline users subqueries).
- `role_levels.role_family_id uuid references role_families(id) on delete set null`.
- Backfill in the same migration: insert one family per distinct `(org_id, job_role)`, link rows. Near-duplicates ("Senior Corporate CSM" vs "Corporate Customer Success Manager") stay separate until merged in the UI.

**Backend.** `role_families` CRUD (new route file, registered in main.py); `PUT /api/role-levels/{id}` accepts `role_family_id` (that's the whole merge mechanic: move a level into another family; empty families deletable); role_levels GET joins family name.

**Frontend.** Roles & Levels rework: family cards with level rows (L1, L2…), expand-for-JD (collapsed by default, first ~2 lines shown); "Add L{n+1}" pre-fills responsibilities from L{n}; "Move to another ladder…" per level row (merge tool); rename family renames the display everywhere. Role dropdowns elsewhere (Settings → Team, Expectations grid, Capacity work units) become grouped selects by family.

**States.** Family with 0 levels → ghost card with delete. Unfamilied level (family deleted) → "Ungrouped" bucket.

**Verification.** Full local-Postgres run of schema.sql + migration-on-HEAD (established pattern); py_compile / tsc / next build; live: merge the Senior variants into their ladders as the real-data test.

**Open questions.** Does `job_role` text stay authoritative for display within a family, or does the family name take over with the level suffix ("Corporate CSM · L3")? Lean: family name takes over; keep `job_role` as the level's optional title override (covers "Senior …" titles at L3).

### Plan S1 — Guided team-setup flow (build 3rd)

**User story.** A brand-new manager lands in one place, and in one sitting: adds people, sketches teams, attaches roles (creating them inline), and sees expectations status — with a progress header showing exactly what's left. Andrew-scale test: wiring 14 people into 6 teams and 13 roles without ever leaving the page.

**Surfaces.** Settings → Team is rebuilt and renamed **People** (first section after Profile); Quick add's Direct report tab is fixed; empty states across the app repoint here.

**Backend.** Mostly exists. Add `GET /api/setup-status`: per-person {has_role, has_team, role_has_expectations} + aggregate step completion (people / teams / roles / expectations) — reuses S3's coverage query. Direct report create accepts optional `role_level_id`/`org_unit_id` at creation time.

**Frontend.**
- **Progress header:** four steps with counts ("3 people · 2 unassigned roles · 0/13 roles have expectations"), each step deep-linking to its surface. Same data feeds the Foundation door's "not finished" state (replaces the static hook).
- **Roster table:** row per person — name, role picker, team picker, expectations chip (✓ / "role has none → draft" linking into S3 / "no role" amber). Pickers are typeahead selects grouped by family/unit with **"+ Create new…"** inline (modal creates the role_level or org_unit without navigation — org_unit creation here covers the common case; the full tree stays on /app/org). Add-person row at bottom (name + optional email).
- **Quick add fix:** free-text "Role (optional)" becomes the same role typeahead (+ create-inline). Stop writing `role_title`; existing values render only as a fallback hint next to an unassigned role picker ("was: 'Account Executive'"). Both assign helpers already preserve the sibling field (role↔unit) — keep that invariant.

**States.** Zero people → the flow *is* the empty state (start by adding people, teams/roles steps unlock as relevant). RLS reminder: role_levels/org_units are org-scoped, direct_reports manager-scoped — no policy changes needed.

**Verification.** py_compile / tsc / next build; live golden-path run: fresh-eyes walkthrough adding a fake person → role → team → AI-draft expectations, timed; target < 5 min/person incl. drafting.

**Open questions.** (a) Does "People" absorb per-person capacity overrides too, or do those stay on the person page? Lean: stay put — this surface is wiring, not tuning. (b) Retire `role_title` column later via migration once dogfood confirms nothing reads it.

### Plan S4+S5 — Visibility + naming pass (build 4th)

**User story.** Half-configured state is impossible to miss anywhere you encounter a person, and every setup surface is named for what a manager would call it.

**Build list (mostly frontend).**
- Person page (`reports/[id]`): expectations block always renders — "No role assigned" + inline role picker (assign without leaving); "Score them against their role's expectations" hidden/reworded until a role exists; role · level · team line stays at top once assigned.
- /app/team roster cards: role + team chip under the name; amber "no role" badge (reads S1's setup-status).
- /app/org: member count per unit ("US Success · 3 people"), sourced from direct_reports grouped by org_unit_id; click → People filtered to that unit.
- Naming: Settings sections become **Profile & Company / People / Roles & expectations / Capacity** — i.e., Roles & Levels + Expectations merge into one role-centric section (pick a ladder → levels, JD, expectations coverage together; S2 + S3 built its halves). /app/org keeps its name, blurb becomes "Your teams and departments — the structure everything rolls up through." Breadcrumbs/zone-map labels updated to match.
- Sweep for stale copy: "Assigning people to roles and teams now lives in Team" and similar cross-references.

**Verification.** tsc / next build; click-through of every renamed surface from the zone map; confirm no orphaned links (the Session-37 nav made labels centralized in ZoneMap.tsx — update once).

**Open question.** Merge timing: if S2/S3 land as separate sections first, this pass does the consolidation — acceptable churn, or should S3 build directly into the merged layout? Lean: build S3 in place, consolidate here — keeps each session shippable.

---

## 7. Post-build review (2026-08-18, after all four sessions shipped)

**Method:** re-walked the live deploy end-to-end — Settings (all four sections), the AI draft modal (generated a real draft for Corporate CSM · L1, cancelled without committing), Org, Team roster, a role-less person page, and Quick add.

### 7.1 Verification: what landed

All four plans are live and substantially faithful. S2: family cards with level rows, collapsed JDs, Rename / Edit / Move… / Remove, "+ Add L3" and "+ Add L1 (lower)". S3: coverage grid grouped by family with M/S/V counts and per-level "Draft with AI" — the draft itself is *good* (NRR quarterly primary, onboarding time-to-value, health score, QBR completion, sensible descriptions), with copy-from-role in the modal. S1: "Set up your team" People section with four stat tiles, per-person role/team selects with status chips, add-person row, "+ Create new role…" in the picker, and Quick add's trap replaced by a real role select with honest helper copy. S4/S5: person page always renders the Expectations block with an inline "Assign a role…" picker and the assess link reworded; roster cards show role·team chips and an amber "No role" badge; Org shows member counts and the new blurb; Settings is consolidated to Profile & Company / People / Roles & expectations / Capacity.

Two plan items didn't fully land: **org-wide values** (no org-level values block anywhere; values are still per-level only, every Values count is 0, and the AI draft returned 0 values — the values story is simply unfinished) and **grouped/typeahead role selects** (the People and person-page role pickers are flat native selects, not grouped by family, not searchable).

### 7.2 New findings

**P1 — People rows can't manage the person, only the wiring (Andrew's find; severity: high).** No way to rename someone, fix their email, open their profile, or remove them from Settings → People — the one place framed as "set up your team." And the row layout is crammed: with both selects populated, the *person's name* truncates ("Jordan …", "Leah W…") while the dropdowns hog the width — the most important text on the row loses. Removal has a real design question underneath: `direct_reports` delete cascades through 1:1s, commitments, assessments, goals history, metric entries — everything. Offboarding someone should not torch their history, so this wants a soft **archive** (small migration: `archived_at`), with hard delete either dropped or gated behind archive + explicit cascade warning.

**P2 — Setup tiles have data-trust problems (severity: medium).** The second tile reads "8 Teams" but 8 is *all org units* — 6 teams + 2 departments. Exactly the class of disagreeing-numbers bug the Aug-12 review flagged. "1/13 Expectations" is also ambiguous (1 what?). And none of the four tiles is clickable, though each has an obvious destination.

**P3 — The near-duplicate ladders are still unmerged, and nothing nudges (severity: medium).** "Senior Corporate CSM," "Senior Customer Support Coordinator," etc. still sit as 1-level families beside their parent ladders. The Move… tool exists but nothing suggests using it. A one-time heuristic hint ("Senior Corporate CSM looks like L3 of Corporate Customer Success Manager — merge?") would finish what the S2 backfill couldn't.

**P4 — Stale copy survived the sweep (severity: low, trust-eroding).** Roles & expectations still says "Assigning people to roles and teams lives in **Team**" — the section it points to is now called People. (The plan's stale-copy sweep explicitly listed this sentence.)

**P5 — Small deep-link and label gaps (severity: low).** The "Draft expectations" chip on a People row goes to the section, not straight into that role's AI-draft modal (one extra decision for the user at the moment of highest intent). The coverage grid repeats the full role name under its own family header ("Corporate Customer Success Manager · L1" under "Corporate Customer Success Manager") where "L1" would scan. Org units with zero people show no count at all — you can't spot an empty/dead team; counts also aren't clickable through to People. The person page H1 still shows only the name — role · team under it would orient every 1:1.

### 7.3 Proposed follow-up scope

**Polish Pass A — People management + trust details (one session).** Rework the People row: two-line layout (name as a link to the profile, status chip right; pickers on line two) with a per-row ⋯ menu — Edit name & email, Open profile, Archive. Add `archived_at` migration + backend support; archived people drop out of rosters/rollups but keep history. Fix the tiles ("6 teams · 2 departments", clarify the expectations tile, make all four clickable). Group role selects by family (optgroup — cheap, no typeahead needed yet). Deep-link the "Draft expectations" chip into the draft modal. Level-only labels in the coverage grid. "0 people" chip on empty org units + counts click through to People. Role · team subtitle on the person page H1. Kill the stale "lives in Team" sentence (and re-sweep).

**Polish Pass B — finish the values story (half to one session).** Org-wide values block (backend treats `value_configs.role_level_id NULL` as org-wide; `fetch_role_expectations` unions them in), AI draft for values at the org level (from company/context info rather than JDs), and the merge-suggestion nudge from P3 if it didn't fit in Pass A.

*Approved scope and session prompts: see docs/TEAM_SETUP_BUILD_SESSIONS.md (Session 5, and 6 if split).*
