-- ============================================================
-- Beyond the team (Phase 1): meetings outside the manager's own team —
-- boss, skip-level, indirect reports, peers, cross-functional and project
-- meetings. Spec: docs/BEYOND_THE_TEAM_SCOPING.md.
--
-- Four new tables, all owner-scoped (owner_id = auth.uid()), with NO
-- IC-visible policy on any of them: nothing here is readable through an IC
-- login. owner_id is denormalized onto the two join tables so their USING
-- clause stays flat; their WITH CHECK additionally proves the parent meeting,
-- person, goal, project or report belongs to the caller, so a known UUID of
-- someone else's row can't be linked to. None of those subqueries touch
-- public.users, so there is no RLS recursion risk (docs/ENGINEERING.md).
--
-- Indirect reports are outside_people rows, not links to direct_reports —
-- their direct_reports row belongs to another manager.
--
-- Also:
--   * commitments.source_type gains 'outside_meeting'.
--   * commitments.committed_by gains 'counterpart' — something the other
--     person owes you — with outside_person_id naming who. A counterpart row
--     never has a direct_report_id. outside_person_id is also allowed on a
--     manager-owned row to say who the manager owes it to.
--   * check_ins gains nullable source_type / source_id, same shape as
--     commitments, so a check-in created from a meeting traces back to it.
--     Existing rows stay null (entered by hand).
-- ============================================================

create table if not exists outside_people (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid references organizations(id),
  owner_id      uuid not null references auth.users(id),
  name          text not null,
  relationship  text not null default 'other'
                check (relationship in ('manager', 'skip_level', 'indirect_report', 'peer', 'cross_functional', 'other')),
  role_title    text,
  email         text,   -- reserved for notes-ingestion matching
  notes         text,   -- private
  archived_at   timestamptz,
  created_at    timestamptz not null default now()
);

alter table outside_people enable row level security;

create index if not exists outside_people_owner_idx on outside_people (owner_id, archived_at);

create table if not exists outside_meetings (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid references organizations(id),
  owner_id      uuid not null references auth.users(id),
  title         text,
  kind          text not null default 'one_on_one' check (kind in ('one_on_one', 'group')),
  scheduled_at  timestamptz,   -- noon-UTC meeting date, docs/decisions/meeting-date-is-scheduled-at.md
  notes         text,          -- raw notes, private
  summary       text,          -- confirmed write-up; null until logged
  logged_at     timestamptz,
  created_at    timestamptz not null default now()
);

alter table outside_meetings enable row level security;

create index if not exists outside_meetings_owner_idx on outside_meetings (owner_id, scheduled_at desc);

create table if not exists outside_meeting_people (
  meeting_id  uuid not null references outside_meetings(id) on delete cascade,
  person_id   uuid not null references outside_people(id) on delete cascade,
  owner_id    uuid not null references auth.users(id),
  primary key (meeting_id, person_id)
);

alter table outside_meeting_people enable row level security;

create index if not exists outside_meeting_people_person_idx on outside_meeting_people (person_id);

create table if not exists outside_meeting_links (
  id                uuid primary key default uuid_generate_v4(),
  meeting_id        uuid not null references outside_meetings(id) on delete cascade,
  owner_id          uuid not null references auth.users(id),
  goal_id           uuid references goals(id) on delete cascade,
  project_id        uuid references projects(id) on delete cascade,
  direct_report_id  uuid references direct_reports(id) on delete cascade,
  note              text,   -- the line that justifies the link
  created_at        timestamptz not null default now(),
  constraint outside_meeting_links_exactly_one_target
    check (num_nonnulls(goal_id, project_id, direct_report_id) = 1)
);

alter table outside_meeting_links enable row level security;

create index if not exists outside_meeting_links_meeting_idx on outside_meeting_links (meeting_id);
create index if not exists outside_meeting_links_report_idx on outside_meeting_links (direct_report_id, created_at desc) where direct_report_id is not null;
create index if not exists outside_meeting_links_goal_idx on outside_meeting_links (goal_id, created_at desc) where goal_id is not null;
create index if not exists outside_meeting_links_project_idx on outside_meeting_links (project_id, created_at desc) where project_id is not null;

-- ---------- commitments ----------
alter table commitments
  add column if not exists outside_person_id uuid references outside_people(id) on delete cascade;

alter table commitments
  drop constraint if exists commitments_source_type_check,
  add constraint commitments_source_type_check
    check (source_type in ('one_on_one', 'goal', 'project', 'manual', 'team_meeting', 'outside_meeting'));

alter table commitments
  drop constraint if exists commitments_committed_by_check,
  add constraint commitments_committed_by_check
    check (committed_by in ('manager', 'direct_report', 'counterpart'));

alter table commitments
  drop constraint if exists commitments_counterpart_shape,
  add constraint commitments_counterpart_shape
    check (committed_by <> 'counterpart' or (outside_person_id is not null and direct_report_id is null));

create index if not exists commitments_outside_person_idx on commitments (outside_person_id) where outside_person_id is not null;

-- ---------- check_ins ----------
alter table check_ins
  add column if not exists source_type text,
  add column if not exists source_id uuid;

alter table check_ins
  drop constraint if exists check_ins_source_type_check,
  add constraint check_ins_source_type_check
    check (source_type in ('manual', 'outside_meeting'));

-- ---------- policies ----------
drop policy if exists "outside_people_all_own" on outside_people;
create policy "outside_people_all_own" on outside_people
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "outside_meetings_all_own" on outside_meetings;
create policy "outside_meetings_all_own" on outside_meetings
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "outside_meeting_people_all_own" on outside_meeting_people;
create policy "outside_meeting_people_all_own" on outside_meeting_people
  for all using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from outside_meetings m where m.id = meeting_id and m.owner_id = auth.uid())
    and exists (select 1 from outside_people p where p.id = person_id and p.owner_id = auth.uid())
  );

drop policy if exists "outside_meeting_links_all_own" on outside_meeting_links;
create policy "outside_meeting_links_all_own" on outside_meeting_links
  for all using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from outside_meetings m where m.id = meeting_id and m.owner_id = auth.uid())
    and (goal_id is null or exists (select 1 from goals g where g.id = goal_id and g.owner_id = auth.uid()))
    and (project_id is null or exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid()))
    and (direct_report_id is null or exists (select 1 from direct_reports d where d.id = direct_report_id and d.manager_id = auth.uid()))
  );
