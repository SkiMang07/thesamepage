-- ============================================================
-- Team meetings: a real meeting entity, on a series, with agenda items.
--
-- Before this migration a "team meeting" was two unrelated rows in
-- team_meeting_notes — one future-dated row holding the agenda, one
-- null-dated row holding whatever got typed afterwards. Nothing joined
-- them, so there was no way to log notes *against* the meeting you
-- planned, one meeting rendered as two cards, and the "next meeting" hero
-- stuck all day because status derived from meeting_date alone.
--
-- This is the 1:1 treatment applied to team meetings: one row per
-- occurrence, a series that owns the repeat rule, and status derived from
-- which columns are filled rather than stored.
--
--   RENAME, don't rebuild. team_meeting_notes already has the right PK,
--   RLS policy and index; renaming preserves every row and every grant and
--   avoids a copy-backfill with a dual-write window. Agenda items FK
--   against the same ids that already exist.
--
-- meeting_date is deliberately NOT dropped here. The backfill below infers
-- agenda-vs-recap from it, and one migration of overlap makes a bad
-- inference recoverable. A follow-up migration drops it once the data has
-- been eyeballed live.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The series — mirrors one_on_one_series exactly.
-- ------------------------------------------------------------
create table if not exists team_meeting_series (
  id             uuid primary key default uuid_generate_v4(),
  manager_id     uuid not null references auth.users(id),
  org_unit_id    uuid references org_units(id) on delete cascade,
  interval_weeks smallint not null check (interval_weeks between 1 and 4),
  anchor_at      timestamptz not null,
  timezone       text not null default 'UTC',
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

alter table team_meeting_series enable row level security;

-- One active series per (manager, team). Two partial indexes rather than one
-- composite unique, for the same reason team_callouts needs them: a plain
-- UNIQUE treats every NULL org_unit_id as distinct, which would let a
-- manager pile up duplicate all-teams series.
create unique index if not exists team_meeting_series_active_unit_idx
  on team_meeting_series (manager_id, org_unit_id)
  where active and org_unit_id is not null;

create unique index if not exists team_meeting_series_active_all_teams_idx
  on team_meeting_series (manager_id)
  where active and org_unit_id is null;

drop policy if exists "team_meeting_series_all_own" on team_meeting_series;
create policy "team_meeting_series_all_own" on team_meeting_series
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- ------------------------------------------------------------
-- 2. team_meeting_notes becomes team_meetings.
-- ------------------------------------------------------------
-- Both renames are guarded so re-running the whole file is a no-op rather
-- than a wall of errors that hides a real one.
alter table if exists team_meeting_notes rename to team_meetings;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'team_meetings' and column_name = 'note'
  ) then
    alter table team_meetings rename column note to agenda_note;
  end if;
end $$;

alter table team_meetings
  add column if not exists summary      text,
  add column if not exists raw_notes    text,
  add column if not exists scheduled_at timestamptz,
  add column if not exists series_id    uuid references team_meeting_series(id) on delete set null,
  add column if not exists logged_at    timestamptz;

-- Dropped BEFORE the backfill below, not after: the recap backfill nulls
-- agenda_note, which the original NOT NULL would reject outright.
alter table team_meetings alter column agenda_note drop not null;

-- The policy came along with the rename but kept its old name.
do $$
begin
  if exists (
    select 1 from pg_policies
     where tablename = 'team_meetings' and policyname = 'team_meeting_notes_all_own'
  ) then
    alter policy "team_meeting_notes_all_own" on team_meetings
      rename to "team_meetings_all_own";
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Backfill.
--
-- A null meeting_date meant "logged after the fact" under the old model, so
-- that text is a recap; a set meeting_date meant "this is the agenda". Rows
-- are only touched when scheduled_at is still null, so re-running is safe.
-- ------------------------------------------------------------
update team_meetings
   set summary      = agenda_note,
       agenda_note  = null,
       scheduled_at = created_at,
       logged_at    = created_at
 where scheduled_at is null
   and meeting_date is null;

update team_meetings
   set scheduled_at = (meeting_date::timestamp + interval '12 hours') at time zone 'UTC'
 where scheduled_at is null
   and meeting_date is not null;

-- Unlogged meetings, soonest first — the "next meeting" lookup and the
-- needs-logging list both ride this.
create index if not exists team_meetings_open_idx
  on team_meetings (manager_id, scheduled_at)
  where summary is null;

-- ------------------------------------------------------------
-- 4. Agenda items.
--
-- Structured rows rather than newline-split text (the team_callouts trick)
-- because carry-forward needs item identity: notes attach to an item, and
-- carried_from_item_id is what makes "carried twice" answerable.
--
-- manager_id is denormalized so the RLS policy stays a flat
-- manager_id = auth.uid() rather than a subquery into team_meetings — same
-- discipline that keeps the org policies out of recursion.
-- ------------------------------------------------------------
create table if not exists team_meeting_agenda_items (
  id                   uuid primary key default uuid_generate_v4(),
  meeting_id           uuid not null references team_meetings(id) on delete cascade,
  manager_id           uuid not null references auth.users(id),
  position             smallint not null default 0,
  item                 text not null,
  covered              boolean not null default false,
  notes                text,
  carried_from_item_id uuid references team_meeting_agenda_items(id) on delete set null,
  created_at           timestamptz not null default now()
);

alter table team_meeting_agenda_items enable row level security;

create index if not exists team_meeting_agenda_items_meeting_idx
  on team_meeting_agenda_items (meeting_id, position);

drop policy if exists "team_meeting_agenda_items_all_own" on team_meeting_agenda_items;
create policy "team_meeting_agenda_items_all_own" on team_meeting_agenda_items
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- Old free-text agendas become one item each so nothing planned is lost.
insert into team_meeting_agenda_items (meeting_id, manager_id, position, item)
select m.id, m.manager_id, row_number() over (partition by m.id order by line.ord) - 1,
       btrim(line.value)
  from team_meetings m
  cross join lateral unnest(string_to_array(m.agenda_note, E'\n')) with ordinality as line(value, ord)
 where m.agenda_note is not null
   and btrim(line.value) <> ''
   and not exists (
     select 1 from team_meeting_agenda_items i where i.meeting_id = m.id
   );

-- ------------------------------------------------------------
-- 5. Commitments extracted from a team meeting.
--
-- source_type gains 'team_meeting' so an extracted commitment traces back to
-- the meeting that produced it via source_id. direct_report_id is already
-- nullable and RLS is a flat owner_id = auth.uid(), so a manager-owned team
-- commitment is legal at the database level today — only the route and the
-- list rendering assumed a person. No column change needed here.
-- ------------------------------------------------------------
alter table commitments
  drop constraint if exists commitments_source_type_check,
  add constraint commitments_source_type_check
    check (source_type in ('one_on_one', 'goal', 'project', 'manual', 'team_meeting'));
