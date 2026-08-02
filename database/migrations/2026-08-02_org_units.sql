-- Org units: team/department entities with parent/child relationships
-- (Session 11, 2026-08-02). See docs/SESSION_HISTORY.md and the
-- org_hierarchy_scoping project memory note for the scoping conversation.
--
-- "Company" is NOT a unit_type here — the existing `organizations` row is
-- the chart's root; a department with parent_unit_id null sits directly
-- under it. Org-scoped like role_levels (org_id = current_org_id()).
--
-- Run this against the live Supabase database. database/schema.sql has
-- already been updated to match, for future reads.

create table if not exists org_units (
  id             uuid primary key default uuid_generate_v4(),
  org_id         uuid references organizations(id) on delete cascade,
  name           text not null,
  unit_type      text not null check (unit_type in ('department', 'team')),
  parent_unit_id uuid references org_units(id) on delete set null,
  created_at     timestamptz not null default now()
);

alter table org_units enable row level security;

create policy "org_units_all_own_org" on org_units
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

alter table direct_reports
  add column if not exists org_unit_id uuid references org_units(id) on delete set null;

alter table goals
  add column if not exists org_unit_id uuid references org_units(id) on delete set null;
