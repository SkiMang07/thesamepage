# Setup mode, chunk D: modals, fading, receipt, ranker, "Built without" (plan)

Written 2026-09-29. Status: BUILT (see `docs/archive/scoping/ONBOARDING_SCOPING.md` section 11). Where this plan and the code differ, the code and section 11 win: "Built without" uses four labels (`org goals` and `team goals` separately), and the goals step's candidate links to `/app/dashboard?setup=goals`. Chunks A to C are pushed (`origin/main` = `322d7f3`). Read `SETUP_MODE_BRIEF.md` (design rules) and `docs/archive/scoping/ONBOARDING_SCOPING.md` section 11 first. Open questions are at the bottom; the build starts once Andrew answers them.

## What chunk D is

The layer that makes setup mode feel guided without nagging, and lets it end cleanly:

1. Entry modal: what setup is and why, shown once.
2. Prompt fading and dismissals on the setup card.
3. Completion modal with a receipt, and a "next, when there is time" list.
4. A Mission Control ranker candidate that brings a manager back to the next step.
5. The prep sheet's "Built without" line, the one place the "why" is shown, not argued.
6. Split view: see question 2. Recommended: not now.

No AI call anywhere in D. Every string is computed from records or fixed copy.

## What already exists (and is reused)

- `build_status()` / `evaluate()` / `next_step()` in `backend/routes/onboarding.py`; `SetupPath.tsx`; the header chip in `AppNav.tsx`; `useZoneData().onboarding`.
- The ranker (`backend/mission_control_engine.py`): `_candidate()`, `_disposition_suppresses()`, `build_brief()`. It already has a `setup_dismissed_today` event type, sent from `WeekInFocus.tsx` and honoured through `mission_control_events`, so a candidate can be dismissed and stay dismissed without a new mechanism.
- The prep sheet's sources line: `prep_drew_on()` in `backend/routes/one_on_ones.py` (shared by manual `/prep` and the overnight worker), stored as `prep_guide.drew_on`, shown in `reports/[id]/prep/page.tsx` as "Drew on ...". Older sheets simply lack the field.
- Telemetry pattern: catalog row first in `docs/systems/product-analytics.md`, server-side capture, counts and enums only.

## 1. Entry modal

- Shown once, on the first Mission Control load where the manager has a prep sheet, is not set up, and has not seen it. Not on the save receipt: that screen is the win and stays uncluttered.
- Content, fixed copy: what setup is (team and org, role expectations, goals), why (each one adds lines to the sheets and unlocks Assessments per person), how long (about 10 minutes, in pieces, any time), and that leaving is fine. Two buttons: "Start with <next step>" (goes to the step, same as the card's action) and "Later" (closes; the card is there).
- Escape and click-outside close it and count as "Later". Focus trap and return focus, as `NotesDumpModal` does.
- Stored: `users.setup_intro_seen_at` (stamped on either button). Analytics: `setup_intro_resolved` with `action` (`started` or `later`).

## 2. Prompt fading and dismissals

Three levels for the card on Mission Control, computed on the server by one pure function so it is tested without a database:

- **full**: today's card (highlighted step, time, one button).
- **quiet**: one line, "Setup n of 3. Next: <step>." with a Continue link. No step list.
- **hidden**: the card is not drawn. The header chip stays. It is the requirement that persists; only the volume changes.

Rules (proposed, tunable in one constant):

- A "Not now" link on the full card is the dismissal. Each one snoozes the card: 1 day, then 3, then 7, then 14 (capped). While snoozed the level is hidden.
- Quiet, not full, after the first dismissal or 7 days since the entry modal, whichever comes first.
- Doing a step (any step completing) clears the snooze: momentum earns the full card back for the next step.
- At most one prompt per screen: the card and the ranker candidate (section 4) never show together. Hidden or quiet card means the candidate may appear; a full card suppresses it.
- Stored on the user row: `setup_card_dismissals` (int), `setup_card_snoozed_until` (timestamptz). Analytics: `setup_card_dismissed` with `dismissals` (int, after this one) and `level_before` (enum).
- Object-level hints (a person added later with no role) are untouched: they are not setup mode, stay permanently, stay quiet.

## 3. Completion modal, receipt, next list

- Trigger: status has `set_up` true and `setup_receipt_seen_at` is null. Shown once on the next Mission Control load, with "Done" as the only required action. The chip and the card are already gone because `set_up_at` is stamped.
- Grandfathering: the migration stamps `setup_intro_seen_at` and `setup_receipt_seen_at` from `set_up_at` for every user already set up, so existing accounts never see either modal.
- Receipt, counted from records at read time, no AI: teams and people placed, roles with expectations (and how many people they cover), org and team goals held. Plain sentences, past tense, no cheer. One line on what changed: Assessments now open for everyone with a role.
- "Next, when there is time", at most three, each shown only if it has something to act on, each optional and labelled so: prep the other people (people with no prep sheet), start a project (none exist), set up check-ins (goals with none). Fixed set, ordered by a fixed rule, no ranking model.
- Endpoints: `GET /api/onboarding/receipt` (only answers while pending; otherwise `null`) and `POST /api/onboarding/receipt-seen`. Analytics: `set_up_receipt_seen` (no properties).
- Onboarded stays a separate, silent state. No modal for it.

## 4. Ranker candidate: return to the next step

- New candidate type `resume_setup_step` built in `_build_candidates` from a new snapshot key `setup` (next step key, label, done count, days since last setup progress). Entity is the user's own setup step, `entity_type: "setup"`, key `resume_setup_step:<step>`.
- Eligible only when: activated, not set up, a next step exists, and the card is quiet or hidden (section 2). A parked goals step ("Waiting on your boss") is not next, so it never nags.
- Rank: deliberately low and fixed (about 10 points, one component labelled "Setup step waiting"), below anything with a date. It surfaces only when nothing due outranks it. Action is the step's own href, same as the card.
- Dismissal reuses `setup_dismissed_today` (snoozed to the next local day, as `WeekInFocus` already does), so no new event type. Fingerprint includes the step and done count, so finishing a step re-arms it.
- Tests: eligibility matrix, rank below a due 1:1, suppression while the card is full, re-arm after a step completes.

## 5. "Built without" line on the prep sheet

- `prep_drew_on()` gains a sibling, `prep_built_without()`, returning plain labels for setup inputs missing for THIS sheet at build time: "team and org" (this person has no team), "role expectations" (`has_role_expectations` false), "goals" (no org goal or no team goal). Empty list means no line.
- Stored in `prep_guide.built_without` (jsonb, no migration), written by the manual `/prep` path and the overnight worker through the shared builder, exactly as `drew_on` is.
- Shown on the sheet next to "Drew on ...": "Built without: role expectations, goals." A quiet link on the line goes to the missing step. Older sheets lack the field and show nothing. Once set up, new sheets have an empty list, so the line stops on its own; no flag to remove later.
- Voice: a statement of fact about the sheet, never a warning or a nudge to hurry. Nothing here says the AI judges the person.

## 6. Split view

Not planned for this build. The VP seat's review put it on the cut-or-delay list until per-step analytics exist (they do now) and a real with-context versus without-context sheet has been compared (it has not). Sections 4 and 5 already give the delta on the sheet and the return path. If Andrew wants it, it is a separate session: it needs the step screens to render inside a panel, which touches expectations, org and goals pages.

## Migration (one file)

`database/migrations/2026-10-01_setup_mode_prompts.sql` and the matching `schema.sql` edit: `users.setup_intro_seen_at`, `setup_receipt_seen_at` (timestamptz), `setup_card_dismissals` (int not null default 0), `setup_card_snoozed_until` (timestamptz), plus the backfill from `set_up_at`. Status reads the columns softly (a deploy before the migration loses only the fade state); migrate before pushing, as in chunk C.

## API and files

- `backend/routes/onboarding.py`: `card_level()` (pure), status gains `intro_pending`, `receipt_pending`, `card` (`level`), `POST /card-dismissed`, `POST /intro-seen`, receipt endpoints.
- `backend/routes/telemetry.py` or the onboarding router for the three new events (catalog rows first).
- `backend/mission_control_engine.py` and `routes/dashboard.py`: snapshot key and candidate.
- `backend/routes/one_on_ones.py` and `backend/jobs/nightly_prep.py`: `built_without`.
- `frontend/lib/api.ts`: types and calls (Hard Rule 3). `frontend/components/SetupIntroModal.tsx`, `SetupCompleteModal.tsx` (new), `SetupPath.tsx` (levels, "Not now"), `ActionBrief` / `WeekInFocus` candidate rendering, `reports/[id]/prep/page.tsx` line.
- Docs: section 11 gets a "Built (chunk D)" paragraph and the "Not built" paragraph shrinks; catalog rows; `docs/systems/product-analytics.md` Setup mode read guide.

## Build order (one session, three slices, each committed on its own)

1. Catalog rows, migration, backend: `card_level`, status fields, receipt, endpoints, ranker candidate, `built_without`. pytest for each pure function and route (fade schedule, snooze cap, momentum reset, grandfather backfill, receipt only once, candidate eligibility and rank, `built_without` per missing input, no text in any event).
2. Frontend: two modals, card levels and "Not now", candidate rendering, sheet line.
3. Verify in proportion: full pytest, `tsc --noEmit` on a clean checkout of HEAD, throwaway Postgres for the migration and backfill. No model call to verify, since D has none. Then the `tsp-push` closeout. Andrew's steps: run the migration in Supabase, `git push`, test on the deployed app.

## Cautions

- Unrelated modified files in the working tree are never staged.
- Copy follows `voice-rules.md`: literal labels, no cheer, "see" not watch/track/monitor, the product never says "The Same Page" about itself.
- Modals only for entry, parse-and-review and completion (rule 3). No tour engine (rule 7).

## Open questions for Andrew

1. Where fading state lives: new columns on `users` (recommended: follows the manager across devices, one small migration) or browser storage only (no migration, resets per device).
2. Split view: defer (recommended) or build in this chunk.
3. How hard the ranker pulls: below anything dated (recommended), only when fewer than three other candidates exist, or above due work.
4. Entry modal timing: first Mission Control load after the first sheet (recommended) or on the first-run save receipt.

## Decisions (Andrew, 2026-09-29)

1. Fading and dismissal state: columns on `users`.
2. Split view: deferred.
3. Ranker candidate: below anything dated, never while the full card is on screen.
4. Entry modal: first Mission Control load after the first sheet.
