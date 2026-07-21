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

Every table has RLS enabled. The policy on all tables is `user_id = auth.uid()`.
The RLS-scoped client from `get_authenticated_client()` enforces this
automatically — you don't need to add `WHERE user_id = ?` to every query.

---

## Database schema (28 tables — aligned with Miro board)

Full schema with indexes and RLS policies: `database/schema.sql`.

**Core tables (MVP feature set lives here):**
```
organizations        -- org-level config
users                -- manager_id self-ref for hierarchy; role: manager/director/vp/ic
manager_report_connections  -- explicit join table for hierarchy traversal (was on Miro board)
direct_reports       -- the manager's team; user_id nullable (IC login post-MVP)
one_on_ones          -- 1:1 logs; notes private to writing manager (RLS)
commitments          -- polymorphic source_type (one_on_one/goal/project/manual) + source_id
subscriptions        -- Stripe billing
```

**Configuration tables (set up once per org, not written to constantly):**
```
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

**Goals / projects / development plans:**
```
goals                -- parent_goal_id self-ref; level: company/department/team/individual
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
**Build order still matters** — don't implement the goals/competency/assessment
layer until the core 1:1 prep + commitments flow is working and in users' hands.

Things explicitly not yet built:
- Stripe webhook handler + subscription-gating middleware
- Blog content pipeline (start with MDX in-repo when the time comes)
- Role-scoped views (individual/manager/dept-head) — schema supports it, UI doesn't exist yet
- IC login (user_id on direct_reports is nullable as a future hook)
- Production deploy configuration

---

## File map

```
backend/
  main.py         FastAPI app init, CORS, router registration
  config.py       Settings — reads .env, exposes AI model names + Supabase keys
  utils.py        get_authenticated_client(), shared helpers
  ai_core.py      generate_text() — the only place Anthropic SDK is called
  routes/
    direct_reports.py   GET/POST/PUT/DELETE /api/direct-reports
    one_on_ones.py      GET/POST /api/one-on-ones, POST /api/one-on-ones/prep

frontend/
  app/
    (marketing)/        Public SSG pages (home, pricing, blog) — need to be indexable
    app/dashboard/      Auth-gated app shell
    app/login/          Login page
  lib/
    api.ts              All fetch() calls live here
    supabase.ts         createClientComponentClient() — browser-side auth client
```

---

## Open questions / not yet decided

- Stripe webhook handler + subscription-gating middleware
- Blog content pipeline (MDX in-repo is the default when we get there)
- Production deploy (Railway + Vercel not yet configured)
- Error monitoring (Sentry, or Railway's built-in, or nothing for now)
