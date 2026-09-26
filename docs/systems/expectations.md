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
  `analysis`, and an optimistic-lock `version`. `status` open → approved/discarded.
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
kept. First use shows a single "Start with one role" prompt.

**Define a role** (`/app/expectations/new`). Paste or upload (PDF, .docx, .txt,
.md) a job description. `POST /import` makes one AI call: placement proposal
(attach / new ladder / existing level, validated server-side by `roles_import`'s
helpers) plus a first draft and at most three focused questions. The manager
confirms title, level and ladder; an existing ladder+level opens that role instead
of creating a second one. `?family=` pins a ladder; `?assign=` assigns a person
(Settings → People's "Define it from a job description"). "Start without a draft"
skips AI. The JD text is never lost on failure.

**Role page** (`/app/expectations/[roleLevelId]`):
- *Open draft* → the workspace: collapsible source JD, the editable document by
  section, and the coaching panel. Actions: **Save & reanalyze**, **Review for
  approval →**, **Save & finish later**, discard. Unsaved edits warn on leave.
  "Reuse expectations from another role" copies approved items in as editable copies.
- *Approved, no draft* → the standard in use, open decisions with "Resolve in a
  revision", and "Refine expectations".
- *Nothing yet* → start from the JD (saved one prefilled), another role, or blank.

**Review** (`…/review`). The complete content that will become active, Edit links
back to each field, every open detail with "Bring this back" dates, what's parked,
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
  in the job description, the current draft or the manager's answers
  (`numbers_in` / `strip_unsupported`); sentences with any other number are
  removed and noted. A composed target survives only if its exact quote is in the
  source and its numbers are in the quote; otherwise the item is numeric with an
  unresolved target. A scanned PDF with no text layer yields no numbers at all.
  Suggested targets must trace to the source or the manager's answers.
- **Every missing target is explicit.** A numeric responsibility without a target
  always carries a system question (independent of the AI). It closes only by
  writing the target or making the item unmeasured — never by dismissing it.
  Approval requires each one to have a deferred decision with a date (checked in
  Python and again inside the SQL function).
- **Questions need an outcome before approval:** answered, parked with a date, or
  "Not needed". Deferral always goes through `POST /drafts/{id}/defer`, so there is
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

## Endpoints (`/api/role-expectations`)

| | |
|---|---|
| `GET /overview` | ladders, levels, people, status, Needs review, Coming back, company values |
| `GET /roles/{id}` | open draft (if any), approved items, people, values, open decisions |
| `POST /import` | JD → placement + composed draft + questions (AI, 10/min, nothing saved) |
| `POST /drafts` | open or resume the role's draft; composed items re-validated server-side |
| `PUT /drafts/{id}` | save (items; answers and open/answered/dismissed) |
| `POST /drafts/{id}/analyze` | save, then reanalyze (AI, 10/min) |
| `POST /drafts/{id}/defer` | park a question until a date |
| `POST /drafts/{id}/suggestions/{sid}` | accept or dismiss one suggestion |
| `POST /drafts/{id}/copy` | copy another role's approved items in |
| `POST /drafts/{id}/discard` | discard; approved expectations untouched |
| `POST /drafts/{id}/approve` | approve the whole role (422 lists what still needs a decision) |

Every draft write carries `version`. The older `/api/expectations/draft`,
`/api/expectations/{kind}/batch` (still used for company values) and
`/api/roles/import/draft` endpoints remain but no screen writes role-level
expectations through them any more.

## Verification

`backend/tests/test_role_expectations.py` covers the number guard, composed-draft
and reanalysis sanitizing, system target questions, save rules and approval
problems. The migration, RLS isolation, the approval transaction (including
rollback on a mid-approval failure), retirement, consumer reads and the full UI flow
were verified end to end against local Postgres with fictional fixtures and a
scripted model. Real-model output quality is checked by running an actual job
description through the flow.
