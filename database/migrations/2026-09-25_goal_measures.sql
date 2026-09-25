-- ============================================================
-- Goals: one optional numeric measure per goal, real readings on check-ins,
-- and an atomic, retry-safe goal check-in write (2026-09-25 goals redesign,
-- docs/design-proposals/2026-09-25-goals-in-view/BUILD_BRIEF.md).
--
-- Additive only. Existing goals stay unmeasured until a manager configures a
-- measure; nothing is backfilled from notes, success_metrics or progress %.
-- Existing check-ins keep measured_value and client_request_id null.
-- The backend's goal list and goal check-in route depend on these columns
-- and on record_goal_check_in(), so run this before deploying that backend.
-- ============================================================

alter table goals
  add column if not exists measure_label text,
  add column if not exists measure_format text check (measure_format in ('count', 'number', 'percent')),
  add column if not exists measure_unit text,
  add column if not exists measure_target numeric,
  add column if not exists measure_direction text check (measure_direction in ('at_least', 'at_most', 'below'));

alter table goals drop constraint if exists goals_measure_complete;
alter table goals add constraint goals_measure_complete check (
  (measure_format is null and measure_label is null and measure_unit is null
    and measure_target is null and measure_direction is null)
  or (measure_format is not null and nullif(btrim(measure_label), '') is not null
    and measure_target is not null and measure_direction is not null
    and measure_target not in ('NaN', 'Infinity', '-Infinity')
    and (measure_format <> 'count' or (measure_target >= 0 and measure_target = trunc(measure_target))))
);

alter table check_ins
  add column if not exists measured_value numeric,
  add column if not exists client_request_id uuid;

alter table check_ins drop constraint if exists check_ins_measured_value_goal_only;
alter table check_ins add constraint check_ins_measured_value_goal_only
  check (measured_value is null or goal_id is not null);
alter table check_ins drop constraint if exists check_ins_measured_value_finite;
alter table check_ins add constraint check_ins_measured_value_finite
  check (measured_value is null or measured_value not in ('NaN', 'Infinity', '-Infinity'));

create unique index if not exists check_ins_owner_request_idx on check_ins (owner_id, client_request_id)
  where client_request_id is not null;

-- record_goal_check_in() is the goal check-in write path. It inserts the
-- check-in and writes its status through to goals.status in one transaction,
-- so a reported success can never be half a write. A client_request_id that
-- already produced a row returns that row, so a retried submit does not
-- duplicate. SECURITY INVOKER: RLS applies exactly as it does to the plain
-- table writes it replaces. Project check-ins and confirmed Beyond check-ins
-- still use routes/check_ins.py's create_check_in().
create or replace function public.record_goal_check_in(
  p_goal_id uuid,
  p_status text,
  p_progress integer default null,
  p_measured_value numeric default null,
  p_note text default null,
  p_client_request_id uuid default null
)
returns setof check_ins
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_goal goals%rowtype;
  v_row check_ins%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_client_request_id is not null then
    select * into v_row from check_ins
      where owner_id = v_uid and client_request_id = p_client_request_id;
    if found then
      if v_row.goal_id is distinct from p_goal_id then
        raise exception 'This update key was already used for another record' using errcode = '22023';
      end if;
      return next v_row;
      return;
    end if;
  end if;

  select * into v_goal from goals where id = p_goal_id and owner_id = v_uid for update;
  if not found then
    raise exception 'Goal not found' using errcode = 'P0002';
  end if;
  if p_status is null or p_status not in ('active', 'on_track', 'at_risk', 'completed', 'cancelled') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  if p_progress is not null and (p_progress < 0 or p_progress > 100) then
    raise exception 'Completion must be between 0 and 100' using errcode = '22023';
  end if;
  if p_measured_value is not null then
    if v_goal.measure_format is null then
      raise exception 'This goal has no numeric measure' using errcode = '22023';
    end if;
    if p_measured_value in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'A measured value must be a finite number' using errcode = '22023';
    end if;
    if v_goal.measure_format = 'count'
       and (p_measured_value < 0 or p_measured_value <> trunc(p_measured_value)) then
      raise exception 'A count must be a whole number of zero or more' using errcode = '22023';
    end if;
  end if;

  begin
    insert into check_ins (owner_id, goal_id, status, progress, measured_value, note, client_request_id)
    values (v_uid, p_goal_id, p_status, p_progress, p_measured_value, nullif(btrim(p_note), ''), p_client_request_id)
    returning * into v_row;
  exception when unique_violation then
    -- A concurrent submit with the same key won the race: return its row.
    select * into v_row from check_ins
      where owner_id = v_uid and client_request_id = p_client_request_id;
    return next v_row;
    return;
  end;

  update goals set status = p_status where id = p_goal_id and owner_id = v_uid;
  return next v_row;
end;
$$;

revoke all on function public.record_goal_check_in(uuid, text, integer, numeric, text, uuid) from public;
grant execute on function public.record_goal_check_in(uuid, text, integer, numeric, text, uuid) to authenticated;

-- Once a goal has a recorded reading, what those numbers mean is fixed: the
-- measure can't be removed and its format/unit can't change. Label wording,
-- target and comparison stay editable (the UI labels the target "current").
-- A different measure is a new goal. The API checks this first for a clear
-- message; this trigger is the backstop for every other writer.
create or replace function public.guard_goal_measure_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if (new.measure_format is distinct from old.measure_format
      or new.measure_unit is distinct from old.measure_unit)
     and exists (select 1 from check_ins where goal_id = old.id and measured_value is not null) then
    raise exception 'This measure already has recorded values, so its format and unit cannot change'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace trigger goals_guard_measure_change
  before update of measure_format, measure_unit on goals
  for each row execute function public.guard_goal_measure_change();
