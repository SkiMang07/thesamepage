# A person's role expectations are their starting goals, read live, never copied

**Status:** Accepted and implemented 2026-10-21 (commit carrying migration
`2026-10-20_goals_from_expectations.sql`). Current behaviour:
`docs/systems/goals.md` → From their role.

## Context

In Susie's onboarding run she expected individual goals to come from the
expectations she had just set for the role, and found the Individual tab empty.
Two personas split: one read an expectation *as* the goal, the other said nobody's
goals come out of a ladder. The Manager's Playbook keeps them separate
(expectations belong to the role; a goal is a direction plus a measure for a
period) but says to put them next to each other. Andrew decided (2026-10-20) that
individual goals start from the role's expectations, and setup still never asks
for an individual goal.

## Decision

- **Live, then personalise.** Goals and the person page show the person's current
  approved role expectations as their starting goals, read live from the role.
  A goal record exists only when the manager makes one specific to the person, and
  it keeps a link to the expectation (`goals.source_metric_config_id` /
  `source_skill_config_id`).
- **One number track.** A measured expectation's readings are `metric_entries`,
  written by hand as well as by a completed assessment. A goal linked to a measured
  expectation carries its own target but no readings of its own (D7).
- **Judged once.** An assessment shows a linked goal under its expectation, never as
  a separate item.

## Rejected alternatives

- **Copy:** one goal per expectation per person on approval or assignment. Seven
  people × six items is 42 records to keep in sync, a revision leaves stale copies,
  nothing reviews them, and the number lives in two places.
- **Prefill only:** start a goal from an expectation in the form. Leaves the
  Individual tab empty, which is the confusion being fixed.
- **Goal readings on `check_ins` for linked goals:** two tracks for the same number.

## Consequences and limits

- Expectation rows don't roll up, can't be cancelled, and aren't in Needs review.
- "Below the bar" shows only when the target text is unambiguous
  (`backend/expectation_bar.py`); there is no structured target to compare against.
- `metric_entries`' policy now also checks the report is the caller's on write.
- Not built: prep sheets citing the latest reading.

## Reopen if

Managers want per-person variants of the standard bar itself (not a stretch), or
rollups of "N of 7 meeting the bar" need expectation rows to behave like goals.
