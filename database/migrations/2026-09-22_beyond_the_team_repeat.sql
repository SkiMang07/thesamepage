-- ============================================================
-- Beyond the team, Phase 2: repeating 1:1s outside the team, with prep
-- and carry-forward. Spec: docs/BEYOND_THE_TEAM_SCOPING.md §4.
-- Applies on top of 2026-09-22_beyond_the_team.sql.
--
-- outside_meeting_series mirrors one_on_one_series: one ACTIVE series per
-- (owner, person), a 1-4 week interval from an anchor date. Occurrences
-- stay outside_meetings rows (series_id), so reschedules, prep and history
-- never mutate the rule. 1:1s only; group meetings don't repeat.
--
-- outside_meetings gains:
--   series_id            the series an occurrence belongs to
--   prep_guide           the generated prep sheet for an upcoming 1:1
--   carry_forward_items  topics carried INTO this meeting from the last one
--                        (the same meaning as one_on_ones.carry_forward_items)
--
-- The outside_meetings policy's WITH CHECK now also proves a series_id is
-- the caller's own. away_period_shifts accepts 'outside_meeting' so Away
-- can move these meetings too.
-- ============================================================

create table if not exists outside_meeting_series (
  id              uuid primary key default uuid_generate_v4(),
  owner_id        uuid not null references auth.users(id),
  person_id       uuid not null references outside_people(id) on delete cascade,
  interval_weeks  smallint not null check (interval_weeks between 1 and 4),
  anchor_at       timestamptz not null,
  timezone        text not null default 'UTC',
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

alter table outside_meeting_series enable row level security;

create unique index if not exists outside_meeting_series_active_person_idx
  on outside_meeting_series (owner_id, person_id)
  where active;

alter table outside_meetings
  add column if not exists series_id uuid references outside_meeting_series(id) on delete set null,
  add column if not exists prep_guide jsonb,
  add column if not exists carry_forward_items jsonb not null default '[]'::jsonb;

alter table outside_meetings
  drop constraint if exists outside_meetings_carry_forward_items_array,
  add constraint outside_meetings_carry_forward_items_array
    check (jsonb_typeof(carry_forward_items) = 'array');

create index if not exists outside_meetings_upcoming_idx
  on outside_meetings (owner_id, scheduled_at)
  where summary is null;

alter table away_period_shifts
  drop constraint if exists away_period_shifts_entity_type_check,
  add constraint away_period_shifts_entity_type_check
    check (entity_type in ('one_on_one', 'team_meeting', 'commitment', 'goal', 'project', 'outside_meeting'));

drop policy if exists "outside_meeting_series_all_own" on outside_meeting_series;
create policy "outside_meeting_series_all_own" on outside_meeting_series
  for all using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from outside_people p where p.id = person_id and p.owner_id = auth.uid())
  );

drop policy if exists "outside_meetings_all_own" on outside_meetings;
create policy "outside_meetings_all_own" on outside_meetings
  for all using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and (series_id is null or exists (select 1 from outside_meeting_series s where s.id = series_id and s.owner_id = auth.uid()))
  );
