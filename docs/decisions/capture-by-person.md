# Setup intake is captured one person at a time

**Status:** Accepted (2026-10-02). Implemented in the commit that adds `person_intake.py`; removal of the old notes dump is pending.

## Context

The setup notes dump asked the model to split one block of text across the whole roster and attribute each line. Three rounds of prompt and guard work (sentence slices, placement, lane guards) never made attribution reliable enough. Wrong attribution corrupts commitments and later assessments, and a manager who sees their words misfiled stops trusting the product.

## Decision

Intake happens on each person's page. The page fixes the person, so the model never chooses one. Guards: sentences naming another roster person are never sent to the model (shown as "Not read"); every drafted row must carry an exact quote from the manager's text or it is dropped; the side of a commitment (`manager` / `direct_report`) is never defaulted and the manager must pick before saving. AI drafts, the manager saves, and no 1:1 is invented.

## Rejected alternatives

- Keep the dump and add chips (A): still relies on model attribution.
- Dump that pre-fills per-person cards (C): same attribution risk, with more code to keep.

## Consequences

Slower than one paste for a whole team, accepted: correctness over speed. About 1,800 lines of attribution machinery become removable.

The prep page reuses the same reader on the note a sheet was just built from ("Promises in your note", `source: "prep_note"`, commitments only), so promises in a first note become commitments the manager confirms. The guards are the same; the prompt body adds one prep-note rule (agenda lines are not commitments). See `docs/systems/one-on-ones.md` → Promises in the note.

## Reopen if

Measured attribution on a sealed per-roster eval reaches zero severe errors, or per-person capture shows setup completion falling sharply.
