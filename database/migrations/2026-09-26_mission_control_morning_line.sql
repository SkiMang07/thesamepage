-- ============================================================
-- Mission Control morning line (B3, AI_OPPORTUNITIES.md) — 2026-09-26
--
-- One sentence of prose at the top of Mission Control, written from the
-- brief's top three moves. Generated on the manager's first Mission Control
-- load of the day (no worker), then cached here per manager per local day.
--
-- `fingerprint` is a hash of the top three candidates' keys + evidence
-- fingerprints. When the ranking or its evidence changes (a move is
-- addressed, snoozed, or new evidence lands) the fingerprint no longer
-- matches and the line is rewritten — capped by `generations` so a busy
-- day cannot run up calls. `line` null means the model declined (nothing
-- worth saying); that is cached too so it is not asked again.
-- ============================================================

create table if not exists mission_control_morning_lines (
  manager_id   uuid not null references auth.users(id) on delete cascade,
  local_date   date not null,
  fingerprint  text not null,
  line         text,
  generations  smallint not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (manager_id, local_date)
);

alter table mission_control_morning_lines enable row level security;

drop policy if exists "mission_control_morning_lines_select_own" on mission_control_morning_lines;
create policy "mission_control_morning_lines_select_own" on mission_control_morning_lines
  for select using (manager_id = auth.uid());

drop policy if exists "mission_control_morning_lines_insert_own" on mission_control_morning_lines;
create policy "mission_control_morning_lines_insert_own" on mission_control_morning_lines
  for insert with check (manager_id = auth.uid());

drop policy if exists "mission_control_morning_lines_update_own" on mission_control_morning_lines;
create policy "mission_control_morning_lines_update_own" on mission_control_morning_lines
  for update using (manager_id = auth.uid()) with check (manager_id = auth.uid());
