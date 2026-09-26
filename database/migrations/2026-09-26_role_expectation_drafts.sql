-- ============================================================
-- Roles & expectations: working drafts, revisions and open decisions
-- (2026-09-26) — docs/systems/expectations.md
--
-- The approved expectations a role uses stay in metric_configs /
-- skill_configs / value_configs, exactly where every consumer already reads
-- them (fetch_role_expectations in routes/direct_reports.py). This migration
-- adds the working layer in front of them:
--
-- 1. Plain-language fields on the config tables, all nullable so every
--    existing row keeps its meaning and stays active without re-approval:
--      exceeds          optional "exceeds expectations" wording
--      skill_configs.area  'responsibility' for a responsibility judged by
--                          observation (no number); null/'skill' = a skill
--      metric_configs.target / target_status / target_source / target_quote
--                       the numerical target as the manager or the source
--                       stated it. target_status 'unresolved' means there is
--                       deliberately no target yet: never zero, never a
--                       guessed standard, excluded from numerical evaluation.
--                       null = a row configured before this workflow (any
--                       target lives in its wording, as before).
--      retired_at       set when an approved revision drops an item that
--                       history may still reference. Readers ignore retired
--                       rows; assessment rows keep their foreign keys.
--
-- 2. role_expectation_drafts — the working draft (a new role) or working
--    revision (an approved role being refined). One open draft per role
--    level. Saving a draft never changes the active expectations.
--
-- 3. role_expectation_decisions — a detail the manager chose to come back
--    to (a missing target, an open question), with its role/level, the item
--    it belongs to and the date it comes back. Survives approval, so an
--    approved role can carry an explicit open decision until a later approved
--    revision resolves it.
--
-- 4. approve_role_expectation_draft() — the only publication path. Writes
--    every item to the config tables, retires dropped items, binds and
--    resolves decisions and marks the draft approved in ONE transaction; a
--    stale version or an unresolved target without a return path writes
--    nothing. A retried approval returns the approved draft unchanged.
--
-- Additive only and safe to re-run. Run before deploying the backend that
-- reads retired_at / the new tables.
-- ============================================================

-- 1. config tables ------------------------------------------------------------

alter table metric_configs
  add column if not exists exceeds text,
  add column if not exists target text,
  add column if not exists target_status text,
  add column if not exists target_source text,
  add column if not exists target_quote text,
  add column if not exists retired_at timestamptz;

alter table metric_configs
  drop constraint if exists metric_configs_target_status_check,
  drop constraint if exists metric_configs_target_source_check,
  add constraint metric_configs_target_status_check
    check (target_status is null or target_status in ('set', 'unresolved')),
  add constraint metric_configs_target_source_check
    check (target_source is null or target_source in ('source', 'manager'));

alter table skill_configs
  add column if not exists exceeds text,
  add column if not exists area text,
  add column if not exists retired_at timestamptz;

alter table skill_configs
  drop constraint if exists skill_configs_area_check,
  add constraint skill_configs_area_check
    check (area is null or area in ('responsibility', 'skill'));

alter table value_configs
  add column if not exists exceeds text,
  add column if not exists retired_at timestamptz;

-- 2. working drafts -------------------------------------------------------------

create table if not exists role_expectation_drafts (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  role_level_id uuid not null references role_levels(id) on delete cascade,
  created_by    uuid references auth.users(id),
  -- 'new': the role had no approved expectations when this started.
  -- 'revision': approved expectations exist and stay in use meanwhile.
  kind          text not null default 'new' check (kind in ('new', 'revision')),
  status        text not null default 'open' check (status in ('open', 'approved', 'discarded')),
  source_text   text,
  source_label  text,
  items         jsonb not null default '[]'::jsonb,
  questions     jsonb not null default '[]'::jsonb,
  suggestions   jsonb not null default '[]'::jsonb,
  analysis      jsonb not null default '{}'::jsonb,
  version       integer not null default 0,
  approved_at   timestamptz,
  approved_by   uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint role_expectation_drafts_items_array check (jsonb_typeof(items) = 'array'),
  constraint role_expectation_drafts_questions_array check (jsonb_typeof(questions) = 'array'),
  constraint role_expectation_drafts_suggestions_array check (jsonb_typeof(suggestions) = 'array')
);

alter table role_expectation_drafts enable row level security;

create unique index if not exists role_expectation_drafts_one_open
  on role_expectation_drafts (role_level_id) where status = 'open';
create index if not exists role_expectation_drafts_org_idx
  on role_expectation_drafts (org_id, status, updated_at desc);

-- 3. open decisions -------------------------------------------------------------

create table if not exists role_expectation_decisions (
  id                uuid primary key default uuid_generate_v4(),
  org_id            uuid not null references organizations(id) on delete cascade,
  role_level_id     uuid not null references role_levels(id) on delete cascade,
  draft_id          uuid references role_expectation_drafts(id) on delete set null,
  -- The draft item's key; once approved it is the config row's id as text.
  item_key          text,
  config_kind       text check (config_kind is null or config_kind in ('metrics', 'skills', 'values')),
  config_id         uuid,
  topic             text not null default 'other' check (topic in ('target', 'measure', 'scope', 'wording', 'other')),
  question          text not null,
  context           text,
  status            text not null default 'deferred' check (status in ('deferred', 'resolved', 'dropped')),
  follow_up_on      date not null,
  resolution        text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  resolved_draft_id uuid references role_expectation_drafts(id) on delete set null
);

alter table role_expectation_decisions enable row level security;

create index if not exists role_expectation_decisions_open_idx
  on role_expectation_decisions (org_id, status, follow_up_on);
create index if not exists role_expectation_decisions_role_idx
  on role_expectation_decisions (role_level_id, status);

drop policy if exists "role_expectation_drafts_all_own_org" on role_expectation_drafts;
create policy "role_expectation_drafts_all_own_org" on role_expectation_drafts
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

drop policy if exists "role_expectation_decisions_all_own_org" on role_expectation_decisions;
create policy "role_expectation_decisions_all_own_org" on role_expectation_decisions
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- 4. approval -------------------------------------------------------------------

create or replace function public.approve_role_expectation_draft(
  p_draft_id uuid,
  p_expected_version integer
)
returns setof role_expectation_drafts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_draft role_expectation_drafts%rowtype;
  v_role role_levels%rowtype;
  v_item jsonb;
  v_q jsonb;
  v_name text;
  v_section text;
  v_kind text;
  v_status text;
  v_target text;
  v_config_id uuid;
  v_keep_metrics uuid[] := '{}';
  v_keep_skills uuid[] := '{}';
  v_keep_values uuid[] := '{}';
  v_key_map jsonb := '{}'::jsonb;
  v_kept_ids text[] := '{}';
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- RLS limits this to the caller's own org.
  select * into v_draft from role_expectation_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;

  -- Retry-safe: an approved draft is returned as it is, never re-written.
  if v_draft.status = 'approved' then
    return next v_draft;
    return;
  end if;
  if v_draft.status <> 'open' then
    raise exception 'This draft was discarded' using errcode = '22023';
  end if;
  if p_expected_version is distinct from v_draft.version then
    raise exception 'This draft changed after it was reviewed' using errcode = '40001';
  end if;

  select * into v_role from role_levels where id = v_draft.role_level_id for update;
  if not found or v_role.org_id is distinct from v_draft.org_id then
    raise exception 'Role not found' using errcode = 'P0002';
  end if;

  for v_item in select * from jsonb_array_elements(v_draft.items) loop
    v_name := nullif(btrim(coalesce(v_item->>'title', '')), '');
    if v_name is null then
      raise exception 'Every expectation needs a name' using errcode = '22023';
    end if;
    v_section := v_item->>'section';
    v_kind := case
      when v_section = 'responsibility' and coalesce(v_item->>'measure', 'judged') = 'numeric' then 'metrics'
      when v_section in ('responsibility', 'skill') then 'skills'
      when v_section = 'value' then 'values'
    end;
    if v_kind is null then
      raise exception 'Unknown expectation section for "%"', v_name using errcode = '22023';
    end if;

    v_status := null;
    v_target := null;
    if v_kind = 'metrics' and jsonb_typeof(v_item->'target') = 'object' then
      v_status := v_item->'target'->>'status';
      v_target := nullif(btrim(coalesce(v_item->'target'->>'text', '')), '');
      if v_status = 'set' and v_target is null then
        v_status := 'unresolved';
      end if;
      if v_status is not null and v_status not in ('set', 'unresolved') then
        v_status := null;
      end if;
      if v_status = 'unresolved' then
        v_target := null;
      end if;
    end if;

    -- A missing target is allowed only with an explicit way back to it.
    if v_status = 'unresolved' and not exists (
      select 1 from role_expectation_decisions d
       where d.role_level_id = v_draft.role_level_id
         and d.status = 'deferred'
         and d.topic = 'target'
         and (d.item_key = v_item->>'key'
              or (nullif(v_item->>'config_id', '') is not null
                  and d.config_id = (v_item->>'config_id')::uuid))
    ) then
      raise exception 'Choose when to come back to the missing target for "%"', v_name using errcode = '22023';
    end if;

    v_config_id := nullif(v_item->>'config_id', '')::uuid;
    if v_config_id is not null and (v_item->>'config_kind') is distinct from v_kind then
      v_config_id := null;  -- moved to another kind: retire the old row, write a new one
    end if;

    if v_kind = 'metrics' then
      if v_config_id is not null then
        update metric_configs
           set metric_name = v_name,
               description = nullif(btrim(coalesce(v_item->>'responsibility', '')), ''),
               expectation = nullif(btrim(coalesce(v_item->>'meets', '')), ''),
               exceeds = nullif(btrim(coalesce(v_item->>'exceeds', '')), ''),
               order_type = nullif(v_item->>'order_type', ''),
               measurement_period = nullif(v_item->>'measurement_period', ''),
               target = v_target,
               target_status = v_status,
               target_source = case when v_status = 'set' then nullif(v_item->'target'->>'source', '') end,
               target_quote = case when v_status = 'set' then nullif(v_item->'target'->>'quote', '') end
         where id = v_config_id and role_level_id = v_draft.role_level_id and retired_at is null
        returning id into v_config_id;
      end if;
      if v_config_id is null then
        insert into metric_configs (org_id, role_level_id, metric_name, description, expectation, exceeds,
                                    order_type, measurement_period, target, target_status, target_source, target_quote)
        values (v_draft.org_id, v_draft.role_level_id, v_name,
                nullif(btrim(coalesce(v_item->>'responsibility', '')), ''),
                nullif(btrim(coalesce(v_item->>'meets', '')), ''),
                nullif(btrim(coalesce(v_item->>'exceeds', '')), ''),
                nullif(v_item->>'order_type', ''),
                nullif(v_item->>'measurement_period', ''),
                v_target, v_status,
                case when v_status = 'set' then nullif(v_item->'target'->>'source', '') end,
                case when v_status = 'set' then nullif(v_item->'target'->>'quote', '') end)
        returning id into v_config_id;
      end if;
      v_keep_metrics := v_keep_metrics || v_config_id;
    elsif v_kind = 'skills' then
      if v_config_id is not null then
        update skill_configs
           set skill_name = v_name,
               description = nullif(btrim(coalesce(v_item->>'responsibility', '')), ''),
               expectation = nullif(btrim(coalesce(v_item->>'meets', '')), ''),
               exceeds = nullif(btrim(coalesce(v_item->>'exceeds', '')), ''),
               order_type = nullif(v_item->>'order_type', ''),
               area = case when v_section = 'responsibility' then 'responsibility' else 'skill' end
         where id = v_config_id and role_level_id = v_draft.role_level_id and retired_at is null
        returning id into v_config_id;
      end if;
      if v_config_id is null then
        insert into skill_configs (org_id, role_level_id, skill_name, description, expectation, exceeds, order_type, area)
        values (v_draft.org_id, v_draft.role_level_id, v_name,
                nullif(btrim(coalesce(v_item->>'responsibility', '')), ''),
                nullif(btrim(coalesce(v_item->>'meets', '')), ''),
                nullif(btrim(coalesce(v_item->>'exceeds', '')), ''),
                nullif(v_item->>'order_type', ''),
                case when v_section = 'responsibility' then 'responsibility' else 'skill' end)
        returning id into v_config_id;
      end if;
      v_keep_skills := v_keep_skills || v_config_id;
    else
      if v_config_id is not null then
        update value_configs
           set value_name = v_name,
               description = nullif(btrim(coalesce(nullif(v_item->>'meets', ''), v_item->>'responsibility', '')), ''),
               exceeds = nullif(btrim(coalesce(v_item->>'exceeds', '')), ''),
               order_type = nullif(v_item->>'order_type', ''),
               value_type = coalesce(nullif(v_item->>'value_type', ''), value_type, 'team')
         where id = v_config_id and role_level_id = v_draft.role_level_id and retired_at is null
        returning id into v_config_id;
      end if;
      if v_config_id is null then
        insert into value_configs (org_id, role_level_id, value_name, description, exceeds, order_type, value_type)
        values (v_draft.org_id, v_draft.role_level_id, v_name,
                nullif(btrim(coalesce(nullif(v_item->>'meets', ''), v_item->>'responsibility', '')), ''),
                nullif(btrim(coalesce(v_item->>'exceeds', '')), ''),
                nullif(v_item->>'order_type', ''),
                coalesce(nullif(v_item->>'value_type', ''), 'team'))
        returning id into v_config_id;
      end if;
      v_keep_values := v_keep_values || v_config_id;
    end if;

    v_key_map := v_key_map || jsonb_build_object(v_item->>'key', jsonb_build_object('kind', v_kind, 'id', v_config_id));
    v_kept_ids := v_kept_ids || v_config_id::text;
  end loop;

  -- Items dropped by this approval retire; history that references them stays intact.
  update metric_configs set retired_at = now()
   where role_level_id = v_draft.role_level_id and retired_at is null and not (id = any(v_keep_metrics));
  update skill_configs set retired_at = now()
   where role_level_id = v_draft.role_level_id and retired_at is null and not (id = any(v_keep_skills));
  update value_configs set retired_at = now()
   where role_level_id = v_draft.role_level_id and retired_at is null and not (id = any(v_keep_values));

  -- Bind this role's open decisions to the approved rows (item_key becomes the config id).
  update role_expectation_decisions d
     set config_kind = v_key_map->d.item_key->>'kind',
         config_id = (v_key_map->d.item_key->>'id')::uuid,
         item_key = v_key_map->d.item_key->>'id'
   where d.role_level_id = v_draft.role_level_id
     and d.status = 'deferred'
     and d.item_key is not null
     and v_key_map ? d.item_key;

  -- What the manager did with each decision in this draft.
  for v_q in select * from jsonb_array_elements(v_draft.questions) loop
    if nullif(v_q->>'decision_id', '') is null then
      continue;
    end if;
    if v_q->>'status' = 'answered' then
      update role_expectation_decisions
         set status = 'resolved', resolution = nullif(btrim(coalesce(v_q->>'answer', '')), ''),
             resolved_at = now(), resolved_draft_id = v_draft.id
       where id = (v_q->>'decision_id')::uuid and role_level_id = v_draft.role_level_id and status = 'deferred';
    elsif v_q->>'status' = 'dismissed' then
      update role_expectation_decisions
         set status = 'dropped', resolved_at = now(), resolved_draft_id = v_draft.id
       where id = (v_q->>'decision_id')::uuid and role_level_id = v_draft.role_level_id and status = 'deferred';
    elsif v_q->>'status' = 'deferred' and nullif(v_q->>'follow_up_on', '') is not null then
      update role_expectation_decisions
         set follow_up_on = (v_q->>'follow_up_on')::date
       where id = (v_q->>'decision_id')::uuid and role_level_id = v_draft.role_level_id and status = 'deferred';
    end if;
  end loop;

  -- A target decision is resolved once the approved row carries a target.
  update role_expectation_decisions d
     set status = 'resolved', resolution = m.target, resolved_at = now(), resolved_draft_id = v_draft.id
    from metric_configs m
   where d.role_level_id = v_draft.role_level_id
     and d.status = 'deferred'
     and d.topic = 'target'
     and d.config_id = m.id
     and m.target_status = 'set';

  -- A decision about an item that is no longer part of the role is dropped.
  update role_expectation_decisions d
     set status = 'dropped', resolved_at = now(), resolved_draft_id = v_draft.id
   where d.role_level_id = v_draft.role_level_id
     and d.status = 'deferred'
     and d.item_key is not null
     and not (d.item_key = any(v_kept_ids));

  if nullif(btrim(coalesce(v_draft.source_text, '')), '') is not null then
    update role_levels set job_responsibilities = v_draft.source_text where id = v_draft.role_level_id;
  end if;

  update role_expectation_drafts
     set status = 'approved',
         approved_at = now(),
         approved_by = v_uid,
         suggestions = '[]'::jsonb,
         version = version + 1,
         updated_at = now()
   where id = v_draft.id
   returning * into v_draft;

  return next v_draft;
end;
$$;

revoke all on function public.approve_role_expectation_draft(uuid, integer) from public;
grant execute on function public.approve_role_expectation_draft(uuid, integer) to authenticated;
