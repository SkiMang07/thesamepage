> **ARCHIVED — historical, not current intent.** All six build sessions completed. Current behavior: `docs/systems/context-engine.md`.

# The Context Engine — Build Plan v1

Drafted 2026-08-11, Session 27. Resolves the five open questions at the end
of `CONTEXT_ENGINE.md` and translates each resolution into sessionable build
chunks. Companion to `CONTEXT_ENGINE.md` (framework) and
`COO_AGENT_QUESTION_SET.md` (why this matters). No code written this session.

## Open questions — resolved

1. **Extraction pipeline.** Claude-native: convert PPTX→PDF (headless
   LibreOffice), feed pages to Claude via `ai_core.py`'s `generate_text()`
   using native PDF/vision support. No new extraction library or vendor;
   reuses the one sanctioned AI path. Cost scales with pages-per-doc and
   folds into the existing per-call cost model (see #4).
2. **Confirm-card placement.** Inline in the Space, immediately after
   upload — preserves the "trust moment" (first thing the system does is
   show it understood you) and keeps upload→confirm one motion.
3. **Novelty scoring granularity.** Per-document for v1. One Librarian
   judgment per upload drives fill; simple to compute, ships fast, honest
   about junk uploads. Per-category-question scoring (stronger, harder) is
   explicitly deferred, not designed around yet — no schema commitment made
   to ease a future upgrade, since that would be speculative work now.
4. **Cost model.** Immediate processing, no cap. Every upload triggers a
   synchronous Librarian read (required for #2's inline confirm-card to
   feel instant). Per-call cost accepted as a COGS line at current usage
   levels; revisit if upload volume or doc size makes it material.
5. **Sensitive docs.** Scope + RLS only, no new mechanism. A comp/pricing
   doc scoped to a team or company is only visible to managers with RLS
   access to that scope — same as every other doc. Matches the existing
   manager-only v1 boundary; no IC-facing views exist yet to leak into.

## Build sessions

Sized and sequenced against the existing repo pattern (schema → backend →
frontend → verify, one domain per session). Each should end with a real
migration written (even if not run live, per the project's current backlog
of un-run migrations) and `tsc`/`next build`/`py_compile` verification.

### Session I — Schema & storage foundation
- `documents` table: id, org_id, uploaded_by, title, storage_path, category,
  freshness_class, effective_date, series_id (nullable), summary_card,
  extracted_text, novelty_score, confirmed_at (nullable — null until the
  user confirms the card), created_at.
- `document_scopes` join table against the existing `org_units` hierarchy
  (a document can carry multiple scopes — many-to-many, not a single FK).
- `document_series` table: id, org_id, name, cadence.
- `document_citations` table: document_id, cited_in (answer/context ref),
  cited_at — the ledger the Brain's credit flow-back (Session V) reads from.
- Supabase storage bucket for raw uploaded files (PPTX/PDF/text).
- RLS: scope-cascade read policy via `current_org_id()` / org_units
  ancestry — **do not inline a `users` subquery** (see the standing RLS
  recursion lesson); reuse the security-definer helper pattern already
  established for org_units.

### Session II — Extraction + Librarian pipeline (backend)
- Upload endpoint: accept PPTX/PDF/plain text; PPTX routed through headless
  LibreOffice → PDF first.
- Single Librarian call per doc via `generate_text()`: extract full text
  and, in the same structured call, propose category / scope / freshness
  class / effective date / summary card / novelty score.
- Store the proposal in the row with `confirmed_at = null` — this is the
  pending state the confirm-card (Session III) reads and writes back to.
- Series detection: match against existing `document_series` by
  title/category/cadence heuristics; create a new series when a doc looks
  recurring but doesn't match one.

### Session III — Confirm-card UX (frontend, inline)
- Upload component in the Space; on upload, show a loading state, then the
  Librarian's proposed card inline (not a separate queue).
- User can edit category/scope/freshness/effective-date before confirming;
  log corrections distinctly from confirms-as-is (training signal per the
  framework doc, not yet wired to anything downstream — just captured).
- Confirm sets `confirmed_at`; only confirmed docs are eligible for
  retrieval (Session IV) or Brain fill (Session V).

### Session IV — Retrieval + agent integration
- Two-tier retrieval helper: search summary cards first (scoped by the
  cascade — team's own docs + department's + company's, more-specific wins
  on stated conflicts), pull full `extracted_text` only for top matches.
- Wire this helper into the existing `generate_text()` call sites for the
  COO/domain agents as an additional context source.
- Write to `document_citations` whenever a doc is actually used in an
  answer — this is the only new write path this session; no auto-extraction
  into other app tables (stays out of scope per the framework doc).

### Session V — The Brain (visualization)
- Coverage view per category: fill weighted by aggregate novelty score,
  never by document count.
- Decay rendering: dim regions by freshness-class-driven age curve.
- Click-through per region: summary cards (what's known) + static
  first-person gap-question copy per category (what's missing) — a
  lighter-weight stand-in for the deferred per-category-question scoring
  from resolution #3, reusing the same category taxonomy already defined.
- Credit flow-back: read `document_citations`, surface as a glow / "used in
  N answers this week" on the sourced region.
- Visual form: build the first pass on the existing dashboard's
  orbital/radial "mission control" motif — lowest design risk, consistent
  with current aesthetic. Treat as a placeholder, not a lock-in; revisit in
  a dedicated design pass if it doesn't earn its kitsch-avoidance bar.

### Session VI — Staleness + precedence surfacing
- Decay weight as a computed value (freshness class + effective date →
  confidence curve), read by both retrieval ranking (Session IV) and Brain
  fill (Session V).
- Conflict detection: when two confirmed docs share a category + overlapping
  scope and disagree in effective-date order, flag rather than
  auto-resolve — same restraint pattern as logged-vs-assumed capacity.
- Librarian proactive staleness prompts on aging load-bearing docs (the
  first piece of Mode-B proactive behavior for this feature, scoped small).

## Sequencing notes
- I → II → III is a hard chain (schema, then the pipeline that fills it,
  then the UI that confirms it). IV and V both depend on III (only confirmed
  docs are usable) but not on each other — could run in parallel across
  two sessions if useful. VI depends on IV and V both existing (it reads
  decay into ranking and fill).
- This feature has no dependency on the check-ins layer landed in the
  parallel Session 26 track; confirm current migration-run state before
  Session I so RLS helper reuse targets what's actually live.
- Per-category-question novelty scoring (the stronger half of resolution
  #3) and a real sensitivity flag (the stronger half of resolution #5) are
  both explicitly deferred, not designed around — revisit only if usage
  after v1 ship demonstrates the simpler version is insufficient.
