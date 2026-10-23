-- ============================================================
-- Call transcription, server pipeline (2026-10-23)
--
-- Session 1 of docs/CALL_TRANSCRIPTION_BUILD_SCOPING.md. Adds:
--   - transcription_consent_at on direct_reports and outside_people
--   - call_transcripts, call_transcript_segments, call_transcript_gaps
--   - transcription_usage, written only by add_transcription_seconds()
--   - call_transcript_ids_for_report() + the report's read-only policies
--   - call_transcript_report_gaps() (gaps without kind, for the report)
--   - transcription_allowance_state() (names the tier; hours live in config.py)
--   - delete_my_account() re-created with a line for call_transcripts
--
-- Idempotent: safe to run twice. Run in the Supabase SQL editor before the
-- push that ships routes/call_transcripts.py.
-- ============================================================

-- -------------------------
-- CALL TRANSCRIPTION (2026-10-23)
-- Built-in meeting transcription with no bot: the manager's browser (later a
-- Mac helper) records 3-minute segments, one per track, posts each to
-- routes/call_transcripts.py, which transcribes it, stores the text and drops
-- the audio. Only text is ever kept. See docs/systems/call-transcription.md.
--
-- call_transcripts          one per recorded meeting (exactly one of the three
--                           meeting links). status is stored: it describes a
--                           running process, not a record state.
-- call_transcript_segments  one per transcribed track of a segment, keyed
--                           (transcript_id, seq, track) so a retried upload is
--                           a no-op. Immutable once written: no UPDATE grant,
--                           so billed_at can only be set by
--                           add_transcription_seconds().
-- call_transcript_gaps      paused, off-the-record and stopped intervals, in
--                           the same ms-offset timeline as the segments. A
--                           table rather than jsonb on call_transcripts on
--                           purpose: the report can read the transcript row,
--                           and `kind` must never reach them. They get gaps
--                           only through call_transcript_report_gaps(), which
--                           has no kind column.
-- transcription_usage       the allowance ledger, seconds per user per UTC
--                           month. No content. No FK to transcripts, so
--                           deleting a transcript never refunds hours. Users
--                           can read their rows; only
--                           add_transcription_seconds() writes them.
--
-- Speaker labels come from the track, never from voice: self = the manager's
-- mic, other = the call tab, mixed = mic only (in person).
-- -------------------------

alter table direct_reports add column if not exists transcription_consent_at timestamptz;
alter table outside_people add column if not exists transcription_consent_at timestamptz;

create table if not exists call_transcripts (
  id                   uuid primary key default uuid_generate_v4(),
  owner_id             uuid not null references auth.users(id) on delete cascade,
  org_id               uuid references organizations(id) on delete cascade,  -- nullable like one_on_ones
  one_on_one_id        uuid references one_on_ones(id) on delete cascade,
  team_meeting_id      uuid references team_meetings(id) on delete cascade,
  outside_meeting_id   uuid references outside_meetings(id) on delete cascade,
  capture_mode         text not null
                       check (capture_mode in ('tab', 'screen', 'mic_only', 'desktop')),
  consent_confirmed_at timestamptz not null,
  started_at           timestamptz not null default now(),
  ended_at             timestamptz,
  -- Offset (ms, the segments' timeline) of the last stop, so a resume can
  -- record the stopped time as a gap.
  ended_at_ms          integer check (ended_at_ms is null or ended_at_ms >= 0),
  ended_reason         text
                       check (ended_reason in ('manager', 'silence', 'max_length', 'share_ended', 'allowance')),
  -- Highest seq the client said it sent when it ended. Ready once every seq
  -- 0..last_seq has a stored segment.
  last_seq             integer check (last_seq is null or last_seq >= -1),
  status               text not null default 'recording'
                       check (status in ('recording', 'finishing', 'ready', 'failed')),
  -- A segment, pause, resume or end. A recording/finishing row idle for 30
  -- minutes is closed on the next read (routes/call_transcripts.py).
  last_activity_at     timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  constraint call_transcripts_one_meeting
    check (num_nonnulls(one_on_one_id, team_meeting_id, outside_meeting_id) = 1),
  constraint call_transcripts_id_owner_key unique (id, owner_id)
);

alter table call_transcripts enable row level security;

-- One running recording per manager. A stale one is closed before a start.
create unique index if not exists call_transcripts_one_recording_idx
  on call_transcripts (owner_id) where status = 'recording';
create index if not exists call_transcripts_one_on_one_idx
  on call_transcripts (one_on_one_id) where one_on_one_id is not null;
create index if not exists call_transcripts_team_meeting_idx
  on call_transcripts (team_meeting_id) where team_meeting_id is not null;
create index if not exists call_transcripts_outside_meeting_idx
  on call_transcripts (outside_meeting_id) where outside_meeting_id is not null;
create index if not exists call_transcripts_owner_idx
  on call_transcripts (owner_id, created_at desc);

create table if not exists call_transcript_segments (
  id              uuid primary key default uuid_generate_v4(),
  transcript_id   uuid not null,
  -- Denormalized so the policy never subqueries call_transcripts; the
  -- composite FK keeps it equal to the transcript's owner.
  owner_id        uuid not null,
  seq             integer not null check (seq >= 0),
  track           text not null check (track in ('self', 'other', 'mixed')),
  offset_ms       integer not null check (offset_ms >= 0),
  duration_ms     integer not null check (duration_ms between 0 and 600000),
  -- [{t_ms, text}], t_ms on the transcript's timeline, for interleaving.
  lines           jsonb not null default '[]'::jsonb
                  constraint call_transcript_segments_lines_array
                  check (jsonb_typeof(lines) = 'array'),
  billed_seconds  integer not null default 0 check (billed_seconds between 0 and 900),
  billed_at       timestamptz,
  created_at      timestamptz not null default now(),
  constraint call_transcript_segments_transcript_fkey
    foreign key (transcript_id, owner_id)
    references call_transcripts (id, owner_id) on delete cascade,
  constraint call_transcript_segments_seq_track_key unique (transcript_id, seq, track)
);

alter table call_transcript_segments enable row level security;

create table if not exists call_transcript_gaps (
  id             uuid primary key default uuid_generate_v4(),
  transcript_id  uuid not null,
  owner_id       uuid not null,
  kind           text not null check (kind in ('pause', 'off_record', 'stopped')),
  start_ms       integer not null check (start_ms >= 0),
  end_ms         integer,   -- null while the pause is still running
  created_at     timestamptz not null default now(),
  constraint call_transcript_gaps_order check (end_ms is null or end_ms >= start_ms),
  constraint call_transcript_gaps_transcript_fkey
    foreign key (transcript_id, owner_id)
    references call_transcripts (id, owner_id) on delete cascade
);

alter table call_transcript_gaps enable row level security;

create unique index if not exists call_transcript_gaps_one_open_idx
  on call_transcript_gaps (transcript_id) where end_ms is null;
create index if not exists call_transcript_gaps_transcript_idx
  on call_transcript_gaps (transcript_id, start_ms);

create table if not exists transcription_usage (
  user_id     uuid not null references auth.users(id) on delete cascade,
  month       date not null check (month = date_trunc('month', month)::date),  -- first of the month, UTC
  seconds     integer not null default 0 check (seconds >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, month)
);

alter table transcription_usage enable row level security;

-- The 1:1 transcripts the caller can read as the report: transcripts of 1:1s
-- whose direct_reports row is linked to their login. SECURITY DEFINER so the
-- policy below never re-enters RLS on one_on_ones/direct_reports (and never
-- touches users). Returns nothing for a signed-out caller, and keeps anon's
-- EXECUTE for the same reason current_org_id() does: policies run their
-- functions as the querying role, so revoking it would turn a signed-out read
-- into an error instead of zero rows.
create or replace function public.call_transcript_ids_for_report()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.id
  from call_transcripts t
  join one_on_ones o on o.id = t.one_on_one_id
  join direct_reports d on d.id = o.direct_report_id
  where auth.uid() is not null
    and d.user_id = auth.uid()
$$;

-- Gaps for a transcript the caller may read, without kind. The report's view
-- shows every gap as the same neutral "Not transcribed" line, so the column
-- that says which was off the record is not in this function's shape at all.
create or replace function public.call_transcript_report_gaps(p_transcript_id uuid)
returns table (start_ms integer, end_ms integer)
language sql
stable
security definer
set search_path = public
as $$
  select g.start_ms, g.end_ms
  from call_transcript_gaps g
  join call_transcripts t on t.id = g.transcript_id
  where g.transcript_id = p_transcript_id
    and auth.uid() is not null
    and (t.owner_id = auth.uid()
         or t.id in (select public.call_transcript_ids_for_report()))
  order by g.start_ms
$$;
revoke all on function public.call_transcript_report_gaps(uuid) from public, anon;
grant execute on function public.call_transcript_report_gaps(uuid) to authenticated;

-- Bills one stored segment to the caller's month, once. Idempotent: a second
-- call for the same segment (a retried upload) adds nothing. Seconds come
-- from the segment row the backend wrote, never from a parameter, so no
-- caller can pass a negative number to refund themselves. Returns the
-- caller's seconds for the current UTC month after the call.
create or replace function public.add_transcription_seconds(p_segment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_secs  integer;
  v_total integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  update call_transcript_segments
     set billed_at = now()
   where id = p_segment_id
     and owner_id = v_uid
     and billed_at is null
  returning billed_seconds into v_secs;

  if found and v_secs > 0 then
    insert into transcription_usage (user_id, month, seconds, updated_at)
    values (v_uid, v_month, v_secs, now())
    on conflict (user_id, month) do update
      set seconds    = transcription_usage.seconds + excluded.seconds,
          updated_at = now()
    returning seconds into v_total;
    return v_total;
  end if;

  select seconds into v_total from transcription_usage
   where user_id = v_uid and month = v_month;
  return coalesce(v_total, 0);
end;
$$;
revoke all on function public.add_transcription_seconds(uuid) from public, anon;
grant execute on function public.add_transcription_seconds(uuid) to authenticated;

-- Which allowance applies to the caller, and what they've used. The hours
-- themselves live in backend/config.py (TRANSCRIPTION_ALLOWANCES) so changing
-- them is a deploy, not a migration; this only names the tier. SECURITY
-- DEFINER because test_account_patterns is unreadable to users. The order
-- matters: read-only first, then paid/comped, founding, test, trial.
create or replace function public.transcription_allowance_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(coalesce(auth.email(), ''));
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_sub   subscriptions%rowtype;
  v_tier  text;
  v_month_secs integer;
  v_total_secs integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_sub from subscriptions where user_id = v_uid;

  if not found then
    v_tier := case when exists (select 1 from users where id = v_uid and role = 'ic')
                   then 'ic' else 'none' end;
  elsif not (v_sub.status = 'active'
             or (v_sub.status = 'trialing' and v_sub.trial_ends_at > now())) then
    v_tier := 'read_only';
  elsif v_sub.status = 'active' then
    v_tier := case when v_sub.stripe_subscription_id is null then 'comped' else 'paid' end;
  elsif v_sub.founding_number is not null then
    v_tier := 'founding';
  elsif exists (select 1 from test_account_patterns where v_email like pattern) then
    v_tier := 'test';
  else
    v_tier := 'trial';
  end if;

  select coalesce(sum(seconds) filter (where month = v_month), 0),
         coalesce(sum(seconds), 0)
    into v_month_secs, v_total_secs
    from transcription_usage
   where user_id = v_uid;

  return jsonb_build_object(
    'tier',          v_tier,
    'month',         v_month,
    'month_seconds', v_month_secs,
    'total_seconds', v_total_secs
  );
end;
$$;
revoke all on function public.transcription_allowance_state() from public, anon;
grant execute on function public.transcription_allowance_state() to authenticated;

-- Policies. Owner-scoped like one_on_ones.notes; the report gets SELECT only,
-- on their own 1:1 transcripts, through the helper above.
drop policy if exists "call_transcripts_all_own" on call_transcripts;
create policy "call_transcripts_all_own" on call_transcripts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "call_transcripts_select_as_report" on call_transcripts;
create policy "call_transcripts_select_as_report" on call_transcripts
  for select using (id in (select public.call_transcript_ids_for_report()));

drop policy if exists "call_transcript_segments_select_own" on call_transcript_segments;
create policy "call_transcript_segments_select_own" on call_transcript_segments
  for select using (owner_id = auth.uid());

drop policy if exists "call_transcript_segments_insert_own" on call_transcript_segments;
create policy "call_transcript_segments_insert_own" on call_transcript_segments
  for insert with check (owner_id = auth.uid() and billed_at is null);

drop policy if exists "call_transcript_segments_delete_own" on call_transcript_segments;
create policy "call_transcript_segments_delete_own" on call_transcript_segments
  for delete using (owner_id = auth.uid());

drop policy if exists "call_transcript_segments_select_as_report" on call_transcript_segments;
create policy "call_transcript_segments_select_as_report" on call_transcript_segments
  for select using (transcript_id in (select public.call_transcript_ids_for_report()));

drop policy if exists "call_transcript_gaps_all_own" on call_transcript_gaps;
create policy "call_transcript_gaps_all_own" on call_transcript_gaps
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "transcription_usage_select_own" on transcription_usage;
create policy "transcription_usage_select_own" on transcription_usage
  for select using (user_id = auth.uid());

-- Segments are immutable to users (billed_at is the billing guard), and the
-- usage ledger is written only by add_transcription_seconds(). Revoke by name:
-- Supabase's default privileges grant every new table to anon and
-- authenticated directly.
revoke update on table call_transcript_segments from anon, authenticated;
revoke insert, update, delete, truncate on table transcription_usage from anon, authenticated;


-- delete_my_account(): unchanged except the call_transcripts line.
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_org   uuid;
  v_sub   subscriptions%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  perform account_deletion_preflight();

  select email into v_email from auth.users where id = v_uid;
  select org_id into v_org from users where id = v_uid;

  -- Beyond the team (owner-keyed; series/people are NO ACTION parents).
  delete from outside_suggestions      where owner_id = v_uid;
  delete from outside_suggestion_runs  where owner_id = v_uid;
  delete from outside_meeting_links    where owner_id = v_uid;
  delete from outside_meeting_people   where owner_id = v_uid;
  delete from outside_meetings         where owner_id = v_uid or org_id = v_org;
  delete from outside_meeting_series   where owner_id = v_uid;
  delete from outside_people           where owner_id = v_uid or org_id = v_org;

  -- Team surfaces (agenda items cascade from meetings).
  delete from team_meeting_agenda_items where manager_id = v_uid;
  delete from team_meetings             where manager_id = v_uid;
  delete from team_meeting_series       where manager_id = v_uid;
  delete from team_callouts             where manager_id = v_uid;
  delete from team_dev_focus            where manager_id = v_uid;
  delete from team_messages             where manager_id = v_uid;

  -- Manager-keyed records (dev_plan_* cascade from development_plans,
  -- away_period_shifts from away_periods).
  delete from assistant_messages         where manager_id = v_uid;
  delete from away_period_shifts         where manager_id = v_uid;
  delete from away_periods               where manager_id = v_uid;
  delete from dr_capture_notes           where manager_id = v_uid;
  delete from career_conversations       where manager_id = v_uid;
  delete from development_plans          where manager_id = v_uid;
  delete from assessments                where manager_id = v_uid;
  delete from direct_report_invites      where manager_id = v_uid;
  delete from manager_report_connections where manager_id = v_uid;

  -- Knowledge (scopes and citations cascade from documents).
  delete from document_citations where cited_by = v_uid;
  delete from documents          where org_id = v_org or uploaded_by = v_uid;
  delete from document_series    where org_id = v_org;

  -- Role expectations (decisions point at drafts with NO ACTION).
  delete from role_expectation_decisions where org_id = v_org or created_by = v_uid;
  delete from role_expectation_drafts    where org_id = v_org or created_by = v_uid or approved_by = v_uid;

  -- Work: projects (check_ins, follow-throughs cascade), then goals in one
  -- statement so the parent_goal_id self-reference resolves, then the rest.
  delete from check_ins    where owner_id = v_uid;
  delete from projects     where org_id = v_org or owner_id = v_uid;
  delete from goals        where org_id = v_org or owner_id = v_uid;
  delete from commitments  where org_id = v_org or owner_id = v_uid;

  -- Call transcripts (segments and gaps cascade). The usage ledger is
  -- keyed to the login and goes with it below.
  delete from call_transcripts where owner_id = v_uid;

  -- 1:1s before their series (NO ACTION), reviews before configs.
  delete from one_on_ones          where org_id = v_org or manager_id = v_uid;
  delete from one_on_one_series    where manager_id = v_uid;
  delete from metric_entries       where recorded_by = v_uid;
  delete from skill_assessments    where assessed_by = v_uid;
  delete from value_assessments    where assessed_by = v_uid;
  delete from performance_reviews  where org_id = v_org or manager_id = v_uid;

  -- People. Cascades capacity_profiles, time_off_entries and every
  -- per-person child not already gone.
  delete from direct_reports where org_id = v_org or manager_id = v_uid;
  -- If this login was itself someone's linked report elsewhere, unlink it.
  update direct_reports set user_id = null where user_id = v_uid;
  update users set manager_id = null where manager_id = v_uid;

  -- The org: cascades role ladders, expectation configs and their scales,
  -- org_units, capacity settings, work units, assessment levels.
  if v_org is not null then
    delete from organizations where id = v_org;
  end if;

  -- Tombstone, so the same email can't reclaim a founding place or a fresh trial.
  -- Only an account that had a clock leaves one behind: an IC, or a manager
  -- who never loaded the app shell, gets the normal allocation on return.
  select * into v_sub from subscriptions where user_id = v_uid;
  if found and v_email is not null and length(trim(v_email)) > 0
     and (v_sub.trial_ends_at is not null or v_sub.status = 'active') then
    insert into deleted_accounts (email_hash, trial_ends_at, comped)
    values (
      account_email_hash(v_email),
      v_sub.trial_ends_at,
      coalesce(v_sub.status = 'active' and v_sub.stripe_subscription_id is null, false)
    )
    on conflict (email_hash) do update
      set trial_ends_at = excluded.trial_ends_at,
          comped        = excluded.comped,
          deleted_at    = now();
  end if;

  -- The login. Cascades users, subscriptions, ai_jobs, mission_control_*,
  -- project_follow_throughs.
  delete from auth.users where id = v_uid;

  return jsonb_build_object('deleted', true);
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
