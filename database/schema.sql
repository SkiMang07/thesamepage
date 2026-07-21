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
-- DIRECT REPORTS
-- 'name' (not 'full_name') to match backend DirectReportIn model.
-- manager_id = the logged-in manager's auth.uid().
-- org_id nullable for MVP.
-- -------------------------
create table direct_reports (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid references organizations(id) on delete cascade,  -- nullable for MVP
  manager_id    uuid not null references auth.users(id),
  user_id       uuid references auth.users(id),  -- future IC login hook
  name          text not null,
  email         text,
  role_level_id uuid references role_levels(id),
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
-- owner_id = the manager who made the commitment.
-- title nullable for MVP (description carries the content).
-- org_id nullable for MVP.
-- -------------------------
create table commitments (
  id               uuid primary key default uuid_generate_v4(),
  org_id           uuid references organizations(id),  -- nullable for MVP
  title            text,   -- nullable for MVP
  description      text,
  owner_id         uuid references auth.users(id),
  direct_report_id uuid references direct_reports(id) on delete cascade,
  source_type      text check (source_type in ('one_on_one', 'goal', 'project', 'manual')),
  source_id        uuid,
  due_date         date,
  status           text not null default 'open' check (status in ('open', 'done', 'dropped')),
  completed_at     timestamptz,
  created_at       timestamptz not null default now()
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
  level            text not null check (level in ('company', 'department', 'team', 'individual')),
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
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid references organizations(id) on delete cascade,
  title       text not null,
  description text,
  goal_id     uuid references goals(id) on delete set null,
  owner_id    uuid references auth.users(id),
  status      text not null default 'active'
              check (status in ('active', 'on_track', 'at_risk', 'completed', 'cancelled')),
  due_date    date,
  created_at  timestamptz not null default now()
);

alter table projects enable row level security;

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
-- ============================================================

-- organizations
create policy "organizations_select_own" on organizations
  for select using (
    id in (select org_id from users where id = auth.uid())
  );

-- users
create policy "users_select_own_org" on users
  for select using (id = auth.uid() or org_id = (select org_id from users where id = auth.uid() and org_id is not null));
create policy "users_update_own" on users
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy "users_insert_own" on users
  for insert with check (id = auth.uid());

-- role_levels
create policy "role_levels_all_own_org" on role_levels
  for all using (org_id = (select org_id from users where id = auth.uid()))
  with check (org_id = (select org_id from users where id = auth.uid()));

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
  for all using (org_id = (select org_id from users where id = auth.uid()))
  with check (org_id = (select org_id from users where id = auth.uid()));

-- assessments
create policy "assessments_all_own" on assessments
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- performance_reviews
create policy "performance_reviews_all_own" on performance_reviews
  for all using (manager_id = auth.uid()) with check (manager_id = auth.uid());

-- metric_configs
create policy "metric_configs_all_own_org" on metric_configs
  for all using (org_id = (select org_id from users where id = auth.uid()))
  with check (org_id = (select org_id from users where id = auth.uid()));

-- metric_scale_definitions
create policy "metric_scale_defs_select_own_org" on metric_scale_definitions
  for select using (
    metric_config_id in (
      select id from metric_configs
      where org_id = (select org_id from users where id = auth.uid())
    )
  );

-- metric_entries
create policy "metric_entries_all_own" on metric_entries
  for all using (recorded_by = auth.uid()) with check (recorded_by = auth.uid());

-- skill_configs
create policy "skill_configs_all_own_org" on skill_configs
  for all using (org_id = (select org_id from users where id = auth.uid()))
  with check (org_id = (select org_id from users where id = auth.uid()));

-- skill_scale_definitions
create policy "skill_scale_defs_select_own_org" on skill_scale_definitions
  for select using (
    skill_config_id in (
      select id from skill_configs
      where org_id = (select org_id from users where id = auth.uid())
    )
  );

-- skill_assessments
create policy "skill_assessments_all_own" on skill_assessments
  for all using (assessed_by = auth.uid()) with check (assessed_by = auth.uid());

-- value_configs
create policy "value_configs_all_own_org" on value_configs
  for all using (org_id = (select org_id from users where id = auth.uid()))
  with check (org_id = (select org_id from users where id = auth.uid()));

-- value_scale_definitions
create policy "value_scale_defs_select_own_org" on value_scale_definitions
  for select using (
    value_config_id in (
      select id from value_configs
      where org_id = (select org_id from users where id = auth.uid())
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
