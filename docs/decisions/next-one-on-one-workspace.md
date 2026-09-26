# Next 1:1 is a persistent workspace

**Status:** Implemented. Amended 2026-09-26: synthesis may also happen
overnight before a dated meeting (see "Amendment" below). The overnight path is
built but parked — no worker is running — until calendar sync or the weekly
email makes it worth turning on.

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

AI synthesis remains just-in-time. Logging the prior meeting does not
immediately generate the next agenda, because later captures, commitment
changes, and record updates would make that sheet stale.

### Amendment (2026-09-26): overnight prep

A dated occurrence with no sheet is prepared in the night before it (today or
tomorrow, from 07:00 UTC) by the background worker, at half price through the
Batch API. This is still just-in-time: it is keyed to a date the manager set,
it runs at most a day ahead, and it reads the same sources the source review
includes by default — the carry-forwards and kept opening line on the
occurrence, captures, open commitments, at-risk goals, the development plan —
through the same assembly as a manual Prepare.

What stayed deliberate: the manager's own Prepare always wins (the worker
writes only while the occurrence has no sheet and no summary, checked again at
the moment of writing); the sheet says "Prepared overnight" and lists what it
drew on; "Rebuild" is the existing source review, where anything can be removed
and the agenda regenerated. Captures are consumed only once the sheet is saved,
and only the ones it read — the same move a manual Prepare makes, into the
sheet's source notes where "Edit prep" reads them back. A prep sheet is a
working draft for the conversation, not an entry in the record, so this is not
an AI write under the draft-then-review rule.

Why the original reasoning does not forbid it: the rejected alternative was a
sheet generated *at wrap-up*, weeks before the meeting and at full price. The
staleness risk shrinks from weeks to hours, and the manager gains a sheet
waiting when they open the person page. The first thing to measure is whether
overnight sheets are rebuilt more often than hand-made ones; if they are, the
window is too early or the defaults are wrong.

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
after wrap-up, or if overnight sheets are routinely rebuilt (a sign they read
stale sources or the wrong defaults).
