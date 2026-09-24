# The Same Page — Engineering Reference

Read this for any session involving backend code, API design, database schema,
auth, AI integration, or infrastructure.

This doc holds what is true across the whole app. Anything specific to one
feature area lives in `docs/systems/<area>.md` — read only the one you're
touching. Nothing here is dated or session-stamped. Durable reasoning belongs in
Git commit bodies or a load-bearing decision record; the session-history files
are frozen legacy references, not default context.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | FastAPI (Python) | Real complexity ahead — multiple AI pipelines, background jobs, an evolving data model. Handles that better than serverless functions. |
| Database + Auth | Supabase (Postgres + RLS + Auth) | Row-level security handles multi-tenant isolation without custom middleware. Auth is built in. |
| Frontend | Next.js App Router | Marketing pages need to rank on Google — SSG/SSR for public pages plus a normal SPA for the auth-gated app, one project. Not Vite (no SSR). |
| AI | Anthropic Claude | Called exclusively through `ai_core.py`. |
| Backend hosting | Railway | Auto-deploys on push. |
| Frontend hosting | Vercel | Auto-deploys on push. |

`utils.py` and `ai_core.py` are direct ports of patterns proven in a separate,
more complex project (Prism Tree). Don't reinvent them.

---

## Conventions

### Auth

Every protected route takes an `Authorization: Bearer <token>` header and calls
`get_authenticated_client(authorization)` from `utils.py`, which verifies the
token against Supabase `/auth/v1/user` and returns a client scoped to that user
via RLS.

**Never query user data with the service-role client from a request path.**
Service-role is for background jobs and webhook handlers only. The one
unauthenticated route in the app (`GET /api/invites/{token}`) uses a plain
anon-key client plus a SECURITY DEFINER function, not service-role, precisely to
keep this rule intact.

**Token cache:** `verify_token_with_supabase()` caches the verified payload in
`_token_cache`, keyed by raw token and TTL'd to the token's own `exp`.
`_evict_expired_tokens()` sweeps on every call, so it stays bounded by
currently-valid tokens. Per-process and in-memory — not shared if this ever runs
on more than one Railway instance; fine at today's scale. Handlers run on a
thread pool (below), so every access goes through `_token_cache_lock`.

### Route handlers are plain `def`

The Supabase Python client is synchronous. Inside an `async def` handler its
queries run on the event loop, and with Railway's single uvicorn worker that
blocks every other request in the process until the query returns. A plain
`def` handler runs on FastAPI's thread pool instead, so requests proceed
concurrently. **Write every route handler as `def`.** Read uploads with
`file.file.read()`, not `await file.read()`. One handler calls another directly
(`return get_meeting(...)`), with no `await`. `tests/test_request_concurrency.py`
fails the suite if an `async def` route handler appears.

**Pooled connections.** `get_authenticated_client()` builds a new Supabase client
per request, so each user's JWT lives only on that request's own HTTP session. Its
PostgREST and auth sessions share one module-level `httpx.HTTPTransport`
(`_SUPABASE_TRANSPORT`), which holds the connection pool and SSL context but
never headers. This skips a CA-bundle reload (~140 ms of CPU per request) and a
fresh TLS handshake to Supabase on every call. Never `.close()` a request's
client or session: that would close the shared transport. The same test file
checks that two requests get separate tokens on the same transport.

### AI calls

All Anthropic calls go through `ai_core.py`. Route modules never import the
Anthropic SDK directly.

- `generate_text()` — the default path.
- `generate_text_from_document()` — sends a base64 PDF as a native Claude
  `document` content block. No OpenAI fallback (chat-completions has no
  equivalent native PDF input).
- `call_anthropic_with_tools()` — the raw tool-use call, used only by
  `assistant_engine.py` for the Scribe loop. Anthropic-only by design; the
  tool-use message format is provider-specific.

`AI_DEFAULT_MODEL_HEAVY` / `AI_DEFAULT_MODEL_LIGHT` in `config.py` must be valid
Anthropic model names. The fallback path only triggers on 5xx, not 4xx — a bad
model name errors hard, it does not degrade.

**Draft-then-review is a product rule, not a per-feature choice.** Every AI write
path in the app produces a draft the manager sees and confirms before anything
persists. Prompts are also written to permit an honest empty result: an AI that
returns nothing is correct behavior, not a failure. Do not add an AI path that
writes directly.

### Entitlement and the read-only gate

Each manager has one `subscriptions` row: a founding place (`founding_number`
1–20, 90 days), a 14-day trial, `active` (paid, or comped when there's no Stripe
id), or read-only once `trial_ends_at` passes without `active`. The row is
created by `ensure_entitlement()`, a SECURITY DEFINER function called with the
user's own client the first time the app shell loads (`GET /api/entitlement`,
via `<EntitlementNotice />`). Invited ICs never get a row. Users can read their
row but never write it.

`read_only_gate` in `main.py` returns 402 on every POST/PUT/PATCH/DELETE under
`/api/` for a read-only account, except the read-shaped POSTs listed in
`_READ_ONLY_ALLOWED`. **A new POST that only reads (a preview, an explain) must
be added to that list**, or read-only managers lose it. The gate is registered
before `CORSMiddleware` so the 402 carries CORS headers, it fails open if the
lookup errors, and it caches for 60 seconds per user (`get_entitlement()` in
`utils.py`). `api.ts` fires `READ_ONLY_EVENT` on any 402, and the notice shows
the banner. Stripe doesn't exist yet: until it does, a manual flip of `status`
to `active` in the SQL editor is how someone pays.

### Rate limiting

Every AI-calling endpoint must be rate-limited. The shared `limiter` lives in
`utils.py` (not `main.py`, to avoid a circular import with the route modules) and
is registered in `main.py` via `app.state.limiter` + `SlowAPIMiddleware`.

To limit a new route: give the endpoint a `request: Request` parameter and stack
`@limiter.limit("10/minute")` directly below the `@router.*` decorator. See
`/prep` and `/wrapup` in `one_on_ones.py`, `/draft` in `assessments.py`, or
`/insight` in `dashboard.py`.

Limiting is **per remote IP**, not per user — slowapi's `key_func` runs before
`get_authenticated_client()` resolves a `user_id`. Coarser (an office NAT shares
a bucket) but sufficient against a runaway loop, which is the real risk today.

Every other write (POST/PUT/PATCH/DELETE) gets `DEFAULT_WRITE_LIMIT`, 120/min per
route per IP, set in `utils.py`. A decorator replaces the default rather than
adding to it. Reads have no limit. `SlowAPIMiddleware` is registered after the
read-only gate and before `CORSMiddleware`: its 429 has to carry CORS headers,
and a throttled write shouldn't cost an entitlement lookup.

### Logging and error monitoring

Use `logger = logging.getLogger(__name__)` in every module; never `print()`
outside `scripts/`. `observability.py` writes each record as one JSON line and
adds the request's `route` and `user_id` itself, so a call site only says what
happened. Pass extra fields as `extra={"fields": {...}}`.

An `except Exception:` must log. Pick the level by what the failure means:
`info` for an expected outcome dressed as an exception (a `.single()` lookup
that is really a 404), `warning` for an optional thing that degrades quietly
(an AI nice-to-have), `error` for a failure that leaves data wrong or
incomplete. `error` and above, and every unhandled exception, go to Sentry once
`SENTRY_DSN` is set on Railway; without it `init_sentry()` does nothing.

Never log a prompt, a model's output, note text, a transcript or audio. Ids,
counts, model names and status codes only. `ai_core.py` logs one `ai_call` line
per provider call (model, tokens, latency) and is the AI cost ledger.

`RequestContextMiddleware` is registered last, so it is outermost. It only sets
a contextvar, so it doesn't disturb the gate-before-CORS order above.

### Frontend → Backend boundary

All calls from Next.js to FastAPI go through `frontend/lib/api.ts`. Components
never call `fetch()` directly. Add the client function to `api.ts` when you add
the endpoint, not after.

`authedFetch` forces `Content-Type: application/json`; multipart uploads use
`authedFormFetch` instead (setting JSON on a file body corrupts it).

### Settings section state

`frontend/app/app/settings/page.tsx` renders exactly one section component at a
time, conditionally, so switching sections unmounts the previous one. **Any state
a section needs to survive switching away and back — a selected role, a tab, a
filter — must live in `SettingsPage` and be passed down as props**, never
declared locally inside the section component.

State owned locally resets to defaults on every switch, which reads as data loss
to the user even though the rows are fine. `roleLevels` / `reports` / `orgUnits`
already follow this pattern.

### Route declaration order

FastAPI matches in declaration order, so a literal path must be declared before a
parameterized sibling: `/overview`, `/rollup`, `/levels`, `/captures` all come
before `/{id}`. Getting this wrong makes the literal path 404 or 422 with a UUID
parse error, which reads as an auth bug.

---

## Data model

`database/schema.sql` is the source of truth — 49 tables with their indexes and
RLS policies. Don't restate it here; read it.

```bash
grep -n "create table" database/schema.sql
grep -n "create policy" database/schema.sql
ls database/migrations/
```

### The three scoping models

Which one a table uses is the single most important thing to know before writing
a query or a policy.

| Model | Predicate | Tables |
|---|---|---|
| Manager-scoped | `manager_id = auth.uid()` | direct_reports, one_on_one_series, one_on_ones, commitments, dr_capture_notes, assessments, skill/value_assessments, metric_entries, team_messages, team_meetings, team_meeting_series, team_meeting_agenda_items, team_callouts, team_dev_focus, direct_report_invites, development_plans + dev_plan_*, assistant_messages, mission_control_events, capacity_profiles, time_off_entries, away_periods, away_period_shifts |
| Owner-scoped | `owner_id = auth.uid()` | goals, projects, check_ins, outside_people, outside_meetings, outside_meeting_people, outside_meeting_links, outside_meeting_series |
| Org-scoped | `org_id = public.current_org_id()` | organizations, users, org_units, role_families, role_levels, *_configs, *_scale_definitions, assessment_levels, capacity_settings, work_unit_configs, documents, document_series, document_scopes, document_citations |

**Naming gotcha:** `goals` and `projects` policies are named `goals_all_own_org` /
`projects_all_own_org` but scope by `owner_id`, not org. Never infer the scoping
model from a policy name — read the predicate.

One additive exception: `direct_reports_select_own_as_ic` lets a claimed IC read
their own `direct_reports` row.

### Never inline a users subquery in a policy

Org scoping goes through `public.current_org_id()`, a SECURITY DEFINER function
that reads `users.org_id` without re-invoking RLS. **A policy with an inline
`(select org_id from users ...)` subquery self-references on the `users` table**
— "infinite recursion detected in policy" (42P17) — **and takes every dependent
policy down with it.** This has cost real time twice; use the function.

### SECURITY DEFINER functions

The deliberate exceptions to RLS, all in `schema.sql`:

| Function | Purpose |
|---|---|
| `current_org_id()` | org scoping without recursion |
| `led_org_unit_ids()` | the one gate every rollup filters through — units the caller leads plus all descendants |
| `org_unit_capacity_rollup(start, end)` | capacity per unit |
| `org_unit_goals_rollup()` | goal status counts per unit |
| `org_unit_projects_rollup()` | project status counts per unit |
| `org_unit_people_rollup()` | headcount + role breakdown per unit |
| `get_invite_preview(token)` | the only function granted to `anon`; returns names + expiry, never the row |
| `accept_direct_report_invite(token)` | claims a report row for `auth.uid()`, re-checks `auth.email()` internally as defense in depth |
| `handle_new_user()` | signup trigger; defaults every new user to `role = 'manager'` |

**Every rollup returns aggregates only, by construction** — a count or a summed
figure per org unit, never a row identifying a person. That is what makes
bypassing RLS safe here, and it is a contract: a rollup function that could
return a name would break the app's privacy boundary. There is no cross-manager
read policy on any base table.

### Privacy boundary

- `one_on_ones.notes` — the writing manager only.
- Everything else (assessments, metrics, development plans, goals) — the direct
  manager and up the hierarchy chain.
- Anything outside your own team — aggregates only, no exceptions.

### Org bootstrap

Users have no `organizations` row until they first save Settings → Profile or add
their first org unit. `ensure_org()` in `utils.py` creates the org and links
`users.org_id` on any org-scoped write. The org insert uses `returning="minimal"`
because the select policy can't see an unlinked org yet.

### Partial unique indexes and NULL

Postgres treats every NULL as distinct, so `UNIQUE(a, b)` does not prevent
duplicate rows where `b IS NULL`. Wherever a nullable `org_unit_id` (or similar)
carries an "applies to everything" meaning, uniqueness needs **two partial unique
indexes** — one for the non-null case, one `WHERE b IS NULL`. Already done for
`team_callouts`, `team_meeting_series` and `document_scopes`.

That interacts with the FK delete action: with `ON DELETE SET NULL`, deleting a
parent row can try to create a second null row and fail the whole DELETE.
`team_callouts.org_unit_id` uses `ON DELETE CASCADE` for exactly this reason,
while `team_meetings` uses `SET NULL`. **Check this interaction before
defaulting to `SET NULL` on any new `org_unit_id` column.**

---

## Verifying schema and RLS changes

`database/local_verify_stub.sql` (checked in) stands up bare `auth`/`storage`
schemas, the `anon`/`authenticated`/`service_role` roles, and the grants real
Supabase sets by default, so the *actual* `schema.sql` and any migration run end
to end against a throwaway local Postgres.

```bash
dropdb --if-exists tsp_verify && createdb tsp_verify
psql tsp_verify -f database/local_verify_stub.sql
psql tsp_verify -f database/schema.sql          # + the migration, if testing one
```

Full command sequence and the gotchas it already solves (`raw_user_meta_data`,
the storage stub, RLS/RETURNING bootstrap ordering) are in the file's own header.

Two rules:

- **Always start from a freshly dropped database.** Reusing one produces
  duplicate-key errors that look like real bugs and aren't.
- **The stub only proves the schema applies, not that a policy does what you
  think.** Write a throwaway functional `.sql` on top of it (`set role
  authenticated`, `set_config('app.current_user_id', ...)`) that actually
  exercises the policy or function you changed — including the failure cases.

Device `device_bash` has a short per-call cap, too short for `npm ci` / `next build` /
`pip install`. Rebuild in the cloud sandbox from the connected folder instead.
The usual full pass: `py_compile` on changed files, a real `import main` with
dummy Supabase env vars (catches import-order bugs and confirms every route
registers with no path collisions), `tsc --noEmit`, `next build`, plus the
Postgres run above when schema changed.

---

## CI

`.github/workflows/ci.yml` runs on every push and pull request against a clean
checkout of the commit: `pytest` plus `pip-audit` for the backend, `tsc --noEmit`
plus `npm audit --audit-level=high` for the frontend. It is an alarm, not a
gate. Railway and Vercel deploy on push whatever CI says, so a red run means
"check production now". `frontend/package-lock.json` is gitignored, so CI and
Vercel both resolve the ranges in `package.json` fresh. That is why the security
floors (`next ^15.5.26`, the `postcss` override) live there. FastAPI is pinned
below 0.137; `requirements.txt` says why.

## Rolling back a bad push

Railway and Vercel each keep every past deployment, so rolling back means
promoting an old build. Nothing needs rebuilding, and the two are independent:
roll back only the side that broke.

1. **Frontend (Vercel).** Project → Deployments, find the last good
   Production deployment, then ⋯ → **Promote to Production** (Vercel calls it
   Instant Rollback). Live in seconds. Vercel stops auto-promoting until you
   promote a new deployment by hand, so the next push won't silently undo the
   rollback.
2. **Backend (Railway).** Service `thesamepage` → Deployments, find the last
   good one, then ⋯ → **Rollback** (older UIs call it Redeploy). It goes live
   once `/health` passes the healthcheck. Confirm with `curl https://thesamepage-production.up.railway.app/health`.
   Railway *does* redeploy on the next push, so step 3 matters here.
3. **Git.** `git revert <bad sha>` and push, so `main` matches what is running.
   Don't force-push over history: both platforms deploy from it.
4. **Database.** Migrations are forward-only (no down files) and Andrew runs
   them by hand in the Supabase SQL editor; nobody else has access. Undoing
   one means a new dated migration that reverses it, with the matching
   `schema.sql` edit (hard rule 4). Almost every migration here only adds
   (tables, columns, policies), and old code ignores what it doesn't read. So
   the usual move is to roll back the code and leave the schema alone.

If a backend rollback crosses an entitlement or RLS change, check the read-only
gate still answers: a write from a signed-in account should get 200 or 402,
never 500.

---

## Rotating secrets

Every production secret lives in exactly one dashboard plus the host that
reads it. None lives in the Obsidian vault: `backend/.env` holds a key only
while Andrew is actively running the backend locally, and it is a separate
`tsp-local` key so the production key never touches the vault.

| Secret | Issued by | Read by | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Claude Console → The Same Page Production workspace → API keys | Railway | every AI feature |
| `OPENAI_API_KEY` | OpenAI → API keys | Railway | transcription only |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API Keys | Railway, Vercel | public by design; RLS is the guard |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API Keys | Railway | bypasses RLS; no request path uses it |
| SMTP app password (`tsp-supabase-smtp-2026-09`) | Google account for ag@thesamepage.xyz → Security → App passwords (needs 2-Step Verification) | Supabase → Auth → Emails → SMTP Settings | sends login email via smtp.gmail.com:465; to rotate, paste the new one, send a test magic link, then revoke the old one in Google |
| `STRIPE_*` | Stripe | Railway | empty until billing ships |
| `SENTRY_DSN` | Sentry | Railway | not a secret; leaks only let someone send you errors |

**Name keys `tsp-<host>-<yyyy-mm>`** (`tsp-railway-2026-09`), so the dashboard
shows at a glance which key serves where and how old it is. A key whose host
you can't name is a key to delete.

**The rotation, for any one secret. New key first, old key last:**

1. **Create** the new key in the issuing dashboard, named as above. In the
   Claude Console make it a **workspace (service account) key**, not a
   personal one: a personal key dies with the person's account. Copy it,
   then close the "save your key" dialog **before** anything else reads that
   tab: the dialog shows the full key, and any screenshot or AI browser tool
   that reads the page captures it.
2. **Paste** it into the host's variable (Railway → `thesamepage` → Variables,
   or Vercel → Settings → Environment Variables). Railway redeploys on save;
   Vercel needs a manual redeploy because `NEXT_PUBLIC_*` values are baked in
   at build.
3. **Verify** the new key is the one serving: `curl
   https://thesamepage-production.up.railway.app/health` returns ok, a
   signed-in page on the Vercel app loads data, and for AI keys the
   dashboard page makes a light AI call, so the new key shows usage in the
   issuing console (usage can lag a few minutes).
4. **Disable or delete** the old key only after step 3 passes. Until then the
   old key is the rollback: paste it back and redeploy.
5. **Record** it: one line in the commit or backlog (date, which key).

**When:** immediately on any suspected exposure (pasted in a chat, committed,
left in a synced file), when someone with access leaves, and otherwise every
six months.

**Supabase is different.** The legacy `anon`/`service_role` JWTs cannot be
rotated one at a time: rotating the legacy JWT secret or disabling legacy keys
kills both. Supabase is retiring them by the end of 2026, so the next Supabase
rotation is the migration to `sb_publishable_…` / `sb_secret_…` keys, which
needs `supabase` ≥ 2.16 in `backend/requirements.txt` (2.9.1 rejects any key
that isn't a JWT). After that migration, each secret key rotates on its own
with the steps above.

---

## Scope discipline

The schema is intentionally complete for the full vision (see PRODUCT_VISION.md).
**Build order still matters.** Prefer activating a dormant table over adding a new
one, and ship the core object before its rollup/cross-link layer.

Not yet built, deliberately:

- **Stripe** — webhook handler + subscription-gating middleware.
- **Blog content pipeline** — MDX in-repo when the time comes.
- **IC-facing view.** The account/claim mechanism works (invite → magic link →
  `direct_reports.user_id` set), but `/app/ic` is a static placeholder. This is
  what keeps `team_messages` store-only. The natural next step to unlock it.
- **Commitments → project linking** (`source_type='project'`, already in
  schema.sql's check constraint).
- **Goal and project rollup status** — a parent's status computed from its
  children. `goals.status` / `projects.status` are plain manual fields today.
- **Capacity demand/allocation** — the model is supply-only. Wiring it into
  projects/goals as "how much of that capacity is spoken for" is the next step.
- **Individual-level goals in rollups** — `org_unit_goals_rollup()` covers
  department and team levels only.
- **`org_unit_projects_rollup()` scoping divergence** — it still derives scope
  from a project's goal or assignee rather than the direct `projects.org_unit_id`
  column. Aggregating *up* to a leader is a different concept from `/app/team`'s
  cascade *down* from a parent, so this was left alone rather than "fixed" —
  but check which mechanism a surface needs before assuming they agree.
- **Admin/owner concept.** Any org member can assign any org member as an
  org_unit leader, and can edit org units. No gating exists.
- **Cycle prevention on `org_units.parent_unit_id`** — only a unit becoming its
  own direct parent is blocked, not a deeper cycle. Fine for one hand-built tree.
- **`role_levels.functional_team`** — column stays, UI stopped writing it,
  existing free-text values were never backfilled into `org_units`.
- **`performance_reviews`** — dormant, deferred in favor of rolling assessments.
- **Settings UI for renaming `assessment_levels`** — the endpoint exists, nothing
  calls it; the 5 seeded defaults are usable as-is.

---

## Open questions

- Error monitoring — the backend is wired (`observability.py`) but stays off
  until `SENTRY_DSN` exists on Railway. The frontend has no error reporting.
- CI doesn't block deploys. Railway and Vercel deploy on push, and CI (above)
  only reports. Making it a gate would mean deploy hooks or GitHub-triggered
  deploys instead of the platforms' own git integrations.
- Pagination — no list endpoint paginates. Fine at one manager's scale, not at
  an org's.
