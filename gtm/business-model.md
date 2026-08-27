# Business model & growth

How The Same Page makes money and where customers come from. Read for pricing,
tiers, distribution, or content strategy.

**This doc no longer owns the audience or the competition.** Who we sell to is
`gtm/personas/new-manager.md`. What we are against is `gtm/positioning.md`, which
corrected this file's old competitive landscape table. How we sound is
`gtm/brand/voice-rules.md`.

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

**The lead is decided: review season.** Not a preference — the dossier guilt that
leads the homepage has no search query, and content is the entire GTM for v1, so top
of funnel has to sit where demand exists. Weight the backlog toward the review cycle
and the specific hard tasks around it. See `gtm/positioning.md`.

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

**Technical setup:** Blog runs on HubSpot Content Hub, as part of the marketing
site. Superseded the earlier plan of MDX in-repo under
`frontend/app/(marketing)/blog/`, which is no longer the intent. See
`website/docs/build-process.md`.

**Conversion path:** Blog post → email capture or free trial → paid. No paywall
on content. Freemium or free-tier mechanic is the BOFU conversion lever.
Free tier scope: not yet defined — nail the paid product first.

---

---

## Product boundary: management, not project management

> If it coordinates how contributors execute the work, it belongs in a project-management tool. If it helps the manager understand, intervene, and follow through, it belongs here.

This is the line between The Same Page and task-management software. Initiatives
belong in the product as manager context: what matters, who owns it, what outcome
it supports, what changed, and where the manager may need to step in. Tasks,
dependencies, workflow stages, delivery scheduling, and contributor coordination
do not. Use this distinction in positioning, sales conversations, and product
copy whenever the initiative surface could otherwise be mistaken for a project
management tool.

---

