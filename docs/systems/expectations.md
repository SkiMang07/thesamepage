# Roles & expectations (`/app/expectations`)

What good looks like for every role, at every level: what the role owns and the
results it's accountable for, the skills it takes, and any role-specific values,
with meets (and optionally exceeds) wording. Everything downstream — 1:1 prep
grounding, development, assessments, the person page, Scribe — reads the
**approved** expectations through one helper.

Its own item in the sidebar's Workspace group, beside Org and Knowledge. Settings
keeps a link-out entry; `/app/settings?section=roles` redirects here.
Design: `docs/design-proposals/2026-09-26-role-expectations/` (`BUILD_BRIEF.md`,
`prototype.html`; its example data is fictional).

Backend: `routes/role_expectations.py` (the flow), `routes/settings.py` (role level
and company-value CRUD), `routes/role_families.py`, `routes/expectations_ai.py`
(coverage, org-values draft, legacy draft/batch endpoints). Frontend:
`app/app/expectations/` (overview, `new`, `[roleLevelId]`, `[roleLevelId]/review`),
`components/expectations/`.

## Data model

Approved expectations live where they always did — one row per item, attached to a
`role_levels` row (a level on a `role_families` ladder):

| Plain-language section | Stored as |
|---|---|
| Responsibility measured by a number | `metric_configs` (+ `target`, `target_status`, `target_source`, `target_quote`, `measurement_period`) |
| Responsibility judged by observation | `skill_configs`, `area = 'responsibility'` |
| Skill / observable behavior | `skill_configs`, `area` null or `'skill'` |
| Role-specific value | `value_configs` with `role_level_id` |
| Company value | `value_configs` with `role_level_id IS NULL` — defined once, applies to every role |

Name → `*_name`, what they own → `description`, meets → `expectation` (values:
`description`), exceeds → `exceeds` (optional; never required). Scales and scale
definitions are untouched.

**Targets.** `target_status = 'set'` carries the target as the manager or the job
description stated it (`target_source`, with the exact source quote). `'unresolved'`
means there is deliberately no target yet: `target` is null — never zero, never a
benchmark — and it is excluded from numerical evaluation. `null` is a row configured
before this workflow; any target it has lives in its wording, and nothing forces a
question about it.

**Retired rows.** When an approved revision drops an item, its row gets
`retired_at` instead of being deleted, so assessment history keeps its foreign
keys. Every reader filters `retired_at IS NULL`.

**Working layer** (`database/migrations/2026-09-26_role_expectation_drafts.sql`):

- `role_expectation_drafts` — one open draft per role level (partial unique
  index). `kind` `new` (no approved expectations yet) or `revision` (approved
  expectations stay in use meanwhile). Holds `source_text`/`source_label` (the JD as
  supplied), `items` (the plain-language document), `questions`, `suggestions`,
  `analysis` (which also carries `context`, the manager's notes — see Define a
  role), and an optimistic-lock `version`. `status` open → approved/discarded.
- `role_expectation_decisions` — a detail the manager chose to come back to: role
  level, the item (`item_key`, which becomes the config id on approval), topic,
  question, `follow_up_on` date, status deferred → resolved/dropped. Survives
  approval.

Both are org-scoped (`org_id = current_org_id()`), like `role_levels`. Existing
roles, assignments, values and configs needed no data migration and stay active.

## Screens

**Overview.** *Needs review* leads, only when something is actionable: an
unapproved draft, a revision awaiting approval, or an approved role whose open
decision has reached its date. Each opens the exact question (`?focus=`). Decisions
not yet due sit in a quiet *Coming back later* list. Ladders group their levels with
who holds them and a plain status (approved / no expectations yet / draft /
revision); healthy roles aren't styled as warnings. *Manage ladders* swaps in
`LadderManager` (create/rename/delete ladders, add levels above or below, edit a
level title, move a level to another ladder — the merge — and delete). Company values
are listed once with add/edit/remove and an AI suggestion that saves nothing until
kept. First use shows a single "Start with one role" prompt. After an approval
(`?notice=approved&role=`), the notice names who holds the role and how many
expectations their next prep sheet measures against (from `counts`;
`lib/expectations-notice.ts`); a role nobody holds gets the plain wording.

**Define a role** (`/app/expectations/new`). Paste or upload (PDF, .docx, .txt,
.md) a job description, and optionally add notes in "What the job description
doesn't say" (typed or dictated; the box stays when a file is attached). Job
descriptions are often out of date — written before a promotion — or generic;
the notes say what's true now. **Where the notes and the job description
disagree, the notes win** (title and level included), and a target stated in the
notes is a stated target (`target_source` `manager`). The notes are kept on the
draft as `analysis.context` and go into every reanalysis. `POST /import` makes one AI call: placement proposal
(attach / new ladder / existing level, validated server-side by `roles_import`'s
helpers) plus a first draft and at most three focused questions. The manager
confirms title, level and ladder; an existing ladder+level opens that role instead
of creating a second one. `?family=` pins a ladder; `?assign=` assigns a person
(Settings → People's "Define it from a job description"). "Start without a draft"
skips AI. The JD text is never lost on failure.

**Supporting documents** (optional, up to five, PDF/.docx/text, 25MB combined;
read by `notes_dump.read_files`, labelled `[Document: <name>]` in the prompt)
can go beside the job description, plus an optional "Anything to ignore?" field
passed to the prompt as an explicit instruction (never inferred from prose).
Documents need a job description, inform only that one composition and are not
stored; the form says so. They rank **below** the job description, which ranks
below the notes: a document adds detail where the job description is silent.
The tier is enforced in `sanitize_composed`, not only in the prompt: a
document's numbers join the allowed set through `extra_numbers_text` (so a stated
figure can stay in wording), but `corpus_text` stays the job description, so a
target quoted from a document lands unresolved and a `source_quote` from one
resolves to `None`. `target_source` still means the JD (`source`) or the notes
(`manager`) — there is no third value. `/import` returns `document_numbers`, which
`POST /drafts` takes back so its re-check keeps those figures in wording (like a
manager edit, it can keep a number in prose, never set a target). Where a document
disagrees with the job description the model reports it under its own
`conflicts` key; `conflict_questions` verifies the JD quote against the job
description and the document quote against that document's text, drops any it
can't verify, and mints each as a question (`topic` `other`, no item, both quotes
in `why`, a short ask in `question` carrying no document-only number) with its own
cap of 3 outside the three-question budget.

**Role page** (`/app/expectations/[roleLevelId]`):
- *Open draft* → the workspace: collapsible source JD (with the manager's notes above it), the editable document by
  section, and the coaching panel. Actions: **Save & reanalyze**, **Review for
  approval →**, **Save & finish later**, discard. Unsaved edits warn on leave.
  "Reuse expectations from another role" copies approved items in as editable copies.
- *Approved, no draft* → the standard in use, open decisions with "Resolve in a
  revision", and "Refine expectations".
- *Nothing yet* → start from the JD (saved one prefilled) plus notes, another role, or blank.

**Review** (`…/review`). The complete content that will become active, Edit links
back to each field, every open detail with "Bring this back" dates (and, with two or
more open, one "Come back to all of these on" date for the lot), what's parked,
and one explicit confirmation + **Approve** for the whole role.

## Rules the code enforces

- **Drafts never publish.** Saving, reanalyzing, deferring and accepting
  suggestions only touch the draft. `approve_role_expectation_draft()` (SQL,
  security invoker) is the only path to the config tables: it writes every item
  (updating rows in place by id, inserting new ones), retires dropped items, binds
  and resolves decisions, stores the JD on the role and marks the draft approved in
  **one transaction**. A stale version is 409; any failure writes nothing; a retry
  after success returns the approved draft unchanged.
- **Never invent a number.** Every number in AI-proposed text must already appear
  in the job description, the manager's notes, the current draft or the manager's
  answers (`numbers_in` / `strip_unsupported`); sentences with any other number are
  removed and noted, and a question's `why` (or a suggestion's) that carries one is
  cleared. A composed target survives only if its exact quote is in the source
  (`target_source` `source`) or the notes (`manager`) **and the target text is a
  span of that quote** (`is_span_of`: both sides through `_canon_numbers`, which
  lowercases, collapses whitespace and rewrites digits and spelled numbers alike to
  one value, so "2 working days" is a span of "within two working days"; whole
  tokens only, so it is not a span of "12 working days"). A span can't carry a
  number the quote doesn't make, and a cadence with no digit ("weekly written
  status") can be a target. Otherwise the item is numeric with an unresolved
  target. A scanned PDF with no text layer yields no numbers of its own — only the
  notes' numbers count. Suggested targets must trace to the source, the notes or the
  manager's answers.
- **Every missing target is explicit.** A numeric responsibility without a target
  always carries a system question (independent of the AI). It closes only by
  writing the target or making the item unmeasured — never by dismissing it.
  Approval requires each one to have a deferred decision with a date (checked in
  Python and again inside the SQL function).
- **Only a missing target blocks approval.** Any other open question is optional:
  approving parks it 30 days out (the same persisted decision as "Bring this back"),
  and the review page says so. Otherwise a question ends answered, parked with a date,
  or "Not needed". Deferral always goes through `POST /drafts/{id}/defer` (one question) or
  `/defer-many` (every listed open question on one date, one draft write and version
  bump; unknown ids are skipped, 404 only if none match, at most 40), so there is
  always a persisted return path. Follow-up is date-based only — the one trigger the
  app can honor.
- **Reanalysis preserves the manager's wording.** It saves first, then adds
  questions and separately reviewable suggestions (rewrite a field, set a target,
  add an item); it never edits an item. Answers, parked decisions and dismissed
  suggestions are kept and fed back so they aren't asked again. A failed analysis
  stores `analysis.status = 'failed'` on the saved draft and offers retry.
- **Company values aren't copied into roles.** Composed value items matching a
  company value are dropped.
- **Revisions don't disturb the active standard.** Approved expectations stay in
  use until the revision is approved; open decisions on the role come into the
  revision and resolve there.

## Consumers

`fetch_role_expectations()` in `routes/direct_reports.py` is the one reader:
approved, non-retired configs plus company values. Person page, 1:1 prep, the
assessment scorecard, development and Scribe all go through it — **add a new
consumer through this helper.** The prep prompt and the assessment draft prompt
state a set target, or say plainly that no target is set and none may be assumed;
the assessment flow shows "No target set" on a metric and freezes target status in
`completed_snapshot`. Completed assessments render only from their snapshot, so
later approvals never rewrite them; an assessment still in draft reads the current
approved standard.

`GET /api/expectations/coverage` (setup status, Settings readiness) counts
non-retired rows.

## Description mode and provenance

With no job description or file, `POST /import` treats the manager's notes
(`context`, min 40 characters) as the only source. The model marks each line's
`origin`: `description` ("from your description") or `typical` ("typical for this
role, not from you"); `jd`, `notes` and `manager` are unchanged. The server
enforces the rest: at most 3 typical lines, forced judged, no number, target or
quote, and they are saved as suggestions (why: "Typical for this role, not from
you.") rather than draft items; accepting one keeps the mark. Numeric
responsibilities also carry `data_source` (where the number lives; stored on
`metric_configs.data_source`) and an optional `example`, which approval folds
into the description as a last "Example: ..." line. Every composed draft emits
`role_draft_composed` (counts and enums only).

## Batch intake (several roles from one input)

The notes box (`NotesDumpModal`, `routes/notes_dump.py`) also proposes, per person
the input describes, a role expectations row: their role (a cited level, their
current one, or a new `{job_role, job_level}` with the level editable on the
review row) and a one-line statement. It is the primary action of the setup
card's expectations step while that step is highlighted and some role in use has
neither approved expectations nor a draft; the per-role route is the secondary
link. Once drafts are waiting, **Review N drafts** (to `#needs-review`) is the
step's action instead, naming whose drafts they are, with "Describe the rest in
one go" and the per-role link as secondary only while undrafted roles remain.
`GET /api/onboarding/status` carries `drafts_to_review`, `review_people` and
`drafts_writing` for roles in use that aren't approved, and its queue leaves out
roles with an open draft. The step still completes only when every role in use
is **approved**: a draft is not yet a standard.

- **Slices.** `intake_slices.slice_by_person` cuts the typed text into
  per-person verbatim slices in code: a sentence goes to the one person it
  names and the ones after it follow; several names go to each and end the run; a
  sentence that leads with a pronoun and names someone else goes to no one; one
  where the pronoun comes first and the name is further in ("I need her to help
  Noor") goes to the current person only, never the named one, and ends the run; one
  that names someone first and has a pronoun after goes to no one and ends the run;
  a paragraph break ends the run unless the paragraph was
  a bare name; anyone else named (roster or `unmatched_people`) ends it too.
  Sentences said of a group ("Everyone…", "The other six…", "The rest…", "Both of
  them…", "They each…") go to every person in that group and follow until someone is
  named; a stated head count must match or the sentence is left out. People on one
  role share those lines once in the draft context, and `shared_by_person` lets the
  review show which lines are said about a group. The slice picks the defaults
  (which sentences a role row may tag, who a sentence is about); what a draft stores as
  `analysis.context`, and the only `context_text` the drafter's
  `sanitize_composed(mode="description")` sees, is the sentences tagged About the
  role (see Placement), so allowed numbers and quote provenance are per person.
  Never the whole input. Files never go back to apply and are never stored. A
  caller that sends no tags gets the slice itself (the pre-placement path; the
  browser always tags).
- **The manager's side is held back.** `intake_slices.for_drafting` removes, in
  code, the sentences in a slice that are the manager's own side:
  a commitment ("I owe her quarterly priorities", "I said I'd write him a growth
  plan", "mine", "on me", plus lines that only continue it, like "Asked two weeks
  ago, waiting on her") and the 1:1 rhythm (a 1:1 plus a cadence or duration:
  "Weekly 1:1, thirty minutes"). A sentence that also states something of the
  report ("I'd want a weekly written status from him", "his side is", "he
  should", anything naming an expectation) is never held back. The drafter reads
  the rest, so held-back sentences can't become items, their numbers leave the
  allowed set and their quotes can't resolve. As a backstop, an item whose
  source or target quotes a held-back sentence is dropped
  (`expectations_batch.drop_manager_side`). The stored `analysis.context` stays
  the full slice, the manager's words; the composed draft's notes list what was
  left out. The review row shows what the draft reads, the held-back lines, and
  a statement cleaned the same way (`clean_statement`: no number outside what
  the draft reads, no sentence repeating a word pair only a held-back line has,
  no 1:1 rhythm). The parse and description prompts also say this, but the
  code is what enforces it.
- **A promise is never also an expectation.** The wording patterns above only
  find a promise phrased the way they expect ("I owe", "mine"); a paste in
  fragments ("Meets versus exceeds talk after calibration. Not raised.") passes
  them. So the lane is also decided by provenance, in code
  (`intake_slices.sourced_by`, `echoes_commitment`, `split_lapses`;
  `notes_dump.separate_statement`). A sentence of a person's slice that one of
  their proposed commitments cites is held back from the draft and shown on the
  review row as a promise (`promises`; the browser echoes them on apply, they are
  stored as `analysis.promises`, and the draft's notes list them). The row's
  statement drops any clause that shares three content words with one of that
  person's commitments, in either direction. A clause that says what happened to a
  standing ask ("stopped after two") is history, not an expectation: it leaves the
  statement with the ask it followed, and the pair is proposed as one unchecked
  commitment the person owes (`commitments_for_lapses`). A sentence that states
  something of the report ("he should", "expect") is never treated as a promise.
  Known edge: with neither the wording nor a commitment row to cite, nothing marks
  a manager-side sentence.
- **A row says only what is about that person.** Who a sentence is about is the
  slicer's call, never the model's. In `finish_expectations`, a row's statement
  keeps a sentence only if `intake_slices.from_own_slice` passes it: it names no
  one else on the team unless the person's slice names them too, and at least half
  its content words are in the slice. The row's excerpt must be in the person's
  slice or it is dropped (the row stays). When unsure the line is left out, so
  "help Noor get ready for exec QBRs" (Odalys's) never shows on Noor's row. A row
  with no slice (only attached files behind it) is not checked.
- **What the manager owes becomes a commitment.** The same read proposes a
  "What you owe people" group: one row per thing the manager says they owe a
  person, as a short editable action ("Share quarterly priorities with Lena").
  When the model misses a held-back commitment, code adds it verbatim
  (`commitments_for_held_back`; a promise said twice is one row; one the model
  already gave anyone is not added again, since a sentence lands in the slice
  of whoever it names; the 1:1 rhythm is never owed; only a stated promise
  ("I owe", "I promised", "I said I'd") is added, never a loose "I have to ask"
  or "that's on me", which stay held back but are not proposed, because every
  proposed row is pre-checked). The review says "You edited this. Your notes
  said" on a row whose text the manager changed. Kept rows save as open commitments the manager owns
  (`committed_by = 'manager'`, `source_type = 'manual'`, no migration), not
  duplicated when an open one with the same words exists for that person; the
  prep sheet and the person page already list open commitments. They used to
  be proposed as notes, and the 2026-09-30 Dana rerun lost all three to the
  five-note cap.
- **Placement: a draft reads only what is tagged About the role**
  (`intake_placement.py`, `lib/notesDumpPlacement.ts`). Filtering a slice by how the
  manager worded things let lapses ("he did twice and then he just stopped"), the
  manager's own account ("I joined two. That's rescuing, not coaching.") and orphan
  fragments through. So the decision is a tag, not a filter. Every promise, kept
  thought, role line and pasted sentence is one item with a lane (You owe, They
  owe you, About the role, Private thought) and a person (or "Not on my team",
  which saves nothing); the review shows both as chips on every row, the model's
  pick is the default, nothing is required, and moving a row regroups it live.
  - *Role lines.* The parse prompt has the model name `evidence` per role row: up
    to six sentences copied from the notes that say what is expected. Code keeps
    those that are in the person's slice and drops any that another row cites (a
    promise or a kept thought), any lapse, any manager-side line or private
    admission, and any sentence the manager leads with "I" or "my" unless it also
    states what they expect of the person
    (`intake_placement.role_sentences`, `notes_dump.assign_role_sentences`). They
    come back as the row's `role_sentences`; a row with none is not preselected
    to draft. With no `evidence` the row's one excerpt stands in.
  - *Apply.* `role_sentences` on an expectation row is what the manager left
    tagged. The server cuts each from the typed text itself
    (`verbatim_sentences`; an altered or invented one is dropped), joins them with
    blank lines as `analysis.context`, and drafts from exactly that. An empty list
    is skipped in `not_drafted` ("Nothing is tagged as about X's role"). Moving a
    promise or thought to the role tags `sentences`, the typed sentences its
    excerpt covers, never the model's rewording. "About the role" needs a kept,
    unblocked role row for that person from the same read; otherwise the row says why
    and saves nothing.
  - *Unplaced.* Every sentence of the typed text that no shown row cites is
    listed as `unplaced` (up to 60; headings and one-word fragments are not
    offered), judged after the caps so a row cut by a cap gives its sentences
    back. Each carries the one roster person it names, if any; a bare "he" is
    left for the manager. They start unchecked and save nothing until placed.
  - The wrong default is still possible: the model proposes the lane, and a
    wrong one the manager does not notice still saves. This makes the leak one
    tap to fix, not impossible. Required fields on every row were rejected: they
    turn an 8 to 9 minute skim into 14 or more decisions.
- **Review budgets.** Everything per person has its own budget, so a bigger
  team never loses rows to a shared cap: expectations (`CAP_EXPECTATIONS`, 15),
  what the manager owes (`CAP_COMMITMENTS`, 20), and notes and role/team rows
  (`CAP_PEOPLE`, 30 each; notes show the soonest 1:1 first). Only new teams or
  departments and goals share the old cap (12 total, 5 each). Apply accepts the
  same sizes. The one read has room for a large team (`PARSE_MAX_TOKENS`
  12,000, `PARSE_TIMEOUT` 180 s): a 15-person monologue used ~3,300 output
  tokens in ~21 s, and a cut-off answer would fail the whole review.
- **Apply order.** Create the level if new (deduped on `job_role` + `job_level`,
  `role_family_id` null, so it lands Ungrouped), assign the person, then insert
  an open draft with `analysis = {status: "drafting", source: "batch", run,
  started_at, context, statement}`. At most 5 roles per apply (422 before any
  write); rows kept without a draft get role and assignment only and come back
  in `waiting` for a second pass. Every kept row is judged, drafted or not: a
  role with an open draft or approved expectations, or a person with no typed
  text (judged when the text is sent), is skipped in `not_drafted` with the
  review row's own reason, never put in `waiting`, so the receipt never offers
  "Draft the next" for it. Someone kept without a draft whose role is drafted in
  the same apply from someone else's part is skipped too ("shares X's role").
  A second pass that asks anyway is refused server-side and the existing draft
  is untouched (the one-open-draft index backs this up).
- **Background.** One `BackgroundTask` (`expectations_batch.draft_in_background`)
  runs up to 5 rows on a 3-thread pool with the request's authenticated client.
  Each run claims its row (version bump, `started_at` reset), calls the model via
  `_call_model` with 429 backoff, and writes `composed` or `failed` only if the
  version is unchanged. A `drafting` row older than 5 minutes (its own
  `started_at`) is presented as `failed`; `POST /drafts/{id}/redraft` re-queues
  it from the row alone. While `drafting`, save/analyze/copy return 409, the row
  is not in Needs review, and the role page and overview poll until it lands.

## Endpoints (`/api/role-expectations`)

| | |
|---|---|
| `GET /overview` | ladders, levels, people, status, Needs review, Coming back, company values |
| `GET /roles/{id}` | open draft (if any), approved items, people, values, open decisions |
| `POST /import` | JD (+ optional documents, ignore instruction) → placement + composed draft + questions + conflicts (AI, 10/min, nothing saved) |
| `POST /drafts` | open or resume the role's draft; composed items re-validated server-side |
| `PUT /drafts/{id}` | save (items; answers and open/answered/dismissed) |
| `POST /drafts/{id}/analyze` | save, then reanalyze (AI, 10/min) |
| `POST /drafts/{id}/defer` | park a question until a date |
| `POST /drafts/{id}/defer-many` | park several open questions on one date, one write |
| `POST /drafts/{id}/suggestions/{sid}` | accept or dismiss one suggestion |
| `POST /drafts/{id}/copy` | copy another role's approved items in |
| `POST /drafts/{id}/discard` | discard; approved expectations untouched |
| `POST /drafts/{id}/redraft` | re-queue a failed or stale batch draft from its stored slice (AI in background, 10/min) |
| `POST /drafts/{id}/approve` | approve the whole role (422 lists what still needs a decision) |

Every draft write carries `version`. The older `/api/expectations/draft`,
`/api/expectations/{kind}/batch` (still used for company values) and
`/api/roles/import/draft` endpoints remain but no screen writes role-level
expectations through them any more.

## Verification

`backend/tests/test_intake_placement.py` covers role tags, verbatim cutting, the
unplaced list, and the apply and parse routes with tags (run `npm run
test:notes-dump-placement` in `frontend/` for the lane and person logic).
`backend/tests/test_intake_slices.py` and `test_expectations_batch.py` cover
slicing, the expectations group, role creation and dedupe, apply order, the
background state machine, retry, cross-contamination between people, and who
owes what (the manager's side held back, skipped roles never `waiting`), with
the Dana persona monologue as the fixture. `test_onboarding.py` covers drafts
waiting on the setup card.
`backend/tests/test_role_expectations.py` covers the number guard, composed-draft
and reanalysis sanitizing, system target questions, save rules and approval
problems. The migration, RLS isolation, the approval transaction (including
rollback on a mid-approval failure), retirement, consumer reads and the full UI flow
were verified end to end against local Postgres with fictional fixtures and a
scripted model. Real-model output quality is checked by running an actual job
description through the flow.
