-- ============================================================
-- Founding places: a year free, not 90 days (decided by Andrew 2026-09-27).
--
-- The first 20 managers get The Same Page free for a year as beta users;
-- manager 21 onward still gets 14 days. Only the founding interval changes:
-- ensure_entitlement() is replaced whole (same body as
-- 2026-09-24_founding_entitlement.sql apart from that one interval), and any
-- founding row already handed out is moved to a year from when it started.
-- Idempotent: safe to run twice.
-- ============================================================

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
      select coalesce(max(founding_number), 0) + 1 into v_next
        from subscriptions where founding_number is not null;

      if v_next <= 20 then
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

update subscriptions
   set trial_ends_at = created_at + interval '1 year'
 where founding_number is not null
   and status = 'trialing'
   and trial_ends_at is distinct from created_at + interval '1 year';
