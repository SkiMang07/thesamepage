# Voice system

Layer 5, and the last layer of the brand foundation. How The Same Page sounds, on
every surface, in the product as well as the marketing. Read before writing a sentence
anyone outside will read, and before naming a field, a button or an empty state.

This file absorbs and replaces the earlier partial rules document. Everything that
bound before still binds; it now sits inside a system rather than beside one.

Upstream: `point-of-view.md` (what we believe), `messaging.md` (what we claim),
`gtm/personas/new-manager.md` (who reads it), `gtm/positioning.md` (what we are).

Every rule here traces to evidence in `gtm/research/audience-2026-08.md` or to a
decision Andrew made and recorded.

---

## The register

Given ~25 headline options across six angles, Andrew picked **zero** from the "lonely
in the middle" group and **zero** that framed the reader as deficient. Every pick
clustered on clarity, evidence, and what good looks like.

**How to apply:** the reader is a manager who wants to be good at this and expects to
be addressed as a professional. No hand-holding, no "we know it's hard," no
empathy-first framing. **Craft and rigor, not comfort.** Cold and accusatory phrasing
is rejected just as firmly. Confident and even, aimed at neither pity nor blame.

The four traits below are how that register gets applied sentence by sentence.

---

## The four traits

Each falls out of a belief. None of them is a mood.

### 1. Plain to the face

Belief 3 is a voice principle wearing product clothes. The record gets written the way
you'd say it to the person it's about, and so does everything else we write. No
defensive hedging. No abstraction standing in for a thing we could name.

*Sounds like:* "There's nothing in here she hasn't read."
*Fails as:* "Full transparency into performance data for both parties."

### 2. Observational, never accusatory

Describe the situation. Don't instruct the reader out of it. Managers indict
themselves heavily and unprompted; a second-person imperative just piles on.

*Sounds like:* "Four reports and it worked. Seven and it didn't."
*Fails as:* "Stop letting your system fall apart."

### 3. Evidence over adjective

Given ~25 headline options across six angles, Andrew picked clarity and specificity
every time and zero from the emotional-appeal group. Show the particular thing rather
than characterising it. A date, a number, a quoted sentence, an actual behaviour.

*Sounds like:* "This came up on the 12th and again on the 26th."
*Fails as:* "Recurring performance concerns."

### 4. Even

Neither warm blanket nor cold audit. No pity, no blame, no encouragement, no
disappointment. This is the trait that protects the coach and the one most likely to
slip, because every default in product copy pulls toward cheerful.

*Sounds like:* "Nothing logged for Priya since the 4th."
*Fails as:* "No notes yet. Let's get started!" and equally as "You're behind on Priya."

---

## The three hard rules

Traits are calibration. These are constraints, and a line that breaks one is wrong
regardless of how it reads.

### The grammar rule

**Say what they said, in the grammar they said it in. First person and observational,
never second person and imperative.**

Managers write about themselves in the first person ("I dont think I can just chalk it
up to being disorganized"). A reader already indicting himself doesn't need us doing
it for him.

Worked: "Stop reconstructing the year from memory" has the right content and the wrong
grammar. "Reconstructing six months from half-memory" is a real manager's sentence
about himself. "They made you a manager. Nobody made you ready" is cut for the same
reason.

### The surveillance verb

Use **see**. Never *watch*, *track*, or *monitor*. The product is one bad verb from
reading as employee surveillance, which the research establishes as a documented
category risk rather than a hunch. Applies everywhere: marketing, product UI, blog,
field labels, error strings.

### The AI line

AI is welcome **upstream** of the manager's judgment and offensive at or after it.
**The boundary is saving, not drafting.**

> The model can draft against the manager's own scale, using evidence the manager can
> see. It never saves a value, never scores from activity, and never fills a gap the
> evidence doesn't support. Every value that enters the record is set by the manager.
> Undisclosed is worse than not doing it at all.

An earlier version of this rule put "a draft the manager rewrites: fine" beside
"producing a rating: not," which left a drafted rating in both columns and settled
nothing. Never write copy implying the product judges a person, and never write copy
claiming it abstains from drafting. It drafts, it leaves blanks where the evidence is
thin, and the manager sets what lands. **That restraint is the claim. Abstinence
isn't.**

---

## Register by surface

The traits hold everywhere. How tight, how warm and how much personality changes.

| Surface | Register | Why |
|---|---|---|
| **Homepage** | Clipped two-beat declaratives. Structural claims. Coldest register we use | Brand, direct and second-visit traffic. It carries the argument, so it can't also be chatty |
| **Blog / Field Guide** | First person, longer, looser, warmer. One manager talking | Arrives from search with no relationship. It has to earn the argument before it makes it |
| **Product UI labels** | Literal and neutral. No voice at all | A label with personality is a label you read twice. Voice in a field name is a bug |
| **Empty states** | One observational line. Never encouraging | "Nothing logged for Priya since the 4th." The state is information, not a prompt |
| **The coach** | Even, sourced, never disappointed | Highest-risk surface in the product. Its own section below |
| **Lifecycle email** | First person, from Andrew, short | Solo founder pre-launch. Sounding like a company is worse than sounding like a person |
| **Errors** | What happened, what to do. No apology theatre | "Couldn't reach the file. Try again or upload it directly." |

**Body prose is warmer, longer and looser than headlines.** That gap is deliberate and
it's Andrew's own register. Headlines stay clipped; the paragraph underneath breathes.

---

## The coach's voice

The product's most dangerous sentences live here. Belief 4 says the coach hands the
manager back their own judgment. Everything below exists so that lands as a mirror
rather than as a scold. The concession in `point-of-view.md` is the reason: **the calm
version of the manager isn't automatically right**, so the coach can never speak as
though it is.

**It cites, always.** Every time it hands something back it says where the thing came
from and when. "You wrote this in March" is a different object from "you believe X."
Unsourced, it's just software with opinions.

**It never characterises the manager.** No "you're being inconsistent," no "this isn't
like you." It describes the record and stops.

**It never sounds disappointed.** The "you said you'd..." construction is the parent
voice and it's banned outright. Same for "as a reminder" and "don't forget."

**It offers a departure as a question, never a verdict.** *Here's what you wrote, here's
what's different now, which one do you mean?* The manager may have grown since they
wrote it. The coach can't tell the difference and shouldn't pretend to.

**It goes quiet when it has nothing sourced.** The empty-box rule from the assessment
draft applies to language too. Silence beats a generated observation.

**It never uses the word coach.** The product doesn't coach the manager, it hands them
their own thinking back. Calling it coaching invites the comparison we lose.

Worked pair:

> ✗ "You said you'd address the deadline slippage two weeks ago."
> ✓ "This came up on the 12th and again on the 26th. Same thing both times."

---

## Say / never say

Verified against the corpus. The left column is the reader's own language.

| Say | Never say |
|---|---|
| my team, my reports, one of my reports | your workforce, your people, talent, headcount |
| 1:1 (digits) | check-in, touchpoint, meeting cadence |
| hard conversation, tough conversation | difficult conversation, crucial conversation |
| doing a good job, where they stand | performance management, engagement score, eNPS |
| notes, context, prep | track, monitor, watch, visibility into, dashboard |
| what's reasonable, how fast someone should work | competency framework, leveling, career architecture |
| they said they'd do it and they didn't | commitment tracking, accountability culture, action items |
| I forget, I can't remember, half-memory | recency bias, single source of truth, actionable insights |

"Recency bias" is known-but-clinical: a tech manager will recognise it and would never
reach for it to describe their own week.

Added by `messaging.md`: never *transparency*, *permissions* or *who-can-see-what*
(the category's argument, and using it concedes ours), never *insights*, never *best
practices*, and never a claim that the product won't draft a rating.

### Ours, and unverified

Do not present these as the reader's language. They may still be right; they have to
win on merit rather than on authenticity.

| Phrase | What the corpus shows |
|---|---|
| the bar | **One** instance in ~120 quotes, in the opposite direction: "lowered the bar more than I should have." **Retired as a device.** Allowed only inside a manager's own quoted sentence |
| what good looks like | **Zero** instances anywhere. **Kept out of copy.** Fine in `PRODUCT_VISION.md`, where it's Andrew's own framing |
| mission control | Never tested against the corpus. Ours, and it has to win on merit |
| what I owe them | Zero instances. It came from a research pass's own synthesis, not a quote |

---

## The standard, named

One noun for the thing set in advance, used the same way in product and in copy.

- **what I expect** / **expectations**, manager-facing. Already the product's own noun.
- **what we agreed**, for anything involving the report. Carries co-ownership without a
  word about sharing.
- *the standard* and *the benchmark*, body prose only, never a headline.

---

## Andrew's prose rules

Apply to any long-form copy written in his voice, and to this folder's own documents.

- No em-dashes. Spaced hyphens or ellipses, sparingly.
- Never begin a sentence or clause with "not," and never begin a sentence with "But."
- Use contractions.
- Headlines stay clipped. Body prose is warmer, longer and looser.

The homepage language audit found the em-dash rule does most of the work on its own:
12 em-dashes in body copy were all doing the same job, appending a corrective or
portentous clause. Deleting every one **and refusing to replace it with a comma** takes
out most of the correctives and most of the metered balance at once, because the dash
is what sets up the second beat. Watch also for "not X but Y" constructions,
rule-of-three lists, "actually," and anaphora runs.

---

## Worked examples

| ✗ | ✓ | The rule |
|---|---|---|
| "Stop reconstructing the year from memory." | "Reconstructing six months from half-memory." | Grammar |
| "Track what your team is working on." | "See what's happened since the last one." | Surveillance verb |
| "Managing people is hard. We get it." | "Four reports and it worked. Seven and it didn't." | Even, observational |
| "Cut review prep from two hours to ten minutes." | "Write the review from what's already written down." | Never lead on time saved |
| "AI that never rates your people." | "It drafts against your scale. Nothing saves until you set it. Where the evidence is thin, it leaves the box empty." | The AI line |
| "You said you'd address this two weeks ago." | "This came up on the 12th and again on the 26th." | The coach |
| "No notes yet. Let's add your first one!" | "Nothing logged for Priya since the 4th." | Empty states |
| "Full transparency into performance data for both parties." | "There's nothing in here she hasn't read." | Plain to the face |

---

## What an H1 has to satisfy

**The H1 is still open on purpose.** This is the test it has to pass, not the line.

1. It carries **one** pillar. On the homepage that's pillar 1.
2. First person or structural. Never a second-person imperative.
3. A competitor selling to People Ops couldn't sign it.
4. It's true of what's shipped, or it argues the principle rather than describing a
   feature. The IC view isn't built.
5. **It survives being said out loud to a report.** This one falls straight out of
   belief 3 and it's the fastest disqualifier we have.
6. No *track*, *watch*, *monitor*, *transparency*, no time saved, no *the bar*.

---

## The original board principles, preserved

From the Miro board, and all three still hold.

- Lead with the manager's pain, not the product's features.
- "Mission control for your team" is the right metaphor, single surface, everything
  you need to be a confident manager. *(Ours and untested. See the table above.)*
- Avoid HR-speak. Use manager-speak: "how's my team doing," "what do I say in this
  conversation." *(The research turned this into the specific lists above.)*

## Do not lead on time saved

The weakest claim available and the one axis where a free model already wins. Lead on
the work being right and unsurprising. Time saved is a benefit, never the argument.

---

## Related
`point-of-view.md` (the beliefs) · `messaging.md` (the pillars and the proof) ·
`gtm/personas/new-manager.md` (the reader) · `gtm/positioning.md` ·
`gtm/research/audience-2026-08.md` (sources and gaps).
