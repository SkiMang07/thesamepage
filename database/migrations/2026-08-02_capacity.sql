-- ============================================================
-- Capacity model (Session 14 scoping conversation with Andrew,
-- 2026-08-02 — see docs/SESSION_HISTORY.md and the capacity_scoping
-- project memory note).
--
-- v1 scope, confirmed with Andrew before this was written:
--   - Supply only. No demand/allocation tracking against Projects or Goals
--     yet — this answers "how much capacity does each person/team/
--     department have", not "how much of it is spoken for". That's a
--     deliberate follow-up, not an oversight.
--   - Hours are the currency under the hood. work_unit_configs is a thin
--     per-role-level translation layer so a team can still see its native
--     unit ("~32 tickets/week") without breaking the ability to roll
--     hours up cleanly across teams that don't share a unit.
--   - Rollup goes all the way to department/org level via the org_units
--     tree (Session 11), not just a manager's own team — see the
--     org_unit_capacity_rollup() function below for how that's scoped
--     safely without a new permissions system.
--
-- Run this file in the Supabase SQL editor before the Capacity feature
-- will work. Nothing here is destructive — pure additions.
--
-- NOTE: this file matches exactly what Andrew ran against live Supabase on
-- 2026-08-02. The off_days_per_year addition (same session, but after this
-- had already been run) lives in a separate follow-up migration —
-- database/migrations/2026-08-02_capacity_off_days.sql — same pattern as
-- goals' success_metrics column shipping as its own migration after the
-- base goals table. Don't fold that change back into this file; it would
-- make "run this file in the SQL editor" fail with "relation already
-- exists" for anyone who already ran this one.
-- ============================================================

-- -------------------------
-- CAPACITY SETTINGS
-- Org-wide defaults, one row per org. Any direct report without a
-- capacity_profiles override inherits these. "Max capacity" is
-- deliberately not 100%: default_target_utilization_pct reserves room for
-- meetings, admin, and the unexpected — a knowledge-work rule of thumb,
-- not a hard rule. Both defaults are editable per org in
-- Settings > Capacity.
-- -------------------------
create table capacity_settings (
  id                              uuid primary key default uuid_generate_v4(),
  org_id                          uuid not null unique references organizations(id) on delete cascade,
  default_hours_per_week          numeric not null default 40,
  default_target_utilization_pct  numeric not null default 75,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

alter table capacity_settings enable row level security;

-- -------------------------
-- CAPACITY PROFILES
-- Per-direct-report override of the org defaults above — e.g. a part-time
-- report's contracted_hours_per_week, or a manager-heavy role's lower
-- target_utilization_pct. Null columns mean "inherit the org default";
-- this table doesn't need a row at all for someone who's fully standard.
-- -------------------------
create table capacity_profiles (
  id                          uuid primary key default uuid_generate_v4(),
  direct_report_id            uuid not null unique references direct_reports(id) on delete cascade,
  contracted_hours_per_week   numeric,
  target_utilization_pct      numeric,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

alter table capacity_profiles enable row level security;

-- -------------------------
-- TIME OFF ENTRIES
-- PTO / sick / holiday / other, logged per direct report. Subtracted from
-- available hours for whatever period is being viewed — capacity is
-- computed per-period, not stored as a single static number, so time off
-- naturally lowers a specific week/month/quarter without needing to touch
-- the baseline.
-- -------------------------
create table time_off_entries (
  id                uuid primary key default uuid_generate_v4(),
  direct_report_id  uuid not null references direct_reports(id) on delete cascade,
  start_date        date not null,
  end_date          date not null,
  type              text not null default 'pto' check (type in ('pto', 'sick', 'holiday', 'other')),
  -- null = a full contracted day (contracted_hours_per_week / 5) at
  -- calculation time; set explicitly for a half-day, etc.
  hours_per_day     numeric,
  notes             text,
  created_at        timestamptz not null default now()
);

alter table time_off_entries enable row level security;

create index time_off_entries_range_idx on time_off_entries (direct_report_id, start_date, end_date);

-- -------------------------
-- WORK UNIT CONFIGS
-- Optional per-role-level translation layer (Andrew's core ask: support
-- thinks in tickets, eng thinks in story points, GTM thinks in campaigns —
-- none of that generalizes as a shared currency, but hours do). When a
-- role_level has a row here, the Capacity UI shows available hours
-- converted into that unit alongside the raw hours; when it doesn't, the
-- UI just shows hours. One row per role_level (a role either has a native
-- unit or it doesn't).
-- -------------------------
create table work_unit_configs (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid references organizations(id) on delete cascade,
  role_level_id   uuid not null unique references role_levels(id) on delete cascade,
  unit_name       text not null,
  hours_per_unit  numeric not null check (hours_per_unit > 0),
  created_at      timestamptz not null default now()
);

alter table work_unit_configs enable row level security;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- capacity_settings — org-scoped like role_levels/assessment_levels.
create policy "capacity_settings_all_own_org" on capacity_settings
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- capacity_profiles — manager-scoped through direct_reports, same pattern
-- as dev_plan_aspirations/dev_plan_opportunities/etc. Individual-level
-- capacity data stays exactly as private as everything else about a
-- manager's own reports; cross-manager visibility only ever happens
-- through org_unit_capacity_rollup()'s aggregate-only output below.
create policy "capacity_profiles_all_own" on capacity_profiles
  for all using (
    direct_report_id in (select id from direct_reports where manager_id = auth.uid())
  )
  with check (
    direct_report_id in (select id from direct_reports where manager_id = auth.uid())
  );

-- time_off_entries — same manager-scoped pattern.
create policy "time_off_entries_all_own" on time_off_entries
  for all using (
    direct_report_id in (select id from direct_reports where manager_id = auth.uid())
  )
  with check (
    direct_report_id in (select id from direct_reports where manager_id = auth.uid())
  );

-- work_unit_configs — org-scoped like metric_configs/skill_configs.
create policy "work_unit_configs_all_own_org" on work_unit_configs
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ============================================================
-- DEPARTMENT / ORG ROLLUP
--
-- Andrew's call (confirmed via direct discussion, not defaulted): rollup
-- above "my own team" should go all the way to department/org level, keyed
-- off the org_units tree rather than the manager-reporting chain — but a
-- viewer outside their own team should only ever see AGGREGATE numbers per
-- org unit, never another manager's individual reports by name.
--
-- direct_reports/capacity_profiles/time_off_entries all stay manager-scoped
-- (see policies above) — this function is the one narrow, deliberate
-- exception, the same shape as current_org_id(): SECURITY DEFINER so it can
-- read across managers inside the function body, but its RETURN SHAPE is
-- aggregate-only by construction (one row per org_unit_id: a count and a
-- summed number of hours). There is no code path from this function back to
-- a named individual, so it can't leak person-level data even though it
-- bypasses RLS internally to compute the sum.
--
-- Returns ONE ROW PER ORG UNIT, covering only the direct reports assigned
-- directly to that unit (not pre-summed across descendant units) — the
-- frontend walks the org_units tree client-side and sums bottom-up, the
-- same pattern already used to build the org chart (frontend/app/app/org).
-- Reports with no org_unit_id assigned are not included in any row; that's
-- an existing precondition of the org chart too, not new to capacity.
--
-- NOTE: this version is superseded by the CREATE OR REPLACE FUNCTION in
-- 2026-08-02_capacity_off_days.sql, which adds the off-days precedence
-- logic. Left as-is here since it matches what actually ran live first.
-- ============================================================

create or replace function public.org_unit_capacity_rollup(p_period_start date, p_period_end date)
returns table (
  org_unit_id uuid,
  direct_report_count integer,
  available_hours numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org_id uuid := public.current_org_id();
  v_period_weeks numeric := greatest((p_period_end - p_period_start) + 1, 0) / 7.0;
begin
  if v_org_id is null or p_period_end < p_period_start then
    return;
  end if;

  return query
  select
    dr.org_unit_id,
    count(*)::integer as direct_report_count,
    sum(
      greatest(
        coalesce(cp.contracted_hours_per_week, cs.default_hours_per_week, 40)
          * v_period_weeks
          * (coalesce(cp.target_utilization_pct, cs.default_target_utilization_pct, 75) / 100.0)
        - coalesce((
            select sum(
              (least(t.end_date, p_period_end) - greatest(t.start_date, p_period_start) + 1)
              * coalesce(
                  t.hours_per_day,
                  coalesce(cp.contracted_hours_per_week, cs.default_hours_per_week, 40) / 5.0
                )
            )
            from time_off_entries t
            where t.direct_report_id = dr.id
              and t.start_date <= p_period_end
              and t.end_date >= p_period_start
          ), 0),
        0
      )
    ) as available_hours
  from direct_reports dr
  join org_units ou on ou.id = dr.org_unit_id and ou.org_id = v_org_id
  left join capacity_profiles cp on cp.direct_report_id = dr.id
  left join capacity_settings cs on cs.org_id = v_org_id
  group by dr.org_unit_id;
end;
$$;

revoke all on function public.org_unit_capacity_rollup(date, date) from public;
grant execute on function public.org_unit_capacity_rollup(date, date) to authenticated;
