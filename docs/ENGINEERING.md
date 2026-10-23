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
Anthropic SDK directly (`ai_core.py` itself uses raw `httpx`, not the SDK).

- `generate_text()` — the default path. Two calling conventions:
  - `generate_text(prompt)` sends the whole prompt as `system` with a
    `"Proceed."` user turn and caches nothing. For one-offs.
  - `generate_text(prefix=..., body=...)`, or a `CachedPrompt(prefix, body)`
    returned by a prompt builder, sends the prefix as one system block with
    `cache_control` and the body as the user turn. The prefix is written to
    Anthropic's prompt cache and read back at a tenth of the input price for
    five minutes.
- `generate_text_from_document()` — sends a base64 PDF as a native Claude
  `document` content block. No OpenAI fallback (chat-completions has no
  equivalent native PDF input). Uncached.
- `call_anthropic_with_tools()` — the raw tool-use call, used only by
  `assistant_engine.py` for the Scribe loop. Anthropic-only by design; the
  tool-use message format is provider-specific. Two cache breakpoints: an
  explicit one on the system block (tool definitions + system prompt, shared
  across turns) and the top-level `cache_control` that turns on automatic
  caching, so each round of the loop reads the thread so far from cache and
  pays full price only for the new assistant turn and tool results.
- `submit_text_batch()`, `get_batch()`, `batch_text_results()` — the Batch
  API, for the background worker only (see below). Each request body is built
  by the same `_text_params()` as a live `generate_text()` call, so a batched
  prompt caches and thinks exactly like the live one; results come back at half
  price, usually within the hour, always within 24. Every succeeded result
  logs its own `ai_call` line with `kind: "batch"`. No fallback.

**Prompt caching: what goes in the prefix.** The split is about repetition,
not meaning. The prefix is whatever is byte-identical between calls that
arrive within the cache window; the body is whatever changes per call.
`CachedPrompt` is a `str` subclass equal to the full prompt text, so tests and
fakes that inspect a prompt see the whole thing.

- 1:1 prep and wrap-up: the coaching frameworks and output schema are the
  prefix and mention no one by name, so every prep call in the app shares one
  cache entry; the report's record is the body.
- Assessments (draft, discuss, summary): the rules, the items with their
  scales, the gathered records and the manager's context are the prefix — a
  discussion is a loop over the same records, and a redraft or refreshed
  summary re-reads them; the current draft, conversation and message are the
  body. The picture call's prefix is the rules alone.
- Everything else still uses the single-prompt form.

Anthropic caches nothing below **1,024 tokens on Sonnet** and **4,096 on
Haiku 4.5**; a shorter prefix is silently sent uncached at the normal price
(no write surcharge). That floor is why the light-model calls (Mission
Control explain, Beyond suggestions, ~350 tokens) are not split, and why a
prefix has to be measured, not assumed: `usage.cache_read_input_tokens` in
the `ai_call` log line is the proof. Cache writes cost 1.25× input, so never
put `cache_control` on a one-off prompt.

`AI_DEFAULT_MODEL_HEAVY` / `AI_DEFAULT_MODEL_LIGHT` in `config.py` must be valid
Anthropic model names. The fallback path only triggers on 5xx, not 4xx — a bad
model name errors hard, it does not degrade. On a 5xx, `generate_text` retries
once against OpenAI (`_ANTHROPIC_TO_OPENAI` maps each Anthropic name to a
chat-completions model); the tool and document paths have no fallback.

Heavy is `claude-sonnet-5`, the same model the Scribe runs (`AI_SCRIBE_MODEL`);
light is Haiku 4.5. **Thinking is off on the one-shot paths** (`generate_text`,
the document call): Sonnet 5 thinks by default, thinking tokens bill as output
and count against `max_tokens`, and with it on a 1,800-token summary budget was
spent entirely on thinking. **The Scribe keeps thinking and gets room for it**:
`call_anthropic_with_tools(thinking=...)` is explicit, `AI_SCRIBE_THINKING`
defaults on and `SCRIBE_MAX_TOKENS` is 4,000 per round. At 2,000 a long final
answer was cut mid-sentence once thinking had spent 1,200+ of it; with thinking
off the eval held at 27/30 on every run, failing the same grounding cases. A
round that still stops at the limit logs a warning from `assistant_engine`. Sonnet 5 also occasionally quotes a number
(`"4.8"`) or puts a remark around the JSON — `_clean_proposal()` coerces
numeric strings before the same validation, and `_parse_json()` takes the
first decodable object. Both evals must pass before the heavy model changes
again.

**Draft-then-review is a product rule, not a per-feature choice.** Every AI write
path in the app produces a draft the manager sees and confirms before anything
persists. Prompts are also written to permit an honest empty result: an AI that
returns nothing is correct behavior, not a failure. Do not add an AI path that
writes directly.

**Evals.** `eval/test_assistant.py` (Scribe, 30 cases, ≥28 to pass) and
`eval/test_assessments.py` (the four assessment calls, 14 cases, ≥13 to pass)
run the real prompts against the real model over fixture data. Both need
`ANTHROPIC_API_KEY` in `backend/.env` or the shell; neither touches the
database. Re-run the one that covers a prompt after changing it, and both
before changing a model name in `config.py`.

### Background worker

**Parked (2026-09-26):** built, tested and deployed with the API, but not running — the Railway worker service has deliberately not been created. To turn it on, see `docs/PRELAUNCH_BACKLOG.md` → P2-later. Everything below describes
how it behaves once it runs.

`backend/jobs/` runs on a **second Railway service** built from the same repo
and `backend/` root as the API, with the same environment variables and the
start command `python -m jobs.worker` (or `--once` on a Railway cron
schedule). The API's `Procfile` stays web-only. It serves no HTTP. Every 15 minutes (`WORKER_TICK_SECONDS`) a
tick collects ended batches; inside the nightly window (four hours from
`NIGHTLY_PREP_HOUR_UTC`, default 07:00 UTC = 3am New York) it also submits the
night's work. `python -m jobs.worker --once` runs one tick and exits, which is
also how to run it as a Railway cron service instead.

`ai_jobs` is its only state and its ledger: one row per unit of work (today
`overnight_prep`, one per 1:1 occurrence), with the batch id, a snapshot of
the sources the prompt read, and the outcome. A partial unique index allows
one in-flight job per occurrence, a finished job blocks resubmission for 20
hours, a failed one gets one retry, an orphaned `queued` row is released after
30 minutes, and a batch still running after 26 hours is written off. So a
restart or a mid-night deploy never prepares anything twice. Once a job
finishes its snapshot is cut down to the `drew_on` labels, so no second copy
of record text stays behind. RLS is on with no policies: no user session can
see the table.

**The worker uses the service-role client (`get_admin_client()`), which
bypasses RLS.** That is the one place in the app where it is allowed, and it
changes the rule for any code it calls: every query must carry its own
manager/owner/org predicate, because nothing else isolates tenants. The shared
prep assembly (`assemble_prep_inputs()` in `routes/one_on_ones.py`) does, and
`fetch_role_expectations()` takes `org_id` because company-wide values have no
role to scope them — without it the service role reads every org's values.
`tests/test_nightly_prep.py` plants another tenant's commitment, goal and value
and fails if any reaches the prompt. Before a new job reuses a request-path
helper, read that helper for queries that lean on RLS alone.

The worker spends only for managers on an active plan or a trial with time
left (the same rule as `ensure_entitlement()`), never for archived people.
Railway logs carry `nightly_prep` lines per phase (counts only) and the usual
`ai_call` lines.

**The first-1:1 wrap-up reminder** (`jobs/wrapup_reminder.py`, Andrew
2026-10-05) also runs on every tick, and on its own as
`python -m jobs.wrapup_reminder` (one pass, then exit) so it can run on a
Railway cron service every 30 minutes while the full worker stays parked; that
pass never starts overnight prep or calls a model. A manager with no logged
1:1 whose first 1:1 date has reached 18:00 in the series timezone (New York
when the series says UTC), and not more than 48 hours past that, gets one
reminder ever: `users.wrapup_reminder_sent_at` is claimed first, then the
meeting day is written to the manager's HubSpot contact
(`wrapup_reminder_due`), and the HubSpot workflow "First 1:1 wrap-up reminder"
sends the email. A HubSpot refusal releases the claim for the next pass. Only
the manager's email, first name and the meeting day reach HubSpot; the email
never names the report. Off until `HUBSPOT_TOKEN` is set.

### Entitlement and the read-only gate

Each manager has one `subscriptions` row: a founding place (`founding_number`
1–20, one year from sign-up), a 14-day trial, `active` (paid, or comped when there's no Stripe
id), or read-only once `trial_ends_at` passes without `active`. The row is
created by `ensure_entitlement()`, a SECURITY DEFINER function called with the
user's own client the first time the app shell loads (`GET /api/entitlement`,
via `<EntitlementNotice />`). Invited ICs never get a row. Users can read their
row but never write it.

A founding place is the lowest free number in 1–20, so a place freed by a
deleted account is handed out again; the deleted email's tombstone stops it
coming back for one. Sign-ups matching `test_account_patterns` (Andrew's and
Susie's plus-addresses) are test accounts: they get the founding year's clock
but never a place, so persona runs and resets can't use up the 20. Add a row
there for any new test address pattern.

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
`/prep` and `/wrapup` in `one_on_ones.py`, `/draft` in `assessment_reviews.py`, or
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
incomplete. `error` and above, and every unhandled exception, go to Sentry
(org `the-same-page`, project `thesamepage-backend`, email alerts to Andrew).
Each event carries the `route` tag and the user id, nothing else about the
person; the Authorization header arrives as `[Filtered]`. Without `SENTRY_DSN`
on Railway, `init_sentry()` does nothing.

Frontend: `@sentry/nextjs`, Sentry project `thesamepage-frontend`, same rules.
Settings live in `frontend/lib/sentryOptions.ts` (browser, Node and edge all
use them): errors only, `sendDefaultPii: false`, console breadcrumbs dropped
(they could carry note text), and `<SentryUser />` in `app/app/layout.tsx`
sets the Supabase user id and nothing else. `app/app/error.tsx` and
`app/global-error.tsx` report what they catch, because a React error boundary
swallows the error before any global handler sees it. Browser events post to
`/monitoring` on the app's own domain (the `tunnelRoute` in `next.config.js`),
so ad blockers don't drop them and the CSP needs no Sentry host. Off until
`NEXT_PUBLIC_SENTRY_DSN` is set on Vercel. Source maps upload only when
`SENTRY_AUTH_TOKEN` is set there too; without it, stack traces are minified.

Uptime: Sentry's uptime monitor (the free plan's one) checks
`https://app.thesamepage.xyz/health` every minute. That path is a rewrite in
`frontend/next.config.js` to the API's `/health`, because Sentry refuses to
monitor `*.railway.app`; it also means one check covers Vercel and Railway.

Product analytics: PostHog Cloud (US), free plan with no card on file, so
past 1M events a month PostHog drops events rather than billing. The browser
(`frontend/lib/analytics.ts`) sends page views only, through `/ingest` on the
app's own domain; the backend (`backend/analytics.py`) sends custom events on a
background pool that never delays or fails the request. Identity is the
Supabase user id only, and event properties are flags, counts, ids or enum
values, never text a manager typed. Off until `NEXT_PUBLIC_POSTHOG_KEY`
(Vercel) and `POSTHOG_PROJECT_KEY` (Railway) are set. The collection details,
privacy rules, event catalog, the golden-path funnel and how to add an event
live in `docs/systems/product-analytics.md`.

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
| Manager-scoped | `manager_id = auth.uid()` | direct_reports, one_on_one_series, one_on_ones, commitments, dr_capture_notes, assessments, performance_reviews, skill/value_assessments, metric_entries, team_messages, team_meetings, team_meeting_series, team_meeting_agenda_items, team_callouts, team_dev_focus, direct_report_invites, development_plans + dev_plan_*, assistant_messages, mission_control_events, capacity_profiles, time_off_entries, away_periods, away_period_shifts |
| Owner-scoped | `owner_id = auth.uid()` | goals, projects, check_ins, project_follow_throughs, outside_people, outside_meetings, outside_meeting_people, outside_meeting_links, outside_meeting_series |
| Org-scoped | `org_id = public.current_org_id()` | organizations, users, org_units, role_families, role_levels, *_configs, role_expectation_drafts, role_expectation_decisions, *_scale_definitions, assessment_levels, capacity_settings, work_unit_configs, documents, document_series, document_scopes, document_citations |

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
| `get_invite_preview(token)` | the only RPC a signed-out caller may execute; returns names + expiry, never the row |
| `accept_direct_report_invite(token)` | claims a report row for `auth.uid()`, re-checks `auth.email()` internally as defense in depth |
| `handle_new_user()` | signup trigger; defaults every new user to `role = 'manager'` |
| `ensure_entitlement()` | creates the caller's `subscriptions` row; see Entitlement below |
| `account_deletion_preflight()` | the refusals `delete_my_account()` makes, callable first so they cost nothing |
| `delete_my_account()` | deletes everything the caller's account owns, the org and the `auth.users` row, in one transaction; see Account export and deletion |

**Revoke from `anon` by name, not just from `public`.** Supabase's default
privileges grant EXECUTE on every new function in `public` straight to `anon`,
so `revoke all ... from public` alone leaves signed-out callers able to run it.
Functions the app calls signed in use `revoke all on function f() from public,
anon;` then `grant execute ... to authenticated;`. Two keep `anon` on purpose:
`get_invite_preview()` (the invite page runs before sign-in) and
`current_org_id()` (RLS policies call it, and a policy's functions are checked
as the querying role, so revoking it would turn a signed-out read into an
error instead of zero rows; it returns null for `anon`). The local stub
reproduces Supabase's default grants, so `has_function_privilege('anon',
'public.f()', 'execute')` locally tells you what production will do.

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

### Account export and deletion

Settings → Your account. `routes/account.py`, both on the user's own JWT
client:

- `GET /api/settings/account/export` reads every table through RLS and returns
  one JSON object: `account` (user, organization, subscription) and `data`
  (one key per table, rows as stored). Uploaded files are not included; their
  extracted text is. `EXPORT_TABLES` / `EXPORT_EXCLUDED` must name every table
  in `schema.sql`; `tests/test_account.py` fails otherwise.
- `DELETE /api/settings/account` (body `{"confirm": "delete my account"}`)
  first calls `account_deletion_preflight()`, which runs the database's own
  refusals (a shared org, no permission to delete from `auth.users`, the
  migration not run) before anything that can't be undone. Then it deletes, in
  this order: the HubSpot contact (GDPR delete, looked up by email
  first) and the PostHog person with events and recordings; then the org's
  files in `context-engine-docs`; then `delete_my_account()`. If either
  outside service can't be reached, or PostHog deletion isn't configured while
  `POSTHOG_PROJECT_KEY` is, it stops with nothing deleted. Storage goes before
  the database because the storage delete policy needs `current_org_id()`.

Why a SECURITY DEFINER function and not the JWT client or the service role:
RLS gives users no DELETE on `organizations`, `users`, `subscriptions`,
`mission_control_*` or `manager_report_connections`, and about 45 foreign keys
to `auth.users` are NO ACTION, so the login can't go first and cascade the
rest. The function is keyed to `auth.uid()`, refuses an org with a second
non-IC user, and runs as one transaction: any failure deletes nothing. No
service-role key is involved.

There are no backups on Supabase Free, so a deletion is final. It writes a
tombstone to `deleted_accounts` (sha256 of the lowercased email, the clock the
account had, whether it was comped). `ensure_entitlement()` checks it, so the
same email signing up again gets its old clock back and no founding place.
Only an account that had a clock leaves one; an IC or a manager who never
loaded the app shell gets the normal allocation on return.
The persona reset script clears a persona's tombstone.

Both routes are in `_READ_ONLY_ALLOWED`: an expired account can still take its
record and leave. **A new table needs a line in `delete_my_account()`** (or a
cascade from a table that has one), and a place in `EXPORT_TABLES` or
`EXPORT_EXCLUDED`. `database/checks/account_deletion_check.py` proves the
function against a local Postgres. It seeds two accounts in every table, with
no hand-written fixtures, deletes one, and checks that the other is untouched
and the export's RLS reads see only the caller's rows.

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
- **When a table or foreign key changes, run the account deletion check** on
  the same database: `python3 database/checks/account_deletion_check.py
  "dbname=tsp_verify user=postgres"` (needs `psycopg`).

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
plus two `npm audit` runs for the frontend: `--omit=dev --audit-level=high` on
what ships, `--audit-level=critical` on build tools (Tailwind 3's `braces` has an
unfixable high advisory that only touches the build). It is an alarm, not a
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
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API Keys (the publishable key, `sb_publishable_…`) | Railway, Vercel | public by design; RLS is the guard. On Vercel the Supabase integration manages it; the frontend falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` only if it is missing |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API Keys (a secret key, `sb_secret_…`, once switched) | Railway | bypasses RLS; no request path uses it |
| SMTP app password (`tsp-supabase-smtp-2026-09`) | Google account for ag@thesamepage.xyz → Security → App passwords (needs 2-Step Verification) | Supabase → Auth → Emails → SMTP Settings | sends login email via smtp.gmail.com:465; to rotate, paste the new one, send a test magic link, then revoke the old one in Google |
| `STRIPE_*` | Stripe | Railway | empty until billing ships |
| `SENTRY_DSN` | Sentry | Railway | not a secret; leaks only let someone send you errors |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry → thesamepage-frontend → Client Keys | Vercel (Config, not Secret) | public by design, ships in the browser bundle |
| `NEXT_PUBLIC_POSTHOG_KEY` / `POSTHOG_PROJECT_KEY` | PostHog → Settings → Project → General → Project API key (`phc_`) | Vercel (Config), Railway | same value in both; public by design, ships in the browser bundle; a leak only lets someone send events, and the free plan drops them past 1M |
| `HUBSPOT_TOKEN` | HubSpot → Settings → Integrations → Private Apps → "tsp-railway-2026-10" (scopes: contacts read and write) | Railway (API and the reminder cron) | empty turns the first-1:1 wrap-up reminder off; reads contacts to find one for account deletion, writes and GDPR-deletes them |
| `POSTHOG_PERSONAL_API_KEY` / `POSTHOG_PROJECT_ID` | PostHog → Settings → Personal API keys (scope `person:write`, this project only); the numeric project id from Project settings | Railway | account deletion uses them to delete the person and their events; if `POSTHOG_PROJECT_KEY` is set and these aren't, account deletion refuses |
| `SENTRY_AUTH_TOKEN` (optional) | Sentry → Settings → Auth Tokens (org token) | Vercel (Secret) | only for source-map upload at build; the build works without it |

**Name keys `tsp-<host>-<yyyy-mm>`** (`tsp-railway-2026-09`; Supabase only
accepts underscores, so `tsp_railway_2026_10` there), so the dashboard
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
kills both, and Supabase retires them at the end of 2026. The backend runs
`supabase` 2.32, which accepts the new `sb_publishable_…` / `sb_secret_…` keys
(2.9.1 refused any key that wasn't a JWT). The variable names stay the same;
only the values change. The switch, once:

1. **Create** both keys in Supabase → Settings → API Keys → "Publishable and
   secret API keys" (a project may already have a `default` publishable key).
   Name the secret key `tsp-railway-<yyyy-mm>`. Legacy keys keep working
   meanwhile.
2. **Railway:** `SUPABASE_ANON_KEY` = the publishable key,
   `SUPABASE_SERVICE_ROLE_KEY` = the secret key, on the API service and on
   every other service that has them (the wrap-up reminder cron; the worker if
   it's been created). Each redeploys on save.
3. **Vercel:** nothing to paste. The Supabase integration (the env vars with
   the lightning icon) writes `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` itself
   when the publishable key exists, and the frontend reads that first, falling
   back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Redeploy without the build cache
   (the value is baked in at build). The integration's other vars
   (`SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_*`) are
   unused by the frontend.
4. **Verify:** `/health` is ok, sign in on the app (a magic link round-trips),
   and a signed-in page loads data. Users stay signed in throughout: their
   session tokens don't change.
5. **Disable** the legacy keys in Supabase → API Keys → "Legacy API keys".
   It's reversible in the dashboard if anything was missed; re-enable and
   look for the client still sending the old key.

After that, each secret key rotates on its own with the steps above.

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
  schema.sql's check constraint). The manager's private next move on a project
  is not this: it lives in `project_follow_throughs` (see
  `docs/systems/projects.md`) so it never surfaces where commitments are read.
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
- **Settings UI for renaming `assessment_levels`** — the endpoint exists, nothing
  calls it; the 5 seeded defaults are usable as-is.

---

## Open questions

- CI doesn't block deploys. Railway and Vercel deploy on push, and CI (above)
  only reports. Making it a gate would mean deploy hooks or GitHub-triggered
  deploys instead of the platforms' own git integrations.
- Tailwind 4. Tailwind 3 depends on `braces`, which carries a high-severity
  advisory (GHSA-vfj7-8cjw-p6xm, stack exhaustion on deeply nested patterns)
  with no fixed release. Only the build reads it, on our own source globs, so
  CI audits build tools at critical. Moving to Tailwind 4 removes it; it is a
  config rewrite plus a visual pass over every page, so post-launch.
- Pagination — no list endpoint paginates. Fine at one manager's scale, not at
  an org's.
