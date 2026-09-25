# Beyond the team

A manager's meetings **outside their own team**: their boss, their skip-level,
indirect reports, peers, peer managers' team meetings, cross-functional and
project meetings. Route `/app/beyond`, nav label "Beyond the team" (People group,
after Assessments). Backend `routes/beyond.py`. Original spec:
`docs/BEYOND_THE_TEAM_SCOPING.md`.

The core product stays about managing your own team. This space is a real nav
item, but **only its outputs reach the rest of the app**: commitments, goal and
project check-ins, and secondhand context in a report's 1:1 prep. It has **no
Mission Control card**, and Mission Control only ever sees these meetings through
what they produce.

## Data

Migrations `database/migrations/2026-09-22_beyond_the_team.sql` and
`2026-09-22_beyond_the_team_repeat.sql` (repeating 1:1s, prep, carry-forward).

| Table | What it holds |
|---|---|
| `outside_meeting_series` | The repeat rule for 1:1s with one person: 1–4 weeks from an anchor date, one **active** series per (owner, person). Mirrors `one_on_one_series`. Group meetings don't repeat. |
| `outside_people` | People you meet outside your team. `relationship` is `manager`, `skip_level`, `indirect_report`, `peer`, `cross_functional` or `other`. Archived, never deleted. `email` is reserved for notes-ingestion matching. |
| `outside_meetings` | One row per meeting. `kind` is `one_on_one` or `group`. `scheduled_at` is the meeting date at noon UTC (`decisions/meeting-date-is-scheduled-at.md`), null for an undated next 1:1. `series_id` for a repeating 1:1. `carry_forward_items` = topics carried **into** this meeting (same meaning as on `one_on_ones`). `prep_guide` = the prep sheet for an upcoming 1:1. |
| `outside_meeting_people` | Who was there. A 1:1 has exactly one person (enforced in the route). |
| `outside_meeting_links` | What a meeting touched on **your own** team — exactly one of `goal_id` / `project_id` / `direct_report_id` per row, plus the note that justifies it. |

All five are **owner-scoped** (`owner_id = auth.uid()`), with **no IC-visible
policy** on any of them. `owner_id` is denormalized onto the two join tables so
their `USING` stays flat; their `WITH CHECK` also proves the meeting, person,
goal, project or report is the caller's own, so a known UUID of someone else's
row can't be linked. The same holds for a series' person and a meeting's
`series_id`. None of those checks read `public.users`, so there is no
RLS recursion risk.

**Indirect reports are `outside_people` rows**, not links to `direct_reports` —
their `direct_reports` row belongs to another manager and is owner-scoped.

Changes to existing tables:

- `commitments.committed_by` gains **`counterpart`** — something the other
  person owes you — named by the new `commitments.outside_person_id`. A
  counterpart row never has a `direct_report_id` (check constraint
  `commitments_counterpart_shape`). `outside_person_id` is also set on a
  manager-owned row from a 1:1, meaning "who you owe it to".
- `commitments.source_type` gains `outside_meeting`.
- `check_ins` gains nullable `source_type` (`manual` | `outside_meeting`) and
  `source_id`, so a check-in created from a meeting traces back to it. Legacy
  rows are null.

### Counterpart commitments and "null means yours"

A null `direct_report_id` means the manager's own commitment
(`decisions/nullable-commitment-owner.md`). A counterpart row also has a null
report, so every reader that relies on that rule has to account for it:

- Mission Control's snapshot excludes `committed_by = 'counterpart'` — what
  someone else owes you is not an action for you.
- Away already filters `committed_by = 'manager'`, so it never moves them.
- Per-report reads (prep, person page, assessments, development) filter by
  report, which a counterpart row never has.

**Any new commitments reader inherits this.** If it treats a null report as
"yours", it must also exclude `counterpart`.

## Status

Derived, never stored (`_meeting_status()`): **logged** once `summary` is set;
otherwise **upcoming** when undated or dated after today, and **draft** (it
happened, not written up) when dated today or earlier. Today counts as draft, so
a meeting you just walked out of reads as something to finish.

## Flow

1. **Log a meeting** (`/app/beyond/meetings/new`, `?person=<id>` preselects):
   kind, who (pick or add inline), optional title, date, notes with dictation
   (`NoteField`). The row is created on "Save draft" or when the write-up starts;
   after that a draft's notes autosave to the server.
2. **Wrap-up** — `POST /api/beyond/meetings/{id}/wrapup` is a pure AI call
   through `ai_core.generate_text()`. **Nothing is written.** The extractor is
   given the manager's attendees, reports, live goals and live projects, and
   `_sanitize_draft()` drops any id not on those lists. Any failure returns an
   empty draft, never an error. "Write it up myself" skips the AI entirely.
3. **Review** — `BeyondWrapUpReview.tsx`, built on the shared
   `components/team/WrapUpReviewShell.tsx` (the same body as the team-meeting
   review). Adds a meeting-date control, "Goals and projects this moved", and
   "About your reports". Commitment owners are You / a report / an attendee
   ("They owe you"). An unresolved counterpart blocks saving until it's picked.
4. **Log** — `POST /api/beyond/meetings/{id}/log` is the only write. It
   re-validates every id against what the manager owns, marks the meeting
   logged, then writes commitments (`source_type='outside_meeting'`), check-ins
   through `create_check_in()` with the meeting as source (status write-through
   unchanged), and link rows. A second `/log` on the same meeting is refused
   with 409, so a retry can't duplicate commitments.

A logged meeting's summary, title, date and people stay editable. A logged
meeting can't be deleted.

## Repeating 1:1s, carry-forward and prep

**Repeat.** The editor's Repeat control (1:1s only, needs a date) sets the
person's series through `PATCH /meetings/{id}` (`recurrence_weeks` /
`clear_recurrence`); `_set_series()` deactivates-then-inserts so the active
partial index never sees two. Moving a repeating 1:1 to someone else moves the
rule with it; turning it into a group meeting stops it. Cancelling (deleting)
the next occurrence also stops the repeat, the same rule as 1:1s. Nothing is
sent to anyone's calendar.

**Roll-forward on log** (`_roll_forward()`, 1:1s with one person). Logging
leaves **at most one** unlogged next 1:1 with that person: an existing one is
topped up with the newly carried topics; otherwise an active series creates the
next occurrence dated from the **prior scheduled date** plus the interval,
skipping past dates; otherwise carried topics alone create an **undated** next
1:1. With none of those, nothing is created. An undated next 1:1 that gets
written up is dated today unless the review says otherwise.

**Carry-forward.** The 1:1 wrap-up proposes "Bring up next time" topics (the
extractor sees the topics carried in, so unresolved ones can carry again); the
manager edits them on the review; `/log` hands them to the roll-forward. The
editor shows carried topics above the notes, droppable.

**Prep.** An upcoming 1:1 opens with `PrepPanel.tsx`. `GET
/meetings/{id}/prep-sources` shows what the sheet draws on (deterministic, no
AI); `POST /meetings/{id}/prep` generates it through `ai_core` and stores it on
`prep_guide` — the same posture as 1:1 prep, a sheet to talk from, not a
record. A model failure is a 502 with nothing saved, so a bad regenerate keeps
the previous sheet. Rate-limited like the other AI routes.

- **Shaped by relationship.** Your manager and skip-level get a **team
  update**: live goals and projects (at risk first), check-ins since you last
  met (capped at 60 days, 14 when you've never met), what they owe you and you
  owe them, carried topics, work links from other meetings beyond the team, and
  an "asks" list. Everyone else gets **what's open between you**: carried topics,
  commitments both ways, the last meeting, work links, and your notes.
- **Work, not people.** Prep never draws on assessments, 1:1 notes, development
  plans, individual-level goals, a project's owner, or secondhand notes about a
  report. The prompt also forbids naming or assessing individual team members.
  This is a privacy boundary, not a tuning choice: this sheet is what you talk
  from with your boss.

**Away** moves every unlogged meeting beyond the team dated inside the window
(`entity_type = 'outside_meeting'`), and fails soft before the migration runs.

## Where the outputs show up

- **1:1 prep.** `fetch_secondhand_notes()` supplies up to five report links from
  the last 90 days to `_build_prep_prompt()`, as a block headed SECONDHAND and
  framed as someone else's account, never as fact or feedback. Private to the
  manager. Fails soft to an empty list (e.g. before the migration has run).
- **Goals and projects.** A check-in confirmed from a meeting carries
  `source_type='outside_meeting'` and the meeting id, so the goal's Updates and
  the project's record link each such entry to its meeting (titles come from
  `GET /api/beyond/links`).
- **Commitments.** Report-owned ones show wherever that report's commitments
  do. The manager's own and counterpart items show on the meeting and the
  person page.

## Pages

- `/app/beyond` — People grouped by relationship (next or last met, open items
  either way) beside the meetings: "Coming up" (with prep state), "Not written
  up yet", then recent.
- `/app/beyond/people/[id]` — a Next 1:1 card (date, repeat, prep state,
  Prepare) or "Plan the next 1:1", what they owe you and you owe them, meeting
  history, and what those meetings touched on your team.
- `/app/beyond/meetings/new` — log a meeting; `?person=<id>` preselects,
  `&plan=1` plans a future 1:1 and opens it into prep.
- `/app/beyond/meetings/[id]` — an unlogged meeting opens in the editor (with
  prep for an upcoming 1:1); a logged meeting shows its record, and right after
  logging links to the next 1:1 it set up.

Nav door state: `last Sep 18` / `nothing logged yet`, from the overview's
`last_logged`.

## Not built

Repeating group meetings, a Scribe tool for logging by conversation,
notes-ingestion "log as a meeting beyond the team", Context Engine documents in
prep, and linking indirect reports to another manager's `direct_reports` rows.
