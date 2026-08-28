# 1:1s — schedule, prep, the call, carry forward

The core product loop and the app's original IP. Backend: `routes/one_on_ones.py`.
Surfaces: `/app/1-1s`, `/app/reports/[id]`, `/app/reports/[id]/prep`,
`/app/reports/[id]/log`.

## Endpoints (`/api/one-on-ones`)

| Route | Notes |
|---|---|
| `GET`/`POST ""` | the log. `POST` takes a manager-confirmed `meeting_date`, and `separate_occurrence` for "this was not the meeting I have prep saved for" |
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

## The meeting date

`scheduled_at` **is the meeting date**, planned or backfilled, past or future,
encoded at noon UTC. Status derives from `summary` alone, so a past date never
makes an occurrence look upcoming — the same rule `team_meetings` states in
`schema.sql`. `logged_at` is when the write-up was saved. `created_at` is row
creation and is never a meeting date: an ad-hoc log completes a workspace that
already existed, so its `created_at` is whenever that shell happened to be made.

`utils.meeting_date_of()` is the **single canonical resolver**, with
`meeting_day_of()` and `meeting_sort_key()` beside it. Nothing reads the columns
directly, the same discipline `resolve_cadence_days()` holds for cadence.
`_serialize_session()` publishes `meeting_date`, so the frontend renders one
field rather than choosing for itself. History sorts by the meeting date because
it displays the meeting date; `/overview` picks the latest completed occurrence
by meeting date; Mission Control counts conversations *held* this week.

See `docs/decisions/meeting-date-is-scheduled-at.md` for why this is not a third
date column.

Every completed conversation leaves exactly one unfinished next-meeting
workspace, even when the next date is unknown. The person page treats it as the
single accumulating object for carry-forwards, captures, live commitments, and
current goal/development signals. `/app/1-1s` remains a triage surface: an
undated gathering workspace does not make a not-yet-due person look scheduled.
Gathering and scheduled occurrences open the source review; a planned occurrence
resumes the generated sheet. On the person page, the visible workflow is
**Review & prepare → Start 1:1 → Wrap up & log**. The secondary **Log a 1:1**
path remains for a conversation that happened without preparation. The
**History** context renders only completed/logged occurrences plus resolved
commitments; the unfinished next occurrence appears only in the dedicated next
conversation workspace.

The `/app/1-1s` index is a relationship-oriented launcher, not a second person
workspace. It renders one alphabetized, searchable row per active report with
the last completed date, the next scheduled/prepared state, and server-derived
due truth. Selecting a row opens a read-only orientation preview: role, exact
next-conversation state, the prepared situation summary when one exists, and at
most one manager-confirmed carry-forward cue. The preview hands off to the exact
prep sheet or the canonical person page. Full history, commitments, cadence
settings, and detailed notes stay on that person page so the two surfaces cannot
drift into competing records.

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

Once the sheet exists, the person page's next-conversation card renders it —
situation summary plus the agenda item titles — rather than the gathering
sources that produced it. It has to: preparing **consumes** those sources, since
generation deletes the captures it folded in. A card that only knew about
carry-forwards, live suggestions and captures therefore went *emptier* the
moment a manager prepared, and a fully prepped conversation could report
"Nothing gathered yet." The empty state now belongs to the gathering and
scheduled states alone. Rationale and suggested questions stay on the prep sheet
itself; the card carries the titles.

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
editable review screen before anything saves. That screen also carries the
**meeting date**, prefilled from the prep sheet on the prepared path and from
the Log a 1:1 page on the ad-hoc one, and editable on both — it is the shared
surface, so neither entry point can save a conversation without a date the
manager saw. Commitments are accountability
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

## Logging a conversation that was not prepped

**Log a 1:1** asks for the meeting date, because it is the path most likely to
be used days after the conversation.

It also asks *which* conversation, but only when there is something to get
wrong. Logging normally completes the person's current unfinished workspace, so
an ad-hoc log does not strand it or open a second record of the same
conversation. When that workspace has a prep sheet on it, completing it would
throw the prep away and file the conversation under the upcoming meeting's date,
so the page offers the choice: **That meeting** sends the occurrence id and
completes it, **A different one** sends `separate_occurrence` and logs its own
occurrence while the prepped workspace keeps its prep, its series and its date.
Either way the confirmed carry-forward topics land on whichever occurrence is
still open. A gathering or merely scheduled workspace holds no work worth
protecting, so nothing is asked.
