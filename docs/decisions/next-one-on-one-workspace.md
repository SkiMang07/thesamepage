# Next 1:1 is a persistent workspace

**Status:** Implemented

## Context

The person page exposed suggested topics, captured notes, carry-forwards, and
commitments as separate filing actions. Managers had to decide repeatedly what
to “save for prep,” even though all four sources already belonged to the next
conversation. The resulting rows also made capture notes look like duplicate
commitments.

## Decision

Every completed 1:1 leaves one unfinished next-meeting occurrence, scheduled
when a recurring date is known and otherwise undated. That occurrence is the
persistent workspace where context gathers.

Carry-forwards attach to the occurrence. Captures remain quick between-session
notes. Commitments remain live accountability records and are linked into prep,
never copied. Current goal and development signals are derived live. All sources
are included by default and reviewed together before the manager generates the
agenda.

AI synthesis remains deliberate and just-in-time. Logging the prior meeting does
not immediately generate the next agenda, because later captures, commitment
changes, and record updates would make that sheet stale.

## Rejected alternatives

- Keep the separate “+ Agenda” and “Save for prep” actions with clearer labels:
  this preserved the administrative work and the false impression of separate
  destinations.
- Generate the next prep sheet automatically at wrap-up: this created an early,
  stale snapshot and spent an AI call before the manager needed the agenda.
- Copy commitments onto the next occurrence: this would create a second source
  of truth for completion and due-date changes.

## Consequences

An undated unfinished occurrence has the derived `gathering` state. The 1:1
overview continues to rank by cadence and does not treat gathering as a scheduled
meeting. Removing a commitment during source review excludes it from that agenda
only; the commitment itself remains open.

Revisit if managers consistently expect a fully generated agenda immediately
after wrap-up, or if just-in-time synthesis latency becomes the dominant obstacle
to starting a meeting.
