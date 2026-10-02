# Capture by person: scoping and comparison

**Status:** proposed 2026-10-02, nothing built. Andrew picks before any build.
**Prototype:** `prototype.html` in this folder (open in a browser; fictional data throughout).
**Replaces:** the single "Add what you already have" notes dump as the main setup intake (`NotesDumpModal.tsx`, `backend/routes/notes_dump.py`).

---

## 1. The two decisions

1. **Intake shape.** Keep the dump with chips (A), capture per person (B), or per person pre-filled from a dump (C).
2. **Where it lives.** Keep the separate setup layer we built beside the app (modals, setup card, parse/apply routes), or fold intake into the surfaces the app already has.

**Recommendation:** B, delivered inside the app (person page and Team), with the dump retired once B clears an offline eval gate. C only if B shows a drop-off we can measure. Reasons below.

## 2. Why the dump keeps failing

Round 3 (2026-10-01), review screen only, nothing saved:

- **Jamal:** inputs clean, but the Gwen summary defaults to "You owe Brennan" and needs one chip tap.
- **Dana:** the lapse leak is gone, but Andre, Mei and Lena show "nothing to draft from". A run-on spoken sentence is dropped whole by the lapse guard because a sentence is the smallest taggable unit.
- **Renata regression:** passes.

Every fix since 2026-09-30 has been another guard on the same question: *which person is this sentence about, and which direction does it point?* The code that answers it:

| Piece | Lines (wc -l) |
|---|---|
| `backend/intake_slices.py` (sentence-to-person slicing, lapse splitting) | 694 |
| `backend/intake_placement.py` (cites, role sentences, unplaced) | 180 |
| `frontend/lib/notesDumpPlacement.ts` (lanes, chips, moves) | 191 |
| Their three test files | 755 |
| **Attribution machinery total** | **1,820** |
| Plus roughly 300 more lines in `notes_dump.py` (`clean_statement` through `rank_and_cap`, approximate) | ~300 |

This is the part B makes unnecessary. When the manager is typing into Mei's card, the text is about Mei. Nothing to guess.

What B does not remove: direction ("I owe her" versus "she owes me") is still read from text, but inside one person's words, and the review step already has a direction toggle (`WrapUpReview`).

## 3. What the separate space costs today

Onboarding-only code, counted with `wc -l`, non-test unless noted:

| Layer | Files | Lines |
|---|---|---|
| Notes dump (parse, apply, placement) | `notes_dump.py` 1,387 · `intake_slices.py` 694 · `intake_placement.py` 180 · `NotesDumpModal.tsx` 870 · `notesDumpPlacement.ts` 191 | 3,322 |
| Setup state and card | `onboarding.py` 818 · `setup_status.py` 104 · `SetupPath.tsx` 556 · `SetupIntroModal.tsx` 96 · `SetupCompleteModal.tsx` 112 | 1,686 |
| Org goals modal | `OrgGoalsModal.tsx` | 405 |
| First-run door | `app/app/start/page.tsx` | 376 |
| **Code total** | 12 files | **5,789** |
| Their tests | 5 Python test files + 1 `.mjs` | 2,556 |

That is about 7.5% of the app's TypeScript and non-test Python (46,301 + 30,671 lines). Not huge. The cost is less size than **duplication of write rules**:

- `apply_items` re-validates and writes to `org_units`, `direct_reports`, `goals`, `dr_capture_notes`, `commitments` and `role_expectation_drafts`. Each of those already has a normal screen with its own rules. Two paths into the same tables means every rule change lands twice.
- Twelve `users` columns exist only to run the setup layer (`set_up_at`, `onboarded_at`, `setup_*_at`, `setup_card_*`, `setup_skipped_steps`, and others).
- A setup card, a header chip, a ranker candidate (`resume_setup_step`) and a "Built without" label all hang off it. Those are worth keeping in some form; they are the derived-status idea, not the modal.

So your instinct is right, with one correction: the first-run door (`/app/start`) and the status derivation are not the problem. The **parse-everything-then-apply-everything modal** is.

## 4. Intake options

All three save only what the manager checks, through the commitment record and review step from prep (decided 2026-09-30). The AI drafts; the manager saves.

### A. Today's dump plus chips (current)
One box, one AI read, lane and person chips on every row, Unplaced section.
- **Good:** one sitting, works for a manager who has one doc to paste.
- **Bad:** attribution is guessed, so every fix is a new guard. Spoken run-ons lose content. 1,820 lines of machinery. Hard to evaluate (round 3 needed three browser personas and a blocked Save).

### B. Per-person capture cards (recommended)
The roster from first-run step 2 already exists, so there is a card per person. Each card has:
- **Their job** (optional): what they own. Feeds the role-expectations draft directly. Replaces the "About the role" lane.
- **Where things stand** (optional): anything else. Typed, or 30 seconds of speech.
- Team and role as plain fields on the card (same fields as Settings → People), not inferred.
- **Read** gives that person's review: what you owe them, what they owe you, kept thoughts. Same rows and toggle as the wrap-up review.
- "Nothing to add" is a valid answer per person. Cards ordered by soonest 1:1; stopping after two is fine because sheet 1 and 2 need only those people.

Attribution is by construction. A sentence in Mei's card that names Andre gets one deterministic flag ("this mentions Andre: move it to his card?"), not a model pass.
- **Good:** nothing to guess, smaller calls, easy to eval, per-person progress is natural, the role draft can only read the "Their job" box (no lapse or promise leaks by design).
- **Bad:** slower first sitting. Six people at about 45 seconds is a few minutes; nine is longer. No "paste my whole doc" shortcut. N small AI calls instead of one (the 10 a minute limit on parse needs revisiting).

### C. Hybrid: the dump pre-fills the cards
Paste once, the read splits it into suggestions that land in each person's card, muted, with Accept / Edit / Clear. Unmatched sentences wait in a "Not placed" list.
- **Good:** keeps the paste-a-doc shortcut; the manager still confirms per card.
- **Bad:** keeps all the guessing code (slicing, lapse guards) *and* adds the card UI. It fails exactly where A fails, just with a nicer review. Most code of the three.

| | A | B | C |
|---|---|---|---|
| Attribution | guessed, then chips | by construction | guessed, then per card |
| Role draft leak risk | guard code | none by design | guard code |
| First sitting | fastest | slowest | fast |
| Code vs today | same | about 2,100–2,500 lines out, 800–1,200 in (estimate) | about 1,000 more than A (estimate) |
| Eval-able offline | hard | easy | medium |
| Fits "match the main app" | no | yes | partly |

## 5. Where it lives

**Separate space (today).** A card on Mission Control opens modals that parse and apply across six record types.

**Integrated.** Intake is the app's own surfaces, in setup mode:
- **Team and roles** and **what I know about each person** become one thing: the person row/card on Team, with Team and Role fields and the capture composer. The composer is the capture feature the person page already has (`createCaptureNote`, captures that feed prep). Setup adds a review step to it; it does not add a place.
- **Role expectations:** the "Their job" box is the existing "What the job description doesn't say" field (`context`) plus description mode, started from the person.
- **Org goals:** the paste-and-review flow moves onto `/app/goals` as an empty-state action, same code, no modal on Mission Control.
- **Setup card, chip, ranker candidate, "Built without":** stay, as pointers into those pages. The status derivation (`onboarding.py`) stays. The intro and completion modals are the first thing to cut.

What it deletes: `NotesDumpModal`, the parse/apply routes and their write-path copies, the attribution machinery, most of the dump's analytics. What it keeps: `/app/start`, derived status, "Built without".

What it costs: no single "everything at once" screen. Mitigation: a roster strip above the composer ("Mei ✓ · Andre · Lena ...") so the team stays visible while walking it.

**Recommendation:** integrated. Combined with B, the setup path stops being a different product. A manager who adds a person in month six uses the same composer they used on day one.

## 6. Design of the recommended path (B, integrated)

**Flow.** Setup card "Add what you know" → person page (composer focused, roster strip, "Next: Andre") → Read → review → Save → next person.

**AI.** One call per person through `ai_core.generate_text`, built on the wrap-up draft shape (`POST /api/one-on-ones/wrapup`, `_build_wrapup_prompt`) with the person already fixed. Returns commitments (each with `committed_by`), kept thoughts, and, from the "Their job" box only, a hint toward a role. Draft only; the manager saves (Hard Rule 6, `docs/decisions/ai-drafts-never-saves.md`).

**Save.** Commitments go to `commitments` with `committed_by`; kept thoughts go to `dr_capture_notes`. **It must not create a past 1:1.** `logOneOnOne` files a session, and a session with a summary counts toward "onboarded" and becomes "last 1:1" on the person page. Background notes are not a conversation. So the review component is reused, the save path is not. To confirm in build: whether the wrap-up prompt works unchanged for notes that are not a call, or needs a `background` mode.

**Role draft.** Starts from the person's "Their job" text plus the role's existing path in `role_expectations`. The sentence-lane filter goes away because the box is the lane.

**Schema.** None expected. Confirm in build.

**Analytics.** Counts and enums only, catalog row first: per-person read/saved/skipped, edit share (the existing `ai_draft_resolved` with a new surface).

## 7. Risks and honest costs

- **Drop-off on a long roster.** The ops persona has nine reports. Mitigation: order by soonest 1:1, say plainly that two people is enough for the first sheets, derive progress from records. Measure it before adding C.
- **Per-person speech friction.** Thirty seconds per person is more starts and stops than one monologue. The mic button must be the lead control on the card, not a secondary one.
- **Rate limits.** Nine reads in a row will hit the current 10 a minute on parse. Needs a per-person limit.
- **Cross-person text.** "Mei and Andre both..." in one card. The deterministic flag handles the obvious case; the eval tests it.
- **Migration of the doc trail.** `ONBOARDING_SCOPING.md` §11 and `docs/systems/one-on-ones.md` need rewriting to the present when this lands; the dump's decisions move to the archive.

## 8. Offline held-out eval (replaces browser persona reruns)

Browser reruns cost a login reset, a blocked Save, and an unreadable second half (role drafts were never inspected in round 3). They also can't compare options on the same input.

**Set.** About 40 labelled pastes: the Jamal, Dana and Renata pastes and their variants from `business/digital-customers/personas/*/sessions/`, plus synthetic ones that stress run-on speech, pronouns, "both of them", people not on the roster, lapses ("he did twice and then stopped"), and promises phrased as expectations. 30 for development, 10 sealed. I draft the labels; Andrew audits the sealed 10.

**Gold per paste.** For each sentence: person (or none), lane (you owe, they owe, role, private, none). For each real commitment: person, direction, due date if stated.

**Metrics.**
- *Severe error:* a commitment saved under the wrong person, or a flipped direction. Gate: zero on the sealed set.
- Commitment recall; direction accuracy; role-leak rate (a promise or lapse in the role draft's input); share of gold content dropped; cross-person bleed (B only).

**Runner.** `eval/test_notes_intake.py` next to `eval/test_assistant.py`, calling through `ai_core.py`, using a temporary copy of `backend/.env` that is deleted afterward (per `CLAUDE.md`). It runs the same pastes through A (today's pipeline), B (pastes split by gold person, which is what the cards deliver) and C. It reports one table, so the choice is on numbers.

**Judging onboarding by the first and second prep sheet.** Per fixture persona, build sheet 1 and sheet 2 from the saved records of each option, plus a no-intake baseline. Score blind on a rubric: (a) items grounded in a saved record, (b) zero wrong-person content, (c) open commitments surfaced with the right owner, (d) sheet 2 carries forward from the logged 1:1, (e) nothing invented where the record is empty. LLM judge for the rubric, Andrew reads about 10 pairs. Live, the same idea: edit share on the prep draft (`ai_draft_resolved`), whether sheet 2 is made within 14 days, and the "Built without" count.

## 9. Build order (one chunk per session)

1. **Eval first.** Labelled set, runner, baseline scores for A. No product change. Gives Andrew numbers for the pick.
2. **Composer and per-person read.** Card component, per-person draft through `ai_core`, review reusing the wrap-up rows, save to commitments and capture notes (no fake 1:1).
3. **Into the app.** Team and Role fields on the card, roster strip, "Their job" into the role draft, setup card pointing at person pages, org goals onto `/app/goals`.
4. **Gate and retire.** Run the eval on B; if the sealed set has zero severe errors, remove A behind the flag, delete the machinery and the two modals, rewrite the docs.

## 10. For Andrew to decide

1. B recommended. Agree to retire the dump once B passes the gate?
2. Integrated, no separate setup space, with the setup card and chip kept as pointers?
3. Team and role as explicit fields on the person card, instead of read out of text?
4. Is the slower first sitting acceptable (a few minutes for six people), given "two people is enough to start"?
5. Org goals stay a paste-and-review action, moved onto `/app/goals`?

## 11. Not verified

- Whether the wrap-up prompt works for non-call notes (section 6).
- Where Brennan's "Call review on his discovery calls, once." landed in the Jamal review (carried from the handoff, still unchecked).
- Line counts above are `wc -l` on the working tree; the "about 2,100–2,500 out, 800–1,200 in" figures are my estimates, not measurements.
- Housekeeping from the handoff: commit `0b4dd87` says 18 placement tests where the real count is 19; a stale `.git/HEAD.lock` blocked amending it. Left alone.
