# Prototype validation

September 25, 2026. Checks apply to the disposable HTML concept, not the application or backend.

## Completed

- JavaScript syntax checked with Node after generation and again after final changes.
- Browser loaded the observed snapshot and reconciled five open Team goals, two needing review because of recorded check-in age, three without check-ins, and one closed goal.
- Visually inspected at 1440 × 1000, 1024 × 900 and 390 × 844. Phone document width was 390 with no horizontal overflow. Narrow screens stack list and detail; selected goals scroll to detail, and Back to goals returns to the list. Browser viewport override reset afterward.
- Switched to the fictional dataset and opened the inline check-in form. Entered a note, failed the next save deliberately, observed the retained form, then saved successfully. The resulting history contained the same entered note, current date and At risk status. The existing 40% retained its September 16 provenance despite the September 25 note-only check-in.
- A failed save did not silently change recorded data. Failure simulation models a wholly rejected local write; it is not a test of partial backend failure or production retry safety.
- Opened history and read full notes. Older numerical entries and the source-meeting door remained available.
- Tested trying to switch from an unfinished check-in to goal editing. Keep editing retained the form; Cancel exited it deliberately.
- Created a fictional goal and verified its title, missing percentage, optional associations and absence of check-ins. Deleted it through the explicit local confirmation and returned to the list.
- Expanded Connections and inspected the explicit parent, child and project. Followed the parent to Department, edited its title inline, saved and verified the new title.
- Loaded the error fixture, verified that it did not claim an empty account, used Try again and verified recovery to illustrative records. Loaded the empty fixture and verified the create-goal entry point.
- Restored the observed snapshot for delivery. Prototype changes reset on reload; no live records were written.

## Limits

This pass is visual and interaction review, not a full accessibility audit. Native controls, visible focus styles, semantic forms, a labeled dialog, status announcements and keyboard-operable disclosures are present. Exhaustive keyboard/screen-reader checks, every status/filter combination, very dense accounts, all error paths and a real Scribe drawer were not exercised. Narrow layout approximates the available-width effect of Scribe rather than implementing the drawer.

Application implementation must preserve existing shared components, canonical destinations, optional NoteField AI revision, manager-only record access, unknown/inaccessible connections and partial-source errors. Prototype boundary dialogs are not replacement product screens. Future implementation should test the blank-percentage behavior and progress provenance against real check-in responses, and avoid representing partially successful two-step backend writes as clean failures.


# Revision 2 verification

September 25, 2026. `prototype-v2.html` preserves the first concept and implements the outcomes-first exploration documented in REVISION_2.md.

- JavaScript syntax passed after the final changes.
- Visually inspected the goal board at 1440 × 1000, 1024 × 900 and 390 × 844. The phone document width was 390 with no horizontal overflow. The team-review dialog was also inspected at 390 pixels; its scroll width was 390.
- Logged a fictional measured value of 16 handoffs after simulating a failed save. The failure retained the form; success updated the value, chart, dated record and Updates feed. Current status stayed At risk, as selected.
- Logged a note-only update for the onboarding goal: the newest update became September 25, while the four-call reading retained September 4. The staleness reason cleared because the goal had a new check-in; the older measurement date remained visible.
- Verified the scope filter reduced the board to Support without inventing a scope for unassociated goals.
- Opened the selected goal's details and verified the numeric measure, reading-history disclosure, exact success metric, existing check-in history and goal controls remained available.
- Prepared a team review, started it, navigated to the next goal and ended it. Verified that update notes and manager controls were absent and status was excluded by default. The final revision also shows the exact success criterion beside the goal title.
- The original observed-account snapshot remains a read-only option. Numeric values in the fictional dataset are explicitly marked as a proposed capability. No account record was written.

Limits: the new measure-definition editor is not built; sample targets and units are fixed. Numeric validation exists but was not exhaustively exercised through every boundary in the browser. Existing goal CRUD is inherited from v1; this revision did not re-run every old CRUD case. No production behavior, permission model, data migration or multi-user interaction was tested. This is a design exploration, not evidence of adoption or retention.
