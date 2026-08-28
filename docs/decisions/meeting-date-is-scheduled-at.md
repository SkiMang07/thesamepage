# The meeting date is `scheduled_at`

**Status:** Implemented

## Context

`one_on_ones` had no value meaning "when did this conversation happen".
`scheduled_at` held the date a meeting was planned for and `created_at` held
the moment the row was inserted. Every surface that needed a meeting date
picked one of those for itself, and they disagreed: History rendered
`scheduled_at || created_at`, the person page header and `/overview` read
`created_at`, and `_build_prep_prompt` read `created_at` while ordering by it
too.

That held up while every meeting was prepped first, because the row was
created for the meeting and carried its date. It broke on the ad-hoc path.
`POST /api/one-on-ones` without a `one_on_one_id` completes the person's
existing unfinished workspace, so a conversation logged from
`/app/reports/[id]/log` inherited the date its workspace shell was created on.

Found by dogfooding, 2026-08-28. A 1:1 held on the 26th and logged on the 28th
filed itself under August 2, the day the shell was made. History showed it
buried at that position, the header disagreed about the same conversation,
`/overview` kept the person flagged overdue, and the next prep sheet opened
with "it has been 26 days since the last 1:1" about a conversation logged four
minutes earlier. The manager, reasonably, logged it again, so the record also
ended up with two completed rows and a duplicated set of commitments.

`team_meetings` had already solved this on 2026-08-24 and 1:1s never caught up.

## Decision

`one_on_ones.scheduled_at` **is the meeting date** — planned or backfilled,
past or future, encoded at noon UTC. Status still derives from `summary`
alone, so a past date never makes an occurrence look upcoming, which is the
same rule `team_meetings` states in `schema.sql`.

Both log paths send a manager-confirmed `meeting_date`. The control lives on
the shared wrap-up review screen so neither path can miss it, and again on the
Log a 1:1 page where a backdated conversation is most likely to be entered.

`logged_at` records when the write-up was saved. `created_at` is row creation
and is never a meeting date.

`utils.meeting_date_of()` is the single resolver, with `meeting_day_of()` and
`meeting_sort_key()` beside it, in the same spirit as `resolve_cadence_days()`.
No call site reads the columns directly. `_serialize_session()` publishes
`meeting_date` so the frontend has one field to render.

An ad-hoc log will not consume a workspace that has a prep sheet on it. The
Log a 1:1 page asks which conversation is being logged and answers explicitly:
`one_on_one_id` for the prepped occurrence, `separate_occurrence` for a
different one. A caller that cannot ask gets the non-destructive half.

## Rejected alternatives

- **Add a `met_at` column.** A third date to keep in sync with two that
  already exist, and it would have left `scheduled_at` still meaning
  "planned only" on 1:1s while meaning "the meeting date" on team meetings.
  The field the manager already fills in on the prep sheet, labelled MEETING
  DATE, was the answer.
- **Leave the fallback and just fix the display.** The wrong date was reaching
  the prep prompt and the due calculation, not only the History list. A
  cosmetic fix would have left the AI reasoning from row-creation timestamps.
- **Stop the ad-hoc path consuming the workspace entirely.** That is the
  `next-one-on-one-workspace` decision, and dropping it would strand the old
  workspace and create a second source of truth for the same conversation.
  Only the prepped case is destructive, so only the prepped case is guarded.
- **Warn without offering a choice.** A manager who really is logging the
  meeting they prepped should not be pushed onto a second record to get past a
  warning.

## Consequences

Migration `2026-08-28_one_on_one_meeting_date.sql` adds `logged_at` and
backfills completed rows: `created_at` becomes `scheduled_at` where it was
null, normalised to noon UTC. Unfinished workspaces are untouched and keep
their derived `gathering` status. Legacy rows created late in the manager's
evening can land one day ahead; every row written after the migration carries
a date the manager confirmed.

History sorts by the meeting date because it renders the meeting date.
`/overview` picks the latest completed 1:1 by meeting date, so backfilling an
old conversation no longer displaces a more recent one. Mission Control counts
conversations *held* this week rather than written up this week.

Revisit if managers start wanting a meeting time rather than a day, which is
the case `scheduled_at` was already left as a `timestamptz` to absorb.
