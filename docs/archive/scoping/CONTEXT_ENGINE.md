> **ARCHIVED — historical, not current intent.** The Context Engine framework. Built and shipped. Current behavior: `docs/systems/context-engine.md`.

# The Context Engine — Framework Doc v0

Drafted 2026-08-09, brainstorming session (same session as
COO_AGENT_QUESTION_SET.md — read that first; this is its companion).
Status: concept framework, no code, no schema migration. This doc exists so
the eventual build sessions scope against a settled frame instead of
re-litigating it.

## What this is

The Context Engine is a dedicated space in The Same Page where a manager
feeds the system the documents that structured data can't capture — strategy,
values, customers, offerings, career paths. It is the substrate that makes
the agent layer (the COO and its domain agents) genuinely consultative
instead of merely data-literate.

Three named parts:

- **The Space** — the surface itself: free-form intake, the brain
  visualization, and the browsing/reviewing UI.
- **The Librarian** — the resident agent. It reads every document on
  arrival, files it, summarizes it, tracks freshness, and speaks to the
  user about what the brain knows and what it's missing. The Librarian is
  a user-facing character, not a background job.
- **The Brain** — the interactive visualization of coverage: what the
  system understands about this team, how current that understanding is,
  and where the gaps are.

User-facing promise, in one line: *the more you teach it, the better your
answers get — and it will show you exactly where teaching it more pays off.*

## Why this design (the tension it resolves)

Every team that uses TSP is different. A rigid "upload these 8 documents"
checklist encodes one persona's world (Andrew's SaaS-GTM examples) and
alienates everyone else. A fully free-form dump solves that but fails the
agents: they can't weigh authority, freshness, or relevance in an
undifferentiated pile — and users don't actually know what to upload.

The resolution: **free-form on the surface, structured underneath, with the
Librarian doing the structuring.** Users drag in anything. The Librarian
assigns the metadata. The taxonomy lives in AI-assigned tags, not in
folders the user must understand — which also means the taxonomy is cheap
to evolve later (a metadata migration, not a user-facing reorg).

The categories are organized by **what question a document helps an agent
answer**, never by document type (deck/memo/PDF — that's where rigidity
creeps in). Tested against multiple personas (SaaS CS team, eng team,
hospital ops, internal platform team), the same frame holds.

## The taxonomy: five topics + a stream

### The five topical categories

**1. Where we're going** — direction and strategy.
The question it answers: *what is this team trying to achieve, and why?*
Examples: 3-year vision/strategy doc, annual plan, region-specific strategy
decks, OKR narrative docs. (Hospital ops: service-line strategy. Eng team:
technical roadmap/architecture vision.)

**2. Who we are & how we operate** — identity and operating system.
The question: *what does this team believe, and how does it run?*
Examples: company values, department principles, team charter, operating
cadence/norms, the "how our team works" new-hire deck. (Universal across
personas almost unchanged.)

**3. Who we serve** — the people on the other side of the team's work.
The question: *who is this work for, and what do they need?*
Examples: customer personas, segment definitions, key-account context,
voice-of-customer decks. (Hospital ops: patient populations. Internal
platform team: internal stakeholder/consumer teams.)

**4. What we offer** — the thing the team provides.
The question: *what does this team sell or deliver, on what terms?*
Examples: pricing & packaging, product overview, service catalog, SLAs,
"what we do / don't do" docs. Non-commercial teams offer services to the
rest of the org — the bucket holds. Without this category, an agent can't
reason about expansion, packaging fit, or what a product change means for
customers — personas alone only cover the demand side.

**5. How people grow here** — the human trajectory.
The question: *what does progression look like on this team?*
Examples: career development/progression frameworks, leveling guides,
competency ladders, promotion criteria, L&D catalogs. Complements (not
duplicates) the structured role_levels/expectations data already in the
product — the docs carry the philosophy and paths; the tables carry the
per-role specifics.

### The stream: "What's happening lately"

Deliberately **not a sixth topic — it's a time axis with an inbox.** A town
hall deck isn't "about" recency; it *contains* strategy updates, people
news, and metric readouts that belong to the topical categories — it's just
fresh and perishable.

- **As intake:** a zero-friction bucket. Users think "here's the latest
  deck" — let them drop it without deciding anything.
- **Internally:** the Librarian treats it as a stream — dates each item,
  detects series (monthly town halls, product update decks), cross-files
  contents against the topical categories, and lets items decay.
- **Series concept:** recurring docs form a named series with a cadence.
  The newest instance mostly supersedes older ones, but history is retained
  and queryable ("what did leadership emphasize in Q1 vs. now?").

### Rejected framings (so they don't get re-proposed)

- **By document type** (decks, memos, policies) — rigid, persona-biased,
  answers no agent question.
- **By agent** ("feed the culture agent") — couples the taxonomy to an
  agent roster that is branding, not architecture; users don't think in
  agents.
- **By scope as primary axis** (company/dept/team) — puts metadata in
  front of meaning. Scope is a tag (see spine), not a bucket.
- **Kept from the alternatives:** position categories to users as
  *questions the brain can't yet answer*, in the Librarian's first-person
  voice — "I don't know where your team is heading yet" beats a label.

## The metadata spine

The invariant layer — get this right and the bucket names can evolve
freely. Every document carries:

| Field | What it is | Assigned by |
|---|---|---|
| Category | One of the five topics (stream items get topic cross-tags) | Librarian, user-confirmed |
| Scope | Company / department / team — see cascade rule below | Librarian, user-confirmed |
| Freshness class | Evergreen / dated / stream-instance | Librarian |
| Effective date | When the content was true (≠ upload date) | Librarian, from content |
| Series | Membership + position, for recurring docs | Librarian |
| Summary card | Short abstract: what this doc knows, in the Librarian's words | Librarian |
| Extracted text | Full-text extraction (decks/PDFs are hostile inputs — real pipeline work) | System |
| Novelty score | Did this doc actually add current, substantive information? | Librarian |
| Usage | Which agent answers cited it, when | System |

**Scope cascades down (one-to-many).** Scope is where a document *lives*,
not the only place it *applies*: a company-scoped doc (values, town hall)
automatically applies to every department and team beneath it; a
department-scoped doc applies to all of that department's teams. Agents
answering for a given team therefore retrieve up the chain — team docs +
their department's docs + company docs — with the more-specific scope
winning on conflict (a team charter refines company values, and where they
tension, the team-level doc is the closer authority, though conflicts still
get surfaced per the precedence rules below). A document can also carry
multiple scopes when it genuinely belongs to several units (e.g. a strategy
deck covering two regions' teams) — scope is a set, not a single value.
This rides the existing org_units hierarchy rather than inventing a
parallel one.

Two-tier retrieval is the context-management answer: agents search summary
cards first, pull full extracted text only for the docs that look relevant.
Full decks never get bulk-loaded into a prompt.

## Freshness, decay, and precedence

- **Decay:** every doc's confidence weight declines on a curve set by its
  freshness class — stream instances decay in weeks, dated docs in months,
  evergreen docs slowly. Nothing is ever "done" being uploaded.
- **Precedence:** when documents conflict, dated-recent beats
  evergreen-old (the March town hall's pivot announcement outranks the
  14-month-old vision doc) — **but the conflict is surfaced to the manager,
  not silently resolved.** "Your strategy doc predates the pivot announced
  in March — is it still current?" is itself a consulting output, and the
  same restraint DNA as logged-vs-assumed in the capacity model.
- **Staleness prompts:** the Librarian proactively asks about aging
  load-bearing docs rather than letting answers quietly degrade.

## The Librarian

The resident agent of the Space — a character the user interacts with, not
a background classifier.

**On intake:** reads the doc, proposes category/scope/freshness/summary in
one confirmable card. The first thing the system does with your document is
demonstrate it understood it — this is the feature's trust moment, and it
doubles as the correction loop (a wrong guess, corrected once, is training
signal).

**In conversation:** answers "what do you know about X?", explains which
docs informed an answer, asks for what's missing in first person ("I don't
know how promotions work on this team"), flags conflicts and staleness.

**Guardrails:** the Librarian curates, it does not consult — team-advice
questions belong to the COO. Keeping the roles distinct keeps both
characters legible. (Architecturally it can share plumbing with the COO;
the separation is voice, surface, and toolset — same brand-not-architecture
decision as the agent roster.)

**Honesty rule:** the Librarian never inflates coverage. Junk uploads score
low novelty and don't move the brain (see below); thin regions are
described as thin.

## The Brain (the visualization)

The coverage map made visceral — one surface serving as empty state,
progress mechanic, navigation, and re-engagement loop. Design direction is
explicitly open (very little design work exists on TSP yet; this section
sets the *mechanics* to preserve through any visual treatment).

**What it must do, regardless of final visual form:**

1. **Show completeness per category** — regions fill/brighten as real
   coverage grows. Day one it's mostly dark; that emptiness is the
   onboarding prompt, not a failure state.
2. **Fill is quality-weighted, never count-weighted.** The novelty score
   drives fill. Ten junk uploads move nothing; one current strategy doc
   lights a region. Otherwise gamification trains users to stuff the brain.
3. **Decay is visible.** Regions dim as their documents age. A brain
   forgets — intuitive, honest about answer quality, and the only
   re-engagement mechanic a static checklist can never give.
4. **Every region is actionable.** Clicking opens (a) what the brain knows
   — the summary cards, proof of understanding — and (b) what it's
   missing, phrased as the Librarian's first-person questions. The
   hospital ops manager and the CS manager see the same question and
   answer it with whatever doc they have.
5. **Credit flows back from answers.** When the COO cites documents,
   the source regions get visible credit — a glow, "used in 4 answers this
   week." Feeding the brain must visibly connect to getting better
   answers, or the ritual dies after onboarding.
6. **The payoff is stated in the user's terms:** more context → better
   answers, fewer hallucinations. The brain is the visual proof of that
   contract.

**Visual treatment — open, with one caution on record:** a literal
anatomical brain with labeled lobes risks kitsch and gets cramped rendering
five-plus regions legibly at small sizes. Alternatives worth exploring in a
proper design pass: a stylized/geometric brain built from abstract
segments; a neural-web where clusters are categories and nodes are
documents (nodes literally connect as cross-references appear); an orbital/
radial "mission control" motif consistent with the dashboard aesthetic.
Andrew is explicitly open-minded here — engaging and interactive is the
bar; the anatomical version is allowed to win if it earns it.

## How this connects to the agent layer

- Directly unblocks **C4** ("does our work match our stated strategy?")
  and strengthens **A1, A4** in the question set — this is data gap #3
  from that doc.
- The Space is the **onboarding mechanism** for the agent era: "feed your
  COO" is a stickier day-one activity than any settings form, and the
  brain gives it a visible score.
- Two-tier retrieval (cards → full text) is the context-management
  pattern the COO uses across *all* its sources, not just docs.

## Deliberately out of scope for v1

- Live integrations (Google Drive / Notion / Slack sync) — upload-first.
  Integrations are a later amplifier, and a v1 crutch that would delay the
  metadata spine, which is the actual product.
- IC-facing views of the Space — manager-only until the manager loop is
  proven. (Role-scoped visibility of *some* docs — e.g. career frameworks —
  is an obvious later win; the scope tag anticipates it.)
- Structured extraction into app tables (e.g. auto-creating goals from a
  strategy doc) — tempting, deferred; keep docs as context, not as a
  second write-path into the schema.

## Open questions for the next scoping session

1. Storage + extraction pipeline (PPTX/PDF → text) — Supabase storage +
   which extraction approach; this is the main engineering risk.
2. Where the Librarian's confirm-card UX lives (inline in the Space vs. a
   review queue).
3. Whether novelty/fill scoring is per-document or per-category-question
   ("is *this specific* gap now covered?") — the latter is stronger and
   harder.
4. Cost model: every upload triggers Librarian reads/summaries — fine at
   $20/mo? Batch vs. immediate?
5. Sensitive docs: pricing and comp-adjacent material raises the same
   access-control questions flagged in the original agent brainstorm —
   scope tag + RLS probably covers v1, confirm at build time.
