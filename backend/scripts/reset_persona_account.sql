-- Reset a Digital Customers persona account to a brand-new user (or delete it).
--
-- HOW TO RUN
--   1. Edit the two values in the first statement below (email, delete_login).
--   2. Paste the whole file into the Supabase SQL editor and run it once.
--   3. Read the one-row result at the bottom: every count must be 0.
--
--   delete_login = false (default)  Wipe everything the persona owns and drop
--       their organization, but KEEP the auth.users row. Same email and password
--       still work; the next sign-in hits first-run onboarding.
--   delete_login = true             Do the same wipe, then also delete the
--       auth.users row (and the public.users row that cascades from it). Frees
--       the email so sign-up can be tested again. The password is gone with it.
--
-- SAFETY
--   - Refuses unless the email is plus-tagged (name+tag@...), so it can never be
--     pointed at a primary address by a typo.
--   - Refuses unless the email resolves to exactly one auth user, and the user's
--     organization has no other members.
--   - After the wipe it checks every foreign key into auth.users / public.users
--     for leftover rows. Anything left (a new table this script doesn't know
--     about, a row in someone else's org) raises, and the whole run rolls back.
--     Nothing is half-deleted.
--   - Files the persona uploaded to Storage are not removed.
--
-- KEEPING IT CURRENT
--   The delete order below is reverse FK dependency, generated from
--   database/schema.sql. backend/tests/test_reset_persona_script.py fails if the
--   schema gains a table this script doesn't delete from. Add the line, in
--   child-before-parent order, then rerun the test.

select
  set_config('tsp.reset_email',  'andrewgodlew+renata3@gmail.com', false),
  set_config('tsp.delete_login', 'false', false);  -- 'true' also deletes the login

do $$
declare
  v_email        text    := lower(current_setting('tsp.reset_email', true));
  v_delete_login boolean := coalesce(nullif(current_setting('tsp.delete_login', true), ''), 'false')::boolean;
  v_uid          uuid;
  v_org          uuid;
  v_n            int;
  v_left         text := '';
  r              record;
begin
  if coalesce(v_email, '') = '' then
    raise exception 'No email set. Run the select above and the DO block in the same run.';
  end if;
  if position('+' in v_email) = 0 then
    raise exception '% is not plus-tagged. Refusing: this script is for test personas only.', v_email;
  end if;

  select count(*) into v_n from auth.users where lower(email) = v_email;
  if v_n <> 1 then
    raise exception '% auth users match %. Need exactly 1. Nothing was deleted.', v_n, v_email;
  end if;
  select id into v_uid from auth.users where lower(email) = v_email;

  select org_id into v_org from public.users where id = v_uid;

  if v_org is not null then
    select count(*) into v_n from public.users where org_id = v_org and id <> v_uid;
    if v_n > 0 then
      raise exception 'Org % is shared with % other user(s). Refusing to delete.', v_org, v_n;
    end if;
  end if;

  raise notice 'Resetting % (uid %, org %, delete_login %)', v_email, v_uid, coalesce(v_org::text, 'none'), v_delete_login;
  perform set_config('tsp.reset_uid', v_uid::text, false);

  delete from manager_report_connections where manager_id = v_uid;
  delete from away_period_shifts where manager_id = v_uid;
  delete from dr_capture_notes where manager_id = v_uid;
  delete from assessment_levels where org_id = v_org;
  delete from assessments where manager_id = v_uid;
  delete from metric_scale_definitions where metric_config_id in (select id from metric_configs where org_id = v_org);
  delete from metric_entries where direct_report_id in (select id from direct_reports where manager_id = v_uid);
  delete from skill_scale_definitions where skill_config_id in (select id from skill_configs where org_id = v_org);
  delete from skill_assessments where direct_report_id in (select id from direct_reports where manager_id = v_uid);
  delete from value_scale_definitions where value_config_id in (select id from value_configs where org_id = v_org);
  delete from value_assessments where direct_report_id in (select id from direct_reports where manager_id = v_uid);
  delete from role_expectation_decisions where created_by = v_uid;
  delete from check_ins where owner_id = v_uid;
  delete from project_follow_throughs where owner_id = v_uid;
  delete from team_messages where manager_id = v_uid;
  delete from assistant_messages where manager_id = v_uid;
  delete from mission_control_events where manager_id = v_uid;
  delete from mission_control_morning_lines where manager_id = v_uid;
  delete from direct_report_invites where manager_id = v_uid;
  delete from team_meeting_agenda_items where manager_id = v_uid;
  delete from team_callouts where manager_id = v_uid;
  delete from capacity_settings where org_id = v_org;
  delete from capacity_profiles where direct_report_id in (select id from direct_reports where manager_id = v_uid);
  delete from time_off_entries where direct_report_id in (select id from direct_reports where manager_id = v_uid);
  delete from work_unit_configs where org_id = v_org;
  delete from dev_plan_aspirations where development_plan_id in (select id from development_plans where manager_id = v_uid);
  delete from dev_plan_opportunities where development_plan_id in (select id from development_plans where manager_id = v_uid);
  delete from dev_plan_training where development_plan_id in (select id from development_plans where manager_id = v_uid);
  delete from dev_plan_manager_notes where development_plan_id in (select id from development_plans where manager_id = v_uid);
  delete from team_dev_focus where manager_id = v_uid;
  delete from subscriptions where user_id = v_uid;
  delete from document_scopes where document_id in (select id from documents where org_id = v_org);
  delete from document_citations where document_id in (select id from documents where org_id = v_org);
  delete from outside_meeting_people where owner_id = v_uid;
  delete from outside_suggestions where owner_id = v_uid;
  delete from outside_suggestion_runs where owner_id = v_uid;
  delete from ai_jobs where manager_id = v_uid;
  delete from career_conversations where manager_id = v_uid;
  delete from one_on_ones where manager_id = v_uid;
  delete from commitments where owner_id = v_uid;
  delete from away_periods where manager_id = v_uid;
  delete from performance_reviews where manager_id = v_uid;
  delete from metric_configs where org_id = v_org;
  delete from skill_configs where org_id = v_org;
  delete from value_configs where org_id = v_org;
  delete from role_expectation_drafts where created_by = v_uid;
  delete from team_meetings where manager_id = v_uid;
  delete from development_plans where manager_id = v_uid;
  delete from documents where org_id = v_org;
  delete from outside_meeting_links where owner_id = v_uid;
  delete from one_on_one_series where manager_id = v_uid;
  delete from projects where owner_id = v_uid;
  delete from team_meeting_series where manager_id = v_uid;
  delete from document_series where org_id = v_org;
  delete from outside_meetings where owner_id = v_uid;
  delete from goals where owner_id = v_uid;
  delete from outside_meeting_series where owner_id = v_uid;
  delete from direct_reports where manager_id = v_uid;
  delete from outside_people where owner_id = v_uid;
  delete from role_levels where org_id = v_org;
  delete from org_units where org_id = v_org;
  delete from role_families where org_id = v_org;

  -- Backstop: any FK into auth.users or public.users that still points at this
  -- user means the list above is stale. Fail now, roll everything back.
  for r in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace  -- auth.* and storage.* are Supabase's; they cascade themselves
      and c.confrelid in ('auth.users'::regclass, 'public.users'::regclass)
      and c.confdeltype <> 'n'                      -- ON DELETE SET NULL can't block
      and array_length(c.conkey, 1) = 1
      and not (c.conrelid = 'public.users'::regclass and a.attname = 'id')
  loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into v_n using v_uid;
    if v_n > 0 then
      v_left := v_left || format(' %s.%s (%s rows)', r.tbl, r.col, v_n);
    end if;
  end loop;
  if v_left <> '' then
    raise exception 'Rows still reference % after the wipe:%. Rolled back. Add the missing table(s) to this script, or clear the foreign row.', v_email, v_left;
  end if;

  -- Unlink before dropping the org, so the users row survives the cascade and
  -- the same login keeps working. ensure_org() builds a fresh org on first write.
  update public.users set
    org_id = null,
    set_up_at = null,
    onboarded_at = null,
    setup_org_at = null,
    setup_expectations_at = null,
    setup_goals_at = null,
    org_goals_unknown_at = null,
    setup_intro_seen_at = null,
    setup_receipt_seen_at = null,
    setup_card_dismissals = 0,
    setup_card_snoozed_until = null,
    setup_skipped_steps = '{}',
    knowledge_skipped_at = null
  where id = v_uid;

  delete from organizations where id = v_org;

  if v_delete_login then
    -- public.users cascades from auth.users; auth.identities and sessions too.
    delete from auth.users where id = v_uid;
    raise notice 'Done. Login deleted. % can sign up again from scratch.', v_email;
  else
    raise notice 'Done. Sign in as % and the app starts at first-run setup.', v_email;
  end if;
end $$;

-- Confirm: every count must be 0. With delete_login = false, login_rows is 1 and
-- org_id / set_up_at are null. With delete_login = true, login_rows is 0.
select
  current_setting('tsp.reset_email') as email,
  (select count(*) from auth.users where lower(email) = current_setting('tsp.reset_email')) as login_rows,
  (select count(*) from direct_reports      where manager_id = current_setting('tsp.reset_uid')::uuid) as people,
  (select count(*) from goals               where owner_id   = current_setting('tsp.reset_uid')::uuid) as goals,
  (select count(*) from projects            where owner_id   = current_setting('tsp.reset_uid')::uuid) as projects,
  (select count(*) from one_on_ones         where manager_id = current_setting('tsp.reset_uid')::uuid) as one_on_ones,
  (select count(*) from commitments         where owner_id   = current_setting('tsp.reset_uid')::uuid) as commitments,
  (select count(*) from role_expectation_drafts where created_by = current_setting('tsp.reset_uid')::uuid) as drafts,
  (select count(*) from subscriptions       where user_id    = current_setting('tsp.reset_uid')::uuid) as subscriptions,
  (select org_id from public.users where id = current_setting('tsp.reset_uid')::uuid) as org_id,
  (select set_up_at from public.users where id = current_setting('tsp.reset_uid')::uuid) as set_up_at,
  (select setup_skipped_steps from public.users where id = current_setting('tsp.reset_uid')::uuid) as setup_skipped_steps;
