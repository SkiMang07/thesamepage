-- Role families: group role_levels into ladders (Session 40, 2026-08-18 —
-- Plan S2 from docs/TEAM_SETUP_UX_REVIEW.md §6). See the
-- team_setup_ux_review project memory note for the scoping conversation.
--
-- Thirteen flat role_levels rows read as one card per (org_id, job_role) —
-- this table groups them into ~5 ladders so the UI can render "Corporate
-- CSM" as one card with L1/L2/L3 rows inside instead of three separate
-- cards. Org-scoped like role_levels/org_units (org_id = current_org_id()),
-- same RLS pattern — no inline `users` subqueries.
--
-- Display convention (per the plan's open question, resolved): once a level
-- has a family, the family name takes over as the display name
-- ("Corporate CSM · L3"); role_levels.job_role stays as-is in the schema
-- (not dropped, not backfilled-over) and is treated as an optional
-- per-level title override — e.g. a level whose job_role is "Senior
-- Corporate CSM" but sits in the "Corporate CSM" family shows that string
-- instead of the family name.
--
-- Backfill: one family per distinct (org_id, job_role) already in
-- role_levels, all existing rows linked to their new family. Near-duplicate
-- names ("Senior Corporate CSM" vs "Corporate Customer Success Manager")
-- deliberately stay as separate families after this backfill — Andrew
-- merges those by hand afterwards using "Move to another ladder…" on a
-- level row in the UI (a PUT changing role_family_id is the whole merge
-- mechanic; no automatic fuzzy-matching here).
--
-- Run this against the live Supabase database. database/schema.sql has
-- already been updated to match, for future reads.

create table if not exists role_families (
  id         uuid primary key default uuid_generate_v4(),
  org_id     uuid references organizations(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

alter table role_families enable row level security;

-- drop-if-exists guard so this migration is safe to re-run (matches
-- 2026-08-01_fix_users_rls_recursion.sql's convention) — CREATE TABLE/ALTER
-- TABLE above already guard with IF NOT EXISTS, so this makes the whole file
-- idempotent.
drop policy if exists "role_families_all_own_org" on role_families;
create policy "role_families_all_own_org" on role_families
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

alter table role_levels
  add column if not exists role_family_id uuid references role_families(id) on delete set null;

-- Backfill: one role_families row per distinct (org_id, job_role) that
-- exists in role_levels today, then link every role_levels row with a
-- matching org_id + job_role to its new family. Scoped to rows that don't
-- already have a role_family_id, so this migration is safe to re-run.
insert into role_families (org_id, name)
select distinct org_id, job_role
from role_levels
where role_family_id is null
  and org_id is not null;

update role_levels rl
set role_family_id = rf.id
from role_families rf
where rl.role_family_id is null
  and rl.org_id is not null
  and rf.org_id = rl.org_id
  and rf.name = rl.job_role;
