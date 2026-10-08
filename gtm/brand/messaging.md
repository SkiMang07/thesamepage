# Message hierarchy

Layer 4. The durable value proposition, three supporting pillars and the proof each
can use. This is not homepage copy. `gtm/site/homepage.md` decides how the homepage
turns the hierarchy into a story.

Built on `point-of-view.md`, `gtm/personas/new-manager.md`, current product truth and
Andrew's 2026-09-26 clarification of the product's ambition. The rules in
`brand/voice-rules.md` bind every public expression of it.

---

## The value proposition

> The Same Page keeps the context of managing a team coherent, so a manager can see
> where to look more closely, ask better questions and decide how to respond with a
> sound basis.

The aspiration is to help someone become a better, more confident,
evidence-informed manager. Confidence is an outcome the story earns, not a product
result we can claim to have demonstrated.

The product's breadth is part of the value. Goals, projects, expectations, meetings,
commitments and team relationships belong together because managers make decisions
across them. No single workflow, including 1:1 preparation or reviews, should become
the whole promise.

---

## Pillar 1: the context stays coherent

**The claim.** The facts a manager needs do not stay inside one meeting or one work
system. The Same Page keeps the management context they record close enough to
consider together and useful over time.

**In the reader's grammar:** *I need somewhere that helps me put the pieces together.*

| Proof | Status |
|---|---|
| The Relationship Desk holds current work, goals, open commitments, conversations and history for one report | **Shipped** |
| Goals and projects carry current state and explicit links; commitments retain their source | **Shipped** |
| Team workspace brings meetings, shared work, commitments and people into the manager's current scope | **Shipped** |
| Role expectations provide a stated basis for preparation and assessment | **Shipped** |
| Context Engine retrieves confirmed company documents and cites them when used | **Shipped** |
| Automatic ingestion from CRM, chat, calendar and external project systems | **Not built as a general capability** |

This pillar does not promise a universal source of truth. Some records are
intentionally private or isolated, and some relationships exist only when the
manager explicitly records them. Say which context the product holds and show where
it came from.

**Say:** context, what happened, what we agreed, current work, the history, put the
pieces together. **Never say:** everything automatically connected, complete picture,
single source of truth, seamless integrations.

---

## Pillar 2: see where to look more closely

**The claim.** The product helps the manager notice work, commitments, expectations
or questions that may deserve a closer look, and shows the recorded reason.

**In the reader's grammar:** *show me what I may have missed.*

| Proof | Status |
|---|---|
| Mission Control ranks explicit due, overdue, at-risk and stale records | **Shipped** |
| Every Mission Control recommendation exposes a factual "Why this?" basis | **Shipped** |
| One-to-one preparation carries forward open commitments and relevant recorded history | **Shipped** |
| Team meeting preparation shows recorded changes, carried items and gaps without inventing decisions or blockers | **Shipped** |
| Goals and projects show current state, measures, updates and explicit connections | **Shipped** |
| Automatic diagnosis of team relationships, employee risk or root cause | **Not built and not a permissible claim** |

"What needs attention" is usable only when the object is clear. Name the open
commitment, project risk, unclear expectation or unanswered question. A visual that
ranks people or places risk labels beside names turns this pillar into employee
scoring and changes the meaning of the product.

Positive and developmental examples belong here alongside problems. The product can
help a manager notice progress, a repeated strength or an opportunity for more
responsibility. A problem-only story makes management look like correction.

**Say:** look more closely, what may have been missed, what changed, worth a
conversation, why this appeared. **Never say:** who needs intervention, problem
employee, the product knows what matters, guessing stops, always know.

---

## Pillar 3: the manager makes the call

**The claim.** The Same Page gives the manager relevant context and a traceable
proposal, then leaves meaning and action with the manager.

**In the reader's grammar:** *give me the context, but I'll decide what the
conversation is.*

| Proof | Status |
|---|---|
| AI-generated preparation and wrap-up content remains a draft until manager confirmation | **Shipped** |
| Assessments draft against the manager's scale, cite the record and leave unsupported items blank | **Shipped** |
| Ratings enter the record only when the manager reviews and completes the assessment | **Shipped** |
| Mission Control ranking is deterministic and source-based; AI may paraphrase but does not choose the priority | **Shipped** |
| Coaching against leadership principles works when those principles arrive as a document | **Partly**; there is no first-class principles object |
| Demonstrated improvement in management quality, confidence, fairness or team performance | **No evidence yet** |

The product can help a manager form a better question. It cannot know from the record
alone whether a slipping project reflects unclear scope, an obstacle, changed
priorities or unmet expectations. Copy and examples must preserve more than one
plausible explanation until the manager investigates.

**Say:** ask a better question, see what it is based on, decide how to respond, a
sound basis, proposal, draft. **Never say:** tells you what to do, objective judgment,
fair by default, understands your team, finds the root cause, AI manager.

---

## Confidence, properly framed

Confidence is the emotional payoff across all three pillars:

1. The relevant context has not disappeared into separate notes and systems.
2. The manager can see why something may deserve a closer look.
3. The manager remains responsible for interpreting it and deciding what happens.

That can support confidence. It does not prove that the manager has become better,
that a decision is fair, or that the team will perform better. Use the aspiration in
the opening or close only when the page also demonstrates the mechanism.

---

## Shared record: aspiration and claim boundary

The principle that a record should be written in language the employee could read
remains valuable. It protects dignity and disciplines the manager's language. It is
not current homepage proof of employee collaboration.

| Capability | Status |
|---|---|
| Manager-owned product with no HR tier or upward access to private 1:1 notes | **Shipped** |
| Invite and account-claim primitives for direct reports | **Shipped underneath the UI** |
| Employee invite controls | **Disabled** |
| Employee-facing view of their record | **Not built**; `/app/ic` is a placeholder |
| Employee contribution, comments or collaboration on the record | **Not built** |

Do not claim in present tense that a report can see, own, contribute to or collaborate
on the record. Revisit this boundary when the employee experience ships.

---

## Which message leads, by surface

| Surface | Lead | Support | Why |
|---|---|---|---|
| **Acquisition** | A dated trigger such as review season or a conversation the manager is preparing for | Coherent context, then judgment | Search demand begins with a recognizable job; the landing story can widen from it |
| **Homepage** | Coherent context for better management decisions | Where to look, then manager judgment | Carries the full aspiration without becoming a feature tour |
| **Product tour** | One first-week situation from recorded context to a manager's next question | Breadth and continuity | Makes the mechanism legible before showing every surface |
| **Retention** | Continuity and accumulated context | Reviews and preparation as payoff | The record becomes more useful as decisions and conversations connect over time |

---

## Message tests

Before a line ships, ask:

1. **Does it describe the manager's capability or merely name product storage?**
2. **Can the page show the mechanism with a truthful, readable example?**
3. **Is the object of attention work, a commitment, an expectation or a question,
   rather than a person being scored?**
4. **Does it say where the context comes from without implying unavailable
   integrations or invisible collection?**
5. **Does it preserve the manager's judgment and more than one plausible
   explanation?**
6. **Is every present-tense claim shipped?**
7. **Would the line still sound acceptable if the employee read it?**

---

## The adoption objection

The strongest objection is not whether connected context would be useful. It is:

> Why won't this become one more place I have to update?

Copy cannot remove the upkeep honestly. Product proof must show a small intentional
habit producing useful first-week value: one current goal or project, one short note
from a conversation and one agreed next step returning together when the manager
needs to decide what to do.

Do not promise effortless setup, a record that builds itself or replacement of every
existing system.

---

## What this does not settle

- The final homepage H1. `gtm/site/homepage.md` carries the two directions to the
  next prototype.
- The exact first-week and positive examples.
- Willingness to pay. There is still no evidence for $20 per month from a manager's
  own pocket.
- Whether the maintenance habit survives week three. That remains a product question.
- Which integrations, if any, would materially change the input burden.

## Related

`point-of-view.md` for the beliefs · `gtm/site/homepage.md` for the page argument ·
`brand/voice-rules.md` for expression · `gtm/personas/new-manager.md` for the reader ·
`gtm/research/audience-2026-08.md` for evidence and sampling gaps.
