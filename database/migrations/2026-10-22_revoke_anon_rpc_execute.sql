-- Signed-out callers can no longer execute the app's RPC functions.
--
-- Found by the 2026-10-22 schema drift check (production grants vs schema.sql).
--
-- schema.sql grants these functions to `authenticated` only, after a
-- `revoke all ... from public`. On Supabase that revoke is not enough: the
-- platform's default privileges grant EXECUTE on every new function in
-- `public` directly to `anon`, and revoking from PUBLIC leaves that explicit
-- grant in place. Production confirmed it: `anon` could execute all eleven
-- below. Each one checks auth.uid() or filters through led_org_unit_ids(), so
-- a signed-out call returned nothing or raised; no data was exposed. This
-- makes the database enforce what schema.sql already says, the same
-- `from public, anon` pattern account_deletion_preflight() and
-- delete_my_account() use.
--
-- Deliberately left executable by anon:
--   get_invite_preview(text)  the invite page calls it before sign-in.
--   current_org_id()          40 RLS policies call it, and a policy's
--                             functions are checked as the querying role,
--                             so revoking would turn a signed-out read into
--                             a permission error instead of zero rows. It
--                             returns null for anon.
--   handle_new_user()         a trigger function; it cannot be called
--                             directly, only fired by the auth.users trigger.
--
-- Run in the Supabase SQL editor. schema.sql already matches. Safe to re-run.

revoke execute on function public.led_org_unit_ids() from anon;
revoke execute on function public.org_unit_capacity_rollup(date, date) from anon;
revoke execute on function public.org_unit_goals_rollup() from anon;
revoke execute on function public.org_unit_projects_rollup() from anon;
revoke execute on function public.org_unit_people_rollup() from anon;
revoke execute on function public.record_goal_check_in(uuid, text, integer, numeric, text, uuid) from anon;
revoke execute on function public.record_project_check_in(uuid, text, integer, text, uuid) from anon;
revoke execute on function public.complete_performance_review(uuid, integer, jsonb, uuid) from anon;
revoke execute on function public.approve_role_expectation_draft(uuid, integer) from anon;
revoke execute on function public.accept_direct_report_invite(text) from anon;
revoke execute on function public.ensure_entitlement() from anon;
