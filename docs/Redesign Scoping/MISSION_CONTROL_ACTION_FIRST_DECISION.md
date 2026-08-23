# Mission Control — approved action-first direction

**Status:** Direction approved; not implemented.

This is the decision record for the next Mission Control redesign. It translates
the UX/customer/marketing analysis, the two-pass advisory-board review, and
Andrew's review of the bounded-synthesis mockup into implementation constraints.

It does **not** describe the live product. Until the redesign ships,
`docs/systems/mission-control.md` remains the source of truth for current behavior.

References:

- `GPT Feedback Aug 22.md` — initial diagnosis
- `mission-control-action-first.html` — first action-first proposal
- `mission-control-bounded-synthesis.html` — **approved interactive direction**

The bounded-synthesis file is the visual source of truth for implementation
planning. Its example data demonstrates normal-week, busy-week and early-use
states; it is reference content, not validated customer data or final production
copy.

---

## Decision

Mission Control changes from an information dashboard into a manager's action
brief. Its primary job is:

> Help the manager choose the next management action that will make the greatest
> difference.

The persistent sidebar owns wayfinding. The large “Your people / The work /
Foundation” zone map is removed from Mission Control rather than moved lower.

The mature first viewport contains:

1. one decisive primary recommendation;
2. no more than two quieter secondary priorities;
3. inspectable evidence behind the recommendation;
4. one quiet, factual progress or genuine all-clear signal; and
5. Scribe as a visible but secondary capability.

This is exception-first, not exception-only. It must reduce choice without
turning TSP into an anxiety-producing backlog.

## Bounded synthesis

- Deterministic signals decide which actions are eligible.
- Transparent rules rank candidates initially.
- AI may explain the **Suggested focus** and help the manager prepare.
- AI does not silently rank unrelated domains or state causal interpretation as fact.
- The manager can inspect and disagree with every recommendation.

Good: “Finish Leah's 1:1 preparation. Her conversation is due tomorrow,
preparation is underway, and you recorded an unresolved bandwidth concern.”

Rejected: “The team has capacity, but the management rhythm is slipping.” The
latter exceeds what the records establish and implies unsupported causality.

## Recommendation controls and learning signals

| Control | Manager meaning | What TSP learns |
|---|---|---|
| Why this? | Show the observations and ranking basis | Whether the recommendation is understandable |
| Addressed | I handled this, possibly outside TSP | The signal was valid, but TSP lacked the resolution |
| Snooze | This matters, but not now | The recommendation is valid; its timing is wrong |
| Not relevant | This should not be a priority | The interpretation or ranking is wrong |

`Addressed` removes the recommendation but does not silently update the
underlying record. If an appropriate record update exists, offer it as a
separate reviewed action. Setup recommendations additionally support **Dismiss
for today** / **Not now** and must not reappear on every navigation or refresh.

Persistence, snooze choices, feedback storage and ranking evaluation remain
implementation-scope decisions. The meanings above are locked.

## First viewport

Keep the greeting/timeframe, Suggested focus with one primary CTA, up to two
secondary priorities, source/reason/freshness, one factual truth signal, and
quiet contextual Scribe access.

Move below the fold: Upcoming conversations; meaningful recent changes; goal,
project or capacity detail that did not earn priority. The provisional sections
are **Upcoming conversations** and **What has changed**.

Exclude from the first viewport:

- the zone map or other product-area summaries;
- full goal/project lists and unqualified raw capacity totals;
- setup debt that does not block immediate value;
- raw assessments, private-note excerpts and inferred employee-risk labels;
- broad unsupported AI diagnoses;
- more than three unresolved attention items; and
- duplicate presentations of the same person/action.

Ordinarily overdue items use amber. Red requires a defined critical condition;
lateness alone is not critical.

## Tone, privacy and agency

- Be decisive about the next action, not dramatic about deficiencies.
- Use humane specifics, not backlog totals or administrative abstractions.
- Show factual progress/all-clear; never manufacture praise or confetti.
- A manager-entered, traceable concern category may appear. Detailed sensitive
  content stays inside the person/preparation workspace.
- Make sources, freshness, defaults and assumptions inspectable.
- Distinguish all-clear, insufficient evidence, partial failure and AI failure.

## Setup, early use and quiet weeks

Setup enters the queue only when it blocks immediate value, states the
consequence, and is dismissible for the day/session. Never use generic “finish
your management foundation” copy as a persistent competing priority.

Sparse accounts get a distinct early-use state:

- begin with one real near-term management moment, normally the next 1:1;
- request context incrementally and tie it to an immediate benefit;
- do not generate confident team judgment from thin evidence;
- explain that recommendations improve with recorded use; and
- transition naturally to the mature action-first state.

The full new-user journey remains a separate onboarding workstream. A quiet
mature account receives a genuine all-clear plus an optional useful next action;
TSP never manufactures a warning to fill the page.

## Navigation and Scribe

- **People:** Team, 1:1s, Assessments
- **Work:** Goals, Projects, Capacity
- **Workspace:** Org, Knowledge
- **Settings:** separately identifiable at the bottom

Org and Settings remain separate. “Workspace” and “Knowledge” are provisional
labels pending comprehension testing. Scribe remains visible globally but
secondary to the page's teal primary action; contextual Scribe help may support
a recommendation.

## Reference-data requirement

The current dogfood account is very thin and mostly starting samples. Its
overdue counts, low progress and capacity total are layout placeholders—not
evidence of realistic manager behavior or priority frequency.

Before treating the design as validated, create coherent reference states:

1. **Normal week:** one meaningful primary action, two secondary items, healthy signals.
2. **Busy week:** legitimate competing signals across people and work.
3. **Early use:** insufficient evidence, immediate value, restrained setup guidance.

Also exercise all-clear and partial-data/failure states. Coherent history across
conversations, commitments, goals, projects, expectations and capacity matters
more than maximum record volume.

## Implementation gate

No product code changed to lock this decision. Next, translate this brief into
an implementation plan using richer reference data, then review the plan before
changing product code.

The plan must specify candidate/ranking rules; evidence/source/freshness;
feedback persistence and record boundaries; early-use/all-clear/loading/stale/
partial-failure behavior; learning instrumentation; a reversible rollout; and
the smallest credible real-manager test.

Revisit the direction if target managers cannot quickly identify and explain
the first action, experience it as judgmental/surveillant, or describe it mainly
as generic task tracking.
