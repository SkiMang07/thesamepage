-- ============================================================
-- Capacity model — off_days_per_year addition (Session 14, same day as
-- 2026-08-02_capacity.sql but run as a separate follow-up after that
-- migration was already live — see docs/SESSION_HISTORY.md and the
-- capacity_scoping project memory note).
--
-- Why this is its own file instead of amending 2026-08-02_capacity.sql:
-- Andrew had already run that migration against live Supabase before this
-- addition was scoped. Folding this into that file and re-running it would
-- try to CREATE TABLE capacity_settings again and fail with
-- "relation already exists". Same convention as
-- 2026-08-02_goals_success_metrics.sql shipping separately from the base
-- goals table.
--
-- What this adds: target_utilization_pct (in the base migration) only
-- buffers within-a-day overhead — meetings, admin, the unexpected. Nothing
-- accounted for whole days not worked at all unless a manager had already
-- logged specific time_off_entries dates. off_days_per_year is a second,
-- orthogonal buffer: an annual whole-days-off default (15 working days
-- vacation + 6 working days sick = 21), editable org-wide in
-- Settings > Capacity and per-person on the DR detail page, same pattern
-- as the other two capacity defaults.
--
-- Precedence vs. time_off_entries, to avoid double-counting: actual logged
-- time off wins for whatever period it overlaps; otherwise the calculation
-- falls back to a prorated share of the annual off_days_per_year default
-- (off_days_per_year * hours_per_day * period_weeks / 52). Mirrored in
-- Python at backend/routes/capacity.py's _effective_off_hours() — keep
-- both in sync if this logic ever changes.
--
-- Safe to run against a database that already has 2026-08-02_capacity.sql
-- applied. The ALTERs are additive/idempotent (IF NOT EXISTS) and the
-- function replacement uses CREATE OR REPLACE, so this is also safe to
-- re-run itself if needed.
-- ============================================================

alter table capacity_settings
  add column if not exists default_off_days_per_year numeric not null default 21;

alter table capacity_profiles
  add column if not exists off_days_per_year numeric;

-- Replaces the org_unit_capacity_rollup() from 2026-08-02_capacity.sql with
-- a version that adds the off-days precedence logic above (actual logged
-- time off via the actual_off LATERAL join wins; otherwise a prorated share
-- of off_days_per_year). Return shape (org_unit_id, direct_report_count,
-- available_hours) and the SECURITY DEFINER aggregate-only reasoning are
-- unchanged from the original — see 2026-08-02_capacity.sql for that.
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
  group by dr.org_unit_id;
end;
$$;

revoke all on function public.org_unit_capacity_rollup(date, date) from public;
grant execute on function public.org_unit_capacity_rollup(date, date) to authenticated;
