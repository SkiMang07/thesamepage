# 1:1s — schedule, prep, the call, carry forward

The core product loop and the app's original IP. Backend: `routes/one_on_ones.py`.
Surfaces: `/app/1-1s`, `/app/reports/[id]`, `/app/reports/[id]/prep`,
`/app/reports/[id]/log`.

## Endpoints (`/api/one-on-ones`)

| Route | Notes |
|---|---|
| `GET`/`POST ""` | the log |
| `GET /overview` | per-report `is_due`, `days_since_last`, `cadence_days`, `cadence_source`, `planned_session`, `last_completed` — **the single canonical "who's due" computation**, backing `/app/1-1s` and the legacy Mission Control rollback; the action brief uses the same shared cadence resolver |
| `GET /open/{direct_report_id}` | current gathering, scheduled, or already-prepared occurrence |
| `POST /prep` | generates the prep sheet from reviewed workspace sources and attaches it to the current occurrence, or creates one |
| `PATCH /session/{id}/schedule` | edits an unfinished occurrence's date and 1–4 week repeat rule |
| `POST /wrapup` | notes → draft summary, commitments, and carry-forward topics |
| `GET`/`POST /{direct_report_id}/captures`, `DELETE /captures/{id}` | between-session capture notes |

`/overview` is declared before `/{id}`.

## Status is derived, never stored

`one_on_ones` has no status column. **Gathering** = the next-meeting workspace
exists while `scheduled_at`, `prep_guide`, and `summary` are null. **Scheduled**
= `scheduled_at` set while `prep_guide` and `summary` are null. **Planned** =
`prep_guide` set and `summary` null. **Completed** = `summary` set. One less thing
that can drift out of sync.

"Deferred" is deliberately not a tracked status — nothing in the app triggers it.

Every completed conversation leaves exactly one unfinished next-meeting
workspace, even when the next date is unknown. The person page treats it as the
single accumulating object for carry-forwards, captures, live commitments, and
current goal/development signals. `/app/1-1s` remains a triage surface: an
undated gathering workspace does not make a not-yet-due person look scheduled.
Gathering and scheduled occurrences open the source review; a planned occurrence
resumes the generated sheet. The person page's **Recent 1:1 sessions** card is
history only and renders completed/logged occurrences; the unfinished next
occurrence appears only in the dedicated Next 1:1 workspace.

## Scheduling and recurrence

`one_on_one_series` owns the repeat rule: manager, report, 1–4 week interval,
anchor timestamp, timezone, and active state. `one_on_ones` remains one row per
occurrence through `series_id` + `scheduled_at`. The composite foreign key
includes manager and report IDs, so an occurrence cannot be attached to another
manager's or another person's series even if a UUID is known.

The current UI schedules a **date**, encoded at noon UTC in the existing
`scheduled_at` timestamp so the date stays stable and the field can later carry
a real calendar start time. The browser timezone is already stored on the
series for that later integration. Copy says “Repeat this 1:1,” never “invite”:
The Same Page does not send a calendar invitation yet.

Logging always creates the next occurrence. A recurring occurrence gets its
date from the prior scheduled date plus the interval, never from when the
manager happened to log it; an ad-hoc occurrence leaves the next workspace
undated. If logging is late enough that one or more recurring occurrences are
already past, the rollover advances to the next future date instead of creating
stale shells. Removing repeat deactivates the series; dismissing its unfinished
occurrence also stops it.

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

Its own table rather than a draft column on `one_on_ones`, because captures can
happen with or without a scheduled series and accumulate independently between
meetings. The unfinished occurrence carries only manager-confirmed follow-up topics
from the prior wrap-up, not every quick jot added later.

Captures appear as one source on the next-meeting workspace. The review step's
notes textarea prefills from unconsumed captures, oldest-first and newline-joined.
Once agenda generation succeeds, every fetched capture is deleted — best-effort
and non-blocking on failure. Carry-forward topics do not masquerade as captures:
they live on the next `one_on_ones` occurrence itself.

## Prep

Preparation is **automatic assembly, deliberate synthesis**. Before calling AI,
the manager reviews the sources already attached or linked to the next meeting:
confirmed carry-forwards, captured notes, open commitments, and current at-risk
goal/development signals. Everything is included by default. Removing a
commitment excludes it from this agenda only; it does not mutate the live
accountability record. Recent meeting history remains grounding context rather
than posing as a removable suggestion.

Only after that review does `/prep` generate and persist the prep guide. This
keeps the agenda fresh instead of generating it immediately after the prior
meeting, before later captures and commitment changes exist.

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

Commitments render as editable review rows with owner and optional due date;
the manager can add or remove rows before saving.

The same review surface includes **Carry into the next 1:1**. AI may suggest
unresolved topics from the call notes, but they remain editable/removable and
are not saved until the manager confirms the whole wrap-up. They seed
`carry_forward_items` on the next occurrence whether that occurrence is
scheduled through a recurring series or remains an undated gathering workspace.

Open commitments are never copied into the next occurrence. They remain one
live accountability record and `/prep` pulls whatever is still open at
generation time. This prevents duplicate or stale commitment snapshots from
becoming a second source of truth.

Commitments are two-sided via `committed_by`, while `owner_id` stays the manager
as record-keeper so RLS is untouched. `dropped` is a first-class status distinct
from done, so accountability data stays honest.

`one_on_ones.notes` is visible to the writing manager only, enforced by RLS.
