# The Same Page — Engineering Reference

Read this for any session involving backend code, API design, database schema,
auth, AI integration, or infrastructure.

This doc holds what is true across the whole app. Anything specific to one
feature area lives in `docs/systems/<area>.md` — read only the one you're
touching. Nothing here is dated or session-stamped; the story of how a decision
was reached is in `docs/SESSION_HISTORY.md`, and only there.

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
on more than one Railway instance; fine at today's scale.

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

`database/schema.sql` is the source of truth — 44 tables with their indexes and
RLS policies. Don't restate it here; read it.

```bash
grep -n "create table" database/schema.sql
grep -n "create policy" database/schema.sql
ls database/migrations/
```

**Known drift:** `assistant_messages` (migration `2026-08-13_assistant_messages.sql`,
applied live) was never folded back into `schema.sql`. A local verification run
from `schema.sql` alone will not have that table. Fold it in next time you touch
the schema.

### The three scoping models

Which one a table uses is the single most important thing to know before writing
a query or a policy.

| Model | Predicate | Tables |
|---|---|---|
| Manager-scoped | `manager_id = auth.uid()` | direct_reports, one_on_ones, commitments, dr_capture_notes, assessments, skill/value_assessments, metric_entries, team_messages, team_meeting_notes, team_callouts, team_dev_focus, direct_report_invites, development_plans + dev_plan_*, assistant_messages, capacity_profiles, time_off_entries |
| Owner-scoped | `owner_id = auth.uid()` | goals, projects, check_ins |
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
`team_callouts` and `document_scopes`.

That interacts with the FK delete action: with `ON DELETE SET NULL`, deleting a
parent row can try to create a second null row and fail the whole DELETE.
`team_callouts.org_unit_id` uses `ON DELETE CASCADE` for exactly this reason,
while `team_meeting_notes` uses `SET NULL`. **Check this interaction before
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

Device `device_bash` has a ~45s cap, too short for `npm ci` / `next build` /
`pip install`. Rebuild in the cloud sandbox from the connected folder instead.
The usual full pass: `py_compile` on changed files, a real `import main` with
dummy Supabase env vars (catches import-order bugs and confirms every route
registers with no path collisions), `tsc --noEmit`, `next build`, plus the
Postgres run above when schema changed.

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

- Error monitoring — `sentry-sdk` is in `requirements.txt`, unused. Same
  "installed ahead of being wired up" state `slowapi` was in before it got used.
- Automated tests — `pytest` is in `requirements.txt`, unused. No test files,
  `tests/` directory, or CI anywhere in the repo. Andrew's explicit call: keep
  flagging rather than scope a first pass now.
- Pagination — no list endpoint paginates. Fine at one manager's scale, not at
  an org's.
