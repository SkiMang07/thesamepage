-- ============================================================
-- Founding places and the free clock (PRELAUNCH_BACKLOG §7 B, P0-1).
--
-- Decided 2026-09-24: managers 1-20 get 90 days free, manager 21 onward
-- gets 14 days, and when the clock runs out the account is read-only
-- (the backend refuses writes with 402) until they pay. Stripe comes later
-- and writes the same row.
--
-- Activates the dormant `subscriptions` table instead of adding a plan
-- column to organizations or users: both of those have update-own RLS
-- policies, so a plan column there would be editable by the user it gates.
-- subscriptions is select-only to its owner; the only writers are this
-- SECURITY DEFINER function and, later, the Stripe webhook.
--
-- ensure_entitlement() is called with the user's own JWT (no service-role
-- on the request path). It only ever touches auth.uid()'s row, and it
-- computes every value itself, so the caller controls nothing but timing.
-- Invited direct reports (role 'ic', or holding a pending invite for their
-- email) never get a row and never take a founding place.
-- ============================================================

alter table subscriptions
  add column if not exists founding_number integer unique
    check (founding_number between 1 and 20),
  add column if not exists trial_ends_at   timestamptz,
  add column if not exists created_at      timestamptz not null default now();

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
        values (v_uid, 'manager', 'trialing', v_next, now() + interval '90 days')
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

-- Everyone who already has a manager account (Andrew's, test accounts) is
-- comped: active, no clock, and not counted toward the 20.
insert into subscriptions (user_id, plan, status)
select u.id, 'manager', 'active'
from users u
where u.role <> 'ic'
  and not exists (select 1 from subscriptions s where s.user_id = u.id)
on conflict (user_id) do nothing;
