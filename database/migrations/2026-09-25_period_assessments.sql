-- ============================================================
-- Period assessments (2026-09-25) — docs/systems/assessments.md
--
-- Activates the dormant performance_reviews table as the period assessment:
-- one row per manager-scoped assessment of one direct report over an explicit
-- period (quarterly, biannual or off-cycle). It carries the resumable draft
-- (gathered evidence, the AI picture, manager context, per-item proposals and
-- decisions, the assessment conversation) and, once the manager completes it,
-- a frozen completion snapshot that keeps the expectation wording, scale
-- meaning and evidence used at the time.
--
-- 1. performance_reviews gains period, cadence, status/stage, draft state,
--    completion snapshot, an optimistic-lock version and a completion
--    request id. reviewed_at becomes nullable (a draft has not been reviewed);
--    review_period stays required and holds the readable period label.
--    Pre-existing rows (the table was dormant) are marked completed.
--    At most one open draft per manager and report.
--
-- 2. skill_assessments / value_assessments / metric_entries gain
--    performance_review_id so confirmed item ratings trace back to the
--    assessment that recorded them. The overall rating keeps using
--    assessments.source_type = 'performance_review' + source_id, which the
--    table has allowed since the original scaffold. metric_entries gains
--    notes, so a metric reading's stated source is no longer dropped.
--
-- 3. complete_performance_review(): the only completion path. Writes the
--    confirmed overall/skill/value/metric rows and marks the assessment
--    completed in ONE transaction. A second call for an already completed
--    assessment returns it unchanged, so a retried submit never duplicates
--    rating rows, and a failure part way writes nothing. The caller passes
--    the draft version it reviewed; any change since then is refused.
--
-- Additive only and safe to re-run. Latest-rating readers (GET /api/assessments, scorecard,
-- person page, Mission Control, Scribe, development suggestions) keep reading
-- the same tables. Run before deploying the backend that calls the function.
-- ============================================================

-- 1. performance_reviews -------------------------------------------------------

alter table performance_reviews
  add column if not exists cadence text
    check (cadence in ('quarterly', 'biannual', 'off_cycle')),
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists status text,
  add column if not exists stage text not null default 'picture'
    check (stage in ('picture', 'draft', 'review', 'completed')),
  add column if not exists mode text not null default 'ai'
    check (mode in ('ai', 'manual')),
  add column if not exists include_private boolean not null default false,
  add column if not exists evidence jsonb,
  add column if not exists picture jsonb,
  add column if not exists manager_context text,
  add column if not exists excluded_evidence jsonb not null default '[]'::jsonb,
  add column if not exists draft jsonb not null default '{}'::jsonb,
  add column if not exists conversation jsonb not null default '[]'::jsonb,
  add column if not exists completed_snapshot jsonb,
  add column if not exists version integer not null default 0,
  add column if not exists completion_request_id uuid,
  add column if not exists completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update performance_reviews set status = 'completed' where status is null;

alter table performance_reviews
  alter column status set default 'draft',
  alter column status set not null,
  alter column reviewed_at drop not null;

alter table performance_reviews
  drop constraint if exists performance_reviews_status_check,
  drop constraint if exists performance_reviews_period_order,
  drop constraint if exists performance_reviews_conversation_array,
  drop constraint if exists performance_reviews_excluded_array,
  add constraint performance_reviews_status_check
    check (status in ('draft', 'completed')),
  add constraint performance_reviews_period_order
    check (period_start is null or period_end is null or period_end >= period_start),
  add constraint performance_reviews_conversation_array
    check (jsonb_typeof(conversation) = 'array'),
  add constraint performance_reviews_excluded_array
    check (jsonb_typeof(excluded_evidence) = 'array');

create unique index if not exists performance_reviews_one_open_draft
  on performance_reviews (manager_id, direct_report_id)
  where status = 'draft';

create index if not exists performance_reviews_report_idx
  on performance_reviews (manager_id, direct_report_id, completed_at desc);

-- 2. provenance on item ratings -----------------------------------------------

alter table skill_assessments
  add column if not exists performance_review_id uuid references performance_reviews(id) on delete set null;
alter table value_assessments
  add column if not exists performance_review_id uuid references performance_reviews(id) on delete set null;
alter table metric_entries
  add column if not exists performance_review_id uuid references performance_reviews(id) on delete set null,
  add column if not exists notes text;

create index if not exists skill_assessments_review_idx on skill_assessments (performance_review_id)
  where performance_review_id is not null;
create index if not exists value_assessments_review_idx on value_assessments (performance_review_id)
  where performance_review_id is not null;
create index if not exists metric_entries_review_idx on metric_entries (performance_review_id)
  where performance_review_id is not null;

-- 3. completion ----------------------------------------------------------------

create or replace function public.complete_performance_review(
  p_review_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_client_request_id uuid default null
)
returns setof performance_reviews
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_review performance_reviews%rowtype;
  v_item jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_review from performance_reviews
    where id = p_review_id and manager_id = v_uid
    for update;
  if not found then
    raise exception 'Assessment not found' using errcode = 'P0002';
  end if;

  -- Retry-safe: a completed assessment is returned as it is, never re-written.
  if v_review.status = 'completed' then
    return next v_review;
    return;
  end if;

  if p_expected_version is distinct from v_review.version then
    raise exception 'This assessment changed after it was reviewed' using errcode = '40001';
  end if;

  if p_payload ? 'overall' and jsonb_typeof(p_payload->'overall') = 'object' then
    if (p_payload->'overall'->>'level_ordinal') is null
       or (p_payload->'overall'->>'level_ordinal')::int not between 1 and 5 then
      raise exception 'Overall judgment is outside the level scale' using errcode = '22023';
    end if;
    insert into assessments (manager_id, direct_report_id, level_ordinal, notes, source_type, source_id)
    values (v_uid, v_review.direct_report_id, (p_payload->'overall'->>'level_ordinal')::int,
            nullif(btrim(p_payload->'overall'->>'notes'), ''), 'performance_review', v_review.id);
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'skills', '[]'::jsonb)) loop
    if (v_item->>'evaluation_point') is null then
      raise exception 'A confirmed skill judgment needs a scale point' using errcode = '22023';
    end if;
    insert into skill_assessments (direct_report_id, skill_config_id, evaluation_point, notes, assessed_by, performance_review_id)
    values (v_review.direct_report_id, (v_item->>'config_id')::uuid, (v_item->>'evaluation_point')::int,
            nullif(btrim(v_item->>'notes'), ''), v_uid, v_review.id);
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'values', '[]'::jsonb)) loop
    if (v_item->>'evaluation_point') is null then
      raise exception 'A confirmed value judgment needs a scale point' using errcode = '22023';
    end if;
    insert into value_assessments (direct_report_id, value_config_id, evaluation_point, notes, assessed_by, performance_review_id)
    values (v_review.direct_report_id, (v_item->>'config_id')::uuid, (v_item->>'evaluation_point')::int,
            nullif(btrim(v_item->>'notes'), ''), v_uid, v_review.id);
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'metrics', '[]'::jsonb)) loop
    if (v_item->>'value') is null or nullif(btrim(v_item->>'period'), '') is null then
      raise exception 'A metric reading needs a value and its measurement period' using errcode = '22023';
    end if;
    if (v_item->>'value')::numeric in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'A metric reading must be a finite number' using errcode = '22023';
    end if;
    insert into metric_entries (direct_report_id, metric_config_id, value, period, notes, recorded_by, performance_review_id)
    values (v_review.direct_report_id, (v_item->>'config_id')::uuid, (v_item->>'value')::numeric,
            btrim(v_item->>'period'), nullif(btrim(v_item->>'notes'), ''), v_uid, v_review.id);
  end loop;

  update performance_reviews
     set status = 'completed',
         stage = 'completed',
         completed_at = now(),
         reviewed_at = current_date,
         rating_ordinal = case when jsonb_typeof(p_payload->'overall') = 'object'
                               then (p_payload->'overall'->>'level_ordinal')::int end,
         summary = nullif(btrim(p_payload->>'summary'), ''),
         completed_snapshot = p_payload->'snapshot',
         completion_request_id = p_client_request_id,
         is_shared_with_report = false,
         version = version + 1,
         updated_at = now()
   where id = v_review.id
   returning * into v_review;

  return next v_review;
end;
$$;

revoke all on function public.complete_performance_review(uuid, integer, jsonb, uuid) from public;
grant execute on function public.complete_performance_review(uuid, integer, jsonb, uuid) to authenticated;
