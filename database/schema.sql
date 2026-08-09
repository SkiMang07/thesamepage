-- ============================================================
-- The Same Page — Database Schema
-- Updated: 2026-07-21
--
-- Structure: ALL CREATE TABLE statements first, ALL CREATE POLICY
-- statements last. This avoids forward-reference errors when policies
-- on early tables reference tables that haven't been created yet.
--
-- MVP simplifications vs original design:
--   - org_id is nullable on core tables (org concept added post-MVP)
--   - users.role defaults to 'manager'
--   - direct_reports uses 'name' not 'full_name' (matches backend + frontend)
--   - one_on_ones has a 'summary' column for the post-meeting log
--   - commitments.title is nullable (description carries the content for now)
--   - handle_new_user() trigger auto-creates a users row on auth signup
-- ============================================================

create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLE DEFINITIONS
-- (All policies come after all tables — see bottom of file)
-- ============================================================

-- -------------------------
-- ORGANIZATIONS
-- -------------------------
create table organizations (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  created_at timestamptz not null default now()
);

alter table organizations enable row level security;

-- -------------------------
-- USERS
-- Managers, Directors, VPs. ICs deferred to post-MVP.
-- manager_id self-references to build the org hierarchy.
-- org_id nullable for MVP (single manager, no org setup required).
-- -------------------------
create table users (
  id         uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid references organizations(id) on delete cascade,  -- nullable for MVP
  email      text unique not null,
  full_name  text not null default '',
  role       text not null default 'manager' check (role in ('manager', 'director', 'vp', 'ic')),
  manager_id uuid references users(id),
  created_at timestamptz not null default now()
);

alter table users enable row level security;

-- -------------------------
-- ROLE LEVELS
-- -------------------------
create table role_levels (
  id                           uuid primary key default uuid_generate_v4(),
  org_id                       uuid references organizations(id) on delete cascade,
  job_role                     text not null,
  functional_team              text,
  job_level                    integer not null,
  salary_min                   numeric,
  salary_max                   numeric,
  variable_bonus               boolean default false,
  variable_bonus_payout_period text,
  variable_bonus_amount        numeric,
  job_responsibilities         text,
  years_experience_min         integer,
  performance_scale_min        integer default 1,
  performance_scale_max        integer default 5,
  created_at                   timestamptz not null default now()
);

alter table role_levels enable row level security;

-- -------------------------
-- ORG UNITS
-- Team/department entities with parent/child relationships (Session 11,
-- 2026-08-02 — see docs/SESSION_HISTORY.md and the org_hierarchy_scoping
-- project memory note for the scoping conversation).
--
-- One self-referencing table, not separate department/team tables — mirrors
-- goals.parent_goal_id and users.manager_id, patterns already in this
-- schema. unit_type is 'department' or 'team' ONLY: "company" is not a row
-- here — the existing `organizations` row is the chart's root, and a
-- department with parent_unit_id null sits directly under it.
--
-- Org-scoped like role_levels (org_id = current_org_id()), not
-- manager-scoped like direct_reports/goals — team/department structure
-- belongs to the org, not to one manager's private view of it.
--
-- Replaces role_levels.functional_team as the source of truth for "which
-- team" — that free-text column stays in the schema for now (not dropped,
-- data not migrated) but the UI stops writing/showing it in favor of
-- direct_reports.org_unit_id below.
--
-- leader_user_id (Session 15, 2026-08-03): the person who leads this unit —
-- the scoping mechanism for role-scoped rollup views (People/Goals/
-- Projects/Capacity). See led_org_unit_ids() and the four org_unit_*_rollup
-- functions near the bottom of this file, and the role_scoped_views project
-- memory note for the scoping conversation. A leader's rollup covers this
-- unit plus every descendant walked down the tree; nothing named, only
-- aggregates.
-- -------------------------
create table org_units (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid references organizations(id) on delete cascade,
  name            text not null,
  unit_type       text not null check (unit_type in ('department', 'team')),
  parent_unit_id  uuid references org_units(id) on delete set null,
  leader_user_id  uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table org_units enable row level security;

-- -------------------------
-- DIRECT REPORTS
-- 'name' (not 'full_name') to match backend DirectReportIn model.
-- manager_id = the logged-in manager's auth.uid().
-- org_id nullable for MVP.
-- org_unit_id: which team/department this person structurally sits in —
-- separate from role_level_id (their job/comp band), since two people with
-- the same role_level can be on different real teams.
-- -------------------------
create table direct_reports (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid references organizations(id) on delete cascade,  -- nullable for MVP
  manager_id    uuid not null references auth.users(id),
  user_id       uuid references auth.users(id),  -- future IC login hook
  name          text not null,
  email         text,
  role_level_id uuid references role_levels(id),
  org_unit_id   uuid references org_units(id) on delete set null,
  role_title    text,
  notes         text,
  start_date    date,
  created_at    timestamptz not null default now()
);

alter table direct_reports enable row level security;

-- -------------------------
-- MANAGER + REPORT CONNECTIONS
-- -------------------------
create table manager_report_connections (
  id               uuid primary key default uuid_generate_v4(),
  manager_id       uuid not null references auth.users(id),
  direct_report_id uuid not null references direct_reports(id) on delete cascade,
  connection_type  text not null default 'direct'
                   check (connection_type in ('direct', 'skip_level')),
  created_at       timestamptz not null default now(),
  unique (manager_id, direct_report_id)
);

alter table manager_report_connections enable row level security;

-- -------------------------
-- 1:1 MEETINGS
-- manager_id = auth.uid() of the manager who runs the meeting.
-- summary = post-meeting log (visible in history).
-- notes = private manager thoughts (not shown in history).
-- prep_guide = AI-generated prep stored for reference.
-- org_id nullable for MVP.
-- -------------------------
create table one_on_ones (
  id               uuid primary key default uuid_generate_v4(),
  org_id           uuid references organizations(id),  -- nullable for MVP
  manager_id       uuid not null references auth.users(id),
  direct_report_id uuid not null references direct_reports(id) on delete cascade,
  scheduled_at     timestamptz,
  summary          text,   -- post-meeting log, shown in history
  notes            text,   -- private to manager only
  prep_guide       jsonb,  -- AI-generated prep, stored for reference
  created_at       timestamptz not null default now()
);

alter table one_on_ones enable row level security;

-- -------------------------
-- COMMITMENTS
-- owner_id = the manager keeping the record (RLS scopes through it).
-- committed_by = who owes the item: the manager or the direct report
-- (both sides of a 1:1 can make commitments — Session 8).
-- title nullable for MVP (description carries the content).
-- org_id nullable for MVP.
-- -------------------------
-- is_team_commitment (Session 23, 2026-08-09): false by default and for
-- every pre-existing row. When true, this commitment (still assigned to one
-- direct_report_id, unchanged) also surfaces on Team Mission Control's
-- team-wide commitments list — purely additive, doesn't change how a
-- commitment behaves anywhere else (dashboard, DR detail, prep).
create table commitments (
  id                  uuid primary key default uuid_generate_v4(),
  org_id              uuid references organizations(id),  -- nullable for MVP
  title               text,   -- nullable for MVP
  description         text,
  owner_id            uuid references auth.users(id),
  direct_report_id    uuid references direct_reports(id) on delete cascade,
  committed_by        text not null default 'manager' check (committed_by in ('manager', 'direct_report')),
  source_type         text check (source_type in ('one_on_one', 'goal', 'project', 'manual')),
  source_id           uuid,
  due_date            date,
  status              text not null default 'open' check (status in ('open', 'done', 'dropped')),
  completed_at        timestamptz,
  is_team_commitment  boolean not null default false,
  created_at          timestamptz not null default now()
);

alter table commitments enable row level security;

create index commitments_open_idx on commitments (direct_report_id, status) where status = 'open';

-- -------------------------
-- ASSESSMENT LEVELS
-- -------------------------
create table assessment_levels (
  id      uuid primary key default uuid_generate_v4(),
  org_id  uuid not null references organizations(id) on delete cascade,
  ordinal integer not null check (ordinal between 1 and 5),
  label   text not null,
  unique (org_id, ordinal)
);

alter table assessment_levels enable row level security;

-- -------------------------
-- ASSESSMENTS
-- -------------------------
create table assessments (
  id               uuid primary key default uuid_generate_v4(),
  manager_id       uuid not null references auth.users(id),
  direct_report_id uuid not null references direct_reports(id) on delete cascade,
  level_ordinal    integer not null,
  notes            text,
  source_type      text check (source_type in ('one_on_one', 'performance_review', 'manual')),
  source_id        uuid,
  created_at       timestamptz not null default now()
);

alter table assessments enable row level security;

-- -------------------------
-- PERFORMANCE REVIEWS
-- -------------------------
create table performance_reviews (
  id                    uuid primary key default uuid_generate_v4(),
  org_id                uuid references organizations(id),
  direct_report_id      uuid not null references direct_reports(id) on delete cascade,
  manager_id            uuid not null references auth.users(id),
  review_period         text not null,
  reviewed_at           date not null,
  rating_ordinal        integer,
  summary               text,
  is_shared_with_report boolean default false,
  created_at            timestamptz not null default now()
);

alter table performance_reviews enable row level security;

-- ============================================================
-- METRIC SETTINGS AND SCALE
-- ============================================================

create table metric_configs (
  id                   uuid primary key default uuid_generate_v4(),
  org_id               uuid references organizations(id) on delete cascade,
  role_level_id        uuid references role_levels(id),
  metric_name          text not null,
  order_type           text check (order_type in ('primary', 'secondary', 'tertiary')),
  description          text,
  team                 text,
  evaluation_scale_min integer default 1,
  evaluation_scale_max integer default 4,
  measurement_period   text check (measurement_period in ('month', 'week', 'quarter', 'annual', 'none')),
  expectation          text,
  created_at           timestamptz not null default now()
);

alter table metric_configs enable row level security;

create table metric_scale_definitions (
  id                  uuid primary key default uuid_generate_v4(),
  metric_config_id    uuid not null references metric_configs(id) on delete cascade,
  evaluation_point    integer not null,
  evaluation_name     text,
  description         text,
  quantitative_output text,
  qualitative_output  text,
  is_range            boolean default false,
  range_min           numeric,
  range_max           numeric
);

alter table metric_scale_definitions enable row level security;

create table metric_entries (
  id               uuid primary key default uuid_generate_v4(),
  direct_report_id uuid not null references direct_reports(id) on delete cascade,
  metric_config_id uuid not null references metric_configs(id),
  value            numeric,
  period           text,
  recorded_at      timestamptz not null default now(),
  recorded_by      uuid references auth.users(id)
);

alter table metric_entries enable row level security;

-- ============================================================
-- SKILL SETTINGS AND SCALE
-- ============================================================

create table skill_configs (
  id                   uuid primary key default uuid_generate_v4(),
  org_id               uuid references organizations(id) on delete cascade,
  role_level_id        uuid references role_levels(id),
  skill_name           text not null,
  order_type           text check (order_type in ('primary', 'secondary', 'tertiary')),
  description          text,
  team                 text,
  evaluation_scale_min integer default 1,
  evaluation_scale_max integer default 4,
  measurement_period   text,
  expectation          text,
  created_at           timestamptz not null default now()
);

alter table skill_configs enable row level security;

create table skill_scale_definitions (
  id                  uuid primary key default uuid_generate_v4(),
  skill_config_id     uuid not null references skill_configs(id) on delete cascade,
  evaluation_point    integer not null,
  evaluation_name     text,
  description         text,
  quantitative_output text,
  qualitative_output  text
);

alter table skill_scale_definitions enable row level security;

create table skill_assessments (
  id               uuid primary key default uuid_generate_v4(),
  direct_report_id uuid not null references direct_reports(id) on delete cascade,
  skill_config_id  uuid not null references skill_configs(id),
  evaluation_point integer,
  notes            text,
  assessed_at      timestamptz not null default now(),
  assessed_by      uuid references auth.users(id)
);

alter table skill_assessments enable row level security;

-- ============================================================
-- VALUE SETTINGS AND SCALE
-- ============================================================

create table value_configs (
  id                   uuid primary key default uuid_generate_v4(),
  org_id               uuid references organizations(id) on delete cascade,
  role_level_id        uuid references role_levels(id),
  value_name           text not null,
  order_type           text check (order_type in ('primary', 'secondary', 'tertiary')),
  description          text,
  team                 text,
  evaluation_scale_min integer default 1,
  evaluation_scale_max integer default 4,
  value_type           text check (value_type in ('team', 'company', 'department')),
  created_at           timestamptz not null default now()
);

alter table value_configs enable row level security;

create table value_scale_definitions (
  id                  uuid primary key default uuid_generate_v4(),
  value_config_id     uuid not null references value_configs(id) on delete cascade,
  evaluation_point    integer not null,
  evaluation_name     text,
  description         text,
  quantitative_output text,
  qualitative_output  text
);

alter table value_scale_definitions enable row level security;

create table value_assessments (
  id               uuid primary key default uuid_generate_v4(),
  direct_report_id uuid not null references direct_reports(id) on delete cascade,
  value_config_id  uuid not null references value_configs(id),
  evaluation_point integer,
  notes            text,
  assessed_at      timestamptz not null default now(),
  assessed_by      uuid references auth.users(id)
);

alter table value_assessments enable row level security;

-- ============================================================
-- GOALS
-- ============================================================

create table goals (
  id               uuid primary key default uuid_generate_v4(),
  org_id           uuid references organizations(id) on delete cascade,
  title            text not null,
  description      text,
  -- Free text, deliberately unstructured (Session 10 follow-up) — the
  -- SMART-framework "Measurable" anchor. Meant to be read by AI/agents, not
  -- parsed or scored, so no dedicated metric table.
  success_metrics  text,
  level            text not null check (level in ('company', 'department', 'team', 'individual')),
  -- Which specific department/team this goal belongs to (Session 11) — null
  -- for company/individual-level goals. The org_unit picker in the UI is
  -- filtered by unit_type = level, so the two can't disagree.
  org_unit_id      uuid references org_units(id) on delete set null,
  owner_id         uuid references auth.users(id),
  direct_report_id uuid references direct_reports(id) on delete cascade,
  parent_goal_id   uuid references goals(id),
  status           text not null default 'active'
                   check (status in ('active', 'on_track', 'at_risk', 'completed', 'cancelled')),
  due_date         date,
  created_at       timestamptz not null default now()
);

alter table goals enable row level security;

-- ============================================================
-- PROJECTS
-- ============================================================

create table projects (
  id                uuid primary key default uuid_generate_v4(),
  org_id            uuid references organizations(id) on delete cascade,
  title             text not null,
  description       text,
  goal_id           uuid references goals(id) on delete set null,
  -- Activated Session 13 (was null-only up to here). Which direct report
  -- this project belongs to — null means it's the manager's own initiative.
  -- Deliberately NOT given its own level/org_unit_id like goals: a project's
  -- scope is derived from whatever it's linked to (its goal's level, or the
  -- direct report it's assigned to, or nothing for a standalone manager
  -- initiative) rather than duplicating goals' hierarchy fields.
  direct_report_id  uuid references direct_reports(id) on delete cascade,
  owner_id          uuid references auth.users(id),
  status            text not null default 'active'
                    check (status in ('active', 'on_track', 'at_risk', 'completed', 'cancelled')),
  due_date          date,
  created_at        timestamptz not null default now()
);

alter table projects enable row level security;

-- ============================================================
-- TEAM MESSAGES
-- Session 21 (2026-08-08) — the messaging half of the "team space" idea
-- Andrew floated 2026-08-03 (see docs/SESSION_HISTORY.md and the
-- team_space_brainstorm project memory note). Free-text, manager-authored,
-- one row per update sent to a direct report.
--
-- STORE-ONLY for v1 — deliberate, not a gap. IC login isn't built yet
-- (direct_reports.user_id above is a future hook, still unused), so there is
-- no surface for a direct report to read this today. This table exists so a
-- manager has somewhere to log updates/priorities per report now, ready to
-- surface the moment IC login ships. Andrew's explicit call over building
-- email delivery this session.
--
-- manager_id = the logged-in manager's auth.uid() (RLS scopes through it,
-- same manager-scoped pattern as one_on_ones/assessments — NOT the
-- owner_id-on-goals/projects naming gotcha documented elsewhere).
-- ============================================================

create table team_messages (
  id                uuid primary key default uuid_generate_v4(),
  manager_id        uuid not null references auth.users(id),
  direct_report_id  uuid not null references direct_reports(id) on delete cascade,
  message           text not null,
  created_at        timestamptz not null default now()
);

alter table team_messages enable row level security;

create index team_messages_report_idx on team_messages (direct_report_id, created_at desc);

-- ============================================================
-- DIRECT REPORT INVITES
-- Session 22 (2026-08-08) — Team Mission Control's "auth primitives now, IC
-- view later" scoping call (see docs/SESSION_HISTORY.md and the
-- team_mission_control project memory note). This is the account/claim
-- mechanism that finally puts a real value into direct_reports.user_id
-- (a future hook, unused since Session 3): a manager generates a one-time
-- link, the report signs in via the same passwordless magic-link flow
-- /app/login already uses, and accept_direct_report_invite() below claims
-- their direct_reports row. Building what an IC actually SEES once logged
-- in is deferred to a follow-up session — this table and its two functions
-- are the whole of this session's IC-login scope.
--
-- manager_id = the inviting manager's auth.uid() (RLS scopes through it,
-- same manager-scoped pattern as team_messages). invited_email is a
-- snapshot at invite time, also backfilled onto direct_reports.email (a
-- second dormant column this activates — see direct_reports.py's
-- POST /{report_id}/invite). token is the single-use secret embedded in the
-- invite URL; expires_at defaults to a 7-day TTL set by the backend.
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

-- ============================================================
-- TEAM MEETING NOTES
-- Session 22 (2026-08-08) — Team Mission Control's right column. Deliberately
-- standalone: one_on_ones.summary stays exactly where it is (per-report 1:1
-- history); this is a separate running log for anything that isn't a 1:1 —
-- staff meetings, team syncs, general observations — same "Standalone
-- team-wide log" choice as team_messages was scoped as per-report. No
-- attendee tagging in v1 (kept deliberately minimal, see the
-- team_mission_control project memory note).
--
-- manager_id = the logged-in manager's auth.uid(), same manager-scoped
-- pattern as team_messages/one_on_ones.
-- ============================================================
--
-- meeting_date (Session 23, 2026-08-09): nullable — a note dated today or
-- later is the surfaced "next meeting's agenda"; null or a past date means
-- it's a logged past meeting. Derived, never a stored status column, same
-- pattern as one_on_ones' planned/completed split (see the planned_sessions
-- project memory note).
create table team_meeting_notes (
  id            uuid primary key default uuid_generate_v4(),
  manager_id    uuid not null references auth.users(id),
  note          text not null,
  meeting_date  date,
  created_at    timestamptz not null default now()
);

alter table team_meeting_notes enable row level security;

-- ============================================================
-- CAPACITY MODEL
-- Session 14 (2026-08-02) — see docs/SESSION_HISTORY.md and the
-- capacity_scoping project memory note for the full scoping conversation.
--
-- v1 is supply-only: how much capacity exists, not what's consuming it.
-- Hours are the shared currency; work_unit_configs is an optional
-- per-role-level display translation (tickets/points/campaigns) on top,
-- so no single native unit has to generalize across every kind of team.
-- capacity_profiles/time_off_entries stay manager-scoped like the rest of
-- a manager's private data — the department/org rollup function further
-- down (see RLS POLICIES section) is the one deliberate exception, and it
-- only ever returns aggregates, never a named individual's numbers.
--
-- off_days_per_year (added same session, before this ever ran live):
-- target_utilization buffers the within-a-day overhead; off_days_per_year
-- is a separate annual whole-days-off buffer (vacation/sick/holiday).
-- Precedence vs. time_off_entries to avoid double-counting: actual logged
-- time off wins for whatever period it overlaps; otherwise the calculation
-- falls back to a prorated share of the annual default. See
-- org_unit_capacity_rollup() below and capacity.py's _effective_off_hours().
-- ============================================================

create table capacity_settings (
  id                              uuid primary key default uuid_generate_v4(),
  org_id                          uuid not null unique references organizations(id) on delete cascade,
  default_hours_per_week          numeric not null default 40,
  default_target_utilization_pct  numeric not null default 75,
  default_off_days_per_year       numeric not null default 21,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

alter table capacity_settings enable row level security;

create table capacity_profiles (
  id                          uuid primary key default uuid_generate_v4(),
  direct_report_id            uuid not null unique references direct_reports(id) on delete cascade,
  contracted_hours_per_week   numeric,  -- null = inherit capacity_settings default
  target_utilization_pct      numeric,  -- null = inherit capacity_settings default
  off_days_per_year           numeric,  -- null = inherit capacity_settings default
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

alter table capacity_profiles enable row level security;

create table time_off_entries (
  id                uuid primary key default uuid_generate_v4(),
  direct_report_id  uuid not null references direct_reports(id) on delete cascade,
  start_date        date not null,
  end_date          date not null,
  type              text not null default 'pto' check (type in ('pto', 'sick', 'holiday', 'other')),
  hours_per_day     numeric,  -- null = a full contracted day at calculation time
  notes             text,
  created_at        timestamptz not null default now()
);

alter table time_off_entries enable row level security;

create index time_off_entries_range_idx on time_off_entries (direct_report_id, start_date, end_date);

create table work_unit_configs (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid references organizations(id) on delete cascade,
  role_level_id   uuid not null unique references role_levels(id) on delete cascade,
  unit_name       text not null,
  hours_per_unit  numeric not null check (hours_per_unit > 0),
  created_at      timestamptz not null default now()
);

alter table work_unit_configs enable row level security;

-- ============================================================
-- DEVELOPMENT PLANS
-- ============================================================

create table development_plans (
  id               uuid primary key default uuid_generate_v4(),
  direct_report_id uuid not null references direct_reports(id) on delete cascade,
  manager_id       uuid not null references auth.users(id),
  status           text not null default 'active'
                   check (status in ('active', 'completed', 'archived')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table development_plans enable row level security;

create table dev_plan_aspirations (
  id                  uuid primary key default uuid_generate_v4(),
  development_plan_id uuid not null references development_plans(id) on delete cascade,
  desired_role        text,
  timeline            text,
  notes               text,
  updated_at          timestamptz not null default now()
);

alter table dev_plan_aspirations enable row level security;

create table dev_plan_opportunities (
  id                  uuid primary key default uuid_generate_v4(),
  development_plan_id uuid not null references development_plans(id) on delete cascade,
  type                text check (type in ('skill', 'knowledge')),
  description         text not null,
  created_at          timestamptz not null default now()
);

alter table dev_plan_opportunities enable row level security;

create table dev_plan_training (
  id                  uuid primary key default uuid_generate_v4(),
  development_plan_id uuid not null references development_plans(id) on delete cascade,
  description         text not null,
  completion_date     date,
  projected_cost      numeric,
  created_at          timestamptz not null default now()
);

alter table dev_plan_training enable row level security;

create table dev_plan_manager_notes (
  id                  uuid primary key default uuid_generate_v4(),
  development_plan_id uuid not null references development_plans(id) on delete cascade,
  content             text not null,
  created_at          timestamptz not null default now()
);

alter table dev_plan_manager_notes enable row level security;

-- -------------------------
-- SUBSCRIPTIONS
-- Written only by the backend service-role client (Stripe webhook).
-- -------------------------
create table subscriptions (
  id                     uuid primary key default uuid_generate_v4(),
  user_id                uuid not null unique references auth.users(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  plan                   text check (plan in ('manager', 'team')),
  status                 text not null default 'inactive'
                         check (status in ('inactive', 'trialing', 'active', 'past_due', 'canceled')),
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);

alter table subscriptions enable row level security;

-- ============================================================
-- AUTO-CREATE USER PROFILE ON SIGNUP
-- When someone signs in via magic link for the first time,
-- Supabase creates an auth.users row. This trigger mirrors it
-- into our public.users table so RLS and queries work immediately.
-- full_name defaults to the email prefix; update via settings later.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'manager'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- RLS POLICIES
-- All policies defined here, after all tables exist.
-- Core MVP tables (direct_reports, one_on_ones, commitments) use
-- auth.uid() directly — no org lookup needed for single-manager MVP.
--
-- Org-scoped policies use current_org_id() (SECURITY DEFINER) instead of
-- subquerying users inline — a subquery on users inside the users policy
-- causes "infinite recursion detected in policy" (42P17), and inline
-- subqueries elsewhere inherit that failure. Fixed 2026-08-01.
-- ============================================================

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.users where id = auth.uid()
$$;

revoke all on function public.current_org_id() from public;
grant execute on function public.current_org_id() to authenticated;

-- organizations
create policy "organizations_select_own" on organizations
  for select using (id = public.current_org_id());

create policy "organizations_insert_authenticated" on organizations
  for insert to authenticated
  with check (true);

create policy "organizations_update_own" on organizations
  for update
  using (id = public.current_org_id())
  with check (id = public.current_org_id());

-- users
create policy "users_select_own_org" on users
  for select using (id = auth.uid() or (org_id is not null and org_id = public.current_org_id()));
create policy "users_update_own" on users
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy "users_insert_own" on users
  for insert with check (id = auth.uid());

-- role_levels
create policy "role_levels_all_own_org" on role_levels
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- org_units
create policy "org_units_all_own_org" on org_units
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- direct_reports — manager sees their own reports
create policy "direct_reports_all_own" on direct_reports
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- manager_report_connections
create policy "connections_select_own" on manager_report_connections
  for select using (manager_id = auth.uid());

-- one_on_ones — private to the manager who created them
create policy "one_on_ones_all_own" on one_on_ones
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- commitments — visible to the owner (manager who made the commitment)
create policy "commitments_all_own" on commitments
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- assessment_levels
create policy "assessment_levels_all_own_org" on assessment_levels
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- assessments
create policy "assessments_all_own" on assessments
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- performance_reviews
create policy "performance_reviews_all_own" on performance_reviews
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- metric_configs
create policy "metric_configs_all_own_org" on metric_configs
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- metric_scale_definitions
create policy "metric_scale_defs_select_own_org" on metric_scale_definitions
  for select using (
    metric_config_id in (
      select id from metric_configs
      where org_id = public.current_org_id()
    )
  );

-- metric_entries
create policy "metric_entries_all_own" on metric_entries
  for all using (recorded_by = auth.uid()) with check (recorded_by = auth.uid());

-- skill_configs
create policy "skill_configs_all_own_org" on skill_configs
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- skill_scale_definitions
create policy "skill_scale_defs_select_own_org" on skill_scale_definitions
  for select using (
    skill_config_id in (
      select id from skill_configs
      where org_id = public.current_org_id()
    )
  );

-- skill_assessments
create policy "skill_assessments_all_own" on skill_assessments
  for all using (assessed_by = auth.uid()) with check (assessed_by = auth.uid());

-- value_configs
create policy "value_configs_all_own_org" on value_configs
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- value_scale_definitions
create policy "value_scale_defs_select_own_org" on value_scale_definitions
  for select using (
    value_config_id in (
      select id from value_configs
      where org_id = public.current_org_id()
    )
  );

-- value_assessments
create policy "value_assessments_all_own" on value_assessments
  for all using (assessed_by = auth.uid()) with check (assessed_by = auth.uid());

-- goals
create policy "goals_all_own_org" on goals
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- projects
create policy "projects_all_own_org" on projects
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- team_messages — private to the manager who sent them, same manager-scoped
-- pattern as one_on_ones/assessments
create policy "team_messages_all_own" on team_messages
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- direct_report_invites — manager manages their own invites. The IC side
-- (preview + accept) never touches this table directly — see
-- get_invite_preview()/accept_direct_report_invite() near the bottom of this
-- file, both SECURITY DEFINER so they can operate before/without a matching
-- RLS-visible row for the IC.
create policy "direct_report_invites_all_own" on direct_report_invites
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- direct_reports — a claimed IC can read (only) their own row. Additive to
-- direct_reports_all_own above (manager access unchanged); this is the one
-- other piece of "auth primitives" scope this session — deliberately just a
-- read policy, since there's no IC-facing view yet to exercise it.
create policy "direct_reports_select_own_as_ic" on direct_reports
  for select using (user_id = auth.uid());

-- team_meeting_notes — manager-scoped, same pattern as team_messages
create policy "team_meeting_notes_all_own" on team_meeting_notes
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- development_plans
create policy "dev_plans_all_own" on development_plans
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- dev_plan_aspirations
create policy "dev_plan_aspirations_all_own" on dev_plan_aspirations
  for all using (
    development_plan_id in (select id from development_plans where manager_id = auth.uid())
  );

-- dev_plan_opportunities
create policy "dev_plan_opportunities_all_own" on dev_plan_opportunities
  for all using (
    development_plan_id in (select id from development_plans where manager_id = auth.uid())
  );

-- dev_plan_training
create policy "dev_plan_training_all_own" on dev_plan_training
  for all using (
    development_plan_id in (select id from development_plans where manager_id = auth.uid())
  );

-- dev_plan_manager_notes
create policy "dev_plan_manager_notes_all_own" on dev_plan_manager_notes
  for all using (
    development_plan_id in (select id from development_plans where manager_id = auth.uid())
  );

-- subscriptions — read-only for the user; backend service-role handles writes
create policy "subscriptions_select_own" on subscriptions
  for select using (user_id = auth.uid());

-- capacity_settings — org-scoped like role_levels/assessment_levels
create policy "capacity_settings_all_own_org" on capacity_settings
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- capacity_profiles — manager-scoped through direct_reports, same pattern
-- as dev_plan_* above
create policy "capacity_profiles_all_own" on capacity_profiles
  for all using (
    direct_report_id in (select id from direct_reports where manager_id = auth.uid())
  )
  with check (
    direct_report_id in (select id from direct_reports where manager_id = auth.uid())
  );

-- time_off_entries — same manager-scoped pattern
create policy "time_off_entries_all_own" on time_off_entries
  for all using (
    direct_report_id in (select id from direct_reports where manager_id = auth.uid())
  )
  with check (
    direct_report_id in (select id from direct_reports where manager_id = auth.uid())
  );

-- work_unit_configs — org-scoped like metric_configs/skill_configs
create policy "work_unit_configs_all_own_org" on work_unit_configs
  for all using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ============================================================
-- ROLE-SCOPED ROLLUP VIEWS (Session 15, 2026-08-03)
-- See database/migrations/2026-08-03_org_unit_leaders.sql for the full
-- reasoning and the role_scoped_views project memory note for the scoping
-- conversation. led_org_unit_ids() is the one shared gate: units the caller
-- directly leads (org_units.leader_user_id = auth.uid()) plus every
-- descendant walked down the tree. Every rollup function below — including
-- the pre-existing capacity one — filters through it, so there's a single
-- place that defines "what can this person see."
-- ============================================================

create or replace function public.led_org_unit_ids()
returns table (unit_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with recursive led as (
    select id from org_units where leader_user_id = auth.uid()
    union all
    select ou.id
    from org_units ou
    join led on ou.parent_unit_id = led.id
  )
  select id from led
$$;

revoke all on function public.led_org_unit_ids() from public;
grant execute on function public.led_org_unit_ids() to authenticated;

-- ------------------------------------------------------------
-- CAPACITY ROLLUP (department/org level)
-- SECURITY DEFINER so it can read across managers, but its return shape is
-- aggregate-only by construction (org_unit_id + count + summed hours, never
-- a named individual) — see database/migrations/2026-08-02_capacity.sql for
-- the full reasoning. direct_reports/capacity_profiles/time_off_entries stay
-- manager-scoped per the policies above; this is the one deliberate
-- exception, mirroring current_org_id()'s pattern.
--
-- Gated by led_org_unit_ids() as of Session 15 — previously any
-- authenticated org member could read the whole org's rollup (a known gap
-- flagged in Session 14, "no second manager yet to test a real permission
-- system against"). Now it only returns units the caller leads (or
-- descends from a unit they lead).
-- ------------------------------------------------------------

create or replace function public.org_unit_capacity_rollup(p_period_start date, p_period_end date)
returns table (
  org_unit_id uuid,
  direct_report_count integer,
  available_hours numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org_id uuid := public.current_org_id();
  v_period_weeks numeric := greatest((p_period_end - p_period_start) + 1, 0) / 7.0;
begin
  if v_org_id is null or p_period_end < p_period_start then
    return;
  end if;

  -- Off-days precedence: actual logged time off (actual_off, computed once
  -- per report via LATERAL) wins for the period it overlaps; otherwise fall
  -- back to a prorated share of off_days_per_year. Mirrors capacity.py's
  -- _effective_off_hours() — keep both in sync if this changes.
  return query
  select
    dr.org_unit_id,
    count(*)::integer as direct_report_count,
    sum(
      greatest(
        coalesce(cp.contracted_hours_per_week, cs.default_hours_per_week, 40)
          * v_period_weeks
          * (coalesce(cp.target_utilization_pct, cs.default_target_utilization_pct, 75) / 100.0)
        - (
            case
              when coalesce(actual_off.hours, 0) > 0 then actual_off.hours
              else
                coalesce(cp.off_days_per_year, cs.default_off_days_per_year, 21)
                  * (coalesce(cp.contracted_hours_per_week, cs.default_hours_per_week, 40) / 5.0)
                  * (v_period_weeks / 52.0)
            end
          ),
        0
      )
    ) as available_hours
  from direct_reports dr
  join org_units ou on ou.id = dr.org_unit_id and ou.org_id = v_org_id
  left join capacity_profiles cp on cp.direct_report_id = dr.id
  left join capacity_settings cs on cs.org_id = v_org_id
  left join lateral (
    select sum(
      (least(t.end_date, p_period_end) - greatest(t.start_date, p_period_start) + 1)
      * coalesce(
          t.hours_per_day,
          coalesce(cp.contracted_hours_per_week, cs.default_hours_per_week, 40) / 5.0
        )
    ) as hours
    from time_off_entries t
    where t.direct_report_id = dr.id
      and t.start_date <= p_period_end
      and t.end_date >= p_period_start
  ) actual_off on true
  where dr.org_unit_id in (select unit_id from public.led_org_unit_ids())
  group by dr.org_unit_id;
end;
$$;

revoke all on function public.org_unit_capacity_rollup(date, date) from public;
grant execute on function public.org_unit_capacity_rollup(date, date) to authenticated;

-- ------------------------------------------------------------
-- GOALS ROLLUP — status counts for department/team-level goals directly
-- tagged with an org_unit_id. Individual-level goals (tied via
-- direct_report_id, no org_unit_id of their own) are NOT included — a
-- deliberate v1 scope limit; revisit if a leader also wants individual
-- goals folded into the same view.
-- ------------------------------------------------------------

create or replace function public.org_unit_goals_rollup()
returns table (
  org_unit_id uuid,
  status text,
  goal_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select g.org_unit_id, g.status, count(*)::integer as goal_count
  from goals g
  where g.org_unit_id in (select unit_id from public.led_org_unit_ids())
  group by g.org_unit_id, g.status
$$;

revoke all on function public.org_unit_goals_rollup() from public;
grant execute on function public.org_unit_goals_rollup() to authenticated;

-- ------------------------------------------------------------
-- PROJECTS ROLLUP — status counts, scoped the same way Projects derives
-- its scope everywhere else: its goal's org_unit_id first, falling back to
-- its assigned direct report's org_unit_id. A standalone project with
-- neither never resolves to a unit and is excluded.
-- ------------------------------------------------------------

create or replace function public.org_unit_projects_rollup()
returns table (
  org_unit_id uuid,
  status text,
  project_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(g.org_unit_id, dr.org_unit_id) as org_unit_id, p.status, count(*)::integer as project_count
  from projects p
  left join goals g on g.id = p.goal_id
  left join direct_reports dr on dr.id = p.direct_report_id
  where coalesce(g.org_unit_id, dr.org_unit_id) in (select unit_id from public.led_org_unit_ids())
  group by coalesce(g.org_unit_id, dr.org_unit_id), p.status
$$;

revoke all on function public.org_unit_projects_rollup() from public;
grant execute on function public.org_unit_projects_rollup() to authenticated;

-- ------------------------------------------------------------
-- PEOPLE ROLLUP — headcount + a role-label/count breakdown per unit.
-- Aggregate-only by construction: job_role + a count, never a name, same
-- contract as the capacity rollup. Reports with no role_level_id assigned
-- are grouped under 'Unassigned' rather than dropped.
-- ------------------------------------------------------------

create or replace function public.org_unit_people_rollup()
returns table (
  org_unit_id uuid,
  direct_report_count integer,
  role_breakdown jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with per_role as (
    select
      dr.org_unit_id,
      coalesce(rl.job_role, 'Unassigned') as job_role,
      count(*) as cnt
    from direct_reports dr
    left join role_levels rl on rl.id = dr.role_level_id
    where dr.org_unit_id in (select unit_id from public.led_org_unit_ids())
    group by dr.org_unit_id, coalesce(rl.job_role, 'Unassigned')
  )
  select
    org_unit_id,
    sum(cnt)::integer as direct_report_count,
    jsonb_agg(jsonb_build_object('job_role', job_role, 'count', cnt) order by job_role) as role_breakdown
  from per_role
  group by org_unit_id
$$;

revoke all on function public.org_unit_people_rollup() from public;
grant execute on function public.org_unit_people_rollup() to authenticated;

-- ------------------------------------------------------------
-- DIRECT REPORT INVITES — the two SECURITY DEFINER functions behind Team
-- Mission Control's "auth primitives now, IC view later" scope (Session 22,
-- see the direct_report_invites table comment above and the
-- team_mission_control project memory note).
--
-- get_invite_preview() is the one function in this file granted to `anon`,
-- not just `authenticated` — the visitor hasn't logged in yet when they
-- land on /invite/{token}, so there is no JWT for RLS to key off. It
-- returns only a minimal, non-sensitive projection (names + expiry), never
-- the row itself, and only for a token the caller already knows (this
-- table has no other anon-readable path). Called from backend/routes/
-- invites.py using a plain anon-key client — NOT get_admin_client() — so
-- the "never service-role for user data" rule stays intact even with no
-- authenticated user in the request.
-- ------------------------------------------------------------

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

-- accept_direct_report_invite() runs as the freshly-authenticated IC (their
-- JWT is what auth.uid()/auth.email() resolve from), but needs to write to
-- direct_reports/direct_report_invites/users rows they don't own via RLS —
-- hence SECURITY DEFINER, same shape as the rollup functions above, just
-- for a single-row claim instead of an aggregate read. auth.email() is
-- re-checked against invited_email inside the function (not just at the
-- Python layer in routes/invites.py) as defense in depth, matching this
-- file's existing belt-and-suspenders posture (see utils.py's explicit
-- manager_id checks alongside RLS).
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

  -- users row already exists (handle_new_user() trigger fired on signup,
  -- defaulting role to 'manager' — the check constraint anticipated 'ic'
  -- since the original MVP simplification note at the top of this file).
  -- Correct it now that we know this account is actually an invited IC.
  update users
    set role = 'ic',
        full_name = case when trim(coalesce(full_name, '')) = '' then v_dr_name else full_name end
    where id = v_uid;

  return v_invite.direct_report_id;
end;
$$;

revoke all on function public.accept_direct_report_invite(text) from public;
grant execute on function public.accept_direct_report_invite(text) to authenticated;
