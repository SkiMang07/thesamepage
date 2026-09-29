# Setup path — after the first prep sheet

## Status

Design proposal from 2026-09-29, not built and not approved. `prototype.html` is a clickable
preview (open in a browser; "Jump to" buttons in the top bar skip between states). All names,
drafts and documents are fictional. Nothing in the prototype is saved.

Andrew has approved the direction in conversation (2026-09-29) and defined "onboarded" below.
He has not yet reviewed this prototype.

## What "onboarded" means (Andrew, 2026-09-29)

A manager is onboarded when all five are true:

1. Team and org are set up (roster in teams, roles assigned).
2. Expectations are configured for each role in use (a job description can supply them).
3. Existing knowledge documents are imported.
4. At least one org goal and one team goal exist.
5. The first 1:1 is logged.

Until all five, the manager is not onboarded. Onboarding continues after the first prep sheet;
nothing here replaces the `/app/start` flow.

## The idea

The prep sheet the manager just built is the meter. It is shown built without whatever is
missing ("Built without: team and org, role expectations, knowledge, goals"). Each setup step
adds lines to that sheet, and each new line carries the source it came from. The "why" is shown
on the sheet, not argued in copy. A step that cannot visibly change the sheet does not belong on
the path.

- **Header chip** "Setup 2 of 5" with five segments, on every page until onboarded. Opens the path.
- **Path** on Mission Control: five steps, each with a one-line "what it changes" and a status.
  Expectations wait on team and org because roles come from there. Steps are otherwise any order.
- **Split view.** A step opens on the left, the sheet stays on the right and gains lines live,
  with a banner ("2 lines added from role expectations").
- **Assessments** shows in the sidebar from day one, locked, labelled "Setup". It opens on completion.
  This answers "when does the full nav return" without hiding doors.
- **Completion** is one receipt, the chip goes, Assessments unlocks. Then an optional "Next, when
  there is time" list (Projects, prep the other people, check-ins), explicitly not required.

## The five steps

| Step | What the manager does | AI drafts | Manager reviews |
|---|---|---|---|
| Team and org | Describes the org in their own words (type, dictate, paste, or upload a chart) | Structure: units, leaders, people, roles | Saves the structure |
| Role expectations | Adds a job description per role | Expectations from the JD (JD import exists) | Approves per role |
| Knowledge | Adds documents (Context Engine upload exists) | Category and summary (Librarian exists) | Confirms each |
| Org and team goals | Writes them, or drafts from a confirmed strategy document | Goal suggestions | Adds each |
| Log the 1:1 | Has the conversation, logs it | none | Saves |

Hard Rule 6 holds throughout: AI drafts, the manager reviews, nothing AI-written is saved unreviewed.

## Voice

Literal labels, no encouragement, no "let's". Sources cited on every line the sheet gains
("Customer Success Manager L2 expectations, approved by you"). "See", never watch/track/monitor.
The product never says "The Same Page" about itself. Completion copy is a statement of fact.

## Decisions (Andrew, 2026-09-29)

- "Nothing to import" counts as the knowledge step.
- Existing accounts with reports are marked onboarded by the migration.
- The Org door comes back rather than building org setup a separate home.
- No AI call unless one is needed. Context lines on the sheet are assembled from saved records.
- The fifth step is called "Log".

Pass 1 is built (status, nav, chip, path card); see `docs/ONBOARDING_SCOPING.md` §11 for what remains.

## Build notes (original list, kept for the record)

Confirm each against the real code and schema before building.

1. **Stored flag.** The five conditions can be derived, but "onboarded" has to be sticky: archiving
   a goal later must not un-onboard someone. Add `users.onboarded_at`, set server-side the first
   time all five are true. A status endpoint returns the five booleans plus `onboarded_at`.
   Dated migration and matching `schema.sql` edit.
2. **Existing accounts.** Anyone with reports today (Andrew's own) must be marked onboarded by the
   migration, or they land in setup.
3. **Knowledge escape hatch.** The prototype has "Nothing to import" so a manager with no documents
   is not stuck. Andrew's rule was "imported". Decide whether declaring none counts. If it does,
   store it (for example `knowledge_skipped_at`). Recommended: yes, with the link visible but quiet.
4. **Org setup vs the hidden Org door.** Org is hidden for launch, but org setup is now required.
   The step needs its own surface (or reuses the org builder inside the step) without bringing the
   Org door back. The "describe your org" draft is a new AI endpoint.
5. **Goal scope.** Confirm how org-level and team-level goals are distinguished in the schema before
   writing the condition.
6. **Expectations condition.** "Each role in use" must match `getSetupStatus()`, which today
   reports `roles_with_expectations_count` and `people_without_role_count`. Roles with nobody in
   them should not block completion.
7. **AI cost.** In the prototype, new sheet lines appear the moment a step is saved. In the build,
   assemble context lines from the saved records with no AI call, and reserve a model call for an
   explicit "Rebuild the sheet" button. Each drafting step (org structure, goals) is one
   button-triggered call. Per-manager AI spend is a margin constraint.
8. **Recorded meetings.** Andrew wants meetings recorded for full value. Notes ingestion is scoped
   (`docs/NOTES_INGESTION_SCOPING.md`) but not built, so step 5 is a manual log for now. It does
   not gate on recording.
9. **Analytics.** One event per step completed (`count` only, no names) plus `onboarded`, added to
   `docs/systems/product-analytics.md` before shipping. The saved PostHog funnel gets the new steps.
10. **Return path.** The 1:1 date can be days away. The path and the chip persist across sessions,
    and the Mission Control ranker can surface the next step as a candidate so a returning manager
    lands on it.

## Not in this proposal

- Projects, prepping the rest of the team, check-ins, Beyond the team (listed as optional depth after completion).
- Capacity and Org doors. Still hidden for launch.
- Changes to `/app/start` steps 1 to 3.
