-- ============================================================
-- Founding places: test accounts never take one, and freed places are reused.
-- Decided with Andrew 2026-10-22, before launch.
--
-- Two problems with the allocator in ensure_entitlement():
--
--   1. Test and persona sign-ups took founding places. Renata's reset took
--      #20 of 20, and 18 of the 20 numbers handed out so far went to test
--      accounts. test_account_patterns lists the email patterns that are
--      tests (Andrew's and Susie's plus-addresses). A matching sign-up gets
--      the founding year's clock, so a persona run sees what a founder sees,
--      but no number.
--
--   2. A place was max(founding_number) + 1, so clearing test accounts
--      freed nothing: with #16 still held, the next manager would be #17 and
--      only four places would be left. It is now the lowest free number in
--      1..20. A deleted account's tombstone still keeps that email from
--      claiming a place again (2026-10-22_account_deletion.sql).
--
-- ensure_entitlement() is replaced whole (body of 2026-10-22_account_deletion.sql)
-- with those two changes. No existing row changes here; the pre-launch
-- cleanup of test accounts is the separate one-off
-- backend/scripts/2026-10-22_prelaunch_account_cleanup.sql.
--
-- Idempotent: safe to run twice.
-- ============================================================

-- test_account_patterns: sign-ups whose email matches one of these (SQL LIKE,
-- lower-case) are test accounts. ensure_entitlement() gives them the founding
-- year's clock but never a founding place, so persona runs and resets can't
-- use up the 20. No RLS policies; edit it in the SQL editor.
create table if not exists test_account_patterns (
  pattern  text primary key check (pattern = lower(pattern)),
  note     text
);

alter table test_account_patterns enable row level security;
revoke all on table test_account_patterns from anon, authenticated;

insert into test_account_patterns (pattern, note) values
  ('andrewgodlew+%@gmail.com',   'Andrew''s persona and test sign-ups'),
  ('suzie.godlewski+%@gmail.com', 'Susie''s test sign-ups')
on conflict (pattern) do nothing;

create or replace function public.ensure_entitlement()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(coalesce(auth.email(), ''));
  v_role  text;
  v_sub   subscriptions%rowtype;
  v_next  integer;
  v_gone  deleted_accounts%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_sub from subscriptions where user_id = v_uid;

  if not found then
    select role into v_role from users where id = v_uid;
    if v_role = 'ic' or exists (
      select 1 from direct_report_invites
      where lower(invited_email) = v_email
        and accepted_at is null
        and expires_at > now()
    ) then
      return jsonb_build_object('status', 'ic', 'read_only', false,
        'founding_number', null, 'trial_ends_at', null);
    end if;

    -- One allocator at a time, so two simultaneous sign-ups can't both be #20.
    perform pg_advisory_xact_lock(hashtext('tsp_founding_places'));

    select * into v_sub from subscriptions where user_id = v_uid;
    if not found then
      -- A deleted account coming back: the clock it left with, no founding
      -- place, no fresh trial.
      select * into v_gone from deleted_accounts
        where email_hash = account_email_hash(v_email)
          and (comped or trial_ends_at is not null);

      if found then
        if v_gone.comped then
          insert into subscriptions (user_id, plan, status)
          values (v_uid, 'manager', 'active')
          returning * into v_sub;
        else
          insert into subscriptions (user_id, plan, status, trial_ends_at)
          values (v_uid, 'manager', 'trialing', v_gone.trial_ends_at)
          returning * into v_sub;
        end if;
      elsif exists (select 1 from test_account_patterns where v_email like pattern) then
        -- A test account: the founding year's clock, never a founding place.
        insert into subscriptions (user_id, plan, status, trial_ends_at)
        values (v_uid, 'manager', 'trialing', now() + interval '1 year')
        returning * into v_sub;
      else
        -- The lowest free place, so a place given up by a deleted account
        -- (or a test account cleared before launch) is handed out again.
        select min(n) into v_next
          from generate_series(1, 20) as n
          where not exists (select 1 from subscriptions where founding_number = n);

        if v_next is not null then
          insert into subscriptions (user_id, plan, status, founding_number, trial_ends_at)
          values (v_uid, 'manager', 'trialing', v_next, now() + interval '1 year')
          returning * into v_sub;
        else
          insert into subscriptions (user_id, plan, status, trial_ends_at)
          values (v_uid, 'manager', 'trialing', now() + interval '14 days')
          returning * into v_sub;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'status',          v_sub.status,
    'founding_number', v_sub.founding_number,
    'trial_ends_at',   v_sub.trial_ends_at,
    'read_only',       not (
                         v_sub.status = 'active'
                         or (v_sub.status = 'trialing' and v_sub.trial_ends_at > now())
                       )
  );
end;
$$;
revoke all on function public.ensure_entitlement() from public;
grant execute on function public.ensure_entitlement() to authenticated;
