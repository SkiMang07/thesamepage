# 1:1s — schedule, prep, the call, carry forward

The core product loop and the app's original IP. Backend: `routes/one_on_ones.py`.
Surfaces: `/app/1-1s`, `/app/reports/[id]`, `/app/reports/[id]/prep`,
`/app/reports/[id]/log`.

## Endpoints (`/api/one-on-ones`)

| Route | Notes |
|---|---|
| `GET`/`POST ""` | the log. `POST` takes a manager-confirmed `meeting_date`, and `separate_occurrence` for "this was not the meeting I have prep saved for". Returns `meeting`, `next_session`, the `commitments` actually inserted, and the cleaned `carry_forward_items` — see "Logging is all-or-nothing" |
| `GET /overview` | per-report `is_due`, `days_since_last`, `cadence_days`, `cadence_source`, `planned_session`, `last_completed` — **the single canonical "who's due" computation**, backing `/app/1-1s` and the legacy Mission Control rollback; the action brief uses the same shared cadence resolver |
| `GET /open/{direct_report_id}` | current gathering, scheduled, or already-prepared occurrence |
| `POST /prep` | generates the prep sheet from reviewed workspace sources and attaches it to the current occurrence, or creates one. `opening_line` omitted keeps the occurrence's; null clears it |
| `PATCH /session/{id}/schedule` | edits an unfinished occurrence's date and 1–4 week repeat rule |
| `POST /wrapup` | notes → draft summary, commitments, carry-forward topics, and an `opening_line` for the next 1:1 |
| `GET`/`POST /{direct_report_id}/captures`, `DELETE /captures/{id}` | between-session capture notes |

`/overview` is declared before `/{id}`.

The worker's overnight prep (`backend/jobs/nightly_prep.py`) is not an
endpoint; see "Prepared overnight" below.

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
resumes the generated sheet. On the person page, the primary action is
**Review & prepare**, or **Start 1:1** once a sheet exists; the secondary
**Log a 1:1** path remains for a conversation that happened without
preparation. The page's layout is described under "The Relationship Desk"
below. Its past-conversations timeline renders only completed occurrences; the
unfinished next occurrence appears only in the next-conversation surface.

The `/app/1-1s` index is a relationship-oriented launcher, not a second person
workspace. It renders one alphabetized, searchable row per active report with
the last completed date, the next scheduled/prepared state, and server-derived
due truth. Selecting a row opens a read-only orientation preview: role, exact
next-conversation state, the prepared situation summary when one exists, and at
most one manager-confirmed carry-forward cue. The preview hands off to the exact
prep sheet or the canonical person page. Full history, commitments, cadence
settings, and detailed notes stay on that person page so the two surfaces cannot
drift into competing records.

## The Relationship Desk (`/app/reports/[id]`)

Identity (name, role, team, person notes, a privacy line), then four views:
**Relationship** (default), **Work**, **Growth**, **Private notes**. Person
settings (cadence override, capacity, time off) open in a drawer. The selected
design is `docs/design-proposals/2026-09-25-relationship-continuity/`.

Relationship reads top to bottom:

- **Last → next conversation**, one surface. The latest completed summary's own
  opening sentence (never a rewrite) opens the full summary in the timeline
  below. The next occurrence shows its date — or "No date set" plus the cadence
  truth with the rule that produced it; cadence due is never shown as a date —
  its repeat rule, and a passed-but-unlogged date says so. Unprepared, it shows
  the first carried topic with the rest behind a disclosure; prepared, the saved
  sheet's situation summary and first agenda titles, and any captures kept
  since. A sheet the worker prepared is badged "Prepared overnight" with a
  line asking the manager to review it before starting. An unprepared
  occurrence with a kept opening line shows it first ("Open with"). Compact disclosures show kept thoughts (removable), work check-ins,
  suggested signals and the open-commitment count. **Date & repeat** links to
  `/prep#schedule`, which focuses the canonical date control; on an existing
  workspace that control now saves on change, through the same schedule write.
- **Keep a thought** directly below: one field, one explicit save to the capture
  endpoint. Text clears only after the server confirms; failures keep it.
- **Follow-through** beside it: open commitments grouped by owner (You, then the
  person), three rows each with a count-accurate expansion, ordered earliest due
  first with undated last. Each row opens its source (see below), done / drop,
  and a resolved list with reopen.
- **Current work / Growth direction** previews: the most relevant live goal or
  project with its latest check-in, and the saved plan's opening sentence.
- **Past conversations**: completed occurrences newest first, each with its
  summary's opening, the count of commitments linked to it, and the full
  reviewed summary on expansion. Search filters the fetched summaries only.

Work-update evidence says "since the last 1:1" only when a prior meeting date
exists; otherwise it labels itself "latest recorded". It is read-only and never
added to the agenda. Every section loads independently; a failed source is named
and never passes as an empty state.

### Commitment sources

`GET /api/commitments` returns `source_type` and `source_id` as stored (and can
filter by them). The desk resolves a 1:1 source only against history it could
read for this manager and person: a source that doesn't resolve shows as "no
longer available", never guessed. Per-conversation counts use those links only.
Manual, goal, project, team-meeting and outside-meeting sources are labelled as
such.

### Logging is all-or-nothing, and ends in a receipt

The log writes the meeting first, then inserts every reviewed commitment in one
statement, then rolls the next occurrence. If anything after the meeting write
fails, `_undo_partial_log()` deletes the inserted commitments and either deletes
an inserted occurrence or returns the completed one to unfinished (summary,
notes, `logged_at`, date restored), then answers 500. A retry therefore
completes the same occurrence once, rather than 404ing or filing the
conversation twice. The compensation is best-effort, not a database
transaction.

The review screen blocks double submission. On an error it checks history for a
completed meeting with the exact submitted summary logged since the save began
— the save that succeeded but whose response was lost — and treats that as
saved instead of inviting a duplicate. Otherwise the review stays intact.

On success it returns to `/app/reports/[id]?logged=<meeting id>` with the save
result held in memory (`lib/one-on-one-receipt.ts`). The receipt shows the
reviewed summary, the commitments the server inserted, the confirmed carried
topics, and the resulting next occurrence (or that the prepared one was kept).
It renders only when the meeting is in this manager's fetched history. After a
reload it is rebuilt, for the latest conversation only, from persisted records:
the meeting and its linked commitments; carried topics are not recorded against
a past meeting and are not reconstructed. If the page's refresh fails after a
successful save, the receipt says so and offers a re-read, never a re-log.
Dismissing it removes the query parameter. Decisions stay in the summary.

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

### Prepared overnight

Every unfinished occurrence dated today or tomorrow with no sheet is prepared
in the night by the background worker (`docs/ENGINEERING.md` → Background
worker), for managers on an active plan or trial and never for archived people.
It reads what the source review would include by default: the occurrence's
carry-forwards and opening line, every capture (oldest first, as the notes
prefill), open commitments, up to three at-risk goals and the development
plan's opening (the same lines `lib/one-on-one-workspace.ts` derives), recent
history, role expectations and Context Engine documents. It goes through the
same `assemble_prep_inputs()` / `parse_prep_output()` / `build_prep_guide()`
as `/prep`, sent through the Batch API.

The result is saved only if the occurrence still has no sheet and no summary,
checked again in the write itself, so a manager who prepares by hand in the
meantime always wins. A reply that doesn't parse into an agenda saves nothing.
Once saved, the captures the prompt read are deleted (their text is now the
sheet's `source_notes`), and any kept later stay. `prep_guide` records
`prepared_by` (`manager` | `overnight`), `prepared_at`, and for overnight
sheets `drew_on`, the plain list the sheet shows ("Prepared overnight · Drew on
1 carried topic, 2 open commitments, … · Rebuild"). Rebuild is "Edit prep":
the source review, with everything the worker read, then a normal generate.
The existing "Prep ready" surfaces (`/app/1-1s`, Mission Control's "Review
Jordan's saved 1:1 prep") light up without change.

See `docs/decisions/next-one-on-one-workspace.md` → Amendment for why this is
still just-in-time.

Output shape is `situation_summary` + `agenda_items[]`, not flat Q&A lists. Each
agenda item renders as a collapsible card: rationale as italic subtext, suggested
questions as an indented list. **The closing question is mandatory and always the
last agenda item.**

The prompt is assembled by `_build_prep_prompt()` from, in order: history,
open commitments, carry-forward, the kept opening line (asked to become the
first agenda item's first question unless newer context resolves it), selected
signals, secondhand notes from
meetings beyond the team (framed as someone else's account, never fact — see
`beyond.md`), role expectations, the Context Engine block (see
`context-engine.md`), then the manager's raw notes.

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

Above it, **Open next time with**: one sentence the manager could open the next
1:1 with, drafted from the single most important thread left open (a
commitment with a date, or a deferred topic), phrased as a question about
where it landed — never "don't forget" or "you said you'd". The prompt allows
an empty line and often returns one. It is editable and clearable, and only a
kept, non-empty line is saved, onto the next occurrence's `opening_line`
(replacing any earlier one; an empty one leaves an existing line alone). Prep
shows it as the first source ("Open with · kept at your last wrap-up"),
removable like the others.

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
