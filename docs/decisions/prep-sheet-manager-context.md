# Manager-side context on the prep sheet: restate, hold, never scrub

**Status:** Accepted and implemented (2026-10-03). Current behaviour:
`docs/systems/one-on-ones.md` → Prep.

## Context

The prep drafter kept turning manager-side context into lines for the report:
reading the person, inventing facts ("HR has flagged this"), and choosing an
action for the manager ("I want you to know HR has asked me to start
documenting performance here" from the note "HR wants documentation"). Two
prompt rounds (0427acc, 850399e) fixed the invented facts but not the scripted
disclosure. The prep sheet will become visible to the direct report; manager-only
notes will not. There is no employee login yet.

## Decision

1. **The AI does not classify or scrub what the manager types.** The manager is
   responsible for what goes on the sheet. Their context is restated in their
   words (`from_your_notes`, the summary).
2. **Restate by default, script on request.** Suggested lines are questions the
   report can answer; a line that tells the report something is written only
   when the notes say the manager intends to tell them or asks for wording.
3. **A deterministic guard holds, never drops** (`backend/prep_guard.py`). Lines
   carrying HR, leadership, another roster person, a performance process, an org
   change, a pending decision, a comparison, unraised personal life or the
   manager's own state are moved to "Held for you" and shown to the manager.
   Escalation words about HR/leadership that the record never used are flagged
   "Not in your notes".
4. **What the manager owes always has a line** (Andrew, 2026-10-03). The
   model tags each item with the commitments it covers; code adds a fixed
   status line ("This one's on me. Here's where it stands.") to any item tagged
   with a manager-owed commitment that has none. Chosen over word-matching items
   to commitments (misses and mismatches) and a stronger prompt (held 1 in 2).
5. **Audience is in the stored sheet, default manager.** Each item carries
   `audience: "manager"`; only `title` and `suggested_questions` could ever be
   shared, and only once the manager shares the item. No migration
   (`prep_guide` is jsonb). Absent = manager.

## Rejected

- **A third prompt rule only.** Two rounds proved the prompt does not hold.
- **AI classification of "internal" content.** It may over-read and silently drop
  what the manager wrote.
- **Deleting flagged lines** (what `private_lane.report_facing` did). Silent
  loss; the manager can't decide about a line they never see.

## Consequences and limits

- Lexical: tone ("given the numbers", "What's actually going on?") is a prompt
  rule only; a boss named without being tagged as the boss in the notes is not
  caught; career questions said as questions pass, statements about a pending
  promotion or pay are held.
- The owed line depends on the model tagging the item. An untagged item gets
  nothing added; the fixed line reads the same every time.
- Deferred, not built: UI copy telling managers the sheet is shareable, a private
  notes area, a way to move a held line back into the questions, the employee
  view itself.

## Reopen when

The employee view is designed (audience becomes live), managers routinely say a
held line aloud anyway (the hold is noise), or persona runs show a disclosure
shape the guard misses.
