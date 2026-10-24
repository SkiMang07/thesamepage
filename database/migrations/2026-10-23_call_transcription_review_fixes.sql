-- ============================================================
-- Call transcription, review fixes (2026-10-23)
--
-- Session 1b of docs/CALL_TRANSCRIPTION_BUILD_SCOPING.md, from the critical
-- review of the session 1 pipeline. Changes:
--   - add_transcription_seconds(): the allowance counts meeting time once.
--     Two tracks of the same 3-minute slot (seq) bill the slot once, at the
--     longer track's length. Per-track billed_seconds stays on each segment
--     for cost reporting.
--   - call_transcript_ids_for_report(): the report reads a transcript only
--     once the call has ended, never while it is being transcribed.
--   - call_transcripts.expected_seqs: the seqs the client sent, per track,
--     given on End. Ready waits for every one of them (a call tab added
--     mid-call starts at a later seq, so a single last_seq can't say this).
--   - one_on_ones.private_notes: notes typed while off the record. Manager
--     only (one_on_ones has no report policy). Never sent to the wrap-up.
--
-- Idempotent: safe to run twice. Run in the Supabase SQL editor AFTER
-- 2026-10-23_call_transcription.sql and before the push that ships the
-- matching routes/call_transcripts.py.
-- ============================================================

alter table call_transcripts
  add column if not exists expected_seqs jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'call_transcripts_expected_seqs_object'
  ) then
    alter table call_transcripts
      add constraint call_transcripts_expected_seqs_object
      check (expected_seqs is null or jsonb_typeof(expected_seqs) = 'object');
  end if;
end $$;

-- Off-the-record notes from the meeting screen. Kept apart from notes (the
-- call notes, which feed the wrap-up). Private to the writing manager.
alter table one_on_ones
  add column if not exists private_notes text;


-- The 1:1 transcripts the caller can read as the report: transcripts of 1:1s
-- whose direct_reports row is linked to their login, once the call has ended
-- (finishing with an end time, or ready). Never while recording, so the
-- report can't watch it grow or read it before the manager could delete an
-- accidental recording. A resumed call is hidden again until it ends.
-- SECURITY DEFINER so the policy never re-enters RLS on one_on_ones/
-- direct_reports. Keeps anon's EXECUTE for the reason current_org_id() does.
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
    and t.ended_at is not null
    and t.status in ('finishing', 'ready')
$$;


-- Bills one stored segment to the caller's month, once, counting meeting
-- time rather than tracks: the first track stored for a seq bills its
-- seconds; another track for the same seq adds only what it runs longer.
-- A two-track hour therefore uses one hour of the allowance. Idempotent: a
-- second call for the same segment adds nothing. The advisory lock makes two
-- tracks of one seq, billed at the same moment, see each other. Seconds come
-- from the segment rows the backend wrote, never from a parameter. Returns
-- the caller's seconds for the current UTC month after the call.
create or replace function public.add_transcription_seconds(p_segment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_tid   uuid;
  v_seq   integer;
  v_secs  integer;
  v_prev  integer;
  v_add   integer;
  v_total integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select transcript_id into v_tid
    from call_transcript_segments
   where id = p_segment_id and owner_id = v_uid;
  if v_tid is null then
    select seconds into v_total from transcription_usage
     where user_id = v_uid and month = v_month;
    return coalesce(v_total, 0);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('call_transcript_billing:' || v_tid::text, 0));

  update call_transcript_segments
     set billed_at = now()
   where id = p_segment_id
     and owner_id = v_uid
     and billed_at is null
  returning seq, billed_seconds into v_seq, v_secs;

  if found then
    select coalesce(max(billed_seconds), 0) into v_prev
      from call_transcript_segments
     where transcript_id = v_tid
       and seq = v_seq
       and id <> p_segment_id
       and billed_at is not null;
    v_add := greatest(coalesce(v_secs, 0) - v_prev, 0);
    if v_add > 0 then
      insert into transcription_usage (user_id, month, seconds, updated_at)
      values (v_uid, v_month, v_add, now())
      on conflict (user_id, month) do update
        set seconds    = transcription_usage.seconds + excluded.seconds,
            updated_at = now()
      returning seconds into v_total;
      return v_total;
    end if;
  end if;

  select seconds into v_total from transcription_usage
   where user_id = v_uid and month = v_month;
  return coalesce(v_total, 0);
end;
$$;
revoke all on function public.add_transcription_seconds(uuid) from public, anon;
grant execute on function public.add_transcription_seconds(uuid) to authenticated;
