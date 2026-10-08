# Commitments — the table, ownership and editing

A commitment is a promise made in a conversation: something the manager owes
someone, or something someone owes the manager. They are written by 1:1
wrap-ups, team meeting wrap-ups, meetings beyond the team, the Scribe, notes
read on a person's page or prep sheet, and the Team page's "+ Add". This doc
covers the one place they are all seen together, and the rules every surface
shares. How a commitment is made and carried into prep lives with its source:
`one-on-ones.md`, `team.md`, `beyond.md`.

## Who owes it

`commitments.committed_by` is who owes it, on every source:

| committed_by | direct_report_id | outside_person_id | Reads as |
|---|---|---|---|
| `manager` | the person | — | You owe that person (1:1) |
| `manager` | null | null | Yours (team meeting, goal, Scribe) |
| `manager` | null | set | You owe someone outside the team |
| `direct_report` | the person | — | That person owes you |
| `counterpart` | null | set | Someone outside the team owes you |

Until 2026-10-08 team-meeting wrap-ups and the Team page saved every row as
`manager` and used `direct_report_id` for whoever owed it, so Mission Control
and the person page counted a report's team-meeting item as the manager's.
Both writers now save `direct_report` when a person is named, and migration
`2026-10-08_team_commitment_owner.sql` corrected the earlier team rows
(team-meeting and Team-page "+ Add").
A null report on a non-counterpart row is the manager's own
(`docs/decisions/nullable-commitment-owner.md`).

## Editing

`PATCH /api/commitments/{id}` changes any of `status`, `description`,
`due_date` (null clears it) and who owes it. Only fields sent change.

- A counterpart row can't change owner.
- A team row (`is_team_commitment`) can move to any of the manager's people or
  to the manager. A row with no team recorded takes its new owner's team, or,
  moving to the manager, keeps its old owner's team.
- Any other row keeps its person and only flips sides ("I owe Leah" ↔ "Leah
  owes me").

A status change sends `commitment_status_changed` with `status`, `owner`
(`you` / `report` / `counterpart`) and `surface` — no text
(`product-analytics.md`).

## The commitments table

`components/commitments/CommitmentsTable.tsx`, rules in
`lib/commitmentsTable.ts` (tested in `lib/commitmentsTable.test.mjs`).

**Data:** `GET /api/commitments/board` returns open commitments plus those
done in the last 30 days, archived people's excluded, with owner, who it is
with, the team (`org_unit_id`, else the owner's team) and where it was made
resolved server-side: "1:1 with Leah · Oct 2" (links to that conversation on
the person page via `?conversation=`), "<Team> meeting", the outside meeting's
title, "Goal: …", "Project: …", "Added on the Team page" or "Added by you". A
source the manager can't read says "no longer available" and has no link.
It also returns the manager's current people for the owner filter.

**Filters:** Owner — You owe (default on Mission Control), Your people owe,
Owed from outside the team (only when there are any), Everyone, or one person
(everything between you and them, either side). Status — Open (default),
Overdue, Due in 7 days, No due date, Done. Each status shows its count for the
chosen owner.

**Order:** overdue first, longest overdue on top; then by due date; then
undated, oldest first; done rows most recent first. First 8, then "Show all".

**Rows:** tick box, the commitment, owner, where it came from, due ("9 days
overdue" in amber, a date, or "No date"), and a menu: Edit, Drop it, Reopen.
Edit opens the wording, who owes it (by the rules above) and the due date in
place.

**Ticking:** the change saves at once. The row stays where it is, struck
through, with Undo, until the page reloads, even if the filter no longer
matches it. Ticking something you owe a person also offers "Tell Leah in your
next 1:1", which saves a capture note ("Let Leah know this is done: …") that
the next prep sheet reads. Nothing is sent to anyone.

**Still on?:** an open row with no date older than 30 days, or more than 14
days overdue, shows an amber "Still on?" that opens Edit (new date, new owner,
or Drop it instead).

**Short lists:** with five or fewer open rows the filters are hidden and the
table is a plain list of everything open. An empty board reads as one line.

Layout is measured: at 720px or wider it is a six-column grid; narrower, each
row stacks owner, due and source under the text.

## Where it appears

- **Mission Control** — full width under the week and the next move, above
  Goals & progress (`mission-control.md`). The "Overdue commitments" count for
  the current week filters the table to everyone's overdue and scrolls to it.
- **Team page** — the same table, holding only commitments made for the team:
  team-meeting rows and those added on the Team page, in the selected team
  (All teams: all of them). The team will be able to see this page, so 1:1
  commitments appear only when the manager ticks "Include 1:1 commitments with
  these people", and then only for people in the selected team. That box is a
  manager tool: when people on the team get access to this page, the server
  must refuse them 1:1 rows, not just hide the box. Today commitments RLS is
  owner-only, so only the manager can read any of them.
- **Person page** — Follow-through is unchanged (`one-on-ones.md`).
- **Beyond the team** — its own lists (`beyond.md`).
