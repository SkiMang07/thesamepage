# Setup mode: build brief (next sessions)

## Status

Direction agreed with Andrew on 2026-09-29 after a review by the VP of Customer Success seat. Chunks A and B are built (2026-09-29; see `docs/ONBOARDING_SCOPING.md` §11 and `CHUNK_B_PLAN.md`); C and D are not. Andrew said nothing is locked and it will iterate. Where a point is marked PROPOSED, confirm it with Andrew before building; everything else is his stated decision.

Full reasoning: `~/Desktop/Obsidian/main/02 Areas/Digital Team/vp-customer-success/reviews/2026-09-29-onboarding-soup-to-nuts.md` (read the review and both addenda) and the seat's log `decisions.md` in the same folder. Current built state: `docs/ONBOARDING_SCOPING.md` section 11 and this folder's `BUILD_BRIEF.md`.

## Definitions

- **Activated:** first prep sheet saved. Already happens in `/app/start`.
- **Set up** (Andrew's list): team members added, org structured, roles set, people connected to org and roles, goals for the team and the company, role expectations. Team goals are the manager's to write. Org goals already exist in most companies: the manager fetches them and adds them so the product can see what the wider business is delivering.
- **Onboarded:** set up, plus first 1:1 logged, plus a second prep sheet that carries forward from that log. Confirmed by Andrew 2026-09-29.
- Knowledge documents fold into the notes dump and stay optional; they are no longer a setup step. Confirmed by Andrew 2026-09-29.
- "Log a 1:1" left the setup conditions; the chip reads "n of 3" (`backend/routes/onboarding.py`).

## Design rules for setup mode

1. Same look and feel as the product. Not a separate app.
2. Hide only what cannot work yet. Show it locked with the reason and unlock condition. Everything that already works stays visible. Assessments unlocks per person once that person's role has expectations, replacing the single global lock (confirmed by Andrew 2026-09-29).
3. Modals only for: entry ("what setup is and why"), the parse-and-review task, and completion. Everything else is an inline prompt at the moment a step would visibly improve what is on screen.
4. One persistent chip; at most one prompt per screen; dismissals remembered; intensity fades with time and dismissals, the requirement does not.
5. Highlight one next step, collapse the rest, show time estimates (the prototype has them, the built card does not).
6. At completion: receipt, scaffolding removed, full product. Hints on a single record ("no role yet" for someone added later) stay permanently and stay quiet.
7. Do not build a tour engine. Solo founder.

## Content on-ramps (Andrew's edits)

- **Notes dump:** one entry point, talk / type / paste / attach, of anything from past conversations and information. Parsed into drafts for org, roles, goals and per-person history. What it did not find becomes the manager's remaining steps. Never required (a newly promoted manager may have nothing). Nothing saves unreviewed (Hard Rule 6). Rank and cap what is shown for review. State plainly what is stored.
- **Role expectations:** push the manager to attach a job description, or "draft with AI" from a short spoken or typed description of the role. Mark each line's source ("from your description" versus "typical for this role, not from you"), leave a box empty rather than invent it, ask for one real example and where each metric's number lives. Sequence by payoff: the next 1:1's person's role first.
- **Org goals:** paste or attach, the product drafts, the manager confirms. Capture period and owner; refresh prompt each quarter. "Don't know yet" is a recorded answer that becomes an agenda item for the boss meeting in Beyond the team.

## Suggested build order (one chunk per session)

A. Definitions and state: setup versus onboarded, chip, next-step highlight, locked doors with unlock conditions, per-step analytics (count only; catalog row in `docs/systems/product-analytics.md` first). Migration only if the state needs it.
B. Notes dump on-ramp, end to end.
C. Role-expectation on-ramps and org-goal ingestion.
D. Modals, prompt fading, completion receipt, split view if still wanted.

## Constraints

Voice: `gtm/brand/voice-rules.md` (literal labels, no cheer, product never says "The Same Page" about itself). No AI call unless needed; each drafting step is one button-triggered call. Existing accounts with reports stay onboarded (grandfathered); `onboarded_at` stays sticky. Andrew's release path: run the migration, push, test on the deployed app; no local env for him; one terminal command at the end. Close out with the tsp-push skill.
