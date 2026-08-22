# The Same Page

A management OS for first-time and newly-promoted managers — 1:1 prep,
commitment tracking, and practical judgment for the conversations most managers
were never taught to have.

Solo-founder product. Content/SEO distribution, $20/mo self-serve.

## Stack

- **Frontend:** Next.js 15 (App Router) + Tailwind + Supabase Auth — `frontend/`
- **Backend:** FastAPI (Python 3.11) + Supabase (Postgres + RLS) — `backend/`
- **AI:** Anthropic Claude, called only through `backend/ai_core.py`. Falls back
  to OpenAI on 5xx when `OPENAI_API_KEY` is set; a 4xx errors hard.
- **Hosting:** Railway (backend) and Vercel (frontend), both auto-deploying on
  push to `main`.
- **Payments:** Stripe — schema exists, nothing wired up.

## Setup

### 1. Supabase

Create a project, then run `database/schema.sql` in the SQL editor. Grab the
project URL, anon key, and service-role key from Settings → API.

Schema changes after that go through `database/migrations/` — run them in the
same SQL editor, in date order.

### 2. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # Supabase + Anthropic keys
uvicorn main:app --reload
```

Runs on `http://localhost:8000`; `GET /health` should return OK.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # Supabase keys
npm run dev
```

Runs on `http://localhost:3000`.

## Where things are

```
backend/    FastAPI — one module per API area under routes/
database/   schema.sql (source of truth), migrations/, local_verify_stub.sql
frontend/   Next.js — (marketing)/ is public, app/ is auth-gated
docs/       reference docs; systems/ has one doc per feature area
eval/       Scribe agent eval (hits the real Anthropic API)
mockups/    design exploration
```

**`CLAUDE.md` is the real entry point** for anyone (or anything) working in this
repo — conventions, hard rules, and which doc to read for which task. This README
deliberately doesn't duplicate its file map; keeping two in sync is how the last
one went stale.

## Verifying a schema change locally

`database/local_verify_stub.sql` stands up enough of Supabase's `auth` and
`storage` schemas for the real `schema.sql` to run against a throwaway local
Postgres:

```bash
dropdb --if-exists tsp_verify && createdb tsp_verify
psql tsp_verify -f database/local_verify_stub.sql
psql tsp_verify -f database/schema.sql
```

Always start from a freshly dropped database. See `docs/ENGINEERING.md` for the
full workflow, including how to functionally test a policy rather than just
proving the schema applies.

## Status

Built and in daily use by the author: auth, direct reports, AI-assisted 1:1 prep
and wrap-up, commitments, goals, projects, check-ins, org units, capacity,
assessments, development plans, role expectations with AI drafting and JD import,
Mission Control, Team Mission Control, the Context Engine (document memory), and
the Scribe (conversational data entry).

Not built: Stripe billing, an IC-facing view once an invited report logs in,
blog content, automated tests. See `docs/ENGINEERING.md` → Scope discipline for
the full list and the reasoning behind each deferral.
