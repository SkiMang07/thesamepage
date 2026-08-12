-- Context Engine — Session III (2026-08-12), confirm-card support
-- (docs/CONTEXT_ENGINE_BUILD_PLAN.md's "Session III — Confirm-card UX").
-- Depends on database/migrations/2026-08-12_context_engine.sql (Session I,
-- already confirmed live) already being run.
--
-- Adds two columns to `documents` to satisfy the build plan's "log
-- corrections distinctly from confirms-as-is (training signal per the
-- framework doc, not yet wired to anything downstream — just captured)"
-- requirement. Nothing reads these yet; this is pure capture for a future
-- pass (the framework doc calls this out explicitly — see
-- docs/CONTEXT_ENGINE.md's "the Librarian" section, "a wrong guess,
-- corrected once, is training signal").
--
-- Both columns stay null until PUT /api/documents/{id}/confirm runs
-- (backend/routes/documents.py) — a document sitting in status='processing'
-- or 'pending_review' has neither set.
--
-- Run this against the live Supabase database. database/schema.sql has
-- already been updated to match, for future reads.

alter table documents
  add column if not exists confirmed_as_is boolean,
  add column if not exists correction_log jsonb;

comment on column documents.confirmed_as_is is
  'Set at confirm time (Session III): true if the user accepted the Librarian''s proposed category/freshness_class/effective_date as-is, false if they edited any of them before confirming. Null until confirmed.';

comment on column documents.correction_log is
  'Set at confirm time when confirmed_as_is is false: {field: {proposed, confirmed}} for each of category/freshness_class/effective_date the user changed from the Librarian''s proposal. Captured as a future training signal (docs/CONTEXT_ENGINE.md) — not read by anything yet. Null when confirmed_as_is is true or the doc isn''t confirmed yet.';
