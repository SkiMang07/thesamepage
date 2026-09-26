-- ============================================================
-- Overnight prep and the carried-forward opening line
-- (2026-09-26) — docs/systems/one-on-ones.md, docs/ENGINEERING.md → Background worker
--
-- 1. one_on_ones.opening_line — one sentence the manager could open the next
--    1:1 with, drafted at wrap-up and kept (or edited, or cleared) by the
--    manager on the review screen before it is saved onto the next
--    occurrence. Null = none kept. Prep reads it as the suggested opener.
--
-- 2. ai_jobs — the background worker's ledger (backend/jobs/). One row per
--    unit of AI work the worker does on its own schedule; today only
--    'overnight_prep', one row per 1:1 occurrence it prepared. It carries the
--    Batch API id, the snapshot of the sources the prompt drew on (so the
--    saved sheet records what it was built from, and only those captures are
--    consumed), and the outcome. It is also what makes the worker idempotent:
--    an occurrence with a job in the last day is not submitted again, and an
--    occurrence can have only one job in flight.
--
--    Written and read only by the worker's service-role client. RLS is on
--    with no policies, so no user session can read or write it.
--
-- Additive only and safe to re-run. Run before deploying the backend that
-- writes opening_line; the worker service needs ai_jobs.
-- ============================================================

alter table one_on_ones
  add column if not exists opening_line text;

create table if not exists ai_jobs (
  id           uuid primary key default uuid_generate_v4(),
  kind         text not null check (kind in ('overnight_prep')),
  manager_id   uuid not null references auth.users(id) on delete cascade,
  one_on_one_id uuid references one_on_ones(id) on delete cascade,
  status       text not null default 'queued'
               check (status in ('queued', 'submitted', 'applied', 'skipped', 'failed')),
  batch_id     text,
  input        jsonb not null default '{}'::jsonb,
  outcome      text,  -- short machine reason for skipped/failed; never record text
  created_at   timestamptz not null default now(),
  submitted_at timestamptz,
  finished_at  timestamptz
);

alter table ai_jobs enable row level security;

create index if not exists ai_jobs_batch_idx
  on ai_jobs (batch_id) where status = 'submitted';
create index if not exists ai_jobs_occurrence_idx
  on ai_jobs (one_on_one_id, created_at desc);
create unique index if not exists ai_jobs_one_in_flight_idx
  on ai_jobs (kind, one_on_one_id) where status in ('queued', 'submitted');
