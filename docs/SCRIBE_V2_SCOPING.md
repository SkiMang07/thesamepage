# Scribe v2 — grounded management intelligence

Status: active implementation brief. Foundation, connected person context,
Mission Control evidence, and the first query-aware workspace/company search
are shipped. Current behavior is canonical in `docs/systems/scribe.md`; only
remaining work stays here.

## Outcome

Scribe should feel like a high-quality general assistant focused on the
manager's live team, work, expectations, and organization. Managers can ask
open-ended questions, think through management situations, and update the
record without first choosing a workflow or fitting their request into an
allowed taxonomy.

The governing architecture principle is:

> **Deterministic at the boundaries; generative in the middle.**

The application guarantees identity, authorization, source provenance, and
review-before-write. A capable model decides what context it needs, how to
reason across it, and how best to answer the manager's actual question.

## Decisions from the review

- **One agent, not an agent fleet.** Start with one frontier model using a small
  set of distinct read tools plus `emit_draft` in a tool loop. Add specialized
  skills or agents only when an observed evaluation failure demonstrates a need.
- **No intent router or question allowlist.** Example question families are an
  evaluation and discovery aid, never prescribed product pathways.
- **Everything relevant is eligible.** A person or team answer may use every
  related source the manager can access, including manager-private notes. The
  retrieval layer selects relevant evidence just in time instead of dumping the
  entire record into every prompt.
- **Internal evidence and general guidance can coexist.** Scribe should label
  what comes from the record, what is interpretation, and what is general
  management guidance. Thin internal evidence should not force a useless
  refusal when general help is still possible.
- **Wrong-scope contamination is the catastrophic failure.** The release bar is
  zero wrong-person, wrong-team, wrong-role, or wrong-expectation attribution in
  the adversarial suite.
- **AI writes remain draft-then-review.** The model never receives a direct
  database write tool. Confirmed writes continue through the product's normal
  source endpoints.
- **Quality sets the initial model choice.** Establish the response-quality
  ceiling with the strongest appropriate Anthropic model, compare a faster
  model on the same evaluation, and optimize cost only after quality is known.

## What not to build first

- A workflow per question category.
- Separate coaching, assessment, development, and triage agents.
- A large skill library.
- Embeddings or a vector index for every relational row.
- A rule for every management scenario.
- Automatic model routing by inferred intent.
- Autonomous source-record writes.
- Proactive employee judgments.

## Minimal architecture

### Agent loop

Retain the existing direct Anthropic tool-use loop in `assistant_engine.py`.
Keep the system prompt short and principle-based. Prefer a small set of varied,
canonical examples over an expanding list of prohibitions.

The v2 read surface is converging toward four capabilities:

1. `search_workspace(query, scope?, source_types?, time_range?)` — **shipped**
   - Broad discovery across accessible structured records and confirmed company
     context.
   - Returns compact evidence references with stable IDs, subject/scope IDs,
     source type, event/effective date, and a human-readable excerpt.
2. `get_entity_context(entity_type, entity_id, time_range?)` — **partially
   shipped as `get_people_context`**
   - Deep, connected context for one resolved person is shipped, including
     explicit multi-person synthesis.
   - Equivalent deep team, goal, project, and org-unit packets remain pending;
     broad discovery for those entities is available through workspace search.
3. `get_manager_brief()` — **shipped**
   - Makes Mission Control's deterministic attention evidence available when it
     helps answer a question. It is an optional tool, not a mandatory route.
4. `emit_draft(...)` — **shipped for six reviewed write verbs**
   - The existing reviewed-write primitive, with trustworthy persisted draft
     lifecycle added before broadening its verb set.

The exact first implementation may keep the existing list tools while these
broader tools prove themselves. Tool count should shrink when capabilities
overlap rather than grow indefinitely.

### Evidence contract

Every evidence item returned to the model carries:

- source type and stable source-record ID;
- direct-report ID and/or org-unit ID when applicable;
- role-level or expectation-config ID when applicable;
- event date, effective date, and retrieval timestamp;
- visibility class (manager-private, manager record, shared org context);
- a source label or route the client can open.

The server filters by authenticated manager and requested scope before any
content reaches the model. Person identity and assigned expectations resolve
from stable IDs, never model inference. Ambiguous people or scopes return
candidates and require clarification.

Private notes are eligible evidence but remain attributed observations. For
example, “Manager-private note on August 12: Jordan seemed frustrated” does not
become the fact “Jordan is disengaged.”

### Response behavior

Scribe answers the question directly. It may combine:

- cited facts from The Same Page;
- explicit uncertainty or contradictory evidence;
- clearly framed interpretations;
- general management guidance;
- suggested questions, approaches, drafts, or role-play;
- a reviewable source-record draft.

It asks a clarifying question only when ambiguity materially changes the answer.
When the desired help is unclear, it may offer lightweight continuations such
as questions, approach, draft message, role-play, or record a follow-up.

## First build slices

### 0. Repair the current foundation

Shipped:

- persisted lifecycle and receipts;
- stable draft IDs and safe hydration/retry behavior;
- pending-draft refinement context;
- complete direct-report card editing;
- a 40-message model window and server-backed New conversation control.

Remaining:

- fully atomic source-write idempotency;
- product telemetry for model, latency, tool calls, errors, draft edits,
  confirmations, discards, and corrections without duplicating sensitive
  message content.

### 1. Open-ended person context

Shipped as `get_people_context`, covering the connected relational sources
already in the product with stable manager-owned person IDs and source metadata.
The model answers arbitrary questions using internal evidence plus general
guidance; there is no workflow dedicated to “How is Jordan doing?” or another
person-question category.

### 2. Team and manager context

Partially shipped: the same tool supports explicit multi-person synthesis up to
12 reports, and `get_manager_brief` exposes Mission Control's existing
deterministic attention ranking. Broader team/org-unit scope remains pending.

Add team-level connected context and expose Mission Control evidence as an
optional tool. Evaluate cross-person synthesis and training/development themes
with strict scope attribution.

### 3. Search and company context

Shipped as one `search_workspace` tool over bounded structured rows and the
existing Context Engine. It accepts a natural-language query, optional stable
person/org-unit scope, optional source families, and an optional date range.
It returns compact, uniformly attributed evidence and keeps company documents,
manager records, manager-private notes, and shared org configuration visibly
distinct.

The first implementation deliberately stops at explainable lexical search. It
does not add public-web retrieval, a vector index for relational rows, a new
document pipeline, intent routing, or question-specific workflows. Evaluate
real misses before adding infrastructure.

Remaining search follow-ups are evidence-driven only:

- improve recall/ranking if beta queries show consistent lexical misses;
- consider a small clickable-source treatment if source-opening behavior shows
  that plain conversational source names/routes are insufficient;
- broaden deep entity context beyond people only when real questions require
  more than search plus the current canonical list tools.

## Model bake-off

Run the same prompt, tool definitions, evidence packets, and evaluation cases
against the current quality-ceiling candidate and the current cost/latency
candidate. Blind-score:

- usefulness and directness;
- management judgment quality;
- correct tool selection and recovery;
- factual grounding and citation support;
- correct person/team/role/expectation scope;
- response naturalness;
- latency and provider cost.

The initial bakeoff compared Sonnet 5 and Opus 5 on the six open-ended
management cases. Both cleared the evaluation; Opus was more expansive but also
more willing to extrapolate from a single observation. Sonnet 5 was materially
tighter while remaining useful, so it is the launch default. Keep
`AI_SCRIBE_MODEL` configurable and re-run the same evaluation before changing
the default.

## Evaluation and learning

The existing write-oriented cases remain a regression suite. Add open-ended,
multi-turn cases drawn from founder dogfooding and customer usage rather than
turning question families into product modes.

The shipped automated set now covers duplicate names, stable person scope,
archived/foreign people, stale records, private-note attribution, confirmed-only
documents, malicious stored instructions, thin evidence, unsupported citations,
and duplicate draft lifecycle regressions. Ambiguous pronouns and trusted page
context are also covered. Navigation context changes, role changes, conflicting
sources, and broader team-versus-org-unit ambiguity remain additions to make as
real beta examples sharpen those cases.

Record real beta questions, tool paths, reformulations, source opens,
corrections, answer-to-action conversion, and failure reason. The product should
learn its recurring jobs from behavior rather than asking users to predict a
prompt taxonomy in the abstract.

## Open product boundary

Decide later whether Scribe may search the public web for current management
research and resources. The first build may use The Same Page evidence plus the
model's general management knowledge; web retrieval is not required to prove
the core experience.

## The page-context object, and the rule it left behind

`frontend/app/app/reports/[id]/page.tsx` calls `setPageContext` with an
`AssistantPageContext` object. That call was committed alone in 2c183d7 while
the type that accepts it (`lib/drawer-context.tsx`, `lib/api.ts`) stayed
uncommitted here, so `main` failed to build for seven hours and the object was
reaching a backend that expected a plain string. 14e301a reverted the call site
to the string form; the object form ships with this V2 diff, together with the
drawer-context and api.ts types, as it always had to.

The standing rule it left behind: **type-check a clean checkout, not the working
tree.** A split change compiles locally because the tree holds both halves, and
`next.config.js` sets no `typescript.ignoreBuildErrors`, so a type error is a
deploy-blocking error rather than a warning. Verify with the repo's pinned
`frontend/node_modules/.bin/tsc` against a scratch `git archive` of the commit
about to be pushed.
