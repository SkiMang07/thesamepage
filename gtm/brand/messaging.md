# Message hierarchy

Layer 4. One value proposition, three pillars, proof under each, and which pillar
leads on which surface. This is the document that turns page-writing from invention
into assignment: every line on every surface should be traceable to a pillar, and any
line that isn't is either a new pillar or it's cut.

Built on `point-of-view.md` (layer 3). The rules in `brand/voice-rules.md` bind every
sentence here. The reader is `personas/new-manager.md`.

**This does not settle the H1.** The value proposition below is the thing every page
must be consistent with. It isn't a headline and shouldn't be used as one.

---

## The value proposition

> The Same Page keeps the record of your team where both of you can see it, ready
> before every conversation, measured against what you said good looked like when you
> were thinking clearly.

Three clauses, three pillars, in that order. If a page contradicts any clause, the
page is wrong. If a page can't be traced to a clause, it's off-message.

---

## Pillar 1: kept with them, rather than about them

**The claim.** The record of someone's work is written to be read by the person it's
about. That's what makes it worth keeping and what makes it honest.

**Carries beliefs 1, 2 and 3.** This is the positioning pillar and the one no
competitor can sign while People Ops is the buyer.

**In the reader's grammar:** *there's nothing in here they haven't seen.*

| Proof | Status |
|---|---|
| Manager-owned by construction. No HR tier, no upward visibility into 1:1 notes | **Shipped.** Structural, and the strongest single proof point we have |
| The report has a real account: invite, magic link, claim | **Shipped** (`direct_report_invites`, `accept_direct_report_invite()`) |
| The report-facing view of their own record | **Not built.** `frontend/app/app/ic/page.tsx` is a 56-line stub |
| Manager-only notes, kept out of the shared record | **Partly.** `dev_plan_manager_notes` is an append-only log on a development plan. There is no per-person comp and no HR-risk object in the schema |

**Do not claim "your report can see it" as a present-tense feature until the IC view
ships.** Until then this pillar argues the principle and the ownership model, which
are both true today, and the shared view is roadmap. Overclaiming here would poison
the one pillar that has to be unimpeachable.

**Say:** kept with them, they've seen it, nothing here is a surprise, my notes, my
record. **Never say:** transparency, visibility, sharing settings, permissions,
who-can-see-what. Granular permission controls are the category's argument and using
that vocabulary concedes ours.

---

## Pillar 2: ready before the conversation

**The claim.** The thing I wanted to raise on Tuesday is in front of me on Thursday,
and what we agreed doesn't quietly fall off.

**Carries belief 4** on the weekly clock. This is the highest-frequency value, the
most complete part of the product, and the reason the record survives the week
nothing else does.

**In the reader's grammar:** *I keep meaning to bring this up and I keep forgetting.*

| Proof | Status |
|---|---|
| Capture a thought about one person between sessions, from anywhere | **Shipped** (`/{report}/captures`) |
| Who's due, per person, with the cadence resolved rather than assumed | **Shipped** (`/one-on-ones/overview`, the single canonical computation) |
| Prep built from what's already there, attached to the actual occurrence | **Shipped** (`POST /prep`) |
| Wrap-up that produces the summary, the commitments and the carry-forward in one pass | **Shipped** (`POST /wrapup`) |
| The running log per person, so November reads rather than reconstructs | **Shipped** |

**This is the pillar that beats a free model, and the argument has to be precise.** A
model pointed at Jira and Slack can tell you what happened last quarter, and it'll do
it fast. What it can't do is hold the thing you decided to say next time, carry an
open commitment across three conversations, or know that this is the second time
you've let the same thing slide. Continuity is the claim. Speed is not.

**Say:** the thing I wanted to raise, what we agreed, prep, before the 1:1, carried
forward. **Never say:** action items, meeting cadence, touchpoint, check-in, never a
time-saved lead.

---

## Pillar 3: grounded in what you said matters

**The claim.** The prep, the coaching and the assessment come from your expectations,
your documents and your own notes. Generic management advice is generic because it
can't know any of that.

**Carries beliefs 4 and 5.** This is where the coach lives, and the whole AI line
resolves here: the model isn't supplying judgment, it's handing back judgment the
manager already made, at the moment they can't reach it.

**In the reader's grammar:** *I need someone who knows my team, not another book.*

| Proof | Status |
|---|---|
| What a role is expected to deliver, know and embody, set in advance, per level | **Shipped** (`role_families` / `role_levels`, metric + skill + value configs, each with its own scale) |
| Assessment against your own scale rather than a vendor's | **Shipped** (rolling, `assessment_levels` seeded per org and editable) |
| Your company's real documents, extracted, confirmed by a human, then cited when used | **Shipped** (Context Engine: Space, Librarian, Brain, `document_citations`) |
| Coaching that reads person history against your stated leadership principles | **Partly.** It works when principles are uploaded as a document. There's no object called *how I manage* |
| AI that drafts against your scale and never saves a value you didn't set | **Shipped.** `POST /assessments/{id}/draft` is a pure call; nothing persists until the manager sets it |
| A draft that leaves the box empty when the evidence is thin, rather than filling it | **Shipped.** The demoable proof and the one a competitor won't build. Lead pillar 3's AI story here |

**The gap to close.** Beliefs 4 and 5 both assume the manager has said how they want
to manage. Today that arrives as a file upload. Until there's a first-class place for
it, this pillar's coaching proof is thinner than its assessment proof, and the copy
should lean on expectations and documents rather than on principles.

**Say:** what I expect, what the role asks for, what we agreed, what I already
decided mattered. **Never say:** competency framework, leveling, career architecture,
best practices, insights, coach you (the product doesn't coach the manager, it hands
them their own thinking back). **Never claim the product won't draft a rating.** It
drafts one, against your scale, from evidence you wrote. The claim is that nothing
saves until you set it and that it leaves blanks rather than inventing. Restraint is
the differentiator. Abstinence would be a lie.

---

## Naming the standard, decided

Belief 4 needs one noun for the thing set in advance, used consistently across
product and copy. Options considered and the call:

| Candidate | Verdict |
|---|---|
| **what I expect** / **expectations** | **Picked for manager-facing use.** Plain, first person, already the product's own noun (`expectations`, `role_levels`), collides with nothing on the never-say list |
| **what we agreed** | **Picked for anything involving the report.** Carries the co-ownership without a word about sharing |
| the bar | **Retired as a device.** Ours, one instance in ~120 quotes and in the opposite direction. Allowed only inside a manager's own quoted sentence |
| what good looks like | **Kept out of copy.** Zero corpus instances. Fine in `PRODUCT_VISION.md`, where it's Andrew's own framing |
| the standard, the benchmark | Cold and slightly institutional. Available for body prose, never for a headline |

Overturnable, and worth overturning if the bar earns it in a headline test. It has to
win on merit rather than on incumbency.

---

## Which pillar leads, by surface

Carried forward from `positioning.md`, now with pillars attached.

| Surface | Lead | Support | Why |
|---|---|---|---|
| **Acquisition** (blog, SEO) | Pillar 2, into the review | 3, then 1 | The guilt has no search query. They arrive behind on something with a date on it |
| **Homepage** | Pillar 1 | 2, then 3 | The one claim a competitor selling to HR structurally can't make |
| **Product tour / walkthrough** | Pillar 2 | 3, then 1 | It's the most complete thing we've built and it demos in thirty seconds |
| **Retention / lifecycle** | Pillar 3, into the review | 2, then 1 | Where the record visibly pays off, in front of the report |

**The bridge, so the site doesn't read as two products:**

> The reason the review is agony in November is that the record you needed in March
> felt creepy to keep.

---

## Message tests

Before any line ships, four questions:

1. **Which pillar?** If the answer is "all three" or "none," rewrite it.
2. **Is the grammar first person and observational?** Second-person imperatives
   accuse a reader who's already indicting himself.
3. **Could Lattice say this?** If yes on pillar 1, it isn't pillar 1.
4. **Is the proof shipped?** Present tense requires present-tense truth. The IC view
   and the principles object are the two places this bites today.

---

## What this doesn't settle

- **The H1.** Still open, deliberately. The value proposition is scaffolding for the
  writer, not a candidate line.
- **The week-three problem.** *"The tool really doesn't matter; but proper discipline
  to use it does."* No pillar answers it and copy can't. It's the product's.
- **Willingness to pay.** No evidence at all for $20/mo from a manager's own pocket.
- **Pillar 1's proof.** Argues a principle today, ships a view later. Everything in
  this document assumes that gap closes.

---

## Related
`point-of-view.md` for the beliefs each pillar carries · `gtm/positioning.md` for the
competitive alternative and the surface split · `gtm/brand/voice-rules.md` for the
binding grammar and the full say/never-say lists · `gtm/personas/new-manager.md` for
the reader · layer 5, the voice system, is still to write.
