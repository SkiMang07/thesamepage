> **ARCHIVED — historical, not current intent.** Exploratory question set from the COO-agent brainstorm. Never a build plan; kept for the data-gap framing it names.

# COO Agent — Question Set v0 (Eval Suite)

Drafted 2026-08-09, brainstorming session. This is the founding artifact for
the agent layer: the real questions a manager should be able to ask The Same
Page and get a data-grounded, consultant-grade answer. It doubles as the eval
suite — every architecture, context, and data-model decision downstream gets
checked against "does it make these answers better?"

**Readiness key** — what happens if we shipped the agent today:
- 🟢 **Ready** — the data exists in the product; answer quality is limited only by prompt/orchestration.
- 🟡 **Partial** — some grounding exists but the answer would lean on inference; noted gap.
- 🔴 **Not yet** — no real data to reason over; agent would vibe. Don't ship the question until the gap closes.

---

## A. Synthesis — the COO itself

These are cross-domain. They're the flagship questions and the hardest;
they only work if the domain questions below work.

**A1. "What are the biggest opportunities across my team right now?"** 🟡
Pulls: assessments vs. expectations, overdue/at-risk commitments, goal
progress, initiative status, capacity, callouts, recent 1:1 notes.
The founding demo question. Partial only because "opportunity" needs demand-
side capacity and initiative health signals we don't fully have (see gaps).

**A2. "What am I not seeing? What's slipping that nobody has flagged?"** 🟡
Pulls: staleness signals — DRs with no recent 1:1, commitments past due,
goals with no metric movement, initiatives with no linked activity, unread
callouts. Tests the agent's restraint DNA: it should return "nothing
material" on quiet weeks, not manufacture drama.

**A3. "If I could only fix three things this quarter, what should they be?"** 🟡
Same inputs as A1 but forces prioritization and trade-off reasoning — tests
whether the agent can rank, not just list.

**A4. "Prep me for my skip-level / QBR — what story does the data tell about my team this quarter?"** 🟡
Pulls: everything, plus (eventually) team charter/strategy docs for framing.
High-value, low-frequency. Gap: most tables store *current state*, not
history — "this quarter" needs change-over-time data we mostly don't keep.

**A5. "What's changed since last Monday?"** 🔴
The proactive-mode question in disguise — whatever answers this is also what
files callouts and writes the weekly brief. Blocked on the same temporal gap
as A4: without event/history tracking, the agent can't diff the team's state.

## B. Performance management agent

The data-richest domain: assessments (overall + metrics/skills/values),
role_levels + expectations, 1:1 history.

**B1. "Who is furthest from expectations for their role, and what's the evidence?"** 🟢
Pulls: per-report scorecards vs. role expectations. Must cite specific
scored items, not just repeat the overall rating.

**B2. "Is my read on [name] backed by evidence or vibes? What contradicts it?"** 🟢
Pulls: assessments, 1:1 notes, commitment follow-through. The
manager-coaching question — the agent as honest mirror, willing to say "your
2-rating isn't supported by anything logged in the last 6 weeks."

**B3. "Draft talking points for a tough performance conversation with [name]."** 🟢
Pulls: expectations, scorecard, 1:1 history, open commitments. Extends the
existing prep feature; the eval is whether every talking point traces to
logged evidence.

**B4. "Who's ready for promotion, and what gaps remain vs. the next level?"** 🟡
Pulls: current vs. next role_level expectations, scorecard trend. Partial:
depends on the manager having defined next-level expectations, and trend
needs assessment history over time.

## C. Delivery / strategy & ops agent

Goals + success_metrics, projects, capacity, org_units. Gets much stronger
once context docs (strategy, customer/pricing) exist.

**C1. "Are my initiatives actually laddering to my goals? What's orphaned?"** 🟢
Pulls: projects ↔ goals linkage. Mechanical to answer; the value is the
agent saying *so what* — "40% of active work maps to no goal."

**C2. "Which initiatives are at risk?"** 🟡
Pulls: linked commitments (overdue?), owner capacity, callouts. Partial: no
initiative status history or velocity signal — risk is inferred, not
measured.

**C3. "Who's overloaded and who has slack?"** 🔴→🟡
The capacity model is supply-only — hours available, off-days — with no
demand side (allocation of people to initiatives). Until work is assigned
against capacity, "overloaded" is unanswerable. Sharpest single data gap
this exercise surfaced.

**C4. "Does what my team is working on actually match our stated strategy?"** 🔴
Blocked on the context-docs feature — this question *is* the reason strategy
docs need to be first-class objects. Day one of docs existing, this goes 🟡.

## D. People development / L&D agent

1:1 notes, commitments, expectations, skills ratings. Strong on evidence,
weak on aspiration.

**D1. "What does [name] want from their career, and are we making progress on it?"** 🟡
Pulls: 1:1 notes (unstructured mentions), expectations trajectory. Gap:
career aspirations live only in free-text notes, if at all — no structured
field. Cheap schema addition, big agent payoff.

**D2. "What should be on the agenda for my next 1:1 with [name]?"** 🟢
Already a product feature (prep). The agent version is the upgrade: prep
grounded in scorecard movement, stale commitments, and career threads — the
existing grounding rules from expectations_surfacing apply.

**D3. "Which strengths on my team am I underusing?"** 🟡
Pulls: skills ratings (high scores) cross-referenced against what people are
assigned to. Partial for the same reason as C3 — without assignment data,
"underusing" is half-inferred.

**D4. "Where is the same weakness showing up across multiple people — what should I coach or train at the team level?"** 🟢
Pulls: skills/values ratings aggregated across the roster. Pattern-finding
across scorecards; entirely answerable today and a genuinely novel answer
most managers have never gotten from a tool.

## E. Culture / team health agent

The thinnest domain — flagged honestly rather than staffed prematurely.

**E1. "Are we living our values? Where's the gap?"** 🟡
Pulls: values ratings in assessments — the *only* real culture signal today.
One-source answers should say so.

**E2. "How is team morale trending?"** 🔴
No signal exists: no engagement pulse, no sentiment, no history. Either this
domain earns a lightweight input (e.g., a 1-question pulse in the 1:1 flow)
or the culture agent stays aspirational. Don't let it vibe.

---

## What this exercise revealed (the real payoff)

Five data gaps block the best questions, in rough priority order:

1. **No demand-side capacity / assignment model** — people aren't linked to
   initiatives with an allocation. Blocks C3, weakens A1, C2, D3. Biggest
   single unlock.
2. **No temporal layer** — most tables store current state; no history/events
   to diff. Blocks A5 (and all proactive mode), weakens A4, B4. Proactive
   agents *are* a change-detection system; this gap is load-bearing.
3. **No context-docs feature** — strategy, customers, pricing, team charter.
   Blocks C4, weakens A4. Already agreed this should be first-class
   (typed docs, team-scoped, RLS, staleness signals) and doubles as
   onboarding.
4. **No structured career-aspiration data** — blocks D1 from being reliable.
   Cheapest fix on the list.
5. **No team-health signal** — blocks E2 entirely. Decide deliberately
   whether to add an input or defer the culture domain.

## Mapping to the agent roster

Readiness-ranked, per the "brand vs. architecture" decision (one COO agent
with per-domain context/tools under the hood; split only when quality
demands):

| Domain (brand name) | Data readiness today |
|---|---|
| Performance management | Strong — ship first |
| People development / L&D | Good — one cheap schema gap |
| Delivery / strategy & ops | Medium — strong on goals↔projects, blocked on demand-side capacity + docs |
| Culture | Weak — needs an input signal before it earns a seat |
| COO (synthesis) | As strong as the weakest domain it cites — but A1/A2/A3 are shippable in restrained form now |

## How to use this as an eval suite

For each question: write 2–3 seeded team scenarios (a healthy team, a team
with a hidden problem, a sparse-data team) and define what a *good* answer
must do — cite specific records, admit data gaps instead of filling them,
and return "nothing material" when that's the truth. Run every prompt/
architecture change against the suite. The sparse-data scenario matters
most: a new user's team is sparse, and the agent's restraint there decides
whether they trust it enough to feed it more.
