-- Migration: fix infinite recursion in users RLS policy (Session 6 hotfix)
-- Run once in the Supabase SQL editor. Safe to run after (or instead of
-- needing to re-run) 2026-08-01_settings_policies.sql.
--
-- Bug: users_select_own_org subqueries the users table inside the users
-- policy itself — Postgres raises "infinite recursion detected in policy
-- for relation users" (42P17). Any query that touches users directly, or
-- any org-scoped policy whose subquery reads users (role_levels,
-- metric/skill/value_configs), errors out. Symptom: every /api/settings/*
-- request failed while the rest of the app worked.
--
-- Fix: the standard Supabase pattern — a SECURITY DEFINER function reads
-- the caller's org_id without re-invoking RLS, and policies call it.

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.users where id = auth.uid()
$$;

revoke all on function public.current_org_id() from public;
grant execute on function public.current_org_id() to authenticated;

-- users: the recursive policy, rebuilt without the self-referencing subquery
drop policy if exists "users_select_own_org" on users;
create policy "users_select_own_org" on users
  for select using (
    id = auth.uid()
    or (org_id is not null and org_id = public.current_org_id())
  );

-- Org-scoped policies: not self-recursive, but they subqueried users and
-- inherited the blast radius. Swap to the function (also faster).
drop policy if exists "role_levels_all_own_org" on role_levels;
create policy "role_levels_all_own_org" on role_levels
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

drop policy if exists "metric_configs_all_own_org" on metric_configs;
create policy "metric_configs_all_own_org" on metric_configs
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

drop policy if exists "skill_configs_all_own_org" on skill_configs;
create policy "skill_configs_all_own_org" on skill_configs
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

drop policy if exists "value_configs_all_own_org" on value_configs;
create policy "value_configs_all_own_org" on value_configs
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

drop policy if exists "assessment_levels_all_own_org" on assessment_levels;
create policy "assessment_levels_all_own_org" on assessment_levels
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

drop policy if exists "organizations_select_own" on organizations;
create policy "organizations_select_own" on organizations
  for select using (id = public.current_org_id());

drop policy if exists "organizations_update_own" on organizations;
create policy "organizations_update_own" on organizations
  for update
  using (id = public.current_org_id())
  with check (id = public.current_org_id());

-- Scale-definition select policies subqueried users through their config
-- tables; swap for consistency.
drop policy if exists "metric_scale_defs_select_own_org" on metric_scale_definitions;
create policy "metric_scale_defs_select_own_org" on metric_scale_definitions
  for select using (
    metric_config_id in (select id from metric_configs where org_id = public.current_org_id())
  );

drop policy if exists "skill_scale_defs_select_own_org" on skill_scale_definitions;
create policy "skill_scale_defs_select_own_org" on skill_scale_definitions
  for select using (
    skill_config_id in (select id from skill_configs where org_id = public.current_org_id())
  );

drop policy if exists "value_scale_defs_select_own_org" on value_scale_definitions;
create policy "value_scale_defs_select_own_org" on value_scale_definitions
  for select using (
    value_config_id in (select id from value_configs where org_id = public.current_org_id())
  );
