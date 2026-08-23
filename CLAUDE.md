# The Same Page — Session Index

Management OS for first-time and newly-promoted managers: 1:1 prep, commitment
tracking, and judgment-on-demand for conversations most managers never got
trained to have. Solo founder, content/SEO distribution, $20/mo self-serve.

---

## Read this before starting any session

**Always read `docs/SESSION_HISTORY.md` first.** It holds the 5 most recent
sessions in full and tells you the current state and next task, so you don't
relitigate decisions already made. Older sessions are compact index lines
pointing to `docs/archive/SESSION_HISTORY_ARCHIVE.md` — open the archive only
when you need the full detail behind one specific past decision.

Then read by task type — read the *core* doc, and only the subsystem doc for
the thing you're actually touching:

| Task type | Read |
|---|---|
| Backend, API, DB, auth, AI, infra | `docs/ENGINEERING.md` |
| UI, component patterns, design decisions | `docs/DESIGN.md` |
| Product scope, feature priority, roadmap | `PRODUCT_VISION.md` |
| Pricing, GTM, content, ICP | `docs/GTM.md` |
| One specific feature area | `docs/systems/<area>.md` (see below) |

`docs/systems/` holds one current-state doc per subsystem — read on demand,
never all at once:

```
one-on-ones.md      prep, the call, wrap-up, cadence, capture notes
team.md             /app/team — roster, goals, meeting notes, callouts, IC invites
mission-control.md  /app/dashboard — zone map, AI insight, quick add
context-engine.md   document ingest, extraction, retrieval, the Brain
scribe.md           conversational data entry, the agent loop, eval harness
expectations.md     role ladders, coverage grid, JD import, AI draft
assessments.md      rolling ratings, AI draft-then-review
development.md      individual plans, team training focus
check-ins.md        the temporal layer under goals and projects
capacity.md         supply model, off-days buffer, department rollup
org-scoping.md      org_units, leader assignment, role-scoped rollups
brand.md            Current & Carbon — colour roles, ink scale, status vocabulary, logo
```

Pending work that is scoped but not built has its own doc:
`docs/NOTES_INGESTION_SCOPING.md`. Shipped scoping docs live in
`docs/archive/scoping/` — historical, never current intent.

`docs/Redesign Scoping/mission-control-action-first.html` is the **approved
visual authority** for the app's dark theme — open it before any visual work.
It is a look-and-feel reference, not an IA proposal.

---

## How to find things

Don't trust a file map in a doc — it goes stale. Ask the repo:

```bash
ls backend/routes/                          # every API module (20 today)
grep -rn "@router\." backend/routes/        # every endpoint
grep -n "CREATE TABLE" database/schema.sql  # every table (46 today)
ls database/migrations/                     # every schema change, dated
ls frontend/app/app/                        # every auth-gated page
ls frontend/components/                     # shared components
```

Shape of the repo, which does *not* change often:

```
backend/     FastAPI, deploys to Railway on push
  main.py              app init, CORS, router registration, rate limiter
  config.py            env vars, AI model names, Supabase keys
  utils.py             get_authenticated_client(), ensure_org(), shared limiter
  ai_core.py           the only place the Anthropic SDK is called
  context_engine.py    Context Engine plumbing (not a route)
  assistant_engine.py  the Scribe's agent loop (not a route)
  routes/              one module per API area

database/
  schema.sql             source of truth for 46 tables, indexes, RLS policies
  migrations/            dated .sql files — every schema change lands here first
  local_verify_stub.sql  lets schema.sql run against a throwaway local Postgres

frontend/    Next.js App Router, deploys to Vercel on push
  app/(marketing)/   public pages (SSG/SSR)
  app/app/           auth-gated app
  app/auth, app/invite
  components/        shared components
  lib/api.ts         every backend call, nowhere else
  lib/supabase.ts    browser-side Supabase client
  lib/tokens.ts      brand class strings — status maps, buttons, cards, KPI tones
  public/            logo masters, favicon, app icons
  tailwind.config.js every colour value + the font token (see docs/systems/brand.md)

docs/        see the table above
```

---

## Hard rules (enforce in every session)

1. **Auth:** use `get_authenticated_client()` from `utils.py`. Never service-role
   for user data on a request path.
2. **AI calls:** always through `ai_core.py` (`generate_text()`, or
   `call_anthropic_with_tools()` for the Scribe loop). Never inline SDK calls.
3. **API calls:** all frontend→backend calls go through `lib/api.ts`. No ad-hoc
   `fetch()` in components.
4. **Schema changes:** a dated file in `database/migrations/` *and* the matching
   edit to `schema.sql` — never one without the other. Verify locally against
   `local_verify_stub.sql` before calling a migration done. Prefer activating a
   dormant table over adding a new one; see ENGINEERING.md → Scope discipline.
5. **Models:** `AI_DEFAULT_MODEL_HEAVY` / `AI_DEFAULT_MODEL_LIGHT` in `config.py`
   must be valid Anthropic model names — a bad name errors hard, it does not
   degrade.
6. **AI writes are draft-then-review.** No AI-generated content enters the record
   without the manager seeing and confirming it. This applies to every surface.

---

## Handing Andrew a terminal command

Any paste-ready block that runs `git add` / `commit` / `push` **must** start with the
lock removal:

```bash
cd "/Users/andrewgodlewski/Desktop/Obsidian/main/01 Projects/The Same Page"
rm -f .git/index.lock
git add ...
```

This repo reliably ends up with a stale `.git/index.lock` left behind by session
tooling, and the sandbox can't delete it itself (`Operation not permitted`).
Without that line the paste fails on `git add` with "Unable to create
'.../.git/index.lock': File exists", which reads like a git problem and isn't
one. Include it every time, unprompted. It's a no-op when no lock is present.

---

## Keeping these docs true

`tsp-push` closes out every session: it writes the SESSION_HISTORY entry and
updates whichever docs the session actually changed. Two rules it enforces that
matter when you're editing docs by hand:

- **Subsystem docs describe the present, not the history.** When a session
  changes how something works, rewrite that subsystem's doc to current state.
  The story of how it got there belongs in SESSION_HISTORY, and only there — no
  "(Session N)" stamps in reference docs.
- **Nothing is deleted, only moved.** Superseded content goes to the matching
  file under `docs/archive/`.
