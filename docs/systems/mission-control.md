# Mission Control (`/app/dashboard`)

The authenticated landing page is "Your week, in focus": a factual picture of
the manager's week with the action brief's recommendation beside it. The
persistent sidebar owns wayfinding; Mission Control does not duplicate it.

## Page composition

Selected design: `docs/design-proposals/2026-09-24-week-in-focus/`
(`BUILD_BRIEF.md`, `prototype-source.html`). In order:

1. **Heading.** Today's date as the eyebrow and the serif "Your week, in
   focus." No subtitle. Top right: "Updated <time> · Refresh" (the time the
   week last loaded; "Updating…" while it reloads).
2. **Three counts**, each a button that opens its records in the right-hand
   column: conversations completed (of those dated this week), commitments
   completed this week, and overdue commitments (with the number of owners).
3. **Conversation week.** Monday–Friday columns, plus Saturday/Sunday only when
   something is dated there. ‹ › arrows step a week at a time, with "Back to
   this week" when another week is shown; today is marked by a teal top rule.
   Up to four rows per day, then "View all N (+k)"
   opens the whole day beneath the week. Rows show initials (people in their
   identity colour, the same one AppNav's roster gives them; groups in
   neutral squares), a short name
   (first name, or first name + initial when two people share one) and the
   state as glyph + word: ✓ Done, • Prepped / Agenda, ○ To prep / No agenda,
   △ Not logged (the date has passed with nothing written up). Meetings are
   dated by day, so no times are shown (the legend says so to screen readers
   only). 1:1s, team meetings (square avatar)
   and meetings beyond the team all appear. On the current week, people due by
   cadence with no date set get one line below the week (names link to prep; the line
   opens their cadence detail in the right-hand column). They are not
   calendar events.
4. **Follow-through.** "Mine" and "My team" bars split into Completed / Due
   this week / Overdue. Each bar shows proportions within its own group.
   Segments are toned at rest and solid when selected (`METER_SEGMENT`, see
   `brand.md` → Meters). Selecting a segment lists exactly those records;
   overdue lists run oldest first and show each item's age.
5. **Right-hand column.** By default it shows "Your next move" (the brief's
   primary candidate) and up to two "Keep in view" items (the secondaries),
   each with the quiet variant of the unchanged CTA / Why this? / Addressed /
   Snooze / Not relevant controls. Selecting a conversation, count or
   segment replaces the column with details. In two-column mode the column
   is sticky under the top bar, so details open beside whatever was clicked
   and focus moves to them without scrolling the page. Each swap fades in
   over 120ms (none under reduced motion). × or Esc returns
   focus to whatever opened it.
6. **Goals & progress**, full width. Company / Team / Individual tabs, plus
   Department only when department goals exist. Individual adds a person
   picker. Default is the first tier that has goals. Up to six cards,
   attention first (the dashboard's existing at-risk / due / stale order),
   link to Goals for the rest. Selecting a card opens the latest check-in
   note, what the percentage represents, and the linked projects and
   goal-sourced commitments.

Layout is measured, not viewport-based: the page switches to one column below
~860px of content width and the week to stacked days below ~92px per day, so
the Scribe drawer reflows it the same way a narrow window does. In one column
the next move comes straight after the counts, not after Follow-through.
Sections sit 32px apart, headings 16px above their content, related items 8px.
The loading skeleton is measured the same way and mirrors this layout.

Counts and goal percentages are set in the sans with tabular figures; the
serif is for the heading and detail titles only (see `DESIGN.md` → fonts).

## The week view

`GET /api/dashboard/week?local_date=&week_of=` (`routes/dashboard.py` →
`mission_control_week.build_week`, pure and clock-injected) is read-only. Each
domain loads independently and reports coverage. A section whose source
failed says so instead of showing zeros.

- **Week:** Monday–Sunday containing the manager's local date, or containing
  `week_of` when the arrows moved it (within a year either side). `local_date`
  is always today and must be within a day of UTC; `week_of` never moves
  today, so past meetings read "not logged" and nothing future reads overdue.
  `week.is_current` says which case applies. Meetings are
  selected by their `scheduled_at` day (noon-UTC dates).
- **Conversation state:** `summary` → completed. A prep sheet (1:1s, beyond
  the team) or agenda items/note (team meetings) → prepared. A past date with
  neither → not logged. Otherwise → to prepare.
- **Unscheduled due:** calls `get_one_on_ones_overview()`, the canonical
  "who's due", and keeps people who are due with no dated upcoming occurrence.
  Current week only.
- **Commitments:** counterpart rows excluded, archived people excluded.
  Owner is *team* when a direct report committed, otherwise *mine* (a null
  report is the manager's own). State: *completed* means done with
  `completed_at` this week up to today. Dropped does not count. *Overdue*
  means open with a due date before today. *Due* means open and due between
  today and Sunday. For any other week the cohort is that week's own
  commitments as of today: completed during it, or open and due inside it
  (overdue if the date has passed, due if not); overdue never reaches outside
  the week shown. Undated open commitments are counted separately, not
  placed in a bar. Every displayed count is the length of the returned list.
- **Goals:** active / on track / at risk only. `progress` is the latest
  recorded percentage and `progress_at` is the date of the check-in that
  recorded it, which can be older than `last_check_in_at`. No percentage →
  "Progress not recorded", never 0%. Stale means more than 14 days since the
  last check-in. Status and freshness are labelled separately.

The brief and the week load separately. Either can fail without taking the
other down. Only when both fail does the page fall back to the full-page
failure state with "Open previous dashboard".

Frontend: `frontend/app/app/dashboard/page.tsx`,
`frontend/components/mission-control/WeekInFocus.tsx` (page) and
`ActionBrief.tsx` (shared recommendation controls and the failure state; the
loading skeleton is `WeekInFocusSkeleton` in `WeekInFocus.tsx`).
Backend: `backend/routes/dashboard.py`, `backend/mission_control_engine.py`,
`backend/mission_control_week.py`.

## Brief and ranking

`GET /api/dashboard/brief` loads conversations, commitments, goals, projects,
check-ins, expectations coverage, logged time off, and prior dispositions
independently. Each domain reports `ok`, `partial`, or `unavailable`; incomplete
core coverage can never produce an all-clear.

The pure engine establishes eligibility before ranking:

- saved 1:1 prep;
- due 1:1 prep from the existing per-person/org/default cadence;
- open dated commitments due within seven days;
- active goals/projects that are explicitly at risk, due within 14 days,
  stale beyond 14 days, or inconsistent with their latest check-in.

Missing dates never become urgent. Capacity never creates a candidate: actual
logged time off can only corroborate an already-eligible dated commitment.
Assessment scores, capture-note content, private 1:1 notes, and inferred employee
risk do not enter the brief.

Scheduled dates now come from the recurring 1:1 workflow. A saved prep with a
date uses that fact directly and no longer carries the old "no scheduled meeting
date" boundary. A date-only scheduled shell without a generated prep sheet is
visible on `/app/1-1s`, but does not become a Mission Control candidate by
itself; cadence still determines whether starting prep needs attention.

Eligible items share one domain-neutral score based on date urgency, explicit
status/integrity, staleness, saved-prep momentum, corroboration, and whether the
CTA opens the exact workflow. Ties break by strongest date bucket, evidence
count, exact-workflow availability, oldest attention date, then stable candidate
key. Person items deduplicate to one action; a linked goal/project review chain
uses one slot. The engine is clock-injected and AI-free, so identical records and
local date always return the same order.

## Evidence and AI boundary

Every candidate includes factual evidence, fixed source labels, computed
freshness, human-readable rank components, and any relevant boundary (for
example, default cadence or logged-time-off limits). `Why this?` exposes these
deterministic facts.

`POST /api/dashboard/explain` is optional and rate-limited. It recomputes the
candidate and exact evidence fingerprint before asking the light model for a
one-sentence paraphrase. AI cannot select, reorder, add facts, infer causes, or
write a source record. Failure leaves the deterministic brief unchanged.

The morning line is the one sentence under the page heading ("Your week, in
focus."). `GET /brief` returns `morning_line` from the day's cache
(`mission_control_morning_lines`, one row per manager per local date) as
`ready`, or `pending` with a fingerprint of the top three candidates; the page
then calls `POST /api/dashboard/morning-line`, which rebuilds the brief,
rejects a stale fingerprint (409), and asks the light model to reword those
three moves' titles, explanations and evidence under the same no-new-facts
rules (null allowed and cached). The brief never waits on the model. A changed
top three (addressed, snoozed, new evidence) rewrites the line, at most four
times a day; after that, and in empty, partial or all-clear modes, no line
shows. There is no worker: the first Mission Control load of the day writes it.

## Dispositions and analytics

`mission_control_events` is append-only and manager-scoped. RLS permits only
selecting and inserting the authenticated manager's rows; there is no update or
delete policy. It records impressions, explanation opens, CTA clicks,
Addressed, Snooze, Not relevant, setup dismissal, AI result, and inferred
downstream completion.

Addressed and Not relevant suppress only the exact
`candidate_key + evidence_fingerprint`. Snooze suppresses that instance until
Tomorrow, next Monday, or one week. The optional early-use role-grounding prompt
can be dismissed until the next local day. None of these handlers calls a 1:1,
goal, project, commitment, assessment, capacity, expectation, or setup writer.
Addressed explicitly does not close or update the underlying record.

`POST /api/dashboard/reconcile` can append a completion event when later records
honestly establish one: new prep after a start-prep click, a specifically
included commitment resolved after its click, or a later goal/project check-in.
It never mutates those records.

## States and rollout

The brief has normal-week, busy-week, early-use, empty, all-clear, loading,
partial-source, AI-failure, and aged-response states. Early use makes no team
judgment. Empty accounts receive one Add direct report action. Confirmed source
writes in the same browser refresh the brief automatically, including writes from
another tab. After 24 hours the full brief remains usable and gains a quiet,
optional refresh prompt; content never disappears merely because time passed.

`MISSION_CONTROL_ACTION_FIRST_MODE=off|allowlist|on` is the rollback switch, with
`MISSION_CONTROL_ACTION_FIRST_ALLOWLIST` for a manager UUID allowlist. The old
dashboard component and `GET /api/dashboard/insight` remain available while the
flag exists. Turning the mode off restores the previous UI without reversing the
additive event table or changing source data.

## Quick add

`components/QuickAddModal.tsx` remains the lightweight create path for a direct
report, goal, or project. It is not a global command palette.
