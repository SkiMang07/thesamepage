-- ============================================================
-- Projects in motion (2026-09-25) — docs/systems/projects.md
--
-- 1. record_project_check_in(): the project check-in write path. Inserts the
--    check-in and writes its status through to projects.status in ONE
--    transaction, and a client_request_id that already produced a row returns
--    that row, so a retried submit never saves twice. Same shape as
--    record_goal_check_in() (2026-09-25_goal_measures.sql, which added
--    check_ins.client_request_id and its unique index — run that first).
--    Projects never carry measured_value. Confirmed Beyond check-ins keep
--    routes/check_ins.py's create_check_in().
--
-- 2. project_follow_throughs: the manager's own private "next move" on a
--    project. At most one open move per project (partial unique index);
--    completed moves are kept. Independent of projects.status. Deliberately
--    NOT a commitments row: commitments are read by Mission Control, Team,
--    1:1 prep, Away and the report pages, so a project next move stored
--    there would surface in all of them.
--
-- Additive only. Run before deploying the backend that calls the function.
-- ============================================================

create or replace function public.record_project_check_in(
  p_project_id uuid,
  p_status text,
  p_progress integer default null,
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
  v_row check_ins%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_client_request_id is not null then
    select * into v_row from check_ins
      where owner_id = v_uid and client_request_id = p_client_request_id;
    if found then
      if v_row.project_id is distinct from p_project_id then
        raise exception 'This update key was already used for another record' using errcode = '22023';
      end if;
      return next v_row;
      return;
    end if;
  end if;

  perform 1 from projects where id = p_project_id and owner_id = v_uid for update;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if p_status is null or p_status not in ('active', 'on_track', 'at_risk', 'completed', 'cancelled') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  if p_progress is not null and (p_progress < 0 or p_progress > 100) then
    raise exception 'Completion must be a whole number from 0 to 100' using errcode = '22023';
  end if;

  begin
    insert into check_ins (owner_id, project_id, status, progress, note, client_request_id)
    values (v_uid, p_project_id, p_status, p_progress, nullif(btrim(p_note), ''), p_client_request_id)
    returning * into v_row;
  exception when unique_violation then
    -- A concurrent submit with the same key won the race: return its row.
    select * into v_row from check_ins
      where owner_id = v_uid and client_request_id = p_client_request_id;
    if v_row.project_id is distinct from p_project_id then
      raise exception 'This update key was already used for another record' using errcode = '22023';
    end if;
    return next v_row;
    return;
  end;

  update projects set status = p_status where id = p_project_id and owner_id = v_uid;
  return next v_row;
end;
$$;

revoke all on function public.record_project_check_in(uuid, text, integer, text, uuid) from public;
grant execute on function public.record_project_check_in(uuid, text, integer, text, uuid) to authenticated;

create table if not exists project_follow_throughs (
  id            uuid primary key default uuid_generate_v4(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  body          text not null check (char_length(btrim(body)) between 1 and 1000),
  status        text not null default 'open' check (status in ('open', 'done')),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint project_follow_throughs_done_shape
    check ((status = 'done') = (completed_at is not null))
);

create unique index if not exists project_follow_throughs_one_open
  on project_follow_throughs (owner_id, project_id) where status = 'open';
create index if not exists project_follow_throughs_owner_idx
  on project_follow_throughs (owner_id, status, created_at desc);

alter table project_follow_throughs enable row level security;

-- Owner-scoped. WITH CHECK also proves the project is the caller's own, so a
-- known UUID of someone else's project can't carry your next move.
drop policy if exists "project_follow_throughs_all_own" on project_follow_throughs;
create policy "project_follow_throughs_all_own" on project_follow_throughs
  for all using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid())
  );

grant select, insert, update, delete on project_follow_throughs to authenticated;
