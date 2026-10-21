-- ============================================================
-- Individual goals start from the role's expectations (Andrew, 2026-10-20)
--
-- docs/GOAL_ATTRIBUTION_SCOPING.md, Part B. A person's role expectations show
-- as their starting goals, read live from the role: no per-person copies. A
-- goal record exists only when the manager makes one specific to the person
-- (a stretch, a date, a note on how), and it keeps a link to the expectation
-- it started from.
--
-- goals.source_metric_config_id / source_skill_config_id: that link. At most
-- one is set, and only on an individual goal. A retired expectation keeps its
-- row (retired_at), so the link survives a revision; set null only if the
-- config row itself is deleted.
--
-- metric_entries becomes the one number track for an expectation: readings
-- are now written from the person page and Goals as well as from a completed
-- assessment. The policy's check now also requires the reading to be about one
-- of the caller's own reports (reads are unchanged).
--
-- Idempotent.
-- ============================================================

alter table goals
  add column if not exists source_metric_config_id uuid references metric_configs(id) on delete set null,
  add column if not exists source_skill_config_id  uuid references skill_configs(id) on delete set null;

alter table goals drop constraint if exists goals_one_source;
alter table goals add constraint goals_one_source
  check (source_metric_config_id is null or source_skill_config_id is null);

alter table goals drop constraint if exists goals_source_individual;
alter table goals add constraint goals_source_individual
  check ((source_metric_config_id is null and source_skill_config_id is null) or level = 'individual');

create index if not exists goals_source_metric_idx on goals (source_metric_config_id)
  where source_metric_config_id is not null;
create index if not exists goals_source_skill_idx on goals (source_skill_config_id)
  where source_skill_config_id is not null;

create index if not exists metric_entries_report_config_idx
  on metric_entries (direct_report_id, metric_config_id, recorded_at desc);

drop policy if exists "metric_entries_all_own" on metric_entries;
create policy "metric_entries_all_own" on metric_entries
  for all using (recorded_by = auth.uid())
  with check (
    recorded_by = auth.uid()
    and exists (
      select 1 from direct_reports d
      where d.id = metric_entries.direct_report_id and d.manager_id = auth.uid()
    )
  );
