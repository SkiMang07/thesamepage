# The Same Page

A management OS for first-time managers — 1:1 prep, commitment tracking, and
practical judgment for the conversations most managers were never taught to have.

## Stack

- **Frontend:** Next.js (App Router) + Tailwind + Supabase Auth — `frontend/`
- **Backend:** FastAPI + Supabase (Postgres, RLS) — `backend/`
- **AI:** Anthropic (primary) with OpenAI fallback on 5xx
- **Payments:** Stripe (not yet wired up)

See `CLAUDE.md` for architecture rationale and conventions.

## Setup

### 1. Supabase

Create a Supabase project, then run `database/schema.sql` in the SQL editor.
Grab your project URL, anon key, and service-role key from Settings → API.

### 2. Backend

```
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in Supabase + Anthropic keys
uvicorn main:app --reload
```

Runs on `http://localhost:8000`. Check `http://localhost:8000/health`.

### 3. Frontend

```
cd frontend
npm install
cp .env.local.example .env.local   # fill in Supabase keys
npm run dev
```

Runs on `http://localhost:3000`.

## Project Structure

```
the-same-page/
├── backend/
│   ├── main.py           # FastAPI app + router registration
│   ├── config.py         # env settings
│   ├── utils.py          # Supabase auth verification (RLS-scoped client)
│   ├── ai_core.py         # centralized AI call helpers (Anthropic + fallback)
│   └── routes/
│       ├── direct_reports.py
│       └── one_on_ones.py   # prep + logging — the core feature
├── frontend/
│   ├── app/
│   │   ├── (marketing)/      # public, SEO-facing: home, pricing, blog
│   │   └── app/               # auth-gated: login, dashboard
│   └── lib/
│       ├── supabase.ts
│       └── api.ts            # all backend calls go through here
└── database/
    └── schema.sql
```

## What's built vs. what's next

Built: auth, direct-report CRUD, AI-assisted 1:1 prep, 1:1 logging with
commitment tracking, marketing/pricing/blog page shells.

Not yet built: Stripe subscription + webhook, commitment due-date reminders,
actual blog content, production deploy (Railway + Vercel).
