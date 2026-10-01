# Setup walkthrough follow-ups

Source: `business/digital-customers/personas/02-eng-manager-scaling/sessions/2026-09-30-fresh-setup-walkthrough.md`
(findings 6 and 7). Dana is a hypothesis, not real-user evidence.

## 1. Commitments lose "four months ago" and "April"

**Decided: the due date is enough.** No `committed_on` column. `commitments.created_at`
is the day it was typed in, not the day it was promised, so it can stand in for age
on commitments made in the app from now on, and not for backfilled history. Revisit
if real users ask how long ago they promised something.

**Open, small, no migration:** "in April" cannot become a date because the notes-box
prompt carries no current date. Put today's date in the per-call body (not the cached
prefix) and let a month-only or relative due date resolve, marked low-confidence so the
review row starts unchecked. Risk: a wrong month becomes a false "overdue" on Mission
Control, so keep those dates editable.

## 2. What people owe her: built

The notes box proposes commitments in both directions through the existing
`commitments` record (`committed_by` `manager` or `direct_report`), the same one the
wrap-up writes. A "What people owe you" review section sits beside "What you owe people".
A missing or odd direction stays the manager's own. A recurring expectation of a role
("a weekly status") stays an expectation. The model's behaviour on these lines is covered
by prompt and validation tests, not yet by a live eval.
