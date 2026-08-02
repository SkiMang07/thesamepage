-- Session 10 follow-up (2026-08-02): goals need a SMART-framework anchor.
--
-- Title/description covers Specific; due_date covers Time-bound. The gap was
-- Measurable/Attainable/Realistic — nothing captured what "done" looks like
-- in concrete terms. success_metrics is deliberately unstructured free text
-- (not a new metric_configs-style table) — per Andrew, it's meant to be read
-- by AI/agents, not parsed or scored, so a single text field is enough and
-- avoids fields that stay blank for goals that don't fit a rigid model.
--
-- Nullable, no backfill needed for existing rows.
--
-- Run once in the Supabase SQL editor.

alter table goals
  add column if not exists success_metrics text;
