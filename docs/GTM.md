# The Same Page — GTM & Business Model Reference

Read this doc for any session involving pricing, distribution strategy, content
plan, ICP, or competitive positioning. Pulled from the original Miro board.

---

## Business model

**Self-serve SaaS, land-and-expand.**

- **Entry point:** Individual manager buys for themselves — low price, low
  friction, no procurement process required. Target: $20/mo.
- **Expansion:** Same per-seat price extends to the manager's team. Business/
  department tier targets ~$100/mo. The path is individual → team → department.
- **Add-ons:** Modular. Not yet defined — validate core before adding tiers.

This is an individual manager buying for themselves, not an HR team buying for
the org. That distinction matters for everything — product design, messaging,
pricing, onboarding.

---

## ICP (Ideal Customer Profile)

First-time or newly-promoted manager with 3+ direct reports, at a tech-industry
company (startup or scale-up), on a GTM team, with under 3 years of management
experience, working remote, at a company without a strong internal manager-
coaching culture.

Age: roughly 28–35. Pain: balancing multiple demands in the role while still
figuring out how to fairly assess team performance against ambiguous goals.

**What they are NOT:** an HR team, a VP of People, or a seasoned manager who's
done this for 10 years. Design and message for the new manager figuring it out,
not the expert who already has a system.

---

## Growth strategy

Two motions, sequenced:

1. **No-touch self-serve (now):** Individual managers find the product via
   content/SEO, sign up themselves, pay with a card. No sales involvement.
   This is the entire GTM for v1.

2. **Expansion (later):** Once a manager is using the product, expand into
   their department/team. Higher-touch, not the initial motion.

Do not build for motion 2 until motion 1 is working.

---

## Content & SEO strategy

Content is the distribution channel. The blog exists to rank for terms that
first-time managers are actively searching.

**Content categories (from the problem-space brainstorm):**
- How to run an effective 1:1
- How to give feedback without it being awkward
- How to set expectations clearly for a new direct report
- How to hold someone accountable without micromanaging
- How to run a performance review when you have no template
- How to identify high performers vs. low performers
- How to build trust with a remote team

Every problem in `PRODUCT_VISION.md → "Problems to solve"` is close to a
publishable post title. That list is the content backlog.

**Technical setup:** Blog is MDX in-repo (under `frontend/app/(marketing)/blog/`).
Simple. No headless CMS until content volume justifies it.

**Conversion path:** Blog post → email capture or free trial → paid. No paywall
on content. Freemium or free-tier mechanic is the BOFU conversion lever.
Free tier scope: not yet defined — nail the paid product first.

---

## Competitive landscape

| Category | Players | Our angle |
|---|---|---|
| Feedback + Engagement | Culture Amp, engagement surveys | Survey-heavy, HR-bought, not manager-first |
| Performance Management | Lattice, 15Five, ClearCompany | HR buyer, not manager buyer; complex setup |
| Task Management | Asana | Not built for people management |
| Skills/Competency | Coursera for Business | Learning, not doing |
| All-in-one HRIS | Rippling, Workday, SAP, Salesforce | Enterprise, HR-bought, overkill |

**Differentiation thesis:**
1. **Manager-first** — every competitor is sold to HR/People teams. We design
   for the manager as the primary user and buyer.
2. **All-in-one for the manager** — competitors are single-purpose; managers
   stitch 4-5 tools together. We collapse 1:1 notes, commitments, performance
   context, and coaching nudges into one surface.
3. **Judgment, not just data** — we don't just show data, we help the manager
   know what to do with it. AI-assisted coaching and prep, not dashboards.

---

## Messaging principles

- Lead with the manager's pain, not the product's features.
- "Mission control for your team" is the right metaphor — single surface,
  everything you need to be a confident manager.
- Avoid HR-speak ("performance management," "engagement scores"). Use
  manager-speak ("how's my team doing," "what do I say in this conversation").
