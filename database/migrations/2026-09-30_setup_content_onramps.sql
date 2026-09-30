-- ============================================================
-- Setup mode, chunk C: content on-ramps
-- (docs/design-proposals/2026-09-29-onboarding-path/CHUNK_C_PLAN.md)
--
--   goals.period_label   the period an org goal covers, as the manager's
--                        words ("FY26", "Q4 2026"). goals.due_date stays the
--                        period end when there is one.
--   goals.set_by         who set the goal ("CEO", "board deck"). Free text,
--                        the manager's words; not a user reference.
--   goals.confirmed_on   the last day the manager said this org goal is still
--                        current. Drives the quarterly "Still current?" line.
--   users.org_goals_unknown_at
--                        the manager answered "Don't know yet" on org goals.
--                        Parks the goals step; it does not complete it. Cleared
--                        when an org-level goal is added. Becomes an agenda item
--                        for the first meeting with their boss.
--   metric_configs.data_source
--                        where a numeric expectation's number lives ("CRM
--                        report, weekly"). The manager's words. Carried from the
--                        draft item by approve_role_expectation_draft(), which
--                        also folds an optional draft "example" into the
--                        description as a final "Example: ..." line.
--
-- Everything is nullable and nothing is backfilled. Idempotent: safe to run
-- twice (create or replace on the function).
-- ============================================================

alter table goals add column if not exists period_label text;
alter table goals add column if not exists set_by text;
alter table goals add column if not exists confirmed_on date;
alter table users add column if not exists org_goals_unknown_at timestamptz;
alter table metric_configs add column if not exists data_source text;

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
               description = nullif(btrim(coalesce(v_item->>'responsibility', '') || case when nullif(btrim(coalesce(v_item->>'example', '')), '') is not null then E'\nExample: ' || btrim(v_item->>'example') else '' end), ''),
               expectation = nullif(btrim(coalesce(v_item->>'meets', '')), ''),
               exceeds = nullif(btrim(coalesce(v_item->>'exceeds', '')), ''),
               order_type = nullif(v_item->>'order_type', ''),
               data_source = nullif(btrim(coalesce(v_item->>'data_source', '')), ''),
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
                                    order_type, data_source, measurement_period, target, target_status, target_source, target_quote)
        values (v_draft.org_id, v_draft.role_level_id, v_name,
                nullif(btrim(coalesce(v_item->>'responsibility', '') || case when nullif(btrim(coalesce(v_item->>'example', '')), '') is not null then E'\nExample: ' || btrim(v_item->>'example') else '' end), ''),
                nullif(btrim(coalesce(v_item->>'meets', '')), ''),
                nullif(btrim(coalesce(v_item->>'exceeds', '')), ''),
                nullif(v_item->>'order_type', ''),
                nullif(btrim(coalesce(v_item->>'data_source', '')), ''),
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
