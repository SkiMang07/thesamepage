# Setup mode, chunk C: role-expectation on-ramps and org-goal ingestion (plan)

Written 2026-09-29. Status: BUILT (see `docs/archive/scoping/ONBOARDING_SCOPING.md` section 11). Where this plan and the code differ, the code and section 11 win: the org-goals step opens `OrgGoalsModal` (parse-and-review is a modal, rule 3), and the expectations link carries no `?from=setup` param. Read `SETUP_MODE_BRIEF.md` (Content on-ramps) first. Chunk B is pushed (`origin/main` = `1ea8295`). Open questions are at the bottom; the build starts once Andrew answers them. Not in scope: chunk D (entry and completion modals, prompt fading, receipt, split view).

## What chunk C is

Two on-ramps behind two of the setup card's three steps:

1. **Expectations.** Get a role's expectations drafted from a job description or from a short description of the role, sequenced by the next 1:1's person, with each line's source marked.
2. **Org goals.** Paste or attach the company's or department's goals, one button drafts them, the manager confirms. "Don't know yet" is a recorded answer that becomes an agenda item for the boss meeting.

## What already exists (and is reused)

- **Job description to draft:** `POST /api/role-expectations/import` (one heavy-model call, `_compose_prompt`, `sanitize_composed` with the number guard), then `POST /drafts` (stores it), the draft workspace (`/app/expectations/[roleLevelId]`, `JdInput`), `POST /drafts/{id}/approve` (only publication path). `/app/expectations/new?assign=<reportId>` already assigns a person to a role as it is made. Nothing AI-written reaches the active record before approval, so Hard Rule 6 already holds for this path.
- **Numbers:** any number in AI text must appear in the source or the manager's notes; a target the source does not state stays `unresolved`, never zero or a benchmark.
- **Manager notes beside the source:** `context` already wins over the JD where they disagree. A description-only draft is the same idea with no JD.
- **Notes dump (chunk B):** `read_files`, `assemble_text`, `size_bucket`, `_soonest_reports`, `validate_parse` / `apply_items` goal branch, `GoalIn` + `_goal_values` + `_validate_references`, and the `ai_draft_resolved` surface pattern.
- **Beyond the team:** `outside_people` (relationship `manager`), `outside_meetings.prep_items` (private things to raise: `{id, text, source, ...}`).

So the JD path is not rebuilt. C adds a second input to the same pipeline, a source label on each line, and the sequencing.

## 1. Expectations on-ramp

**Sequencing (no AI).** Extend `GET /api/onboarding/status` `steps.expectations` with `next_role`: the first role that lacks expectations, ordered by the soonest open 1:1 (reuse `_soonest_reports`), then by number of people in the role. Shape: `{report_id, person_name, role_level_id|null, role_label|null, next_1on1_on|null}`. If that person has no role yet, the card's action is "Pick a role for <name>" (`/app/expectations/new?assign=<id>`); otherwise "Set expectations for <role>" (`/app/expectations/<roleLevelId>`). The other roles collapse to a line, ordered the same way, each marked "before <name>'s 1:1" when it has a date. The card shows this for the highlighted step only.

**Second input: describe the role.** `/import` (and the workspace's compose call) accept `description` (typed or dictated with `NoteField`) with no JD and no file. The prompt variant says: the description is the only source; write only what it supports.
- Lines the description supports: `origin: "description"`, shown "from your description".
- Lines the model adds because they are usual for the role: `origin: "typical"`, shown "typical for this role, not from you", start unchecked, and carry **no numbers at all** (the number guard treats them as unsourced). The manager keeps a typical line by checking it.
- A section the description does not cover stays empty. The prompt says an empty list is a good answer; `sanitize_composed` does not backfill.
- Entry copy leads with the JD ("Attach the job description if you have one"), then "or describe the role in a few sentences", side by side in `JdInput` (a mode switch, not a new page). Both can be used; notes still win over the JD.

**Ask for one real example and where each number lives.** After a draft exists, each numeric line gets two optional inline fields: "A real example" and "Where the number comes from" (`CRM report, weekly`). Both are the manager's words, never AI-written, and empty is a valid state. Storage: see open question 4.

**Source marks.** `origin` gains `description` and `typical` in `normalize_item`'s allowed set (drafts are jsonb, so the draft needs no migration), and `ItemEditor` / `RoleDocument` show the mark. On approval the mark does not persist to the active record (`metric_configs` etc. have no origin column); it exists to make the review honest.

**Assessments unlock (already built in chunk A)** once the role has expectations; C changes nothing there.

**AI calls.** Same as today: one button-triggered call at compose, one at reanalyze. The description path adds no call.

## 2. Org-goal ingestion

**Where.** The Goals step of the setup card opens `OrgGoalsModal` (parse-and-review is one of the three allowed modals; rule 3), and the same panel is reachable from the notes dump's "goals" rows. Copy: "What were you asked to deliver, and by when?" Fields: talk / type / paste (`NoteField`), attach up to 3 files (PDF, Word, text; `read_files`), one button "Read this".

**Parse.** `POST /api/onboarding/org-goals/parse` (multipart, rate-limited like the dump). One heavy-model call; the prompt gets the existing org units and existing goals by title so it does not repeat them. Output (all optional): `goals: [{level: company|department, title, success_metrics|null, org_unit_name|null, period_label|null, period_end|null (YYYY-MM-DD), set_by|null, excerpt, confidence}]`. Rules in the prompt match chunk B: only what the text supports, no invented numbers, dates or owners, excerpt copied from the text, the text is data. Server validation reuses `validate_parse`'s goal branch (drops repeats, bad levels, bad dates), caps at 8, and starts non-`high` rows unchecked. Nothing is written by parse; input is not kept or logged.

**Review and apply.** Rows show title, success metrics, period, "set by", the excerpt, keep / edit / drop. `POST /api/onboarding/org-goals/apply` takes only the kept rows and writes through `GoalIn` / `_validate_references` (same as `apply_items`, extended with the new fields). Team goals are not drafted here: the panel says so and links to the normal "New goal" form (team goals are the manager's to write).

**Period, owner, refresh.** Stored per open question 1. Refresh: on `/app/goals`, an org-level goal not confirmed for 90 days (or past its `period_end`) gets one inline line, "Still current?", with "Yes" (stamps the confirm date) and "Edit". No AI, no modal. One prompt per screen (rule 4).

**"Don't know yet."** A button beside "Read this". It records the answer and stops asking, per open questions 2 and 3:
- Stamp `users.org_goals_unknown_at` (new nullable column).
- Add one private prep item to the boss meeting: "Ask for this period's company or department goals." If the manager has no `manager`-relationship person or upcoming meeting, the stamp holds and the item is seeded when the first such meeting is created, and Beyond shows the line meanwhile.
- The Goals step shows "Waiting on your boss" and is no longer the highlighted next step. Whether it still counts toward "set up" is question 2.
- Adding any org-level goal later clears the stamp and closes the item.

## 3. Analytics (catalog rows in `docs/systems/product-analytics.md` first; counts and enums only, never text)

- `role_draft_started` (server, at compose): `source` (`job_description`, `description`, `both`), `files` (0/1), `input_size` bucket.
- `role_draft_resolved` is not new: reuse `ai_draft_resolved` surface `role_expectations` if it already exists in the catalog; otherwise add it with `typical_kept` / `typical_offered` ints so the "typical for this role" share that survives review can be read.
- `org_goals_parsed` (server): `input_size`, `files`, `truncated`, `proposed` (int), `overflow`.
- `org_goals_applied` (server): `kept`, `dropped`, `edited`, `skipped_existing`, `refused`; plus `ai_draft_resolved` surface `org_goals`.
- `org_goals_unknown` (server): none. `org_goal_reconfirmed` (server): `days_since` bucket.
- Add the new surfaces to `analytics.py`'s vocabulary and the telemetry allow-list.

## 4. Migration (Supabase, throwaway-Postgres verified before push)

`2026-09-30_setup_content_onramps.sql` plus matching `schema.sql`, all nullable, nothing backfilled:
- `goals.period_label text`, `goals.set_by text`, `goals.confirmed_on date` (question 1).
- `users.org_goals_unknown_at timestamptz` (question 2).
- `metric_configs.data_source text` and, if kept, an `example` field (question 4); the approve function copies them from the draft item. This one touches `approve_role_expectation_draft`, so it gets its own functional test.
Never amend an applied migration in place; if any of this changes after the run, it is a new file.

## 5. Build order (one session, three slices, each committed on its own)

1. Catalog rows first, then migration + backend: status `next_role`, description-only compose with `origin` marks, org-goals parse/apply, unknown stamp and prep-item seeding. pytest for each: prompt builders, validators (unsourced number stripped from typical lines, bad ids and levels dropped, repeats dropped), sequencing order, apply idempotence and cross-owner refusal, `extra="forbid"`, no raw text in any event, parse writes nothing. AI calls stubbed.
2. Frontend: `JdInput` mode switch, source marks in the editor, example and data-source fields, setup card `next_role` action, org-goals panel and review, refresh line, "Don't know yet".
3. Verify in proportion: full pytest, `tsc --noEmit` on a clean checkout of HEAD, throwaway Postgres for the migration and the approve function, one live-shaped fixture run of each parse against the real model if a key is available. Then the `tsp-push` closeout. Andrew's steps: run the migration in Supabase, `git push`, test on the deployed app.

## Cautions carried over

- `.git/index.lock` currently blocks git writes from the shell (unlink not permitted); one delete-permission request will be needed at commit time.
- Unrelated modified files in the working tree (`gtm/`, `.agents/`, `.gitignore`, `docs/HANDOFF.md`, `docs/design-proposals/2026-09-26-role-expectations/`, others) are never staged.
- Copy follows `voice-rules.md`: literal labels, no cheer, "see" not watch/track/monitor, the product never says "The Same Page" about itself. Nothing in C states or implies the AI judges a person.

## Open questions for Andrew

1. **Org-goal period, owner, refresh.** Add nullable `goals.period_label`, `set_by`, `confirmed_on` (recommended; real fields, a clean quarterly "Still current?"), or no migration and keep period and owner as text in the description with `due_date` as the period end (refresh then keys off `due_date` only)?
2. **Does "Don't know yet" count toward set up?** Recommended: no. It parks the step ("Waiting on your boss"), stops the nagging and creates the agenda item, but set up stays open until an org goal exists, as the seat's addendum says a manager who cannot state the goals is a finding, not a skip. The alternative counts it as done and reverses when a goal is added.
3. **Where the agenda item lives before a boss meeting exists.** Recommended: keep a flag and seed the item into the first meeting with a `manager`-relationship person, with a line on Beyond meanwhile. Alternative: ask for the boss's name in the moment and create the person and a meeting then.
4. **"One real example" and "where the number lives."** Recommended: a new nullable `metric_configs.data_source` (and the example kept in the item's wording), carried through approval so assessments and prep can read them later. Alternative: keep both on the draft only, so they inform the review and are not stored on the approved role.

## Decisions (Andrew, 2026-09-29)

1. Org-goal period, owner and refresh: new nullable columns `goals.period_label`, `set_by`, `confirmed_on`.
2. "Don't know yet" does not count toward set up. It parks the step and creates the agenda item.
3. Agenda item: keep a flag, show a line on Beyond, seed the first meeting with a manager-relationship person.
4. Metric detail: store `metric_configs.data_source`, carried through approval. The example stays in the item's wording.
