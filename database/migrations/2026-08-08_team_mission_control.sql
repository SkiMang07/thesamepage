-- ============================================================
-- Team Mission Control (Session 22, 2026-08-08; see docs/SESSION_HISTORY.md
-- and the team_mission_control project memory note for the scoping
-- conversation).
--
-- Depends on 2026-08-08_team_messages.sql already having been run (this
-- migration does not touch team_messages, but both are Session 21/22 of the
-- same "team space" feature — run in order if applying incrementally).
--
-- Decisions locked before this file was written:
--   - IC login: "auth primitives now, IC view later." This migration adds
--     the account/claim mechanism (direct_report_invites + the two
--     functions below) that finally populates direct_reports.user_id — a
--     future hook, unused since Session 3. It does NOT add anything for
--     what an IC sees once logged in; that's a follow-up session.
--   - "Key updates" (a manager-authored broadcast feed) was scoped and then
--     explicitly deferred to a follow-up — nothing for it in this file.
--   - Meeting notes: a standalone team-wide log (team_meeting_notes),
--     deliberately separate from one_on_ones (stays per-report) and
--     team_messages (stays per-report). No attendee tagging in v1.
--   - /app/team is reworked in place into a 3-column layout — no new nav
--     item or route for the roster/goals/notes columns themselves.
--
-- This file is idempotent-ish (create table / create policy will error on
-- re-run, matching every other migration in this repo) — run once against
-- the live database.
-- ============================================================

create table direct_report_invites (
  id                uuid primary key default uuid_generate_v4(),
  manager_id        uuid not null references auth.users(id),
  direct_report_id  uuid not null references direct_reports(id) on delete cascade,
  invited_email     text not null,
  token             text not null unique,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  accepted_at       timestamptz
);

alter table direct_report_invites enable row level security;

create index direct_report_invites_report_idx on direct_report_invites (direct_report_id);

create table team_meeting_notes (
  id          uuid primary key default uuid_generate_v4(),
  manager_id  uuid not null references auth.users(id),
  note        text not null,
  created_at  timestamptz not null default now()
);

alter table team_meeting_notes enable row level security;

-- manager manages their own invites; the IC side (preview + accept) goes
-- through the SECURITY DEFINER functions below instead, not this policy.
create policy "direct_report_invites_all_own" on direct_report_invites
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- additive to the existing direct_reports_all_own policy — lets a claimed
-- IC read (only) their own row. No IC-facing view exercises this yet.
create policy "direct_reports_select_own_as_ic" on direct_reports
  for select using (user_id = auth.uid());

-- manager-scoped, same pattern as team_messages
create policy "team_meeting_notes_all_own" on team_meeting_notes
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- Public preview by token — the visitor hasn't logged in yet, so this is
-- the one function in the schema granted to `anon`. Returns only a minimal,
-- non-sensitive projection, never the row itself.
create or replace function public.get_invite_preview(p_token text)
returns table (
  report_name text,
  invited_email text,
  manager_name text,
  expires_at timestamptz,
  valid boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    dr.name,
    i.invited_email,
    nullif(trim(coalesce(u.full_name, '')), '') as manager_name,
    i.expires_at,
    (i.accepted_at is null and i.expires_at > now()) as valid
  from direct_report_invites i
  join direct_reports dr on dr.id = i.direct_report_id
  left join users u on u.id = i.manager_id
  where i.token = p_token
$$;

revoke all on function public.get_invite_preview(text) from public;
grant execute on function public.get_invite_preview(text) to anon, authenticated;

-- Claims a direct_reports row for the now-authenticated IC. Re-checks
-- auth.email() against invited_email inside the function as defense in
-- depth, on top of the check already done in routes/invites.py.
create or replace function public.accept_direct_report_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite direct_report_invites%rowtype;
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.email(), ''));
  v_dr_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from direct_report_invites where token = p_token for update;

  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'This invite has already been used';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'This invite has expired';
  end if;
  if lower(v_invite.invited_email) is distinct from v_email then
    raise exception 'This invite was sent to a different email address';
  end if;

  update direct_reports set user_id = v_uid
    where id = v_invite.direct_report_id and user_id is null
    returning name into v_dr_name;

  if v_dr_name is null then
    raise exception 'This direct report is already linked to an account';
  end if;

  update direct_report_invites set accepted_at = now() where id = v_invite.id;

  update users
    set role = 'ic',
        full_name = case when trim(coalesce(full_name, '')) = '' then v_dr_name else full_name end
    where id = v_uid;

  return v_invite.direct_report_id;
end;
$$;

revoke all on function public.accept_direct_report_invite(text) from public;
grant execute on function public.accept_direct_report_invite(text) to authenticated;
