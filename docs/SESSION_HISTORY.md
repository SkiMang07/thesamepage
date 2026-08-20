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

## Session 45 — 2026-08-19

**Goal:** Andrew flagged that a manager/director leading more than one `org_units` team had no way to
tell, on `/app/team`, which team's data they were looking at — the page always combined every direct
report with no label. Add a team name + dropdown to the header, and make picking a team actually
filter the page.

**What was done:**
- Scoped via one AskUserQuestion round (3 questions, all Andrew's recommended defaults): dropdown
  source = `org_units` the caller leads (`leader_user_id`, existing Session 15 mechanism); selecting a
  team filters everything on the page, not just the label; "All teams" stays the default.
- **Key simplification found mid-build:** most of "filter everything" needed zero backend changes.
  Roster, initiatives, and commitments all key off `direct_report_id` → `direct_reports.org_unit_id`
  (filterable client-side); goals already carry `org_unit_id` directly. Only `team_meeting_notes` and
  `team_callouts` had no per-team signal at all.
- `database/migrations/2026-08-19_team_dropdown_scoping.sql` (new) — adds nullable `org_unit_id` to
  both tables (null = "applies to all teams," shown under every specific team's filter, same
  treatment as a company-level goal).
- `backend/routes/team.py` — `TeamNoteIn`/`TeamCalloutIn` gain `org_unit_id`. `GET /callout` changed
  shape: returns every callout row for the caller (list) instead of one object, so the frontend
  switches teams without a round trip. `PUT /callout` does a manual look-up-then-write instead of
  supabase's `upsert()` (see decision below).
- `frontend/lib/api.ts` — `TeamNote`/`TeamCallout` gain `org_unit_id`; `getTeamCallout()` return type
  changed to `TeamCallout[]`; `createTeamNote`/`updateTeamCallout` take an `orgUnitId` param.
- `frontend/app/app/team/page.tsx` — header gains the team name + `<select>` (only rendered if the
  caller leads at least one org_unit); every section derives a `visible*` filtered view from
  `selectedTeamId` client-side; `CalloutsPanel` reworked to take `callout`/`scopeLabel`/`onSaved`
  instead of `callout`/`setCallout`, with a reset-on-team-switch effect so a half-written draft can't
  get saved against the wrong team.

**Decisions made / locked:**
- `team_callouts.org_unit_id` is `ON DELETE CASCADE`, not `ON DELETE SET NULL` like
  `team_meeting_notes` — found and fixed via a real local-Postgres functional test, not reasoned
  about in the abstract. `team_callouts` needed a uniqueness rule per `(manager, org_unit)` pair plus
  "at most one all-teams row," which a plain composite `UNIQUE` can't express (Postgres treats every
  NULL as distinct), so it's two partial unique indexes instead. With `SET NULL`, deleting an
  org_unit that has both a team-specific callout AND a manager already holding a separate all-teams
  callout tries to write a second null-`org_unit_id` row — the delete fails outright. Reproduced the
  failure, then reproduced the fix, against real inserts before delivering.
- `GET /callout` moved from returning one object to a list — worth flagging because it's a breaking
  response-shape change for anyone else calling that endpoint (none currently exist besides this
  page).

**Verification:** cloned the pushed GitHub repo (commit `bbd65c0`) into a scratch sandbox. Backend —
fresh venv, `main` import with dummy Supabase env vars confirmed all team.py routes register,
`py_compile` clean. Frontend — fresh `npm install`, `tsc --noEmit` clean, `next build` clean (all 21
routes, `/app/team` at 8.79 kB). Schema — the repo's checked-in `database/local_verify_stub.sql` stood
up a local Postgres 16, ran the full `schema.sql` + new migration end to end with zero errors, then
functionally tested as two managers: inserted notes/callouts across two led teams + an all-teams row,
confirmed both partial unique indexes reject duplicates, confirmed RLS isolation (second manager sees
0 rows, an UPDATE against the first manager's row affects 0 rows), and specifically exercised the
org_unit-delete edge case above.

**Schema note — new migration, not yet run live.**
`database/migrations/2026-08-19_team_dropdown_scoping.sql` must run in the Supabase SQL editor before
this works against the live database — `team_meeting_notes`/`team_callouts` reads/writes will 500
until then (`org_unit_id` doesn't exist live yet on either table).

**Next step:** Run the migration in Supabase, then dogfood the dropdown — Andrew's own account needs
at least one `org_units` row with himself as `leader_user_id` before the dropdown shows up at all
(zero led units = today's unchanged single-team view).

---

## Session 44 — 2026-08-18

**Goal:** Build the Role JD Import flow scoped in `docs/ROLE_JD_IMPORT_SCOPING.md` — paste or drop a
job description, one AI call extracts the role identity + proposes where it belongs among existing
ladders + drafts its expectations, the manager reviews, one commit creates (or back-fills) the role
and its expectations. Kills the "type everything by hand" burden that left 13 dogfood roles with 0
expectations.

**What was done:**
- **`backend/routes/roles_import.py` (new) — `POST /api/roles/import/draft`.** Multipart, exactly one
  of `file` / `text` (422 on both or neither). `.pdf` goes to Claude as-is, `.docx` through
  LibreOffice, `.txt`/`.md` and pasted text inline. ONE AI call returns the whole scoping-§3.1
  contract: `is_job_description` (+ `reason`), `role` (job_role/job_level/functional_team/
  job_responsibilities), `match` (attach | create_new | exists, with role_family_id/
  existing_role_level_id/confidence/rationale), `other_roles_note`, and `expectations`. Rate limit
  `10/minute`, 25MB cap (applied to pasted text too), **nothing saved, no Storage writes** — same
  pure-AI contract as `/api/expectations/draft`. Mounted at `/api/roles/import` in `main.py`.
- **Reuse rather than re-implementation, in four places.** (1) `documents.py`'s
  `_convert_pptx_to_pdf` generalized to `convert_to_pdf(raw_bytes, kind)` — same subprocess, suffix
  driven by `kind`, error strings now name the actual input type; its one existing call site passes
  `"pptx"`. (2) `expectations_ai.py`'s METRICS/SKILLS/VALUES definitions block hoisted to
  `_EXPECTATION_DEFINITIONS` and interpolated back into `_build_draft_prompt` — verified
  byte-identical output against the pre-session module, so the coverage-grid draft prompt is
  unchanged while the JD prompt carries the same definitions verbatim. (3)
  `_generate_and_parse_draft`'s validation tail split into `parse_draft_items(parsed)` so the JD
  route runs the identical clamps on its `expectations` sub-object (it can't reuse the call-and-parse
  wrapper — its one call returns much more than expectations). (4) `_compute_coverage` supplies the
  per-level "has expectations" counts in the ladders block.
- **Match proposal.** Every family's ladder/level names go into the prompt (the model needs them all
  to propose anything), but only a server-side shortlist gets its existing expectations inlined for
  calibration — `_shortlist_families()` normalizes with the same seniority-prefix stripping as
  Session 43's ladder-merge nudge (`stripSeniorityPrefix` in `settings/page.tsx`), matching against
  the pasted text or, for uploads, the filename (a PDF's contents aren't readable server-side without
  a second extraction call, and one call is the point). `_validate_match()` never trusts the model's
  ids: a hallucinated/foreign family id degrades to create_new, an `existing_role_level_id` pointing
  outside its claimed family is dropped, a create_new never carries a ladder, and a level number
  already occupied in the proposed ladder is forced to `exists` against **that** row — so the
  frontend's own collision UI only has to handle collisions the manager creates by editing.
- **`frontend/components/DraftExpectationRows.tsx` (new).** The Plan S3 draft-review rows
  (keep/edit/discard per item, three kind tabs) lifted verbatim out of `DraftReviewPanel` in
  `settings/page.tsx` into a shared `DraftExpectationsReview`, plus `draftIncludedCount()` and
  `commitDraftExpectations()` (one batch call per non-empty kind). `DraftReviewPanel` now renders the
  shared component and calls the shared commit — same screen, one implementation, so the JD import
  and the coverage grid can't drift. Empty-state copy is a prop; the defaults are the coverage grid's
  original wording.
- **`frontend/components/RoleImportPanel.tsx` (new).** input (paste textarea + drag/drop zone, one
  control each) → drafting → review → commit. Review is an editable role identity card (title, level
  stepper, ladder select with the AI's match preselected + "Create new ladder: <title>", optional
  team, and the extracted responsibilities) above the shared draft-review rows. Collision handling
  per §3.2: choosing a ladder+level that already exists blocks the commit and offers "Update L{n}
  instead" (back-fill mode) or "Add as L{next free}". Back-fill mode is **derived** from the current
  selection, not a stored flag, so editing the ladder or level out from under it drops back to
  create-mode instead of PUTting the wrong row.
- **Commit uses only existing endpoints, client-orchestrated.** create_new → `createRoleFamily` →
  `createRoleLevel` → the three batches; attach → `createRoleLevel` with the existing family → batches;
  exists → `updateRoleLevel` (whole-record PUT preserving the level's ladder, and its team unless the
  manager typed one — same preservation pattern as `saveEdit`) → batches. Empty kinds are skipped. No
  import-specific write endpoint exists.
- **All three entry points wired (`settings/page.tsx`).** RolesSection's "+ Add a new ladder" now
  opens the import panel as the hero, with "or start from scratch" inside it falling back to the
  unchanged `RoleForm`; each ladder card's add-a-level row gains an "Import from a JD" link that
  opens the panel pinned to that family (its manual prefilled form stays the default, and is what
  "start from scratch" falls back to there); the People section's inline create-role modal gains
  "Paste a JD instead", which swaps to the panel and still assigns the imported role to the person
  the modal was opened from. The coverage grid's "Draft with AI" is untouched.

**Decisions made / locked:**
- **No migration, confirmed.** Every column this flow writes already exists (`job_responsibilities`,
  `role_family_id`, nullable `value_configs.role_level_id`) and no new table is involved. The
  scoping brief asked for a loud flag if the build found otherwise — it did not.
- Collision resolution is **server-side first** (the draft response already says `exists` when the
  proposed level is occupied), with the frontend handling only manager-created collisions. One rule,
  two enforcement points, instead of the model's word being trusted.
- The definitions block is **shared, not copied**. The scoping brief said "copy verbatim"; a shared
  constant is the same text with no way to drift, and the pre/post prompt strings were diffed to
  prove the existing path is byte-identical.
- `.pptx` is deliberately **not** accepted here even though the conversion path would handle it — a
  slide deck is not a job description, and the Context Engine is where decks belong.
- The JD file is never stored (no Storage write, no `documents` row): a JD is role config, not a
  Context Engine document.

**Verification:** `python3 -m py_compile` clean on every touched backend file; imported `main` and
confirmed `/api/roles/import/draft` registers with the limiter attached. `npx tsc --noEmit` clean;
`npx next build` clean, 19/19 routes. Functional: ran the **real route with real Anthropic calls**
against an in-memory fake Supabase (auth bypassed via a dependency override) seeded with a Corporate
CSM ladder at L1 + its expectations, an ungrouped Account Executive, and two org-wide values — all
six scoping-§4 cases pass. (1) Content-marketing JD → `create_new`, 3 metrics + 3 skills. (2) Senior
CSM JD → `attach` to Corporate CSM at L2, high confidence, rationale "Looks like the next level up
on your Corporate CSM ladder…". (3) The exact existing L1 JD → `exists` with
`existing_role_level_id` = that row (the back-fill path). (4) `.pdf` upload (generated with
`cupsfilter`) drafts end-to-end; `.docx` upload verified through type inference → `convert_to_pdf(…,
"docx")` dispatch → AI call, with the conversion stubbed since LibreOffice isn't installed on this
Mac, plus a separate check that the real `convert_to_pdf` shells out as `libreoffice --headless
--norestore --convert-to pdf` on an `input.docx`. (5) A braised-short-ribs recipe → honest refusal
("This looks like a cooking recipe…", no role, no expectations). (6) Empty and whitespace-only input
→ 422; both file and text → 422; `.pptx` → 422. Also confirmed a 3-role job-req document extracts
the primary role and reports `other_roles_note` naming the other two, unit-tested `_validate_match`'s
degradation paths and `_validate_role`'s clamps, and validated every commit payload the panel sends
against the receiving Pydantic models. **Values came back empty on every role draft** — correct: the
org-wide values were in the prompt and the restraint rule held, so nothing was duplicated per role.
What's still unverified: the real LibreOffice `.docx` conversion (no binary locally — it runs on
Railway, same posture as the existing PPTX path), and the whole commit path against a live Supabase.

**Post-build fix (Cowork review, same day):** the `_EXPECTATION_DEFINITIONS` hoist was left
half-done — the constant was a literal stub (`"""{_EXPECTATION_DEFINITIONS}"""`) while
`_build_draft_prompt` still carried the definitions inline, which is exactly why the byte-identical
diff passed: the coverage-grid path never changed, but the JD prompt shipped the placeholder token
instead of the definitions (drafts still parsed because the JD prompt's RULES section spells out the
enums — the miss was calibration guidance, invisible in output shape). Cowork filled the constant
with the real block, made `_build_draft_prompt` interpolate it, and verified programmatically:
coverage prompt byte-identical pre/post-fix (cases with and without JD/siblings), JD prompt now
carries the definitions, `parse_draft_items` parity unchanged. Lesson for future sessions: a
byte-identical diff on the UNCHANGED path proves nothing about the NEW path — render the new prompt
and assert the shared text actually appears in it.

**Next step:** Live smoke test on Railway/Vercel once pushed — paste a real JD into Settings → Roles &
expectations → "+ Add a new ladder" and confirm the created ladder/level/expectations all land, then
paste a JD for one of the 13 expectation-less dogfood roles and confirm the `exists` back-fill path
updates that role in place rather than creating a duplicate. Upload a real `.docx` JD (the one path
that can't be exercised locally) to confirm the LibreOffice conversion works in production. If the
`exists` proposal proves reliable, the fastest way to clear the 13-roles/0-expectations backlog is to
paste each role's JD in turn.

---

## Session 43 — 2026-08-18

**Goal:** Build the polish pass from `docs/TEAM_SETUP_UX_REVIEW.md` §7.3 (Pass A + Pass B
combined, the fifth and last of the team-setup UX sessions — see
`docs/TEAM_SETUP_BUILD_SESSIONS.md`, Session 5): person management on Settings → People (edit,
open profile, archive), a People-row layout rethink, data-trust fixes on tiles/labels/links, the
org-wide values story, and a ladder-merge nudge.

**What was done:**
- **Archive, not delete (`database/migrations/2026-08-18_direct_reports_archive.sql` +
  `database/schema.sql`).** `direct_reports.archived_at timestamptz null` + a supporting index.
  No cascade changes — 1:1s, assessments, goals, and metric entries all stay intact for an
  archived person. Every listing/rollup query that lists direct reports now filters
  `archived_at is null`: `backend/routes/direct_reports.py` (`list_direct_reports` — new
  `?archived=true` param for the opposite list, `get_team_overview`), `setup_status.py`,
  `team.py`'s roster, `capacity.py`'s overview, `dashboard.py`'s insight, `assessments.py`'s
  list, `assistant.py`'s `list_direct_reports` tool, and `one_on_ones.py`'s 1:1s-overview query.
  A specific-report fetch by id (person page, 1:1 prep, scorecard, `save_assessment`) is
  deliberately **not** filtered — an archived person's history must stay reachable. The two
  SECURITY DEFINER rollup functions that count people (`org_unit_people_rollup`,
  `org_unit_capacity_rollup`) also gained `and dr.archived_at is null` — the audit finding P1
  explicitly called these out. `org_unit_goals_rollup`/`org_unit_projects_rollup` were left
  alone — they aggregate over `goals`/`projects` directly, not a people count.
- **Backend: `POST /{id}/archive`, `POST /{id}/unarchive`, `PATCH /{id}/profile`
  (`direct_reports.py`).** Archive/unarchive are separate one-field POSTs rather than folded
  into the existing PUT, so the People row's Archive action can't be triggered by an unrelated
  field update. The profile PATCH is its own small model (`name` + `email`) rather than routed
  through `DirectReportIn` (the shared PUT body) — that model deliberately has no `email` field
  (see its docstring: an omitted key on a full-record PUT would silently wipe a previously-set
  email), so editing email needed a model that carries exactly these two fields.
- **`frontend/app/app/settings/page.tsx` — People row rework (finding P1).** Two-line layout:
  line 1 is the person's name as a real `Link` to `/app/reports/[id]` (never truncated) with the
  expectations status chip and a new `PersonRowMenu` ("⋯") on the right; line 2 is the
  role/team pickers, unchanged otherwise. The menu opens `EditPersonModal` (name + email,
  `updateDirectReportProfile`) or `ArchiveConfirmModal` (states explicitly that history is
  kept). A "Show archived (N)" toggle below the roster lazy-fetches
  `getArchivedDirectReports()` on first expand and renders a dimmed list with per-row
  Unarchive.
- **Setup tiles (finding P2).** `setup_status.py` now returns `team_units_count` +
  `department_units_count` (split by `unit_type`) alongside the existing `teams_count` (kept,
  unchanged meaning — total units — since `ZoneMap.tsx`'s Foundation-door check reads it that
  way). The People tile now renders "6 teams · 2 departments" instead of one ambiguous number.
  The expectations tile's label changed from "Expectations" to "Roles with expectations" so
  "1/13" reads unambiguously. All four tiles were already buttons/links as of Session 41 — no
  change needed there, and the "Draft expectations" chip already deep-links straight into the
  AI-draft modal (`draftForRoleId`/`initialDraftRoleId`, wired since Session 41) rather than
  just the section — both were flagged in §7.2 (P2/P5) but verified already correct in code, so
  left alone rather than rebuilt.
- **Coverage grid level labels (finding P5).** New `levelOnlyLabel()` in
  `frontend/components/RolePicker.tsx` — under a family header row, a level now shows "L1" (or
  "Senior Corporate CSM · L3" when the level has a title override), not the full family name
  repeated on every row. Mirrors `LevelRow`'s existing `overrideTitle` logic, just returning a
  string. (`setup_status.py`'s new `archived_people_count` field, mentioned above, is what feeds
  the People row rework's "Show archived (N)" toggle count without a second round-trip.)
- **Ladder merge nudge (finding P3, `settings/page.tsx`).** `suggestLadderMerges()` — a 1-level
  family whose name (after stripping a Senior/Sr/Lead/Staff/Principal prefix) matches or is
  contained by another family's name is flagged with a dismissible one-line banner in
  `RolesSection` ("Senior Corporate CSM looks like a level of Corporate Customer Success
  Manager — use Move… to merge"). Heuristic + session-local dismiss only, per the plan — no
  auto-merge; the actual merge still goes through the existing "Move to another ladder…" tool.
- **Org-wide values story (item 8).** `POST /api/expectations/draft-org-values`
  (`expectations_ai.py`) — drafts 3-5 company-wide values from the org's name/context (not a
  JD, since there's no role here); shares the existing `_generate_and_parse_draft()` tail
  (extracted from `draft_expectations` so both routes parse the same way) and the existing
  `/values/batch` commit endpoint with `role_level_id: null`. `OrgWideValuesBlock` gained its
  own "Draft with AI" button + an include-checkbox review panel, same draft-then-review
  contract as the per-role flow. Also lifted `OrgWideValuesBlock` to the top of `CoverageGrid`
  (previously only reachable after picking a specific role's Values tab) so it's visible
  immediately on landing in Roles & expectations, satisfying the plan's "at the top of the
  Values view" framing more literally. `fetch_role_expectations()`'s union of org-wide
  (`role_level_id is null`) values into every role's expectation set was already live (Plan
  S3) — confirmed unchanged, still the one place that union happens for prep grounding, the
  person page, and assessments.
- **Org page zero-people (finding P5, `frontend/app/app/org/page.tsx`).** The Build tab's
  member-count link was gated on `memberCount > 0`, so an empty unit showed no count at all,
  indistinguishable from a loading state — now renders plain "0 people" text (not a link,
  nothing to filter to). The Rollup tab's `RollupNode` already rendered "0 people" correctly
  (ungated) — no change needed there.
- **Person page subtitle (finding P5, `frontend/app/app/reports/[id]/page.tsx`).** The H1
  subtitle used to show only the legacy free-text `role_title`. Now resolves the real assigned
  `role_level` (via `roleLabel()`, family-aware) and `org_unit` (via `orgUnitLabel()`) once
  either is set, falling back to `role_title` only when neither is assigned yet — same "was:
  ..." hint pattern PeopleSection already uses. Fetches `getOrgUnits()` alongside the
  role_levels/role_families this page already loaded for the inline role picker.
- **Copy sweep (finding P4).** `RolesSection`'s blurb still said "Assigning people to roles and
  teams lives in **Team**" — the section is now People (renamed Session 41). Fixed. Swept the
  rest of the frontend for the same stale pattern (`grep -i "lives in Team"` and similar) —
  nothing else found; `ZoneMap.tsx`'s `team`-id door legitimately points at `/app/team` (Team
  Mission Control), a different page, not a stale reference.
- **Optgroup role selects (item 11).** Verified, not rebuilt: `GroupedRoleSelect` (extracted to
  `RolePicker.tsx` in Session 42) was already in use on both the People rows and the person
  page's inline "assign a role" picker — §7.1's claim that these were still flat selects didn't
  match the code as found. No typeahead added, per the plan's explicit "no typeahead this
  session."

**Decisions made / locked:**
- Two mutually-exclusive lists (active via `GET /api/direct-reports`, archived via
  `?archived=true`), not one combined list filtered client-side — the People section only pays
  for the archived fetch when a manager actually expands "Show archived."
- `teams_count` keeps its pre-existing meaning (total org units) rather than being repurposed —
  `ZoneMap.tsx`'s Foundation-door "is anything set up" check reads it that way; the tile-display
  split lives in two new fields instead.
- Several §7.2 findings (P2's tile-click-through, P5's deep-link chip, item 11's grouped
  selects) turned out to already be fixed in the code at HEAD, contradicting the post-build
  review's text. Trusted the code over the doc in each case and spent the session's effort on
  what was actually still missing, rather than re-doing already-correct work.

**Verification:** `python3 -m py_compile` clean on every touched backend file; imported `main`
in an isolated venv (`pip install -r requirements.txt`) with dummy env vars and confirmed all
new routes register (`POST/PATCH .../archive`, `.../unarchive`, `.../profile`,
`POST /api/expectations/draft-org-values`) alongside the existing 107-route total, limiter
attached. `npx tsc --noEmit` clean; isolated `npm install` + `npx next build` clean, 19/19
routes. Schema: spun up a local Postgres 16 with the established minimal Supabase `auth` schema
stub (extended this session with `raw_user_meta_data` on `auth.users`, needed by
`handle_new_user()`) plus a minimal `storage` schema stub (`buckets`/`objects`/`foldername()`,
same shape Session 27's Context Engine verification used) — ran the **entire** `schema.sql` end
to end with zero errors. Separately applied the pre-session `schema.sql` (without
`archived_at`) then the migration file on top, confirming it applies cleanly against a
live-like pre-migration state and is idempotent on re-run. Functional RLS test: two managers,
archived and active reports for manager 1, confirmed active-only and archived-only queries each
return the right person, confirmed an archived person is still fetchable by id, and confirmed
manager 2 sees zero of manager 1's reports (archived or not). Separately confirmed
`org_unit_people_rollup()` and `org_unit_capacity_rollup()` both exclude an archived report from
their counts. What's still unverified: the AI draft-with-AI calls (org-wide values and the
existing role-level draft) against a real Anthropic key, and the actual live migration run.

**Next step:** Run `database/migrations/2026-08-18_direct_reports_archive.sql` in the Supabase
SQL editor — nothing archive-related works live until it does. Then a live smoke test: archive a
person from People, confirm they drop off the roster/tiles/org counts/capacity, confirm their
person page and 1:1 history are still reachable directly, then unarchive and confirm they
reappear. Also worth clicking "Draft with AI" on the org-wide values block once against a real
company to sanity-check the prompt's output quality, same way Session 39 spot-checked the
role-level draft.

---

## Session 42 — 2026-08-18

**Goal:** Build Plan S4+S5 from `docs/TEAM_SETUP_UX_REVIEW.md` §6 (last of the four S1-S5
setup-UX sessions, see `docs/TEAM_SETUP_BUILD_SESSIONS.md`): make half-configured setup state
visible everywhere a person appears, and rename/consolidate the setup surfaces.

**What was done:**
- **`frontend/components/RolePicker.tsx` (new)** — `roleLabel()`, `orgUnitLabel()`,
  `groupRoleLevelsByFamily()`, `GroupedRoleSelect`, and `OrgUnitSelect` extracted out of
  `settings/page.tsx`, which is the only place they used to live. The direct-report page and
  Team roster cards both needed the identical "ladder-grouped role label" formatting this
  session, so page-local was no longer viable — `settings/page.tsx` now imports these from the
  shared module instead of defining them (behavior unchanged there; `CREATE_NEW_VALUE`/
  `UNGROUPED_LABEL` moved too). `QuickAddModal.tsx`'s own separate `groupRolesByFamily()`
  duplicate (Session 41) was **not** touched — out of scope for this session, noted as a future
  small cleanup.
- **`frontend/app/app/reports/[id]/page.tsx`** (F6) — the Expectations block now always renders
  instead of being absent when no role is assigned. No role: amber "No role assigned." plus an
  inline `GroupedRoleSelect` that calls `assignReportRole()` (preserving `org_unit_id`/cadence,
  same invariant the People picker relies on) then re-fetches the full report via
  `getDirectReport()` — the PUT response doesn't carry the `expectations` object (only GET
  attaches it, per `backend/routes/direct_reports.py`), so a local patch of `role_level_id`
  alone can't render the metrics/skills/values block correctly. Role assigned: unchanged
  behavior. The Assessment section's "Score them against their role's expectations" link now
  reads "Assess them" when no role is assigned (reworded, not hidden — the AI-draft-from-notes
  path still works without a role) and keeps the original phrase once one exists.
- **`frontend/app/app/team/page.tsx`** (F6) — roster cards get a role · team chip or an amber
  "No role" badge, reading Session 41's `getSetupStatus()` for the `has_role` boolean (never
  recomputed locally, per the plan) and resolving display text from `getDirectReports()` +
  `getRoleLevels()`/`getRoleFamilies()`/`getOrgUnits()` joined client-side by person id —
  `TeamMember` (from `getTeam()`) only carries the legacy `role_title`, which the chip no longer
  reads.
- **`frontend/app/app/org/page.tsx`** (F6) — Build-view unit cards (the default `/app/org` view;
  Chart/Rollup views weren't touched — scope call, flagged as a deviation below) show a member
  count ("3 people") next to the leader line, computed client-side from `getDirectReports()`
  grouped by `org_unit_id` — no backend endpoint needed, `DirectReport.org_unit_id` was already
  there. The count links to `/app/settings?section=people&unit={id}`. Blurb changed from
  "Departments and teams, and how they connect under {companyName}." to "Your teams and
  departments — the structure everything rolls up through," per the plan.
- **`frontend/app/app/settings/page.tsx`** (S5) — Roles & Levels and Expectations merged into one
  tab, **Roles & expectations** (`SectionId` drops `"expectations"`; `RolesSection` renders
  first, `ExpectationsSection` right below it inside the same `"roles"` tab, separated by a
  divider and an `id="expectations-block"` anchor). Every internal deep-link that used to call
  `setSection("expectations")` now targets `"roles"` (People's expectations-step deep-link and
  `onDraftExpectations`'s section switch); the People step's `handleStep` scrolls to
  `#expectations-block` after switching so a manager lands on the right half, not the top of the
  ladder cards. User-facing "Roles & Levels" copy renamed to "Roles & expectations" (nav label +
  blurb, the "add more levels" ladder-creation hint, Capacity's empty-state pointer); the
  Expectations section's own "no roles yet" empty state was rewritten to "add your first role
  above" instead of naming a now-nonexistent separate tab, since `RolesSection` renders directly
  above it now. Historical session-comment references to the old name were left as-is (this
  file's established convention — see Session 41's own comments still saying "Team").
  Additionally: `SettingsPage` now wraps a `SettingsFlow` inner component in `<Suspense>` and
  reads `?section=` and `?unit=` from `useSearchParams()` (same pattern as
  `reports/[id]/prep/page.tsx`) — `?section=people` opens the People tab directly, `?unit={id}`
  scopes the People roster to one org unit with a "Showing people in X · Clear filter" banner.
  This is what `/app/org`'s new member-count links land on.
- **`frontend/components/ZoneMap.tsx`** — reviewed, not touched. Its Foundation-zone "Settings"
  door already reads `getSetupStatus()` generically (Session 41) and doesn't name any Settings
  sub-section, and neither "Org" nor "Settings" nav labels changed this session — no stale copy
  found there to sweep.

**Verification:**
- `npx tsc --noEmit` — clean, no errors.
- Isolated `next build` (fresh `npm install` in a scratch copy of `frontend/`) — compiled
  successfully; `/app/settings` still prerenders as a static route despite the new
  `useSearchParams()` usage, confirming the `<Suspense>` wrapper is doing its job.
- Grepped the whole frontend for stale "Roles & Levels" / `section === "expectations"` /
  `SectionId` references post-edit — none outside historical comments in `settings/page.tsx`.
- **Not done live**: no access to the live deploy or a running backend from this session, so the
  "click-through of every renamed surface from the zone map" the plan asked for was done
  statically (link/query-param audit above) rather than by actually clicking through the app.
  Recommend a real click-through before calling S4+S5 fully closed.
- Migration: none — this session was frontend-only, matching the plan's expectation.

**Deviations from the plan / open items:**
- `/app/org`'s member count was added to the Build (tree) view only, not Chart or Rollup — the
  plan's example ("US Success · 3 people") didn't specify which view, and Build is the default/
  primary one. Extending to Chart is a small follow-up if Andrew wants it there too.
- `QuickAddModal.tsx`'s duplicate role-grouping helpers weren't folded into the new
  `RolePicker.tsx` — flagged above, not done, to keep this session's diff scoped to what the
  plan asked for.
- Assessments page's two "Add them in Settings" links (`app/app/assessments/[reportId]/
  page.tsx`) weren't changed to deep-link into `?section=roles` — outside this session's active
  file list, left alone.
- This session's changes were committed locally (`git commit`) but **not pushed** — the sandbox
  this session ran in has no network access for git operations (confirmed: `git fetch` returned
  a 403 from a proxy). Andrew needs to run `git push` from his own machine to get this live.

**Next step:**
All four S1-S5 sessions from `docs/TEAM_SETUP_UX_REVIEW.md` §6 are now built. Recommended next:
(1) `git push` this session's commit, (2) a real click-through of Settings, /app/team, /app/org,
and a role-less direct-report page against the live/dev deploy to close the "not done live" gap
above, (3) decide whether to fold `QuickAddModal`'s duplicate role-grouping helpers into
`RolePicker.tsx` and whether to extend `/app/org`'s member count to the Chart view.

---

## Session 41 — 2026-08-18

**Goal:** Build Plan S1 from `docs/TEAM_SETUP_UX_REVIEW.md` §6 (third of the four S1-S5
setup-UX sessions, see `docs/TEAM_SETUP_BUILD_SESSIONS.md`): rebuild Settings → Team as a
roster-first "People" section that walks people → teams → roles → expectations in one place —
progress header, inline creation of roles/teams from the pickers, and a fix for Quick add's
dead-end free-text Role field.

**What was done:**
- **`backend/routes/expectations_ai.py`** — extracted `_compute_coverage(supabase)` out of
  `get_coverage()` so it takes a bare supabase client (no auth dependency) and can be called
  from another route's handler without a second HTTP round-trip. `GET /coverage` is now a thin
  wrapper. Behavior unchanged.
- **`backend/routes/setup_status.py` (new)**, registered in `main.py` under `/api/setup-status`
  (single `GET ""` route — no sub-paths): per-person `{has_role, has_team,
  role_has_expectations}` (the last is `null`, not `false`, when no role is assigned — the
  roster chip needs to tell "no role" apart from "role has zero configured expectations") plus
  aggregate counts (`people_count`, `teams_count`, `roles_count`,
  `roles_with_expectations_count`, `people_without_role_count`, `people_without_team_count`).
  Reuses `expectations_ai._compute_coverage()` for the per-role "has expectations" check, per
  the plan's own note. `teams_count` reads `org_units` org-scoped (same list `GET
  /api/org-units` returns), not leader-scoped like the role-scoped-views rollups — every team in
  the org should count toward setup progress, not just ones the caller leads.
- **`backend/routes/direct_reports.py`** — `POST ""` already accepted `role_level_id`/
  `org_unit_id` (no change needed there — Session 6's original `DirectReportIn` had them from
  the start). Added a create-only `DirectReportCreateIn(DirectReportIn)` subclass with an
  `email: str | None` field, used only by `POST`, so the add-person row can take an optional
  email at creation time. Deliberately **not** added to the shared `DirectReportIn` that `PUT`
  uses: every existing PUT caller (`assignReportRole`/`assignReportOrgUnit`/
  `assignReportCadence` in `api.ts`) does a full `body.model_dump()` replace that omits fields
  it doesn't know about — if `email` were on the shared model, an omitted key would resolve to
  Pydantic's `None` default and silently wipe out an email set via the invite flow (`POST
  /{report_id}/invite`, which writes email with its own raw `.update()`, bypassing this model
  entirely). Keeping `email` create-only sidesteps that risk instead of requiring every PUT
  caller to remember to round-trip it.
- **`frontend/lib/api.ts`** — `createDirectReport()` gains `email`/`role_level_id`/
  `org_unit_id` params; new `SetupStatus`/`SetupStatusPerson` types + `getSetupStatus()`.
- **`frontend/app/app/settings/page.tsx`** — the biggest change:
  - Settings section renamed **People** (was "Team") and promoted to the second tab, right after
    Profile & Company (`SectionId` changed from `"team"` to `"people"`).
  - `PeopleSection` (was `TeamSection`) rebuilt roster-first: a `SetupProgressHeader` (four
    steps — people / teams / roles assigned / expectations covered — each a count pill that
    deep-links: people focuses the add-person input, teams opens the create-team modal, roles
    scrolls to and briefly highlights the first unassigned person, expectations switches to the
    Expectations section); the roster itself (name, role picker, team picker, an
    `ExpectationsChip` per row — ✓ green / amber "Draft expectations" deep-linking into
    Expectations' AI-draft flow for that exact role / amber "No role"); an add-person row at the
    bottom (name + optional email).
  - **Inline creation**: `GroupedRoleSelect` gained an optional `onCreateNew` prop — passing it
    adds a "+ Create new role…" option that opens `CreateRoleModal` instead of assigning
    (Expectations'/Capacity's existing callers don't pass it, so their plain dropdown behavior
    is unchanged). New `OrgUnitSelect` component is the team-picker equivalent with its own "+
    Create new team…" option opening `CreateTeamModal`. Both modals, when opened from a specific
    roster row, auto-assign the newly created role/team back onto that row after creation
    (`creatingRoleFor`/`creatingTeamFor` state holds the triggering row, or the literal string
    `"header"` when opened from the progress header's Teams step, which just creates without
    assigning). `CreateRoleModal` mirrors Roles & Levels' own "+ Add a new ladder" mechanic
    (creates a `role_family` + its L1 `role_level` together) so a role created from People shows
    up correctly as its own ladder, not an orphaned "Ungrouped" level.
  - **Expectations deep-link**: clicking a roster row's "Draft expectations" chip, or the header's
    Expectations step, needs to land on the Expectations section with the right role's AI-draft
    panel already open. `draftForRoleId` state was lifted to `SettingsPage` (same reason
    `expRoleLevelId`/`expKind` already live there — it has to survive the section swap that
    unmounts `ExpectationsSection`); `ExpectationsSection` gained an `initialDraftRoleId` prop
    consumed once in a `useEffect` that opens `DraftReviewPanel` then calls
    `onConsumeInitialDraft()` to clear it, so a later plain visit to Expectations doesn't
    reopen a stale draft.
  - `role_title` fallback hint: a roster row with no `role_level_id` but a non-empty legacy
    `role_title` shows `was: "Account Executive"` under the name (muted, not editable) — the
    column stays in the schema and un-migrated, per the plan.
- **`frontend/components/QuickAddModal.tsx`** — the F1 fix. The free-text "Role (optional)"
  input is replaced with the same grouped-by-ladder `<select>` + "+ Create new role…" mechanic
  as People's picker (duplicated locally as `groupRolesByFamily()`/`roleLabel()` — `settings/
  page.tsx`'s versions aren't exported, and this is a small enough duplication for one extra
  caller rather than promoting page-local helpers to a shared module). Selecting "+ Create new
  role…" swaps in an inline name field + Create button (same family+L1 mechanic as
  `CreateRoleModal`). `createDirectReport()` now sends `role_level_id` instead of `role_title` —
  **this UI path no longer writes `role_title` at all**, closing F1 (the free-text trap) for
  both entry points into the app (Quick add and People's add-person row, which never wrote
  `role_title` to begin with — only email, per the plan). Role levels/families are fetched once
  per modal open (fine at this scale, same posture as every other list fetch in this codebase).
- **`frontend/components/ZoneMap.tsx`** — the Foundation door's Settings state previously read
  only `profile.org_ready` (true the moment a manager saves Profile & Company once — a much
  lower bar than "setup is actually done"). Now reads `getSetupStatus()` and requires all four
  steps done (`people_count > 0 && teams_count > 0 && people_without_role_count === 0 &&
  roles_count > 0 && roles_with_expectations_count === roles_count`) before clearing the "not
  finished" warning — the same data People's progress header and roster badges read, so all
  three surfaces can't disagree about what "done" means. Falls back to the old `org_ready` check
  only if the `setup-status` fetch itself fails.

**Decisions made / locked:**
- `role_has_expectations` is `null` (not `false`) when a person has no role — the roster chip
  and any future consumer need to distinguish "nothing to check yet" from "checked and found
  nothing," same honesty convention Capacity's `off_hours_source: "logged" | "assumed"` already
  established in this codebase.
- Inline role/team creation always creates a *new* role_family+L1 or org_unit — there's no
  "search existing roles fuzzy-match" step. A manager with a near-duplicate role in mind still
  ends up merging it later via Roles & Levels' existing "Move to another ladder…" tool (Session
  40) — not rebuilt here, kept as the one designated place for that mechanic.
- `email` on create is fire-and-forget (no invite is sent) — it's stored for a future invite,
  the same manual-delivery posture Sessions 21/22 established; the add-person row doesn't try to
  also trigger `POST /{report_id}/invite` in the same step.
- People's progress header always shows all four steps, even before anything exists — a
  brand-new org shows "0 people · 0 teams · –/0 roles · –/0 expectations," which reads as the
  literal starting line of the golden path rather than an error state (the plan's "the flow *is*
  the empty state" note).
- Kept `SectionId`'s internal string values as short codenames independent of their display
  labels (`"people"` displays "People", `"roles"` displays "Roles & Levels") — consistent with
  how `"capacity"`/`"expectations"` already worked before this session.

**Verification:** `python3 -m py_compile` on every backend `.py` file; a real `main` import
(fresh venv, dummy Supabase/Anthropic env vars) confirming `/api/setup-status` registers
alongside the unchanged `/api/direct-reports`, 71 distinct route paths total, `app.state.limiter`
attached. A hand-rolled fake-Supabase-client functional test called `get_setup_status()` directly
with three seeded people (one fully wired, one bare, one with a role but zero configured
expectations) across two org units and two roles (one with a metric config, one without) and
confirmed every count and every per-person field matched by hand — including the
`role_has_expectations: null` vs `false` distinction. Frontend: fresh `npm install`, `npx tsc
--noEmit` clean (zero errors) across the whole project, `next build` clean (19/19 routes,
`/app/settings` at 11.9 kB). **Not done this session:** no live click-through against the
production Supabase database or a real browser (this cloud container has no route to either,
same standing caveat as every session since Session 21) — see the golden-path walkthrough note
below for what a live check should confirm. No new migration — `setup-status` and the
create-only `email` field both read/write existing, already-live columns.

**Golden-path walkthrough (code-traced, not live-clicked — flagging honestly rather than
implying a stopwatch was run against a real browser):** add fake person → role → team → AI-draft
expectations, per the plan's exit bar. Traced interaction count: Settings → People (1 click,
already the second tab) → fill name (+ optional email) → Add person (1 click, person appears in
roster immediately from local state, no refetch needed) → open that row's role picker → "+
Create new role…" → type a name → Create role (auto-assigns back to the row) → open the same
row's team picker → "+ Create new team…" → type a name → Create team (auto-assigns) → click the
row's now-amber "Draft expectations" chip → lands on Expectations with `DraftReviewPanel` already
open for that exact role → AI draft runs → review → "Add N expectations" commits. Roughly 10-12
clicks/keystrokes across three short text entries (person name, role name, team name), no page
navigation and no bounce to another Settings section except the one deliberate deep-link into
Expectations for the draft step. Comfortably under the plan's 5-minutes-per-person target by
interaction count alone; **Andrew should still run this live** on the deployed app to confirm
timing and that nothing about the real Supabase round-trips (AI draft latency especially) changes
that picture.

**Deviations from the plan:** none structural. Two additions beyond the literal text: (1) the
progress header's Teams step opens the create-team modal unconditionally rather than only when
`teams_count === 0` (a quick way to add another team from the header at any point, not just when
starting from zero) — the plan only specified this behavior for the empty-teams state; (2) an
"Editing levels within a ladder, or merging near-duplicate roles, still happens in Roles &
Levels" link was kept in People's intro copy (using the `onNavigateToRoles` prop the old
`TeamSection` already had) rather than being dropped, since ladder-level editing genuinely isn't
rebuilt here.

**Open item carried forward from Session 40:** `database/migrations/2026-08-18_role_families.sql`
still needs to run in the Supabase SQL editor before role_levels/role_families work live — this
session's new `/api/setup-status` endpoint also depends on it (it reads `role_levels` and, via
`_compute_coverage()`, the config tables) but adds no new migration dependency beyond what
Session 40 already required.

**Next step:** Run the Session 40 migration if it hasn't been already, then Session 4 of the four
(`docs/TEAM_SETUP_BUILD_SESSIONS.md`'s Session 4 prompt) builds Plan S4+S5 — visibility (always-
render expectations block, roster/org-page badges) and the naming/placement pass. After all four
land, Andrew brings the per-session reports back to the Cowork review session for a final pass
per the team_setup_ux_review project memory note.

---

---

## Archived sessions (compact index)

Each line below is the goal plus the key decisions locked in that session —
enough to know if it matters to what you're doing now. Full entries
(what was done, verification, deviations) are in
`docs/SESSION_HISTORY_ARCHIVE.md`, newest-first, unchanged from their
original text. Open that file when you need the full detail behind a
specific decision.

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
