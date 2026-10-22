-- ============================================================
-- Account deletion (PRELAUNCH_BACKLOG §7 E), decided with Andrew 2026-10-22.
--
-- A manager can take their record and leave. This migration adds the part the
-- user's own JWT client cannot do:
--
--   1. delete_my_account(): SECURITY DEFINER, keyed to auth.uid() and the
--      caller's org. Deletes every row the account owns, in foreign-key order,
--      then the organizations row, then the auth.users row. One transaction:
--      if any delete fails, nothing is deleted. It runs as the function owner
--      because RLS gives the JWT client no DELETE on organizations, users,
--      subscriptions, mission_control_*, manager_report_connections or
--      auth.users, and about 45 foreign keys to auth.users are NO ACTION, so
--      the login cannot go first and cascade the rest.
--      This keeps the service-role key out of the request path
--      (ENGINEERING.md: Security), the same way accept_direct_report_invite()
--      does.
--
--   2. deleted_accounts: a hashed-email tombstone. Deleting and signing up
--      again with the same email must not hand out a second founding place or
--      a fresh 14-day clock. Holds sha256(lower(email)), the clock the
--      account had, and whether it was comped. Nothing else: no name, no
--      org, no data. No RLS policies: only the two SECURITY DEFINER functions
--      below read or write it.
--
--   3. ensure_entitlement() replaced whole (body of 2026-09-29_founding_year.sql)
--      with one new branch: a returning email gets back the clock it left with,
--      and no founding number.
--
-- Storage objects (context-engine-docs) are removed by the backend through the
-- user's JWT before this function runs; current_org_id() is gone afterwards.
--
-- No backups exist on Supabase Free (Andrew, 2026-10-22): a deletion here is
-- final. The Settings confirmation says so.
--
-- Idempotent: safe to run twice.
-- ============================================================

create table if not exists deleted_accounts (
  email_hash     text primary key,          -- encode(sha256(lower(email)), 'hex')
  trial_ends_at  timestamptz,               -- the clock the account had when it left
  comped         boolean not null default false,
  deleted_at     timestamptz not null default now()
);

alter table deleted_accounts enable row level security;
revoke all on table deleted_accounts from anon, authenticated;


create or replace function public.account_email_hash(p_email text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(lower(trim(coalesce(p_email, ''))), 'UTF8')), 'hex');
$$;


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
      else
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


-- The checks delete_my_account() makes before it deletes anything, callable on
-- their own. The backend calls this first, before the HubSpot, PostHog and
-- Storage deletes it cannot take back, so a refusal costs nothing. It also
-- proves the migration ran and that the function owner may delete from
-- auth.users (owned by supabase_auth_admin on Supabase).
create or replace function public.account_deletion_preflight()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select org_id into v_org from users where id = v_uid;

  -- An org is one manager (ensure_org() makes one per sign-up). If another
  -- non-IC user ever shares it, stop rather than delete their record.
  if v_org is not null and exists (
    select 1 from users where org_id = v_org and id <> v_uid and role <> 'ic'
  ) then
    raise exception 'This organization has other managers; account deletion is not available for shared organizations';
  end if;

  if not has_table_privilege('auth.users', 'DELETE') then
    raise exception 'Account deletion is not available: the database cannot remove logins';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.account_deletion_preflight() from public, anon;
grant execute on function public.account_deletion_preflight() to authenticated;


-- Order matters only where a foreign key is NO ACTION; everything else
-- cascades. Each block names the parent whose cascade covers its children.
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
