# Assessments (`/app/assessments`)

A manager's assessment of one direct report against their role's configured
expectations, over an explicit period — normally quarterly or biannual, or
off-cycle when there's a reason. It supports performance-review conversations;
it is not a weekly rating tool, so nothing here goes "stale" and nobody is ranked.

**AI leads the preparation; the manager owns the judgment.** AI brings the
period's records together, asks what's missing, drafts against each item's own
scale and discusses it. Every value that is recorded was set or explicitly
confirmed by the manager. Manual assessment is the same flow without AI proposals.
(For Assessments this supersedes the app-wide "AI is an optional assist"
convention in `docs/DESIGN.md`; draft-then-review still binds — see
`docs/decisions/ai-drafts-never-saves.md`. Why the flow is shaped this way:
`docs/decisions/assessments-are-period-assessments.md`.)

Backend: `routes/assessment_reviews.py` (the flow), `assessment_evidence.py`
(evidence gathering, not a route), `routes/assessments.py` (levels, team list,
per-person scorecard reads). Frontend: `/app/assessments` (overview),
`/app/assessments/[reportId]` (start / resume / history), 
`/app/assessments/[reportId]/[reviewId]` (the flow and the completed view),
components in `components/assessments/`, period presets in
`lib/assessment-periods.ts`. Design reference:
`docs/design-proposals/2026-09-25-assessment-directions/ai-led-flow/` (v2 sketches).

## Data model

| Table | What |
|---|---|
| `performance_reviews` | **The period assessment.** Activated 2026-09-25. One row per manager × report × period. `status` `draft` → `completed`; `stage` picture / draft / review; `mode` ai / manual; `cadence`, `period_start`, `period_end`, `review_period` (readable label); `evidence` (gathered records + coverage), `picture`, `manager_context`, `excluded_evidence`, `include_private`, `draft` (per-item proposals, decisions, revisions, narrative, summary), `conversation`; `completed_snapshot`, `completed_at`, `reviewed_at`, `rating_ordinal`, `summary`; `version` (optimistic lock). `is_shared_with_report` stays false. |
| `assessments` | Overall `level_ordinal` rows. Completion writes `source_type = 'performance_review'`, `source_id` = the assessment. |
| `skill_assessments`, `value_assessments` | Per-item points, each on its config's own scale; `performance_review_id` set by completion. |
| `metric_entries` | Real readings with a measurement period; `performance_review_id` and `notes` set by completion. |
| `assessment_levels` | Org 1–5 overall scale, auto-seeded on first use. |

At most **one open draft per manager and report** (partial unique index). Earlier
rolling-scorecard rows stay as history and still count as the latest rating until
a completed assessment supersedes them; the UI labels them "not a period assessment".

The latest-rating readers are unchanged: `GET /api/assessments` (team list, now
also `last_review`, `open_review`, `latest_from_review`, and `reviews` — every period assessment
newest first with its `rating_label` and, for completed ones only, the confirmed
`headline` read from `completed_snapshot`), `GET /api/assessments/{id}`
(scorecard, now also `last_review` / `open_review`), the person page's Growth card,
Mission Control, Scribe context and development suggestions all read the same tables,
and only completion writes to them. Both reads fail soft if `performance_reviews`
hasn't been migrated.

## The overview (`/app/assessments`)

One card per person, never ranked. The card shows the open draft (a three-step
bar and Resume), else the last completed assessment (its confirmed headline and
overall, Open assessment, Start another), else a legacy rating labelled "not a
period assessment", else nothing yet. Every card ends in a **year strip**: the four
quarters ending with the one a quarterly assessment would cover today
(`stripQuarters` / `buildYearStrip` in `lib/assessment-periods.ts`). A quarter is
filled when a completed assessment covers at least half of it, an amber ring when
a draft does; a biannual fills two joined dots, a shorter off-cycle assessment is a
small diamond in the quarter it ended in, and a legacy rating is a hollow dot in an
otherwise empty quarter. Empty quarters are neutral grey, never overdue. A single
line above the cards counts completed / in progress / not started for that quarter.

## The flow

1. **Check the picture.** Starting gathers evidence for the period and AI writes a
   short account: headline, contributions (each must cite a record or it is
   dropped), where impact is less clear than activity, gaps, and at most two
   consequential questions. A period with nothing on record gets an honest "little
   on record" state without an AI call. The manager answers "What's missing or
   needs context?" or takes "Nothing to add". Confirming context approves the
   *inputs* to drafting, never a rating. Records can be left out of this assessment
   (the records themselves are untouched).
2. **Draft & discuss.** AI proposes a judgment per item (point on the item's own
   scale, or for a metric a value + period) and a separate overall judgment, with a
   reason, cited sources and what the evidence doesn't establish — or leaves the item
   unassessed with a reason. "Worth your attention" leads with the items that need
   thought and says why (the proposal's own stated limits, differs from the prior
   judgment, rests only on manager context, changed by a redraft, a revision waiting)
   — never a confidence score or rating severity. Every judgment stays inspectable
   below with scale meanings visible. The manager edits directly or discusses (one
   item or the whole assessment); AI revisions are stored as visible proposals with
   Apply / Keep current and change only that item.
3. **Review & complete.** One page shows the summary (AI-written from the included
   judgments, or the manager's own, or none), every included judgment with its reason
   and support, what stays unassessed with prior context, and the limits. An explicit
   checkbox + Complete records the whole displayed set — no per-row approval ritual.
4. **Completed view.** Rendered only from `completed_snapshot`: overall, overview,
   contributions to recognize, supported strengths, where more observation would help,
   the reviewed conversation opener, the limits, and a disclosure with every
   expectation, scale meaning, reason, source and the coverage table. Links to the
   Relationship Desk and Growth (`/app/reports/{id}?view=growth`). The receipt is a
   secondary disclosure.

## Rules the code enforces

- **Decisions are the manager's.** Each item has `proposal` (AI, read-only),
  `decision` (what will be recorded, with `origin`: ai, ai_confirmed, manager,
  ai_revision, reaffirmed) and `revision` (pending AI suggestion). A redraft updates
  untouched AI decisions (flagged "changed") and turns a new proposal for anything
  the manager decided into a revision, never an overwrite.
- **Each scale stays its own.** Points outside an item's scale are rejected at draft
  and at edit. The overall is chosen independently, never averaged.
- **No invented metrics.** A drafted metric value must match a recorded reading for
  that config or a number the manager literally stated (context or discussion
  message); otherwise the item is unassessed ("No recorded reading"). Completion
  requires a value and a measurement period. Confirming a reading already on record
  for that period does not log it twice. Metrics can't be "reaffirmed" from an
  earlier reading.
- **Prior ratings are context.** Inputs never start from them. Reaffirming a prior
  skill/value/overall for this period is an explicit action and is recorded as such.
  Untouched items are not re-logged.
- **Staleness is explicit.** Changing context, exclusions, private opt-in or the
  period after a draft marks it (`flags.context_changed`); completion waits for a
  redraft or "Keep the draft as it is". Changing a judgment after the summary marks
  the summary stale; completion waits for a refresh or the manager's edit. A pending
  revision blocks completion.
- **Concurrency and resumption.** Every manager write carries the draft `version`;
  a mismatch is 409 and the page reloads rather than overwriting. AI results merge
  onto the latest row. Draft writes don't fire the app's records-changed event.
- **Completion** goes through `complete_performance_review()` (SQL, security
  invoker): refuses a stale version, writes overall/skill/value/metric rows and marks
  the row completed in one transaction, and returns an already-completed assessment
  unchanged, so a retried Complete never duplicates. The client sends a per-draft
  `client_request_id` (sessionStorage). Nothing is shared, scheduled or written to
  goals, notes, commitments, agendas or development plans.
- **Failures are recoverable.** Picture, draft, discussion and summary failures are
  stored on the draft with retry and manual paths; nothing entered is lost.

## Evidence (`assessment_evidence.py`)

All reads use the caller's RLS client and are scoped to manager + report. Each item
carries a timing (in period / context / background), a date, an attribution and a
short ref (`S1`…) used in prompts; sources the model cites are mapped back to ids.

| Source | Included | Dates | Notes |
|---|---|---|---|
| 1:1 write-ups (`summary`) | Yes | meeting date (`meeting_date_of`) | Up to 3 earlier ones as labelled background |
| Commitments about the person | Yes | completed / due / created in period | Says who owed it; open-overdue and dropped shown as such |
| Individual goals + check-ins | Yes | check-in `created_at` | Goal = standard (context); check-ins = evidence, incl. measure readings |
| Projects assigned to them + check-ins | Yes | check-in `created_at` | Labelled "assigned — who did which part is not recorded" |
| Metric readings | Yes | `recorded_at` | The only source of metric values besides the manager's own numbers |
| Development plan | Background | training completion date | Never performance evidence |
| Private 1:1 notes, capture notes, secondhand notes from Beyond | **Off by default** | meeting / created | Per-assessment opt-in; every item labelled private |
| Team meetings, Knowledge documents, team messages, outside tools | Not included | — | No reliable person link; shown as "Not included" in coverage |

Coverage states: included, none found, off (private), not included, couldn't read.
"No records" and "retrieval failed" are never the same answer.

## Endpoints (`/api/assessments/reviews`, registered before `/api/assessments`)

`GET ?direct_report_id=` (list), `POST` (start; returns the open draft with
`resumed: true` instead of creating a second), `GET /{id}`, `DELETE /{id}` (drafts
only), `PATCH /{id}` (period, cadence, context, exclusions, private opt-in, stage,
mode, narrative, acknowledge context change), `POST /{id}/gather`, `POST
/{id}/picture`, `POST /{id}/draft`, `POST /{id}/items/{key}` (set, unassessed,
accept/keep proposal, reaffirm prior, apply/dismiss revision), `POST /{id}/discuss`,
`POST|PUT /{id}/summary`, `POST /{id}/complete`. AI routes are rate-limited; all AI
calls go through `ai_core.generate_text`.

## Verification

`backend/tests/test_assessment_reviews.py` (period/source scoping, private opt-in,
scales, metric rules, edit preservation, revisions, resumption, stale versions,
completion blockers, retry safety, reaffirm, consumers).
`frontend/lib/assessment-periods.test.mjs` (`npm run test:assessments`). The SQL
function, the one-draft index and RLS were exercised against local Postgres from
both a fresh `schema.sql` and the previous schema + migration.

## Known limits

- The prompts have not been evaluated against the live model or real manager data;
  there is no eval harness for these four call sites yet.
- Reopening or correcting a completed assessment is not supported; an off-cycle
  assessment is the way to record a later view.
- Team meetings and Knowledge documents are not person-linked, so they are reported
  as not included rather than mined.
