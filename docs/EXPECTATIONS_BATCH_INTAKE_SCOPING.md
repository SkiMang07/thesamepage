# Batch expectations intake — scoping

Status: scoped 2026-09-30, not built. Source of findings:
`business/digital-customers/personas/02-eng-manager-scaling/sessions/2026-09-30-batch-intake-test.md`.

## Goal

Fill role expectations for several roles from one input (typed, spoken, or
attached documents) without dropping numbers the manager states, and without
spending more model calls than the input needs.

## Decided (Andrew, 2026-09-30)

- Role drafts run **in the background** after the batch is applied.
- When an attached document disagrees with the job description, the job
  description wins **and the conflict is shown to the manager** as a question.
- The AI rule holds: drafts are saved unapproved; nothing is approved for the
  manager. The number guard stays; it recognises more real numbers, not fewer rules.

## Step 1 (done, uncommitted)

`numbers_in()` in `role_expectations.py` recognises spelled-out numbers
("two working days", "under two a quarter", "about six a week"). A bare "one"
counts only as a count ("one a week"), never as a pronoun ("no one",
"one-on-one"). Tests in `test_role_expectations.py`.

## Three input paths, routed in code (no model call decides the route)

| Input | Path | Model work |
|---|---|---|
| Job description for a role | Parse: `POST /expectations/import` as today | 1 call per role. Anchored to quotes, no invented lines. Test whether the LIGHT model holds quality before switching. |
| Typed or spoken description of several roles | Generate: new `expectations` group in `notes_dump.py`, then the per-role drafter in `mode="description"` | The batch read already happens (1 call); the new group adds no call. Then 1 drafter call per role that has a statement. Roles the manager said nothing about get no call and no draft. |
| Job description plus other documents | Parse with supplements: `/import` with labelled supplementary documents | Same 1 call per role. |

### Path 2 details

- The batch read returns, per role, a statement and verbatim source excerpts.
  Excerpts must be substrings of the input (same check the other groups use).
- The drafter's context is the **verbatim excerpts**, not the model's
  paraphrase, so a number can only come from the manager's own words.
  Any number in a displayed statement that is not in the input is stripped
  with `strip_unsupported`.
- Apply order: role assignments first (roles must exist), then drafting is
  queued per role that has a statement.
- Existing open draft on a role (e.g. Sofia's working draft): never replace.
  New lines arrive as suggestions on it, as `create_draft` already does for
  approved roles.

### Path 3 details

- Today `_CONTEXT_RULES` says the manager's notes beat the job description on
  any disagreement. Keep that for the manager's own typed or spoken notes
  (their word on what the role is now). Attached **documents** are a second,
  lower tier: the job description wins; a document adds detail only where the
  job description is silent.
- New optional "anything to ignore?" field, passed to the prompt as an
  explicit instruction. Not inferred from prose.
- A disagreement between a document and the job description becomes a question
  (topic `other`, why: "Your job description and <document> disagree") with
  both quotes. Numbers from both are in the allowed set so the question passes
  the number filter.
- Attached extra files are read with the existing file reader and labelled
  `[Document: name]` in the prompt.

## Background drafting

- The Railway worker (`jobs/worker.py`) is parked, ticks every 15 minutes,
  uses the service-role client and is built for overnight batches. Wrong fit
  for "ready in a minute or two", and hard rule 1 forbids service-role on a
  user path. Do not use it.
- Use FastAPI `BackgroundTasks` on the API, with the manager's authenticated
  client. Bounded concurrency (3 at a time) for Anthropic rate limits.
- State lives on the draft row, no migration: insert the
  `role_expectation_drafts` row first with `analysis.status = "drafting"`,
  then `composed` or `failed`. A row `drafting` for over 5 minutes is shown as
  failed with a Retry (covers a redeploy mid-run).
- UI: per role "drafting" -> "ready to review" in the setup flow; failed shows Retry.
- To check before building: where the frontend reads `analysis.status`
  (a new value must not break it), and the `/import` 10/minute limit versus a
  batch of up to ~10 roles.

## Verification

Unit tests for validation and the new group; number-guard tests with the
monologue's real phrases; `tsc --noEmit` on a clean checkout of HEAD; no schema
change so no migration. Then push and rerun the Dana monologue on the live app:
expected result is role drafts with Andre's weekly status and Lena's quarterly
priorities captured as targets, all unapproved.

## Not in scope

Lighter-model switch for path 1 (measure first); changing the 4 decisions the
JD path raises; approving anything for the manager.
