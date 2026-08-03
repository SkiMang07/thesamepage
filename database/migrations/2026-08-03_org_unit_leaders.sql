-- ============================================================
-- Role-scoped views, part 1 — org_unit leader assignment + rollup
-- functions (Session 15, 2026-08-03; see docs/SESSION_HISTORY.md and the
-- role_scoped_views project memory note for the scoping conversation).
--
-- Decisions locked before this file was written:
--   - Scoping mechanism: an explicit "leader" per org_unit (new
--     leader_user_id column), NOT users.role tiers and NOT the
--     users.manager_id reporting chain — mirrors Capacity's Session 14
--     choice to walk the org_units tree rather than the manager chain, so
--     there's one consistent source of truth for "who sees what."
--   - Visibility depth: aggregate-only outside your own team, same
--     precedent as org_unit_capacity_rollup() (Session 14) — a leader's
--     rollup is always counts/sums per org unit, never a named individual.
--   - Scope of this pass: People (headcount + role breakdown), Projects,
--     Capacity (closing the known "open to any org member" gap flagged in
--     Session 14), and Goals — all four surfaces Andrew picked, not a
--     narrower first slice.
--   - Built ahead of real multi-manager data, same posture as org_units
--     (Session 11) and Capacity (Session 14) — verified build-clean, not
--     live-tested against a second manager (none exists yet).
--
-- led_org_unit_ids() is the single gate every rollup function below shares:
-- units the caller directly leads, plus every descendant walked down the
-- org_units tree. A caller who leads nothing gets an empty scope everywhere
-- — including org_unit_capacity_rollup(), which before this migration was
-- readable by any authenticated org member. That's an intentional behavior
-- change: the "By department" capacity view will show nothing until Andrew
-- (or any manager) is assigned as a leader of at least one unit in Org >
-- Build. Not a bug — see docs/SESSION_HISTORY.md Session 15 for the note
-- flagging this to Andrew directly.
-- ============================================================

alter table org_units
  add column if not exists leader_user_id uuid references auth.users(id) on delete set null;

-- ------------------------------------------------------------
-- led_org_unit_ids() — recursive walk down from every unit the caller
-- directly leads. SECURITY DEFINER so it can read org_units rows the
-- caller wouldn't otherwise be scoped to by RLS in the future; today
-- org_units itself is already org-wide readable, so this is really about
-- giving every rollup function below one shared, auditable gate rather than
-- reimplementing the recursion four times.
-- ------------------------------------------------------------
create or replace function public.led_org_unit_ids()
returns table (unit_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with recursive led as (
    select id from org_units where leader_user_id = auth.uid()
    union all
    select ou.id
    from org_units ou
    join led on ou.parent_unit_id = led.id
  )
  select id from led
$$;

revoke all on function public.led_org_unit_ids() from public;
grant execute on function public.led_org_unit_ids() to authenticated;

-- ------------------------------------------------------------
-- org_unit_capacity_rollup() — same formula as
-- database/migrations/2026-08-02_capacity_off_days.sql, now gated by
-- led_org_unit_ids() instead of returning every org_unit in the org. This
-- closes the gap flagged in Session 14 ("Per-org-unit rollup permissions
-- ... wasn't built because there's no second manager yet to test one
-- against").
-- ------------------------------------------------------------
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
  group by dr.org_unit_id;
end;
$$;

-- ------------------------------------------------------------
-- org_unit_goals_rollup() — status counts for department/team-level goals
-- directly tagged with an org_unit_id. Individual-level goals (tied via
-- direct_report_id, no org_unit_id of their own) are NOT rolled in here —
-- deliberate v1 scope limit, same "don't generalize past what's needed"
-- discipline as the rest of this schema. Revisit if a dept head wants
-- "how's everyone's individual goals doing" folded into the same view.
-- ------------------------------------------------------------
create or replace function public.org_unit_goals_rollup()
returns table (
  org_unit_id uuid,
  status text,
  goal_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select g.org_unit_id, g.status, count(*)::integer as goal_count
  from goals g
  where g.org_unit_id in (select unit_id from public.led_org_unit_ids())
  group by g.org_unit_id, g.status
$$;

revoke all on function public.org_unit_goals_rollup() from public;
grant execute on function public.org_unit_goals_rollup() to authenticated;

-- ------------------------------------------------------------
-- org_unit_projects_rollup() — status counts for projects, scoped the same
-- way Projects derives its scope everywhere else: its goal's org_unit_id
-- first, falling back to its assigned direct report's org_unit_id. A
-- standalone project with neither never resolves to a unit and is excluded
-- — nothing to roll it up under.
-- ------------------------------------------------------------
create or replace function public.org_unit_projects_rollup()
returns table (
  org_unit_id uuid,
  status text,
  project_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(g.org_unit_id, dr.org_unit_id) as org_unit_id, p.status, count(*)::integer as project_count
  from projects p
  left join goals g on g.id = p.goal_id
  left join direct_reports dr on dr.id = p.direct_report_id
  where coalesce(g.org_unit_id, dr.org_unit_id) in (select unit_id from public.led_org_unit_ids())
  group by coalesce(g.org_unit_id, dr.org_unit_id), p.status
$$;

revoke all on function public.org_unit_projects_rollup() from public;
grant execute on function public.org_unit_projects_rollup() to authenticated;

-- ------------------------------------------------------------
-- org_unit_people_rollup() — headcount + a role-label/count breakdown per
-- unit. Aggregate-only by construction: job_role + a count, never a name,
-- same contract as the capacity rollup. Reports with no role_level_id
-- assigned are grouped under 'Unassigned' rather than dropped.
-- ------------------------------------------------------------
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
    group by dr.org_unit_id, coalesce(rl.job_role, 'Unassigned')
  )
  select
    org_unit_id,
    sum(cnt)::integer as direct_report_count,
    jsonb_agg(jsonb_build_object('job_role', job_role, 'count', cnt) order by job_role) as role_breakdown
  from per_role
  group by org_unit_id
$$;

revoke all on function public.org_unit_people_rollup() from public;
grant execute on function public.org_unit_people_rollup() to authenticated;
