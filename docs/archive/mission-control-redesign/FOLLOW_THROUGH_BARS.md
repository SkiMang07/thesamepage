# Follow-through bars (Mission Control, 2026-09-24 to 2026-10-08)

Superseded by the commitments table (`docs/systems/commitments.md`). Kept as
the record of what the section did. `lib/followThrough.ts` still holds its
copy rules and test.

From `docs/systems/mission-control.md`, Page composition, item 4:

> **Follow-through.** "Mine" and "My team" bars split into Completed / Due
> this week / Overdue. Each bar shows proportions within its own group.
> Segments are toned at rest and solid when selected (`METER_SEGMENT`, see
> `brand.md` → Meters). Selecting a segment lists exactly those records;
> overdue lists run oldest first and show each item's age.
> Open commitments with no due date are not in a bar. Each group says so under
> its bar ("4 open commitments with no due date, not shown in the bar."), and a
> group with no dated commitments reads "4 open, no due date", never
> "0 commitments" (`lib/followThrough.ts`).

Why it went: it showed only this week's states, so commitments due later or
with no date (42 of Andrew's 54 open ones on 2026-10-08) were counts, never
rows; and its records were links, so closing one meant opening another page,
finding the row and ticking it there. Team-meeting rows were also counted as
"Mine" because they were saved with committed_by = 'manager'.
