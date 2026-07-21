# The Same Page — Session Index

Management OS for first-time and newly-promoted managers: 1:1 prep, commitment
tracking, and judgment-on-demand for conversations most managers never got
trained to have. Solo founder, content/SEO distribution, $20/mo self-serve.

---

## Read this before starting any session

| Task type | Read these |
|---|---|
| Backend, API, AI, database, auth | [ENGINEERING.md](docs/ENGINEERING.md) |
| Product decisions, feature scope, roadmap | [PRODUCT_VISION.md](PRODUCT_VISION.md) |
| Pricing, GTM, content strategy, ICP | [GTM.md](docs/GTM.md) |
| UI, design decisions, component patterns | [DESIGN.md](docs/DESIGN.md) |
| What was done last session / what's next | [SESSION_HISTORY.md](docs/SESSION_HISTORY.md) |

**Always read SESSION_HISTORY.md first.** It tells you the current state and
next task so you don't relitigate decisions already made.

---

## Project structure

```
backend/          FastAPI app (Python, deploys to Railway)
  main.py         App entry point, CORS, router registration
  config.py       Env vars — AI model names, Supabase keys
  utils.py        get_authenticated_client(), shared helpers
  ai_core.py      All Anthropic calls — use generate_text() only
  routes/
    direct_reports.py   CRUD for direct reports
    one_on_ones.py      1:1 logging + AI-assisted prep

database/
  schema.sql      4 tables: direct_reports, one_on_ones,
                  commitments, subscriptions. All RLS-scoped.

frontend/         Next.js App Router (deploys to Vercel)
  app/
    (marketing)/  Public pages — home, pricing, blog (SSG/SSR)
    app/          Auth-gated dashboard
  lib/
    api.ts        All backend calls go here, nowhere else
    supabase.ts   Supabase client (browser-side)

docs/             Canonical reference docs (see table above)
PRODUCT_VISION.md Full product vision — the "Mission Control" concept,
                  ICP, competitive landscape. Read before adding features.
```

---

## Hard rules (enforce in every session)

1. **Auth:** use `get_authenticated_client()` from `utils.py`. Never service-role for user data.
2. **AI calls:** always through `ai_core.py`'s `generate_text()`. Never inline SDK calls.
3. **API calls:** all frontend→backend calls go through `lib/api.ts`. No ad-hoc `fetch()` in components.
4. **Schema:** stay at 4 tables until real users demand more. See ENGINEERING.md → Scope Discipline.
5. **Models:** `AI_DEFAULT_MODEL_HEAVY` / `AI_DEFAULT_MODEL_LIGHT` in `config.py` must be valid Anthropic model names.
