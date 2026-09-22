# Beyond the team

A manager's meetings **outside their own team**: their boss, their skip-level,
indirect reports, peers, peer managers' team meetings, cross-functional and
project meetings. Route `/app/beyond`, nav label "Beyond the team" (People group,
after Assessments). Backend `routes/beyond.py`. Spec and Phase 2 plan:
`docs/BEYOND_THE_TEAM_SCOPING.md`.

The core product stays about managing your own team. This space is a real nav
item, but **only its outputs reach the rest of the app**: commitments, goal and
project check-ins, and secondhand context in a report's 1:1 prep. It has **no
Mission Control card**, and Mission Control only ever sees these meetings through
what they produce.

## Data

Migration `database/migrations/2026-09-22_beyond_the_team.sql`.

| Table | What it holds |
|---|---|
| `outside_people` | People you meet outside your team. `relationship` is `manager`, `skip_level`, `indirect_report`, `peer`, `cross_functional` or `other`. Archived, never deleted. `email` is reserved for notes-ingestion matching. |
| `outside_meetings` | One row per meeting. `kind` is `one_on_one` or `group`. `scheduled_at` is the meeting date at noon UTC (`decisions/meeting-date-is-scheduled-at.md`). Draft until `summary` is set. |
| `outside_meeting_people` | Who was there. A 1:1 has exactly one person (enforced in the route). |
| `outside_meeting_links` | What a meeting touched on **your own** team — exactly one of `goal_id` / `project_id` / `direct_report_id` per row, plus the note that justifies it. |

All four are **owner-scoped** (`owner_id = auth.uid()`), with **no IC-visible
policy** on any of them. `owner_id` is denormalized onto the two join tables so
their `USING` stays flat; their `WITH CHECK` also proves the meeting, person,
goal, project or report is the caller's own, so a known UUID of someone else's
row can't be linked. None of those checks read `public.users`, so there is no
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

## Where the outputs show up

- **1:1 prep.** `fetch_secondhand_notes()` supplies up to five report links from
  the last 90 days to `_build_prep_prompt()`, as a block headed SECONDHAND and
  framed as someone else's account, never as fact or feedback. Private to the
  manager. Fails soft to an empty list (e.g. before the migration has run).
- **Goals and projects.** `CheckInPanel`'s History lists "From meetings beyond
  the team" via `GET /api/beyond/links`, linking to each meeting. The check-in
  itself is already in the history above it.
- **Commitments.** Report-owned ones show wherever that report's commitments
  do. The manager's own and counterpart items show on the meeting and the
  person page.

## Pages

- `/app/beyond` — People grouped by relationship (last met, open items either
  way) beside the meeting list, drafts first as "Not written up yet".
- `/app/beyond/people/[id]` — what they owe you and what you owe them, meeting
  history, and what those meetings touched on your team. Edit, archive, log a
  meeting. Phase 2 prep builds on this page.
- `/app/beyond/meetings/[id]` — a draft opens in the editor; a logged meeting
  shows its record.

Nav door state: `last Sep 18` / `nothing logged yet`, from the overview's
`last_logged`.

## Not built (Phase 2 and later)

Repeating meetings and prep for managing up (`outside_meeting_series`, the boss
1:1 first), Away shifting those series, a Scribe tool for logging by
conversation, notes-ingestion "log as a meeting beyond the team", and linking
indirect reports to another manager's `direct_reports` rows. See the scoping doc.
