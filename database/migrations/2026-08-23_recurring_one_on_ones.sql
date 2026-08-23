-- ============================================================
-- Recurring 1:1 loop: series + scheduled occurrences + confirmed carry-forward.
--
-- `one_on_one_series` owns the repeat rule. `one_on_ones` remains one row per
-- occurrence and gains only the series link plus the manager-confirmed topics
-- that seed the next prep. Status stays derived from scheduled_at/prep_guide/
-- summary; there is no stored status column.
-- ============================================================

create table if not exists one_on_one_series (
  id               uuid primary key default uuid_generate_v4(),
  manager_id       uuid not null references auth.users(id),
  direct_report_id uuid not null references direct_reports(id) on delete cascade,
  interval_weeks   smallint not null check (interval_weeks between 1 and 4),
  anchor_at        timestamptz not null,
  timezone         text not null default 'UTC',
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint one_on_one_series_occurrence_owner_key
    unique (id, manager_id, direct_report_id)
);

alter table one_on_one_series enable row level security;

create unique index if not exists one_on_one_series_active_report_idx
  on one_on_one_series (manager_id, direct_report_id)
  where active;

alter table one_on_ones
  add column if not exists series_id uuid,
  add column if not exists carry_forward_items jsonb not null default '[]'::jsonb;

alter table one_on_ones
  drop constraint if exists one_on_ones_series_id_fkey,
  drop constraint if exists one_on_ones_series_owner_fkey;

alter table one_on_one_series
  drop constraint if exists one_on_one_series_occurrence_owner_key,
  add constraint one_on_one_series_occurrence_owner_key
    unique (id, manager_id, direct_report_id);

alter table one_on_ones
  add constraint one_on_ones_series_owner_fkey
    foreign key (series_id, manager_id, direct_report_id)
    references one_on_one_series (id, manager_id, direct_report_id)
    deferrable initially deferred;

alter table one_on_ones
  drop constraint if exists one_on_ones_carry_forward_items_array,
  add constraint one_on_ones_carry_forward_items_array
    check (jsonb_typeof(carry_forward_items) = 'array');

create index if not exists one_on_ones_upcoming_idx
  on one_on_ones (manager_id, scheduled_at)
  where summary is null and scheduled_at is not null;

drop policy if exists "one_on_one_series_all_own" on one_on_one_series;
create policy "one_on_one_series_all_own" on one_on_one_series
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());
