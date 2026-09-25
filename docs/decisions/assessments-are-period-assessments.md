# Assessments are period assessments, prepared by AI and decided by the manager

**Status:** Accepted and implemented 2026-09-25 (`b2c1cf6`). Supersedes the 2026-08-04
choice of a rolling scorecard with `performance_reviews` left dormant, and, for
Assessments only, the app-wide convention that AI is an optional assist
(`docs/DESIGN.md` → AI in the UI).

## Context

The rolling scorecard asked managers to re-rate items at any time from empty inputs,
with "Draft with AI" as a side button fed by five 1:1 summaries. Real use is a
quarterly or biannual review conversation, sometimes off-cycle. The scorecard had no
period, no draft state, no record of what evidence a rating rested on, and nothing
useful to take into the conversation.

## Decision

- An assessment covers an explicit, manager-chosen period and lives on the activated
  `performance_reviews` row: resumable draft, evidence snapshot, conversation, and a
  frozen completion snapshot. One open draft per person.
- AI leads the preparation — a source-cited picture, "What's missing or needs
  context?", a draft against each item's own scale, and discussion — while every
  recorded value is set or explicitly confirmed by the manager in one final review.
  Manual assessment is the same flow without proposals.
- Completion is the only writer of ratings (`complete_performance_review()`, one
  transaction, retry-safe) into the existing tables, so latest-rating readers are
  unchanged.
- Private material is read only on a per-assessment opt-in; sources without a reliable
  person link are reported as not included rather than mined.

## Rejected alternatives

- **Keep the rolling scorecard and improve the draft.** Leaves no period, no evidence
  trail and no completed artifact, and encourages frequent re-rating.
- **A new assessment-session table.** `performance_reviews` already had the period,
  manager scope, RLS and "not shared" flag; activating it was the smaller change.
- **Per-row approval of every AI proposal.** Turns review into a ritual; one explicit
  confirmation of a fully displayed set is stronger and faster.
- **Automatically reading private notes because they are readable.** Widens a privacy
  boundary without the manager choosing to.

## Consequences

- Earlier rolling ratings remain history and still count as the latest rating until a
  completed assessment supersedes them; the UI labels them as such.
- Anchoring remains a live risk (`ai-drafts-never-saves.md`); the mitigation is the
  auditable draft, not yet measured.
- No eval covers the four assessment AI calls, and they were not run against the live
  model before release.
- Reopening or correcting a completed assessment is out of scope.

## What should reopen this

Managers accepting drafts substantially unedited; a need to share assessments with
reports or run org-wide cycles; evidence that the period framing doesn't match how
customers actually review.
