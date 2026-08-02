# The Same Page — Engineering Reference

Read this doc for any session involving backend code, API design, database
schema, auth, AI integration, or infrastructure.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | FastAPI (Python) | This app will grow real complexity — multiple AI pipelines, background jobs, evolving data model. Python/FastAPI handles that better than serverless functions. |
| Database + Auth | Supabase (Postgres + RLS + Auth) | Row-level security handles multi-tenant isolation without custom middleware. Auth is built-in. |
| Frontend | Next.js App Router | Marketing pages need to rank on Google — Next.js gives SSG/SSR for public pages and a normal SPA for the auth-gated app, all in one project. Not Vite (no SSR). |
| AI | Anthropic Claude | Called exclusively through `ai_core.py`. |
| Backend hosting | Railway | Same as Prism Tree. Proven. |
| Frontend hosting | Vercel | Native Next.js platform. |

The plumbing (`utils.py`, `ai_core.py`) is a direct port of patterns proven in
a separate, more complex project (Prism Tree). Don't reinvent them.

**Deploy (confirmed Session 10):** both Railway and Vercel auto-deploy on
push — no separate deploy step needed. (This doc previously listed
production deploy as "not yet configured"; that was stale.)

---

## Conventions

### Auth

Every protected backend route receives an `Authorization: Bearer <token>` header
and calls `get_authenticated_client(authorization)` from `utils.py`. This:
1. Verifies the token against Supabase `/auth/v1/user`
2. Returns a Supabase client scoped to that user via RLS

**Never query user data with the service-role client from a request path.**
Service-role is for background jobs and webhook handlers only.

### AI calls

All Anthropic calls go through `ai_core.py`'s `generate_text()`. Route modules
import and call that function — they never import the Anthropic SDK directly.

`AI_DEFAULT_MODEL_HEAVY` and `AI_DEFAULT_MODEL_LIGHT` in `config.py` must always
be valid Anthropic model name strings. The fallback path in `ai_core.py` only
triggers on 5xx errors, not 4xx — a bad model name will not gracefully degrade,
it will error hard.

### Frontend → Backend boundary

All calls from the Next.js frontend to the FastAPI backend go through
`frontend/lib/api.ts`. Components never call `fetch()` directly. When you add a
new backend endpoint, add the corresponding client function to `api.ts` first.

### RLS

Every table has RLS enabled. Core tables scope by `auth.uid()` directly
(`manager_id` / `owner_id`); the RLS-scoped client from
`get_authenticated_client()` enforces this automatically — you don't need to
add `WHERE user_id = ?` to every query.

Org-scoped tables (role_levels, *_configs, assessment_levels, organizations)
scope through `public.current_org_id()` — a SECURITY DEFINER function that
reads `users.org_id` without re-invoking RLS. **Never write a policy with an
inline `(select org_id from users ...)` subquery**: on the `users` table it's
self-referencing ("infinite recursion detected in policy", 42P17), and it
takes every dependent policy down with it. Learned the hard way in Session 6.

Org bootstrap: users have no `organizations` row until they first save
Settings → Profile (or add their first org unit, Session 11). `ensure_org()`
in `utils.py` (moved there from `routes/settings.py` when `org_units.py`
needed the same bootstrap-on-write behavior; `settings.py` keeps `_ensure_org`
as a local alias) creates the org + links `users.org_id` on any org-scoped
write (org insert uses `returning="minimal"` since the select policy can't
see an unlinked org yet).

**Gotcha (Session 10):** `goals`/`projects` policies in schema.sql are named
`"goals_all_own_org"` / `"projects_all_own_org"` but actually scope by
`owner_id = auth.uid()`, not `org_id = current_org_id()` — the naming is
misleading, don't assume org-scoping from the policy name alone. Like
`direct_reports`/`one_on_ones`, routes on these tables don't need
`_ensure_org()` or to populate `org_id` for isolation to work.

---

## Database schema (29 tables — aligned with Miro board)

Full schema with indexes and RLS policies: `database/schema.sql`.

**Core tables (MVP feature set lives here):**
```
organizations        -- org-level config
users                -- manager_id self-ref for hierarchy; role: manager/director/vp/ic
manager_report_connections  -- explicit join table for hierarchy traversal (was on Miro board)
direct_reports       -- the manager's team; user_id nullable (IC login post-MVP)
one_on_ones          -- 1:1 logs; notes private to writing manager (RLS)
commitments          -- polymorphic source_type (one_on_one/goal/project/manual) + source_id
goals                -- activated Session 10; parent_goal_id self-ref; level: company/department/team/individual;
                        org_unit_id (Session 11) names which specific team/department a team/dept goal is for
subscriptions        -- Stripe billing
```

**Configuration tables (set up once per org, not written to constantly):**
```
org_units                   -- activated Session 11; team/department entities, self-ref parent_unit_id.
                                "company" is NOT a row here — the organizations row is the chart root.
                                Org-scoped (current_org_id()), replaces role_levels.functional_team as the
                                source of truth for "which team" — that column stays in schema, UI stopped
                                writing/showing it.
role_levels                 -- central concept; links metrics/skills/values to a role+level
assessment_levels           -- stable ordinal (1-5) + configurable label per org
metric_configs              -- per role_level; order_type: primary/secondary/tertiary
metric_scale_definitions    -- evaluation points 1-4; quantitative/qualitative output; range support
skill_configs               -- same shape as metric_configs
skill_scale_definitions     -- same shape as metric_scale_definitions
value_configs               -- adds value_type: team/company/department
value_scale_definitions     -- same shape
```

**Performance / assessment tables:**
```
assessments          -- rolling assessment per direct report
performance_reviews  -- formal periodic review
skill_assessments    -- per-skill score per direct report
value_assessments    -- per-value score per direct report
metric_entries       -- time-series metric data per direct report
```

**Projects / development plans (still dormant):**
```
projects             -- connected to a goal or standalone; goals=what, projects=how
development_plans    -- one per direct report
dev_plan_aspirations    -- career aspiration: desired role/path + timeline
dev_plan_opportunities  -- areas of opportunity: skills + knowledge
dev_plan_training       -- training needed + projected cost
dev_plan_manager_notes  -- private to manager
```

**Privacy boundary (enforced by RLS):**
- `one_on_ones.notes` — visible to writing manager only
- Everything else (assessments, performance reviews, metrics, development plans,
  goals) — visible to the direct manager and up the hierarchy chain

---

## Scope discipline

The schema is intentionally complete for the full vision (see PRODUCT_VISION.md).
**Build order still matters** — don't implement the competency/assessment
layer until it's actually needed. Goals shipped in Session 10 (the core 1:1
prep + commitments flow was working and in Andrew's hands first, per the
original rule); `projects` is the next candidate in this family but is
explicitly still dormant.

Things explicitly not yet built:
- Stripe webhook handler + subscription-gating middleware
- Blog content pipeline (start with MDX in-repo when the time comes)
- Role-scoped views (individual/manager/dept-head) — schema supports it, UI
  doesn't exist yet. Notably relevant to Goals: company/department-level
  goals exist and are usable (Session 10) but don't yet have a distinct
  dept-head/VP audience until this ships. Also relevant to the new org
  hierarchy (Session 11) — role-scoped views are the natural next payoff for
  having real org_units, but weren't built this pass.
- IC login (user_id on direct_reports is nullable as a future hook)
- `projects` table (goals' sibling — "goals=what, projects=how")
- Goal rollup/status calculation (a parent goal's status computed from its
  children's) — PRODUCT_VISION.md's concept, not built; `goals.status` is a
  plain manually-set field today
- `role_levels.functional_team` data migration — the column stays in the
  schema (not dropped) but the UI stopped writing/showing it as of Session
  11; existing free-text values are not backfilled into org_units.
- Cycle prevention on `org_units.parent_unit_id` — `org_units.py` only
  guards a unit becoming its own direct parent, not a deeper cycle (A's
  parent set to B when B's parent is already A). Fine for a solo manager
  hand-building a small tree; revisit if this becomes multi-editor.

---

## File map

```
backend/
  main.py         FastAPI app init, CORS, router registration
  config.py       Settings — reads .env, exposes AI model names + Supabase keys
  utils.py        get_authenticated_client(), ensure_org()/get_email_from_token() (Session 11), shared helpers
  ai_core.py      generate_text() — the only place Anthropic SDK is called
  routes/
    direct_reports.py   GET/POST/PUT/DELETE /api/direct-reports (+ /overview)
    one_on_ones.py      GET/POST /api/one-on-ones, POST /prep (prep sheet), POST /wrapup (notes → draft log)
    commitments.py      GET /api/commitments, PATCH /api/commitments/{id}
    goals.py            GET/POST/PUT/PATCH/DELETE /api/goals — full level hierarchy (Session 10)
    org_units.py         GET/POST/PUT/DELETE /api/org-units — team/department tree (Session 11)
    settings.py         /api/settings — profile, role-levels, expectations

frontend/
  app/
    (marketing)/        Public SSG pages (home, pricing, blog) — need to be indexable
    app/dashboard/      Auth-gated app shell
    app/login/          Login page
    app/goals/          Goals page — own top-level page, not under Settings (Session 10)
    app/org/            Org builder — own top-level page, tree (build/edit) + read-only chart (Session 11)
  lib/
    api.ts              All fetch() calls live here
    supabase.ts         createClientComponentClient() — browser-side auth client
```

---

## Open questions / not yet decided

- Stripe webhook handler + subscription-gating middleware
- Blog content pipeline (MDX in-repo is the default when we get there)
- Error monitoring (Sentry, or Railway's built-in, or nothing for now)
