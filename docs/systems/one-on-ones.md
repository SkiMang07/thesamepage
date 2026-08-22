# 1:1s — prep, the call, wrap-up

The core product loop and the app's original IP. Backend: `routes/one_on_ones.py`.
Surfaces: `/app/1-1s`, `/app/reports/[id]`, `/app/reports/[id]/prep`,
`/app/reports/[id]/log`.

## Endpoints (`/api/one-on-ones`)

| Route | Notes |
|---|---|
| `GET`/`POST ""` | the log |
| `GET /overview` | per-report `is_due`, `days_since_last`, `cadence_days`, `cadence_source`, `planned_session`, `last_completed` — **the single canonical "who's due" computation**, backing `/app/1-1s` and the dashboard zone map |
| `POST /prep` | generates the prep sheet |
| `POST /wrapup` | notes → draft log |
| `GET`/`POST /{direct_report_id}/captures`, `DELETE /captures/{id}` | between-session capture notes |

`/overview` is declared before `/{id}`.

## Status is derived, never stored

`one_on_ones` has no status column. **Planned** = `prep_guide` set, `summary`
null. **Completed** = `summary` set. One less thing that can drift out of sync.

"Deferred" is deliberately not a tracked status — nothing in the app triggers it.

The person page lists planned sessions alongside completed ones with a status
badge, and a planned row clicks straight back into the resumed prep sheet. The
header CTA becomes "Resume prep sheet →" whenever a planned session exists — the
fix for "I lost my prep sheet" has to be reachable from the primary action, not
just from a list item further down.

## Cadence

`resolve_cadence_days()` in `utils.py` is the **single canonical resolver**:
per-report override (`direct_reports.one_on_one_cadence_days`) → org default
(`organizations.one_on_one_cadence_days`, itself defaulting to 21) → hardcoded 21.

It returns `(days, source)`, not a bare int, so the UI can label which rule
applied — the same honesty convention capacity uses for logged-vs-assumed off
hours. Don't compute cadence anywhere else.

## Capture notes

`dr_capture_notes` — a small between-sessions inbox per direct report ("she seemed
frustrated about scope creep"), manager-scoped with flat `manager_id = auth.uid()`
RLS.

Its own table rather than a draft column on `one_on_ones`, because a capture can
happen before any planned session exists, and today a planned `one_on_ones` row is
only ever created *by* `/prep` — attaching to it would mean inventing a
"draft planned session with no prep_guide" state nothing else models.

**Consumption is entirely in `/prep`:** step 1's raw-notes textarea prefills from
the report's unconsumed captures, oldest-first and newline-joined, when opening a
fresh prep flow (skipped on `resumeId`). Once `handleGenerate` succeeds, every
fetched capture is deleted — best-effort and non-blocking on failure. That's the
"lands on the next prep sheet" mechanic end to end, with no new backend
computation.

## Prep

Output shape is `situation_summary` + `agenda_items[]`, not flat Q&A lists. Each
agenda item renders as a collapsible card: rationale as italic subtext, suggested
questions as an indented list. **The closing question is mandatory and always the
last agenda item.**

The prompt is assembled by `_build_prep_prompt()` from, in order: role
expectations, the Context Engine block (see `context-engine.md`), then the
manager's raw notes.

**Expectations are grounding context, not an agenda.** `_format_expectations_block()`
explicitly instructs the model *not* to audit every expectation in one 1:1. This
restraint is the template every other AI prompt in the app copied.

`/prep` is the only Context Engine call site today, and it's rate-limited.

## The call

The in-call screen is two-column on desktop: prep sheet left, a sticky live "Call
notes" pane right. The screen open *during* a 1:1 has to answer both "what should
we cover" and "what's actually happening" without navigation.

## Wrap-up

**Always draft-then-review.** The extracted summary and commitments render on an
editable review screen before anything saves. Commitments are accountability
records; a hallucinated one costs trust in the entire product.

New commitments on the log step split by newline — the simplest UX, avoiding a
dynamic "add another" form.

Commitments are two-sided via `committed_by`, while `owner_id` stays the manager
as record-keeper so RLS is untouched. `dropped` is a first-class status distinct
from done, so accountability data stays honest.

`one_on_ones.notes` is visible to the writing manager only, enforced by RLS.
