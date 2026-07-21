# The Same Page — Product Vision

Pulled from the original Miro board (V1 concept, "The Same Page") on 2026-07-14.
This is the fuller vision behind the product — kept separate from the lean MVP
we scaffolded so both can inform the roadmap without forcing v1 to build all
of it on day one.

## The core idea, in Andrew's own words (from the board)

> **Problem:** How are individuals performing against what "good" looks like
> for their role?
>
> **Who has the problem:** Team Manager
>
> **Solution:** A "mission control" for me to see employee "ratings" against
> expectations in their role. A detailed team page to see how they are
> performing against a range of expectation variables including metrics,
> competencies, and behaviors against company values.
>
> **How it makes the customer's life better:** Rather than needing to look at
> multiple dashboards, tracking sheets, and going back in to look at past
> notes, the app summarizes the things that matter most and critically
> presents this to both you and your employee. This will cut down on any
> ambiguity both for the manager (how do I truly judge how a team member is
> doing and hold confident feedback/coaching conversations with them outside
> of scheduled reviews) and the employee (how do I truly know how I am
> performing and what I need to focus on in my role). Via a beautifully
> designed "mission control" I can answer the top level questions about my
> team which calculates individual's ratings day over day and feel confident
> about the "facts" that are behind my team's current state. If I want more
> detail, I can click in and dig deeper. If I want a summary, I can zoom out.

This is the load-bearing sentence for the whole product: **it's not a 1:1
notebook, it's a "mission control" — a single ratings/status surface, backed
by real data, that removes ambiguity about how someone is performing against
explicit expectations.** The 1:1 prep tool we scaffolded is a genuinely good
wedge feature (highest-frequency touchpoint, fastest to build), but it's one
entry point into this bigger surface, not the whole product.

## The "Mission Control" dashboard structure

The board mocks up **four role-scoped versions of the same dashboard** —
same card types, different scope/detail per role. This is the actual
information architecture to build toward:

**Manager Mission Control** (full view — everything below), **Team Mission
Control** (a report's own view — no visibility into peers' individual
performance), **Department Head Mission Control** (rolled up one level),
**Individual Mission Control** (an IC's own view).

Card types that repeat across all four (same taxonomy, different data scope):

- **Organization Goals** — company-level measurements
- **Department Goals** — department-level measurements
- **Team Goals** — team-level measurements
- **Individual Performance** — name + status per direct report (manager/dept-head view only)
- **Team Health** — KPI 1, KPI 2 (health/engagement signals, not just output)
- **Reports & Dashboard** — linked projects/reports
- **Key Initiatives** — active projects
- **Team/Dept Operations** — Customer Demand, Staffing Model, Forecasting, Budget, Compensation
- **People Operations** (manager/dept-head) or **Growth and Development** (IC/team view) — Development, Performance Reviews, Improvement Plans, Recruiting & Hiring, Employee Feedback

Read as a data model, this implies: a **goals** hierarchy (org → dept → team,
each with measurements), a **competency/expectations framework per role**
(this is the same shape of problem Prism Tree already solved with its Layer
1/2/3 competency system — worth revisiting that pattern here), a **ratings/
status calculation** that rolls individual performance up into team and dept
views, and **role-based view scoping** (what a Team member sees vs. what
their manager sees vs. what a dept head sees).

This is a real product, not a weekend build — which validates Andrew's
instinct that this will end up Prism-Tree-scale. The 1:1 tool is the right
place to start (it's the single highest-frequency manager pain and doesn't
require the full goals/competency data model to be useful), but the schema
and architecture should leave room to grow into this rather than being
designed as if 1:1 prep is the whole product.

## Problems to solve (validated pain points from the board)

Organized by theme, pulled directly from the brainstorm:

**The changing/harder role of the manager** — remote managers find it harder
to connect with their team; visibility into what the team is actually doing
has eroded; burnout; the role has expanded (more expected of managers than
before) while support hasn't kept pace; staying organized across it all is
its own problem.

**Lack of manager coaching / skill leveling** — hard to find benchmarks and
comparisons for what "good" looks like; managers don't know what "good"
looks like as a leader, so they can't coach toward it; new managers
specifically struggle to even get started.

**No objective way to rate performance** — the intersection of metrics,
behaviors, impact, and competencies is muddled; articulating what "good"
looks like across metrics/competencies rarely happens in a structured way;
objective "rating" rarely occurs in practice; unclear how team operations
should even work; too much time spent developing the bottom 20% vs. the
top 20%; transparency on how someone's progressing is inconsistent.

**Inefficient systems** — too many reports/dashboards/data points, no clarity
on what actually matters; no consistency in how different managers or ICs
track things; managers repurpose generic PM tools to do people management
(square peg, round hole); a lot of wasted time "painting a full story" for
reviews instead of it being readily available; managers who lack self-
awareness make it worse.

**1:1s and trust are the mechanism, but managers fail at them** — weekly 1:1s
are considered key, but managers fail to effectively engage their teams
through them; ICs often don't feel the connection between their work and the
bigger company goals; managers have a hard time identifying what talents to
capitalize on for their ICs; responsiveness to reports is essential to being
seen as an effective manager; trust-building requires knowing each report's
strengths, what triggers activate those strengths, and their learning style.

This list is a genuinely good source of content-marketing topics too — each
one of these is close to a LinkedIn post or blog post title on its own.

## Who it's for (ICP, from the board)

Managers of 3+ people, at tech-industry companies, specifically start-ups
and scale-ups, on GTM teams, with less than 3 years of management
experience, working remote, at companies where deep management experience/
mentorship is lacking (i.e., no strong internal manager-coaching culture to
lean on), roughly 28-35 years old. Their stated pain: balancing multiple
demands in the role, and still feeling out how to fairly assess team
performance against ambiguous goals.

Market sizing pulled from the board (rough figures, not vetted): ~900K
managers in tech industry; ~230K customer success managers (6% growth
through '28); ~2.1M customer success reps (-1.6% growth); ~907K marketing &
sales managers; ~626K sales reps. Directionally useful for a "how big could
this get" gut check, not something to cite externally without re-verifying.

## Competitive landscape & differentiation

The board maps existing players into four categories: **Feedback + Engagement**
(Culture Amp, Lattice-adjacent, engagement surveys), **Performance
Management** (Lattice, 15Five, ClearCompany), **Task Management** (Asana),
**Skills/Competency** (Coursera for Business, skills platforms), and **All-in-
one HRIS** (Rippling, Workday, SAP SuccessFactor, Salesforce). The
differentiation thesis: **all-in-one solution** (most competitors are
single-purpose and force managers to stitch tools together — this maps
directly to the "too many dashboards" and "square peg round hole" pain
points above), **manager coaching and "alerts"** baked into the product
itself (not just data, but nudges/judgment), and **usability built for the
manager, not for HR** (most of this category is sold to HR/People teams as
buyers even though managers are the actual daily users — designing for the
manager as the primary user is itself a differentiator).

## Business model & GTM (from the board)

**Pricing shape:** low price/barrier to entry for an individual manager to
buy (this matches the earlier "$20/mo self-serve" positioning), the same
per-seat price extended to the manager's team, and roughly $100/mo as a
target price point at the business/department tier — i.e., a land-and-expand
motion: cheap individual entry, expands in price as it expands in seats/
scope. Subscription-based with modular add-ons.

**Growth strategy:** two motions in parallel — low-touch/no-touch direct
self-serve sale to individual managers (B2C-style, matches the content/SEO
distribution plan already agreed on), and a higher-touch sale into the
department once there's a wedge (expansion motion, not the initial GTM).

**Marketing strategy (TOFU/MOFU → BOFU):** top-of-funnel via an educational
blog, first-time-manager enablement content, short courses, a "manager
organization"/community angle, and industry events; bottom-of-funnel via a
free offering (freemium or free tier) as the conversion mechanism into paid.
This lines up closely with the content-led distribution plan already in
place — the blog/SEO plan isn't a guess, it's Andrew's own original GTM
thinking validated independently.

## How this reconciles with the MVP we built

The FastAPI + Next.js + Supabase scaffold and the 1:1-prep-and-commitments
feature are still the right starting point — they're the single highest-
frequency, fastest-to-ship wedge into this vision, and match the "low
price/barrier to entry" self-serve motion. What this document changes is
the target shape to build *toward*, so schema and product decisions don't
have to be re-litigated later:

- The data model should eventually support a **goals hierarchy** (org/dept/
  team, each with measurements) and a **competency/expectations framework**
  per role — conceptually the same shape as Prism Tree's Layer 1/2/3
  competency system, which is proven to work for "define what good looks
  like, then score evidence against it."
- **Role-scoped views** (individual/manager/dept-head) are a real feature,
  not a nice-to-have — the same underlying data, filtered and rolled up
  differently per viewer.
- The "1:1 prep" feature should eventually feed the ratings/status layer
  (a good 1:1 log is evidence toward "how is this person doing against
  expectations"), not stay a standalone journal.
- Content marketing has a ready-made backlog: every entry in "Problems to
  solve" above is close to a publishable post.

None of this needs to be built now. It's here so the next few product
decisions (schema changes, what feature to build after 1:1 prep) get
checked against this instead of guessed at fresh each time.
