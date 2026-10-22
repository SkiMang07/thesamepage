-- One-off, 2026-10-22: clear test accounts from production before launch.
-- Decided with Andrew: keep his account and Susie's (plus Susie's +1/+2/+3),
-- delete the Forkcast demo org (andrewcgodlewski@ and its four example.com
-- managers) and every andrewgodlew+ persona/test account.
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and run it once,
-- after database/migrations/2026-10-22_founding_places.sql. The last statement
-- prints the accounts that remain.
--
-- WHAT IT DOES, all in one transaction (any error and nothing changes):
--   1. Refuses if any account exists that is on neither list below, so a real
--      sign-up since this was written is never touched or misfiled.
--   2. Deletes each account on the delete list with delete_my_account(), the
--      same function behind Settings -> Delete my account: every row, the org,
--      the login, and a tombstone so the email can't reclaim a founding place.
--      The Forkcast org has five managers and that function refuses a shared
--      org, so the other members are detached from it first; they are all on
--      the delete list, and the org's rows go with the first one deleted.
--   3. Susie (suzie.godlewski@) becomes founding manager #1. Her +1/+2/+3 test
--      accounts become comped (active, no founding place, no clock).
--   4. Checks: 5 accounts left, and #1 is the only founding place in use.
--
-- NOT DONE HERE: Storage files those orgs uploaded stay in the bucket, and any
-- HubSpot contact or PostHog person for these test emails stays too.
--
-- There are no backups on Supabase Free. Deletion is final.

do $$
declare
  v_delete text[] := array[
    'andrewcgodlewski@gmail.com',
    'forkcast-support-manager@example.com',
    'forkcast-sales-manager@example.com',
    'forkcast-marketing-manager@example.com',
    'forkcast-product-manager@example.com',
    'andrewgodlew+test@gmail.com',
    'andrewgodlew+dana@gmail.com',
    'andrewgodlew+walt@gmail.com',
    'andrewgodlew+renata@gmail.com',
    'andrewgodlew+renata2@gmail.com',
    'andrewgodlew+renata3@gmail.com',
    'andrewgodlew+dayna2@gmail.com',
    'andrewgodlew+jamal@gmail.com',
    'andrewgodlew+dayna3@gmail.com',
    'andrewgodlew+theo@gmail.com',
    'andrewgodlew+susie@gmail.com'
  ];
  v_keep text[] := array[
    'andrewgodlew@gmail.com',
    'suzie.godlewski@gmail.com',
    'suzie.godlewski+1@gmail.com',
    'suzie.godlewski+2@gmail.com',
    'suzie.godlewski+3@gmail.com'
  ];
  v_founder text := 'suzie.godlewski@gmail.com';
  v_email text;
  v_uid   uuid;
  v_org   uuid;
  v_other text;
  v_left  integer;
  v_nums  integer[];
begin
  -- 1. Every account must be on one of the two lists.
  select string_agg(email, ', ') into v_other from auth.users
    where lower(email) <> all (v_delete || v_keep);
  if v_other is not null then
    raise exception 'Accounts on neither list (stop and decide): %', v_other;
  end if;

  -- 2. Delete.
  foreach v_email in array v_delete loop
    v_uid := null;
    select id into v_uid from auth.users where lower(email) = v_email;
    if v_uid is null then
      raise notice 'already gone: %', v_email;
      continue;
    end if;

    select org_id into v_org from users where id = v_uid;
    if v_org is not null then
      select string_agg(a.email, ', ') into v_other
        from users u join auth.users a on a.id = u.id
        where u.org_id = v_org and u.id <> v_uid and lower(a.email) <> all (v_delete);
      if v_other is not null then
        raise exception 'Org of % is shared with accounts not being deleted: %', v_email, v_other;
      end if;
      update users set org_id = null where org_id = v_org and id <> v_uid;
    end if;

    -- Act as this user for the length of the call (Supabase reads the JWT
    -- claims; the app.* pair is the local verify stub's equivalent).
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'email', v_email, 'role', 'authenticated')::text, true);
    perform set_config('app.current_user_id', v_uid::text, true);
    perform set_config('app.current_user_email', v_email, true);
    perform delete_my_account();
    raise notice 'deleted: %', v_email;
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.current_user_id', '', true);
  perform set_config('app.current_user_email', '', true);

  -- 3. Founding places among the keepers.
  update subscriptions s set founding_number = null, status = 'active',
         trial_ends_at = null, updated_at = now()
    from auth.users a
    where a.id = s.user_id and lower(a.email) like 'suzie.godlewski+%@gmail.com';
  update subscriptions s set founding_number = 1, updated_at = now()
    from auth.users a
    where a.id = s.user_id and lower(a.email) = v_founder;
  if not found then
    raise exception 'No subscription row for %', v_founder;
  end if;

  -- 4. Checks.
  select count(*) into v_left from auth.users;
  select array_agg(founding_number order by founding_number) into v_nums
    from subscriptions where founding_number is not null;
  if v_left <> 5 or v_nums is distinct from array[1] then
    raise exception 'Unexpected result: % accounts, founding numbers %', v_left, v_nums;
  end if;
end $$;

select a.email, s.founding_number, s.status, s.trial_ends_at::date as clock_ends,
       (select count(*) from direct_reports d where d.manager_id = a.id) as reports
from auth.users a left join subscriptions s on s.user_id = a.id
order by s.founding_number nulls last, a.email;
