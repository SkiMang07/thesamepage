# Mission Control — Week in focus

## Status and purpose

Andrew selected this direction during a design-only exploration on September 24, 2026. He approved the revised clickable concept enthusiastically and requested a handoff to Claude for implementation. No application code, database, or live account was changed during the exploration. This package is a design proposal and implementation reference; it does not claim the design is already shipped or silently replace canonical current-state documentation.

Read `CLAUDE.md` first, then `docs/DESIGN.md`, `docs/systems/brand.md`, and `docs/systems/mission-control.md`. Inspect the existing dashboard and its real data contracts before implementing. Resolve intentional differences from older visual authority in favor of Andrew's selected direction here; preserve existing functional and data-integrity rules.

## Files

- `prototype.html`: portable, clickable browser preview. Open in a browser to inspect the design. It includes a standalone preview wrapper; some icon resources may require internet access.
- `prototype-source.html`: readable HTML/CSS/JavaScript source of the selected mockup. This is the primary visual and interaction reference for Claude. The wrapper and mockup state infrastructure are not production architecture.
- `BUILD_BRIEF.md`: this handoff, including decisions, boundaries, and validation.

The prototype uses illustrative names, schedules, percentages, statuses, goals, records, links, and counts. None of these should be copied into production fixtures or treated as verified current account data.

## What Andrew explicitly preferred

- A visually compelling, professional, data-first, clickable management dashboard.
- The original "Your week, in focus" concept over the two alternative "Relationship rhythm" and "Work in motion" concepts.
- Useful visual information, clear actions, and details that open on demand.
- A small, secondary next-move panel rather than a dominant recommendation hero.
- Remove "A little perspective. A clear way forward." Keep the main heading "Your week, in focus."
- Compact avatar/initial and name on the same row in the weekly calendar, so multiple conversations fit each day.
- Explore a maximum of four visible conversations before switching to an overflow pattern. The selected revision demonstrates four plus "View all 6 (+2)" opening a complete day agenda.
- Add goals and progress after follow-through, with Company / Team / Individual filtering.

The app's existing teal/carbon identity should carry forward. Andrew liked the editorial heading, larger purposeful numbers, human identity, restrained surfaces, and quieter recommendations. Do not replace this with a generic admin dashboard, decorative charts, giant AI recommendation, stock imagery, motivational copy, or a new task-management product.

## Page composition

1. Existing application shell, preserving real navigation and global controls such as Quick add, Scribe, and account actions. The mockup simplifies shell behavior for illustration; it is not permission to delete existing controls.
2. Small Mission Control label, then the editorial headline "Your week, in focus." No promotional subtitle.
3. Three factual, clickable metrics: completed conversations, completed commitments, and overdue commitments. Their scopes and denominators must be explicit and consistent with drill-downs.
4. A five-day conversation week, with names and compact initials side by side. Display meeting time and an accessible preparation/completion indicator. Highlight today subtly.
5. Follow-through: compact segmented bars for "Mine" and "My team", with Completed / Due this week / Overdue segments. Click a segment to see its actual underlying records.
6. A quiet right-hand column: "Your next move" plus limited "Keep in view" items. Selecting a conversation or metric replaces this column with contextual details; closing it returns to the recommendation overview.
7. Below this overview, a full-width "Goals & progress" section. Company / Team / Individual controls change only this section. Individual also provides a person selector. Each goal shows its name, recorded percentage when available, check-in date, and separately labeled status/freshness. Clicking a goal expands its supporting update and linked work directly beneath the goal cards.

Keep the composition, proportions, rhythm, readable contrast, and typography close to the prototype. The prototype's raw CSS values are illustrative: adapt to the real project's semantic tokens and shared components rather than duplicating a parallel design system. The existing product logo remains authoritative; the prototype uses an icon placeholder.

## Interaction reference

- Click a conversation in a day column: show person identity, meeting date/time, preparation state, context, commitments, and linked goal where the relationship exists.
- "Preview agenda" in the mockup is a local demonstration. In production, use the canonical prep/conversation workflow and preserve existing write and review behavior.
- Days are ordered chronologically. Show up to four rows; the overflow control states the total and hidden count. Opening it displays all of that day's meetings with full names, times, type, and prep state. Every hidden conversation remains reachable.
- Thursday deliberately has six conversations to demonstrate overflow; Friday has two. Three completed conversations out of eleven scheduled matches the sample calendar.
- Click a headline metric: show the matching records, not an unrelated destination or an unexplained score.
- Click a follow-through segment: filter by both ownership and state. Segment count and drill-down count must agree.
- Click Company / Team / Individual: update goal cards without changing the rest of Mission Control. Switching tiers or people clears an incompatible selected goal.
- Click a goal: reveal the latest check-in, what its percentage represents, and actual linked work. Close to return to the compact overview.
- The Team example includes both a stale check-in and a goal with no progress recorded. Preserve these distinctions.

## Data semantics to settle against the real application

These were not backend-validated during design. Check existing contracts before choosing an implementation:

- Use actual scheduled meeting dates and timezone-aware week boundaries. A conversation being due by cadence is not itself a scheduled calendar event. Handle unscheduled conversations separately and retain their useful existing actions.
- Preserve support for cross-functional conversations and team meetings where the existing data model supports them. Avoid forcing a group meeting into a one-person row or inventing a start time when only a date exists.
- Distinguish completed, preparation saved, and preparation not started without relying on color alone. For long or duplicate names, keep full identity available in accessible labels and expanded details.
- Count completions from recorded completion events/timestamps. Avoid counting all historical completed items as this week's completions.
- Define the follow-through cohort and make states mutually exclusive. Recommended interpretation for review: completed during the week; still-open items due later in the week/today; and still-open items overdue as of now. Confirm treatment of undated commitments and ownership overlap against current behavior. The mockup does not settle every production edge case.
- Follow-through bars display proportions within each ownership group, not a shared absolute-length scale. Display raw counts and denominators, and make empty groups explicit.
- Show a goal percentage only when a real recorded check-in supplies it. Do not infer it from status, fabricate historical values, or average unlike goals into a single company/team score.
- A goal without progress is "Progress not recorded", not 0%. A stale numeric value retains its date and warning. Completion percentage, health/status, and freshness are separate concepts.
- Company, Team, and Individual follow existing permission and organization scope. Do not broaden access to populate the overview.
- Company is the demonstrated default, not a settled universal onboarding requirement. Avoid an empty default when the manager has only team or individual goals; use existing product context to make a sensible choice.
- The prototype displays a few goals per tier. Production needs a bounded overview and a path to the full Goals page for larger sets. Reuse existing ranking, attention, or ownership rules; don't silently invent a cross-goal priority score.
- Only show evidence links that actually exist. Do not synthesize linked goals or ownership gaps merely to make a detail panel look complete.

## Preserve existing capabilities

- Existing Mission Control recommendation eligibility/ranking, source coverage/error handling, and inspectability.
- Why this? / Addressed / Snooze / Not relevant and other existing supported dispositions. The simplified mockup omits some controls; this is not a decision to remove them.
- Existing refresh and source-record refresh behavior.
- Canonical person, prep, meeting, goal, and commitment routes.
- Draft-then-review for AI-generated writes, auth/RLS boundaries, shared API layer, and all project hard rules.
- Scribe drawer and its reflow behavior; don't let a dashboard detail panel make the remaining content unusably narrow.

## Implementation approach

1. Inspect the source reference and open the portable preview. Establish what the existing frontend/backend can already supply.
2. Map each visible section and interaction to its real data source. Clearly identify any missing capability before adding speculative backend work.
3. Implement with the existing React/Next.js structure, tokens, shell, API layer, and shared components. Do not embed the standalone preview, its iframe wrapper, `window.openai`, `Tweak`, static sample records, or raw DOM `innerHTML` rendering in production.
4. Preserve visual fidelity while handling loading, partial failure, empty accounts, and dense real data.
5. Compare rendered implementation with the reference. Update canonical design/system docs only when the implementation changes current truth. Do not commit or deploy unless separately requested in the build session.

## Acceptance checks

- Main subtitle is absent; suggested next move remains visually secondary.
- Inspect desktop at approximately 1024px and 1440px, narrow layouts, and Scribe open.
- Calendar works with 0, 1, 4, 5, and 6+ conversations on a day; hidden items are selectable; long/duplicate names and undated meeting times remain understandable.
- Correct timezone/week edges, completed vs upcoming meetings, empty weeks, and unscheduled cadence-due conversations.
- Metric and segment drill-downs reconcile to displayed counts; no duplicated ownership or double-counted status.
- All three goal levels work; person switching works; restricted/empty scopes remain truthful.
- Valid 0%, 100%, no check-in, and stale check-in are distinct. Goals with different measurement types are not averaged.
- Existing recommendation actions and prep/goal routes still work.
- Keyboard operation, visible focus, accessible chart/meeting labels, and usable contrast. Preserve focus through updates; the disposable prototype's DOM replacement is not a production accessibility pattern.

## What was checked in the concept

The revised preview was viewed in Chrome at about 1024px width. The six-conversation overflow, selecting a hidden conversation, switching goal tiers, expanding a goal update, and switching the individual person selector were exercised. This was prototype verification only, not application/backend testing.
