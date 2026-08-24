# The Same Page — Project Guide

Management OS for first-time and newly-promoted managers: 1:1 prep, commitment
tracking, and judgment-on-demand for conversations most managers never got
trained to have. Solo founder, content/SEO distribution, $20/mo self-serve.

---

## Start every task here

Do not preload project history or every reference doc. Start from Andrew's task,
then retrieve only the current context that can change the work:

- **New task:** ignore any handoff and use the routing table below.
- **Continuation:** when Andrew says to continue, resume, or finish earlier work,
  read `docs/HANDOFF.md` if it exists, then the relevant current-state docs and
  code. A handoff is active task state, not general project memory.
- **Historical question:** search the relevant file's Git history and commit
  bodies first. `docs/SESSION_HISTORY.md` and
  `docs/archive/SESSION_HISTORY_ARCHIVE.md` are frozen legacy references; open
  them only when Git and a current decision record do not answer the question.

Read the *core* doc for the task type, and only the subsystem doc for the thing
you're actually touching:

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
one-on-ones.md      scheduling, recurrence, prep, the call, wrap-up, carry-forward
team.md             /app/team — roster, goals, meetings, callouts, IC invites
mission-control.md  /app/dashboard — action brief, ranking, dispositions, rollback
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

`docs/decisions/` holds one record per durable decision — the cross-subsystem,
costly-to-reverse choices whose rationale would otherwise be relitigated. Read
one when you are about to change what it decided.

Pending work that is scoped but not built has its own doc:
`docs/NOTES_INGESTION_SCOPING.md`. Shipped scoping docs live in
`docs/archive/scoping/` — historical, never current intent.

`docs/Redesign Scoping/mission-control-bounded-synthesis.html` is the **approved
Mission Control visual authority** — open it before visual work on that surface.
Its example data is reference content, not validated customer data or final copy.

---

## How to find things

Don't trust volatile counts in a doc — they go stale. Ask the repo:

```bash
ls backend/routes/                          # every API module
grep -rn "@router\." backend/routes/        # every endpoint
grep -n "CREATE TABLE" database/schema.sql  # every table
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
  schema.sql             source of truth for tables, indexes, RLS policies
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

When the environment has authorized Git write and network access, commit and
push directly when Andrew asks. If it cannot, hand Andrew a paste-ready block.

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

`tsp-push` closes out completed or continuing work. Git records completed
history; `docs/HANDOFF.md` exists only when another session must resume genuinely
unfinished work; canonical docs are updated only when their current truth
changed. `docs/SESSION_HISTORY.md` is frozen and must not receive new entries.

Two rules matter when editing docs by hand:

- **Subsystem docs describe the present, not the history.** When a session
  changes how something works, rewrite that subsystem's doc to current state.
  Durable reasoning belongs in the commit body or a load-bearing decision
  record — no new "(Session N)" stamps in reference docs.
- **Historical reference content is preserved.** Materially superseded
  canonical content moves to the matching file under `docs/archive/`. This does
  not apply to the temporary `docs/HANDOFF.md`, which is retired when its work
  is complete.
