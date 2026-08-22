# The Scribe — conversational data entry

The write-side agent. The manager talks to a persistent drawer, the agent
assembles draft entities, and **nothing writes until the manager confirms** — at
which point the client calls the same endpoint the forms already use.

Scoping brief: `docs/archive/scoping/AGENT_SCRIBE_SCOPING.md`.

## Hard rules — locked, do not relitigate

- **The model has read tools only** (`list_goals`, `list_projects`,
  `list_direct_reports`, `list_org_units`) plus `emit_draft`. It cannot write to
  the database. Ever. Its "write" is a structured draft payload; the actual write
  is the client calling the normal endpoint on Confirm.
- **v1 verbs are create + append only:** create project, create goal, link
  project↔goal, log check-in, add commitment, add direct report. No edits, no
  deletes.
- **Entity linking never silently guesses.** High-confidence match → prefilled and
  visibly marked in the draft card. Ambiguous → ask, with candidates. No match →
  offer to create.

`emit_draft` is the write primitive — the model calls a tool that returns
`{"ok": true}` to stage a draft, rather than emitting JSON in its text output.

## Backend

`assistant_engine.py` — `TOOLS`, `SYSTEM_PROMPT_TEMPLATE` (six verbs plus MVR
schemas, each verified against `schema.sql`; note projects have no
`success_metrics` column, goals do), and `run_assistant_turn(thread, new_message,
tool_executor, today_str, page_context=None)` running the tool loop, max 8
iterations.

**The thread is fully server-managed.** The client sends only the new message plus
optional page context; it does not pass a thread.

**Page context is ephemeral** — injected into the system prompt per request, never
stored in `assistant_messages`.

`routes/assistant.py` — `POST /api/assistant/message` (rate-limited 10/min; loads
from and saves to `assistant_messages`; body is `{message, page_context?}`) and
`GET /api/assistant/thread` for hydration.

`assistant_messages` is manager-scoped with a JSONB `drafts` column so draft cards
re-render on hydration, indexed on `(manager_id, created_at asc)`. **It is applied
live but missing from `schema.sql`** — see ENGINEERING.md → Known drift.

Two endpoints exist because of the Scribe: `POST /api/commitments` (standalone
create, validates DR ownership, `source_type='manual'`) — deliberately not
`POST /api/team/commitments`, which always sets `is_team_commitment = true` — and
`GET /api/projects/{id}`, registered after `/rollup` so the literal path matches
first.

## Frontend

`app/app/layout.tsx` is the app's first shared authenticated layout:
`DrawerProvider` + `AppShell` (flex row, drawer as a `sticky h-screen` aside,
content reflows), a ⌘J/Esc listener, and a fixed ✦ toggle on non-dashboard pages.
Drawer width is `w-[clamp(400px,30vw,640px)]`.

`components/ScribeDrawer.tsx` — thread UI, `DraftCard` for all six entity types
with confirm handlers each calling the existing form endpoint, receipts with a 30s
undo (project and goal only — the only types with frontend delete endpoints),
ambiguity quick-reply chips, and edit-in-card.

`lib/drawer-context.tsx` — open state (sessionStorage), thread state, and
`pageContext` registration (the person page sets it; cleared on unmount).

## Eval

`eval/test_assistant.py` — 15 utterances, mocked tool executor, **real Anthropic
API**. Exit bar ≥13/15; last full run was 15/15.

**Re-run after any system-prompt or engine change.** Requires `ANTHROPIC_API_KEY`
in `backend/.env` and fails fast if missing — never read another project's `.env`.
