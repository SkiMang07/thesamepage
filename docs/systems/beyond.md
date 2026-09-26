# Beyond the team

A manager's meetings **outside their own team**: their boss, their skip-level,
indirect reports, peers, peer managers' team meetings, cross-functional and
project meetings. Route `/app/beyond`, nav label "Beyond the team" (People group,
after Assessments). Backend `routes/beyond.py` (people, meetings, wrap-up,
prep) and `routes/beyond_continuity.py` (the four-view aggregate, the brief,
private prep items, AI suggestions). Original spec:
`docs/BEYOND_THE_TEAM_SCOPING.md`. Page design:
`docs/design-proposals/2026-09-25-beyond-directions/` (`overview-revised.png`,
with option A's continuity in the deeper views; `CLAUDE_BUILD_BRIEF.md`).

The core product stays about managing your own team. This space is a real nav
item, but **only its outputs reach the rest of the app**: commitments, goal and
project check-ins, and secondhand context in a report's 1:1 prep. It has **no
Mission Control card**, and Mission Control only ever sees these meetings through
what they produce.

## Data

Migrations `database/migrations/2026-09-22_beyond_the_team.sql`,
`2026-09-22_beyond_the_team_repeat.sql` (repeating 1:1s, prep, carry-forward)
and `2026-09-25_beyond_continuity.sql` (prep items, suggestions).

| Table | What it holds |
|---|---|
| `outside_meeting_series` | The repeat rule for 1:1s with one person: 1–4 weeks from an anchor date, one **active** series per (owner, person). Mirrors `one_on_one_series`. Group meetings don't repeat. |
| `outside_people` | People you meet outside your team. `relationship` is `manager`, `skip_level`, `indirect_report`, `peer`, `cross_functional` or `other`. Archived, never deleted. `email` is reserved for notes-ingestion matching. |
| `outside_meetings` | One row per meeting. `kind` is `one_on_one` or `group`. `scheduled_at` is the meeting date at noon UTC (`decisions/meeting-date-is-scheduled-at.md`), null for an undated next 1:1. `series_id` for a repeating 1:1. `carry_forward_items` = topics carried **into** this meeting (same meaning as on `one_on_ones`). `prep_guide` = the prep sheet for an upcoming 1:1. |
| `outside_meeting_people` | Who was there. A 1:1 has exactly one person (enforced in the route). |
| `outside_meeting_links` | What a meeting touched on **your own** team — exactly one of `goal_id` / `project_id` / `direct_report_id` per row, plus the note that justifies it. |
| `outside_suggestions` | AI-proposed connections between a **reviewed** Beyond record (an open commitment from a logged meeting, or a logged write-up) and one of your live goals or projects. Evidence excerpts are copied from the records by the server. `status` is `open`, `dismissed` or `connected`; `added_meeting_id` records where its prep line went. Unique on (owner, `suggestion_key`, `evidence_hash`). |
| `outside_suggestion_runs` | One row per owner: the fingerprint of the evidence the last suggestion pass saw. |

`outside_meetings.prep_items` (jsonb array) holds the private things saved to
raise in an upcoming conversation: `{id, text, source: thought|suggestion,
suggestion_id, created_at}`. Not agreed commitments; never sent. Every read of
it goes through `fetch_prep_items()`, which fails soft and reports
`prep_items_available: false` rather than an empty list.

All seven are **owner-scoped** (`owner_id = auth.uid()`), with **no IC-visible
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

## The four views and the brief

`/app/beyond` reads one aggregate, `GET /api/beyond/continuity` (deterministic,
no AI), and has four tabs (`?view=people|my-manager|groups`, Overview default):

- **Overview** — "What needs you next?" then three previews (People, My
  manager, Group conversations: latest reviewed outcome, next conversation,
  commitments both ways). Three columns from ~900px of content width, stacked
  below it (measured, so the Scribe drawer reflows it).
- **People** — every active person except relationship `manager`, as option
  A's continuity card: where you left off (latest reviewed 1:1, else latest
  reviewed group meeting, labelled), what's open both ways with real owners
  (a report-owned commitment keeps the report's name), carried topics, saved
  thoughts, the next conversation or "No next conversation on record",
  "+ Add a thought", Prepare / Plan the next 1:1, History. Relationship
  filter chips; adding a person is secondary.
- **My manager** — the same card for relationship `manager`, framed as
  updates, asks and decisions. Zero managers offers "Add your manager"; more
  than one says so rather than picking. Skip-levels stay under People.
- **Group conversations** — each group meeting is its own row (coming up,
  not written up, written up) with attendees, reviewed outcome and open
  commitments. **No series is inferred** from matching titles or attendees;
  recurring group conversations aren't built and the view says so. A group
  meeting's commitments also show on each person's card — the same records.

**The brief** (`build_brief()`, pure and tested). Recorded kinds, in order:
dated items within 7 days (upcoming conversations, with facts like what you
owe and what's recorded as open from them; your own open promises from Beyond
meetings — one owed to someone whose conversation is already listed is folded
into that item), then meetings not written up, then reconnects. A reconnect
needs an **explicit repeat rule with nothing on record** ("that doesn't mean
you haven't met") or **recorded open work** with no next conversation —
elapsed time alone never produces one. Three shown (one slot reserved for a
suggestion when there is one), up to six behind "Show more". Counterpart
commitments are never the manager's tasks: they appear as "recorded as open".

## Suggestions, prep items and connections

- `POST /suggestions/refresh` (6/min) runs once per Overview visit, after the
  recorded brief renders. It gathers evidence deterministically
  (`gather_suggestion_evidence()`): open manager/counterpart commitments from
  logged meetings, and logged write-ups from the last 60 days, against live
  non-individual goals and live projects (title, description, due date).
  **Never** report-owned commitments, report links or secondhand notes,
  individual goals, a project's owner or report, assessments, 1:1 notes or
  development plans. It calls the model (light) only when the evidence
  fingerprint changed; the model sees short refs, not ids, and
  `sanitize_suggestions()` drops unknown refs. Already-linked pairs, open ones
  and dismissed key+evidence pairs aren't proposed again. A model failure
  records nothing and the recorded brief is unaffected.
- A suggestion is hidden if its source meeting isn't logged, its source
  commitment closed, or its target is gone or no longer live.
- **Add to prep** — `POST /meetings/{id}/prep-items` with editable text and a
  conversation the manager chooses (no default). Upcoming meetings only. Sets
  the suggestion's `added_meeting_id`; its status stays `open`. No
  commitment, check-in, link or status change. With no upcoming conversation
  the review offers "Plan a 1:1" — nothing is scheduled silently.
- **Confirm connection** — `POST /suggestions/{id}/connect` writes one
  `outside_meeting_links` row (source meeting ↔ goal/project, with the
  manager's reason) and sets `connected`. No check-in, no status or progress
  change. Idempotent. Goals (Connections) and Projects (record) now list
  such links that came without a check-in.
- **Dismiss** — status only; source records untouched.
- **Add a thought** — the same prep-items endpoint with `source: thought`,
  from the continuity card, the person page, a group card or the editor.
  Items show beside carried topics in the editor (removable while upcoming),
  in "What you saved to raise" on the logged record, and feed 1:1 prep as
  "THINGS THE MANAGER SAVED TO RAISE (…not agreed commitments…)".

## Pages

- `/app/beyond` — the four views above.
- `/app/beyond/people/[id]` — a Next 1:1 card (date, repeat, prep state,
  Prepare) or "Plan the next 1:1", what they owe you and you owe them, meeting
  history, and what those meetings touched on your team.
- `/app/beyond/meetings/new` — log a meeting; `?person=<id>` preselects,
  `&plan=1` plans a future 1:1 and opens it into prep, `?kind=group` starts a
  group meeting.
- `/app/beyond/meetings/[id]` — an unlogged meeting opens in the editor (with
  prep for an upcoming 1:1); a logged meeting shows its record, and right after
  logging links to the next 1:1 it set up.

Nav door state: `last Sep 18` / `nothing logged yet`, from the overview's
`last_logged`.

## Not built

Repeating group meetings and a persistent home for a recurring group
conversation (would need explicit manager-created grouping — never inferred),
confirming a connection by hand without a suggestion, suggestions that use
check-in notes or Context Engine documents, a Scribe tool for logging by conversation,
notes-ingestion "log as a meeting beyond the team", Context Engine documents in
prep, and linking indirect reports to another manager's `direct_reports` rows.
