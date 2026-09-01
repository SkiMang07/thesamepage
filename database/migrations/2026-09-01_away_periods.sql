-- ============================================================
-- Away periods: a manager declares "I'll be out from X to Y" and every
-- upcoming 1:1, team meeting, and self-owned commitment/goal/project due
-- date that falls in that window gets pushed forward by however many days
-- long the window is, so nothing sits as false delinquency while they're
-- gone.
--
-- Deliberately a new table pair, not a generalization of time_off_entries.
-- That table is a passive capacity-math input scoped to direct_report_id
-- (see capacity.py / org_unit_capacity_rollup()) — read continuously by the
-- hours rollup, and logging a direct report's vacation there moves nothing
-- else. away_periods is the opposite shape: it exists purely to trigger one
-- explicit, one-time sweep, and every row in it has already been applied
-- (see the applied_at comment in schema.sql). See docs/systems/away.md.
--
-- away_period_shifts is the audit trail — one row per item actually moved.
-- manager_id is denormalized onto it (same reasoning as
-- team_meeting_agenda_items) so its RLS policy stays a flat
-- manager_id = auth.uid() instead of a subquery through away_periods.
-- ============================================================

create table if not exists away_periods (
  id           uuid primary key default uuid_generate_v4(),
  manager_id   uuid not null references auth.users(id),
  start_date   date not null,
  end_date     date not null,
  reason       text,
  applied_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint away_periods_date_range check (end_date >= start_date)
);

alter table away_periods enable row level security;

create index if not exists away_periods_manager_idx on away_periods (manager_id, start_date desc);

drop policy if exists "away_periods_all_own" on away_periods;
create policy "away_periods_all_own" on away_periods
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

create table if not exists away_period_shifts (
  id             uuid primary key default uuid_generate_v4(),
  away_period_id uuid not null references away_periods(id) on delete cascade,
  manager_id     uuid not null references auth.users(id),
  entity_type    text not null check (entity_type in ('one_on_one', 'team_meeting', 'commitment', 'goal', 'project')),
  entity_id      uuid not null,
  label          text not null,
  old_date       date not null,
  new_date       date not null,
  created_at     timestamptz not null default now()
);

alter table away_period_shifts enable row level security;

create index if not exists away_period_shifts_period_idx on away_period_shifts (away_period_id);

drop policy if exists "away_period_shifts_all_own" on away_period_shifts;
create policy "away_period_shifts_all_own" on away_period_shifts
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());
