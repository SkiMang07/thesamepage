# Product walkthrough page — argument

The case the product walkthrough page makes, in order, before any pixels exist.
Companion to `homepage-argument.md` — same format, same voice rules.

Sources: `homepage-argument.md` (locked copy system, the three-moves promise this
page fulfills), `positioning-source.md`, and the current-state subsystem docs —
`docs/systems/one-on-ones.md`, `mission-control.md`, `expectations.md`,
`scribe.md`, `team.md`, `context-engine.md`. This page describes what the product
actually does today, not the fuller Mission Control vision in
`PRODUCT_VISION.md` — nothing here gets ahead of what's built.

---

## The decisions this rests on

**Job of this page, and what it is not.** The homepage wins the argument that
the pain is real and worth $20/mo. This page is where someone who's already
half-convinced comes to check whether the product is actually real, or just a
landing page — the click target for the homepage's ghost CTA ("See how it
works") and the nav's "Product" link. So this page doesn't re-argue the pain
and doesn't re-use the research stats; homepage did that. It shows the
mechanism, screen by screen, in the order a manager would actually hit it.

**Five steps, not three.** The homepage's "Three moves" section is the
condensed pitch: define, capture, see. This page is the uncondensed version —
five steps, because the real product has two moves worth showing that the
homepage's three-card grid had no room for: the Scribe (talk to it instead of
filling out forms) and Mission Control's actual ranking mechanics (not just
"see where everyone stands," but *why* that candidate, today). Skipping
either would make this page redundant with the homepage instead of a genuine
deeper cut.

**Order follows the product's own data dependency, not a feature-importance
ranking.** Expectations has to exist before a 1:1 prep can ground itself in
it; a 1:1 or the Scribe has to produce records before Mission Control has
anything to rank. Showing Mission Control first (the flashiest screen) would
look like a dashboard with no explanation of where the data came from — which
is the exact "just dashboards" complaint Section 5 of the homepage positions
against. So: **Expectations → the 1:1 loop → the Scribe → Mission Control →
the Team workspace.**

**A dedicated trust section, not a footnote.** `scribe.md`'s hard rule ("the
model has read tools only... it cannot write to the database, ever") and
`mission-control.md`'s AI boundary ("AI cannot select, reorder, add facts,
infer causes, or write a source record") are two of the most defensible,
concrete claims in the whole product. Most competitors' AI claims are vague
("AI-powered insights"); this product can say exactly what the model is and
isn't allowed to do, in plain language. That's worth its own section between
the Scribe step and Mission Control — positioned right where a reader would
otherwise start wondering "wait, what happens if the AI gets it wrong."

**Layout departs from the homepage's three-card grid.** Five items in a
3-column grid forces an awkward 3-then-2 wrap, and this page's whole reason
to exist is *more room per step* than the homepage gave it. Full-width rows,
alternating the screenshot side left/right, each with a larger `.shot`
placeholder than the homepage's moves cards. Visually distinct from the
homepage section it extends, not a bigger copy of it.

**No new proof stats.** The 71% engagement stat and the manager-overwhelm
figures already ran on the homepage. Repeating them here would spend the same
material twice on a reader who, per the referral path above, likely just came
from there. This page's proof is the mechanism itself and the trust section —
not more research citations.

**One CTA, at the close only.** Following the About page's precedent: this
page's job is to build enough confidence to click, not to interrupt that
build with asks along the way. The nav's persistent "Start free" button
already covers a reader who's convinced by step two. Unlike Contact, this
page *does* end on the standard close-CTA block — the tour has to land
somewhere, and "Start free" after five real screens is a stronger ask than
the same button floating in the nav.

**Real screenshots are still blocked.** Same placeholder convention as
`moves.module` — dashed border, sunken fill, a one-line label naming what the
real screenshot will show. Five placeholders here instead of three, each
labeled precisely enough that dropping in the real screenshot later is a
pure swap, no copy rewrite.

---

## Section 1 — Frame

**Job:** tell the reader what kind of page this is before they scroll — a
walk-through of five real screens, in the order they'd hit them, not a
marketing recap of the homepage.

| Slot | Line |
|---|---|
| Eyebrow | Product |
| H1 | Here's exactly what happens. |
| Sub-headline | Five screens, in the order you'd actually use them — from writing down what "good" means to knowing, on any given morning, who needs you and why. |

No CTA in this section, matching About's precedent (see decisions above).

## Section 2 — Step 1: Set the standard once

**Job:** show that "define what good looks like" is a real, structured thing
— not a text box. This is the foundation everything downstream reads from,
so it goes first.

| Slot | Copy |
|---|---|
| Number | 1 |
| Heading | Set the standard once |
| Body | Metrics, skills and values, per role and per level — the thing every manager means to write down and never does. Build a ladder for a role once, and every level under it inherits the shape. Values that apply company-wide are set once, not copy-pasted into every role. |
| Detail line | Starting from a blank page is optional — paste a job description in and get a first draft of the expectations for that role. Nothing is saved until you review it and confirm it, exactly like everything else this product drafts for you. |
| Screenshot label | Screenshot — role ladder, metrics/skills/values by level |

Grounding: `expectations.md` — `role_levels`/`role_families`, org-wide values,
the coverage grid, JD-import AI draft with nothing persisted pre-review.

## Section 3 — Step 2: Let the evidence collect itself

**Job:** this is the highest-frequency loop in the product — the 1:1 — and
the section that has to do the most work, since it's the mechanism the
founder story and the homepage both point back to.

| Slot | Copy |
|---|---|
| Number | 2 |
| Heading | Let the evidence collect itself |
| Body | Jot a note the moment something happens — no need to wait for the meeting. When it's time to prep, everything you've captured, every open commitment, and anything carried over from last time is already sitting there for you to review before the agenda gets built. |
| Detail line | Every prep ends on one mandatory question, every time: what do you actually want to walk out of this conversation having said? After the call, notes become a draft summary and a list of commitments — yours to edit, cut, or approve before any of it is saved as a record. |
| Screenshot label | Screenshot — 1:1 prep sheet, situation summary and agenda |

Grounding: `one-on-ones.md` — capture notes, automatic-assembly-then-
deliberate-synthesis prep, mandatory closing question, draft-then-review
wrap-up, carry-forward.

## Section 4 — Step 3: Or just tell it what happened

**Job:** introduce the Scribe as a second way in, not a replacement for the
forms — and set up the trust section that follows by naming the read-only
constraint plainly, in product terms rather than engineering terms.

| Slot | Copy |
|---|---|
| Number | 3 |
| Heading | Or just tell it what happened |
| Body | "Sarah and I agreed she'll own the migration doc by Friday" is a sentence, not a form. Say it to the drawer and it drafts the commitment, finds Sarah on your roster, and shows you exactly what it's about to save — you confirm, or you don't. |
| Detail line | It can read what's already in your workspace to get the match right. It cannot write anything on its own — not a commitment, not a goal, not a check-in — until you say so. |
| Screenshot label | Screenshot — Scribe drawer, a drafted commitment awaiting confirmation |

Grounding: `scribe.md` — read-only tools plus `emit_draft`, v1 verbs
(create/append only), ambiguous-match asks rather than guesses, 30-second
undo on the two entity types that support it.

## Section 5 — AI drafts. You decide.

**Job:** the trust interstitial — three short, specific, checkable claims
about what the AI in this product is and isn't allowed to do. Reuses the
three-claim visual pattern already established for the homepage's
competitive section (`claims.module`), so it reads as a sibling section
rather than a new visual idea mid-page.

| Slot | Copy |
|---|---|
| Eyebrow / heading | AI drafts. You decide. |
| Sub-headline | Every AI-generated word in this product goes through the same rule: it proposes, you confirm, and only then does anything save. |

Three claims:

- **Nothing writes on its own.** The Scribe's model can read your workspace
  and stage a draft. It cannot call the database. The write happens when you
  click confirm, through the exact same endpoint the manual forms use.
- **Every summary is a draft, not a save.** A 1:1 wrap-up, a team meeting
  wrap-up — both land on an editable review screen first. Add a commitment
  it missed, cut one it got wrong. Nothing is a record until you say it is.
- **Ranking is arithmetic, not opinion.** What Mission Control puts in front
  of you first is a deterministic score from your actual records — dates,
  status, staleness. AI can add one plain-language sentence explaining a
  candidate. It cannot reorder your list, invent a fact, or decide something
  is urgent on its own.

## Section 6 — Step 4: See where everyone stands, ranked for you

**Job:** now that the reader has seen where the data comes from and trusts
how AI touches it, show the payoff screen — and be specific that it's a
ranked short list with reasons, not a dashboard of tiles.

| Slot | Copy |
|---|---|
| Number | 4 |
| Heading | See where everyone stands, ranked for you |
| Body | Open the app and get one suggested focus, up to two quieter priorities, and a plain answer to "is anything on fire" — not a wall of cards to scan yourself. |
| Detail line | Click "Why this?" on anything and see the actual evidence behind it: what's due, how stale it is, what it's based on. Mark something addressed or snooze it and it stays out of your way — nothing about your team's underlying records changes because you dismissed a suggestion. |
| Screenshot label | Screenshot — Mission Control action brief, Now/Next/Watch |

Grounding: `mission-control.md` — the Now/Next/Watch runway, deterministic
domain-neutral scoring, `Why this?` evidence expansion, Addressed/Snooze/Not
relevant as presentation-only dispositions that never mutate source records.

## Section 7 — Step 5: Zoom out to the whole team

**Job:** close the tour by showing the product isn't only a person-by-person
tool — it rolls up to a team view without turning into a second, competing
dashboard.

| Slot | Copy |
|---|---|
| Number | 5 |
| Heading | Zoom out to the whole team |
| Body | One page for "my team as a unit": what's overdue, what's at risk, and the meeting rhythm underneath it all — with everything healthy tucked behind a click instead of competing for your attention. |
| Detail line | It's not a second scorecard. There's no team health number, no morale score — just the same kind of factual brief as your own dashboard, scoped to the team instead of to you. |
| Screenshot label | Screenshot — Team workspace, attention brief and live follow-through |

Grounding: `team.md` — the deterministic attention brief (explicitly not a
team score), live follow-through ordered by due date, operating work with
at-risk items surfaced first, the roster.

## Section 8 — Close

**Job:** the same ask as everywhere else on the site. Reuses the locked
site-wide close line verbatim.

> Get on the same page. Stay there.

Same CTA (**Start free**), same founding-counter treatment as every other
page's close. One CTA, and it's earned by this point in the page.

---

## SEO

- **Title tag:** `Product — The Same Page`
- **Meta description:** "See how The Same Page actually works — set the
  standard for a role, let 1:1 evidence collect itself, and know who needs
  you first, every morning." (155 characters)
- **H1** ("Here's exactly what happens.") deliberately distinct from the
  title tag, same convention as About and Contact.
- Alt text for each `.shot` placeholder gets written when the real
  screenshot goes in — same open item as About's founder photo.

## Visual direction — decided 2026-08-26

The first prototype pass (flat, About/Contact-style treatment) read as too
bland — confirmed against Andrew's own reaction and against his separate note
that the app's dashboard has the same problem. Three genuinely different
directions were sketched on a design canvas (bold editorial scale, a
product-native/browser-chrome treatment, and a warm serif/narrative
treatment); **bold editorial won.**

`walkthrough.html` now carries that direction through all five steps, not
just the two sketched on the canvas: oversized display type for the H1 and
every step heading, huge low-opacity "ghost" numerals (01–05) behind each
step, hard alternating light/dark carbon bands between steps, the homepage's
bar-chart motif blown up into a real graphic under the hero, and — replacing
the flat dashed `.shot` placeholders — small illustrative mock cards (role
ladder bars, a 1:1 prep card, a Scribe draft-commitment card, a Mission
Control Now/Next/Watch card, a team attention-brief card) standing in for
real screenshots until the demo-data session happens. These are clearly
stylized placeholders, not attempts at pixel-accurate UI.

**New: a display typeface, `Bricolage Grotesque`, scoped to this page only.**
Nav and footer are untouched — same `--sans` system stack as every other
page, same shared chrome. The display face is used for the H1, the step
headings, and the ghost numerals only. This is a real, deliberate departure
from `build-process.md`'s current state ("the font stack is a literal... when
a real typeface is chosen it becomes a proper font field") — worth a decision
before this gets cut into theme code: promote `Bricolage Grotesque` to a real
theme font field and let other pages opt into it, or keep it walkthrough-only
as a one-page accent. Flagging rather than deciding.

**Hero copy is still a placeholder.** Andrew is holding off on positioning
text for this page until later — six alternate headline/tagline candidates
were drafted in conversation (not written to this file, since none are
locked) and can be dropped in whenever he's ready. The visual system doesn't
depend on which one wins; every candidate discussed fits the same scale
treatment.

## Open questions

- **Screenshots.** All five are placeholders until the demo-data session
  happens (same blocker noted across `build-process.md`). Labels are written
  precisely enough that swapping in real images shouldn't require a copy
  pass.
- **Module reuse vs. a new module.** `build-process.md`'s planned module list
  already names `walkthrough-step` — this page is the reason it's on that
  list. The alternating-side layout described above doesn't exist in any
  built module yet (`moves.module` is a fixed 3-column grid); that's a
  build-phase decision, not a prototype-phase one, but flagging it now so it
  isn't a surprise when this gets cut into theme code.
- **Where "Product" sits in the nav.** The nav already has a "Product" link
  pointing nowhere (`href="#"` in the built prototypes). This page is what it
  should point to — worth confirming there isn't a different plan for that
  nav slot before wiring it up.
- **Whether Mission Control's screenshot should show the `Why this?`
  expansion open or closed by default.** Left as a build-time call once a
  real screenshot exists — the copy above works either way.
