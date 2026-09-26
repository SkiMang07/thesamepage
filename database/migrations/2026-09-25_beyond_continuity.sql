-- ============================================================
-- Beyond the team — Overview and conversation continuity.
-- Design: docs/design-proposals/2026-09-25-beyond-directions/.
-- Current state: docs/systems/beyond.md.
-- Applies on top of 2026-09-22_beyond_the_team_repeat.sql.
--
-- outside_meetings gains:
--   prep_items   private things the manager wants to raise in THIS upcoming
--                conversation: a thought they added, or a suggested prep line
--                they edited and accepted. Each item is
--                {id, text, source: 'thought'|'suggestion', suggestion_id,
--                created_at}. Not an agreed commitment, never sent anywhere;
--                1:1 prep reads it as the manager's own notes.
--
-- outside_suggestions — AI-proposed connections between a REVIEWED Beyond
-- record (an open commitment or a logged meeting's write-up) and one of the
-- manager's own live goals or projects. The evidence excerpts are copied
-- from the records by the server, never written by the model. A suggestion
-- is a proposal only:
--   'open'       shown in the Overview brief
--   'dismissed'  hidden; the same key + the same evidence is never proposed
--                again (unique index), but materially new evidence can be
--   'connected'  the manager confirmed it, which wrote ONE
--                outside_meeting_links row — no check-in, no status change
-- added_meeting_id records that its prep line was added to a conversation;
-- that alone confirms nothing.
--
-- outside_suggestion_runs — one row per owner: the fingerprint of the
-- evidence the last AI pass saw, so the Overview only asks the model again
-- when the underlying records changed (including when it found nothing).
--
-- All owner-scoped, no IC policy, and WITH CHECK proves every referenced
-- row is the caller's own. No subquery reads public.users.
-- ============================================================

alter table outside_meetings
  add column if not exists prep_items jsonb not null default '[]'::jsonb;

alter table outside_meetings
  drop constraint if exists outside_meetings_prep_items_array,
  add constraint outside_meetings_prep_items_array
    check (jsonb_typeof(prep_items) = 'array');

create table if not exists outside_suggestions (
  id                    uuid primary key default uuid_generate_v4(),
  owner_id              uuid not null references auth.users(id),
  suggestion_key        text not null,   -- source + target identity
  evidence_hash         text not null,   -- what the evidence said when proposed
  source_meeting_id     uuid not null references outside_meetings(id) on delete cascade,
  source_commitment_id  uuid references commitments(id) on delete cascade,
  source_excerpt        text not null,
  goal_id               uuid references goals(id) on delete cascade,
  project_id            uuid references projects(id) on delete cascade,
  target_excerpt        text,
  person_id             uuid references outside_people(id) on delete set null,
  title                 text not null,
  reason                text not null,
  suggested_prep        text,
  status                text not null default 'open'
                        check (status in ('open', 'dismissed', 'connected')),
  added_meeting_id      uuid references outside_meetings(id) on delete set null,
  added_at              timestamptz,
  resolved_at           timestamptz,
  link_id               uuid references outside_meeting_links(id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint outside_suggestions_one_target
    check (num_nonnulls(goal_id, project_id) = 1)
);

alter table outside_suggestions enable row level security;

create unique index if not exists outside_suggestions_key_evidence_idx
  on outside_suggestions (owner_id, suggestion_key, evidence_hash);
create index if not exists outside_suggestions_open_idx
  on outside_suggestions (owner_id, created_at desc) where status = 'open';

create table if not exists outside_suggestion_runs (
  owner_id     uuid primary key references auth.users(id),
  fingerprint  text not null,
  ran_at       timestamptz not null default now()
);

alter table outside_suggestion_runs enable row level security;

drop policy if exists "outside_suggestions_all_own" on outside_suggestions;
create policy "outside_suggestions_all_own" on outside_suggestions
  for all using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from outside_meetings m where m.id = source_meeting_id and m.owner_id = auth.uid())
    and (added_meeting_id is null or exists (select 1 from outside_meetings m where m.id = added_meeting_id and m.owner_id = auth.uid()))
    and (source_commitment_id is null or exists (select 1 from commitments c where c.id = source_commitment_id and c.owner_id = auth.uid()))
    and (goal_id is null or exists (select 1 from goals g where g.id = goal_id and g.owner_id = auth.uid()))
    and (project_id is null or exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid()))
    and (person_id is null or exists (select 1 from outside_people p where p.id = person_id and p.owner_id = auth.uid()))
    and (link_id is null or exists (select 1 from outside_meeting_links l where l.id = link_id and l.owner_id = auth.uid()))
  );

drop policy if exists "outside_suggestion_runs_all_own" on outside_suggestion_runs;
create policy "outside_suggestion_runs_all_own" on outside_suggestion_runs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
