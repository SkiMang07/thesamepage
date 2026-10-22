-- Leader rollups skip archived people, and team_meetings' constraints get
-- their own names.
--
-- Found by the 2026-10-22 schema drift check (production vs schema.sql).
--
-- 1. 2026-08-18_direct_reports_archive.sql added direct_reports.archived_at
--    and updated schema.sql's org_unit_people_rollup() and
--    org_unit_capacity_rollup() to skip archived people, but the migration
--    never redefined the functions. Production still counts archived people
--    in a leader's People and Capacity rollups. Both are recreated below
--    exactly as schema.sql has them (same signature and return type, so
--    CREATE OR REPLACE keeps their grants).
--
-- 2. 2026-08-24_team_meetings.sql renamed team_meeting_notes to
--    team_meetings, and the constraints kept their old names. Cosmetic only;
--    renamed so production matches schema.sql and the drift check comes back
--    clean. Renaming a primary key renames its index too. Each rename only
--    runs if the old name is still there, so this file is safe to re-run.
--
-- Run in the Supabase SQL editor. schema.sql already matches.

create or replace function public.org_unit_people_rollup()
returns table (
  org_unit_id uuid,
  direct_report_count integer,
  role_breakdown jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with per_role as (
    select
      dr.org_unit_id,
      coalesce(rl.job_role, 'Unassigned') as job_role,
      count(*) as cnt
    from direct_reports dr
    left join role_levels rl on rl.id = dr.role_level_id
    where dr.org_unit_id in (select unit_id from public.led_org_unit_ids())
      -- Session 43: archived people drop out of the headcount rollup.
      and dr.archived_at is null
    group by dr.org_unit_id, coalesce(rl.job_role, 'Unassigned')
  )
  select
    org_unit_id,
    sum(cnt)::integer as direct_report_count,
    jsonb_agg(jsonb_build_object('job_role', job_role, 'count', cnt) order by job_role) as role_breakdown
  from per_role
  group by org_unit_id
$$;

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

  -- Off-days precedence: actual logged time off (actual_off, computed once
  -- per report via LATERAL) wins for the period it overlaps; otherwise fall
  -- back to a prorated share of off_days_per_year. Mirrors capacity.py's
  -- _effective_off_hours() — keep both in sync if this changes.
  return query
  select
    dr.org_unit_id,
    count(*)::integer as direct_report_count,
    sum(
      greatest(
        coalesce(cp.contracted_hours_per_week, cs.default_hours_per_week, 40)
          * v_period_weeks
          * (coalesce(cp.target_utilization_pct, cs.default_target_utilization_pct, 75) / 100.0)
        - (
            case
              when coalesce(actual_off.hours, 0) > 0 then actual_off.hours
              else
                coalesce(cp.off_days_per_year, cs.default_off_days_per_year, 21)
                  * (coalesce(cp.contracted_hours_per_week, cs.default_hours_per_week, 40) / 5.0)
                  * (v_period_weeks / 52.0)
            end
          ),
        0
      )
    ) as available_hours
  from direct_reports dr
  join org_units ou on ou.id = dr.org_unit_id and ou.org_id = v_org_id
  left join capacity_profiles cp on cp.direct_report_id = dr.id
  -- Archived people (Session 43) don't count toward available capacity.
  left join capacity_settings cs on cs.org_id = v_org_id
  left join lateral (
    select sum(
      (least(t.end_date, p_period_end) - greatest(t.start_date, p_period_start) + 1)
      * coalesce(
          t.hours_per_day,
          coalesce(cp.contracted_hours_per_week, cs.default_hours_per_week, 40) / 5.0
        )
    ) as hours
    from time_off_entries t
    where t.direct_report_id = dr.id
      and t.start_date <= p_period_end
      and t.end_date >= p_period_start
  ) actual_off on true
  where dr.org_unit_id in (select unit_id from public.led_org_unit_ids())
    and dr.archived_at is null
  group by dr.org_unit_id;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('team_meeting_notes_pkey',            'team_meetings_pkey'),
      ('team_meeting_notes_manager_id_fkey',  'team_meetings_manager_id_fkey'),
      ('team_meeting_notes_org_unit_id_fkey', 'team_meetings_org_unit_id_fkey')
    ) v(old_name, new_name)
  loop
    if exists (
      select 1 from pg_constraint
      where conrelid = 'public.team_meetings'::regclass and conname = r.old_name
    ) then
      execute format('alter table public.team_meetings rename constraint %I to %I',
                     r.old_name, r.new_name);
    end if;
  end loop;
end;
$$;
