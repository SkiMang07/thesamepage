# Setup walkthrough follow-ups: two items scoped, not built

Source: `business/digital-customers/personas/02-eng-manager-scaling/sessions/2026-09-30-fresh-setup-walkthrough.md`
(findings 6 and 7). Dana is a hypothesis, not real-user evidence. Scoped here
because each needs a decision from Andrew before code.

## 1. Commitments lose "four months ago" and "April"

Two different gaps, one complaint.

**a. "April" (a due date in words).** The notes-box prompt
(`backend/routes/notes_dump.py`, the `commitments` line) says "due_date only
when the notes state a date", and the prompt carries no current date, so "in
April" cannot become `YYYY-MM-DD` and comes back null. No schema change needed.
Fix: put today's date in the prompt body (the body is per-call, so the cached
prefix is untouched) and let a month-only or relative due date resolve to a
real date, marked low-confidence so the review row shows it checked-not-sure.
Risk: a wrong year or a wrong month turns into a false "overdue" on Mission
Control. Keep month-only dates low-confidence and editable.

**b. "Four months ago" (when it was promised).** `commitments` has `due_date`
and `created_at` (the day it was typed) and nothing for the day it was made.
Needs a nullable `committed_on date` column: a migration
(`database/migrations/`), a `database/schema.sql` edit, parse-side resolution
from today's date, and display ("Promised in May") on the person page and the
prep prompt. Not needed for prep to be correct, but "the thing I promised four
months ago" is exactly what a manager is afraid of forgetting, and age is what
makes a follow-through list feel true.

Recommendation: do (a) now, it is small. Do (b) only if you want age shown;
it is a migration plus four touch points.

Question for Andrew: is "how long ago I promised it" something the product
should show, or is the due date enough?

## 2. A section for what people owe her

Today the notes box extracts one direction only: what the manager owes
(`committed_by = 'manager'`). What people owe her (Andre's weekly status,
Lena's priorities, Mei's need to hear what exceeds looks like) lands as a
private thought or inside an expectation line.

The data model already has it: `commitments.committed_by` allows
`direct_report`, and Mission Control, the person page and prep already read
both directions. The gap is the intake:

- parse prompt: a second `owed_to_you` group, same shape as `commitments`
- validation, caps and the draft shape in `notes_dump.py`
- a "What people owe you" review section in `NotesDumpModal.tsx`, unchecked
  by default until she confirms (hard rule 6: draft, then review)
- `_apply_commitments` writing `committed_by = 'direct_report'`
- the eval fixtures and the `notes_dump_applied` telemetry counts

Risk to decide on: an expectation ("send me a weekly status") and a commitment
("Andre owes me the plan by Friday") look alike. An expectation belongs to the
role and recurs; a commitment is one deliverable. The prompt must keep that
line, or the review fills with expectations restated as tasks.

Recommendation: build it as its own session with a small eval set (Dana's
three examples plus a few expectation-shaped lines that must not match).
Roughly the size of the "What you owe people" section that already exists.
