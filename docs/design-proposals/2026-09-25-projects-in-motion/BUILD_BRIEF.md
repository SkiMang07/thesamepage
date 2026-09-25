# Projects: keep things moving — approved build handoff

## Authority and scope

Andrew approved the Projects concept and requested real implementation through Claude, with one addition: each project currently takes too much space, and the opening screen needs a useful top-line portfolio view. Implement `/app/projects` using this brief and `prototype.html` with its `style.css` / `prototype.js`. Preserve all prototype files unchanged. This brief supersedes exploration-stage pending decisions for the bounded features below.

Build the portfolio overview, tighter project briefs, inline updates and dated record, private manager follow-through, existing project management actions, and deliberate local review mode. No new design approval round is required for routine layout or implementation choices. Do not commit, push, deploy or apply production migrations without a separate request.

## Start efficiently and protect concurrent work

Read CLAUDE.md, this brief, docs/DESIGN.md, docs/ENGINEERING.md, docs/systems/brand.md and docs/systems/check-ins.md. Inspect the rendered Projects prototype and its core update/follow-through/review interactions. Then inspect the current Projects page, relevant API types/client calls, project/check-in routes, required schema portions and nearby tests. Read other files only to resolve a concrete dependency. EXPLORATION.md and VALIDATION.md are supporting context, not additional research assignments.

Check working-tree changes first. At handoff, Goals implementation has advanced in the Goals page/components, API client, shared check-in helper/panel, schema, migrations, tokens and docs. The current check-in documentation now includes `progress_at` and a goal-specific transactional/retry-safe write path. Inspect current code; do not assume the exploration's older inventory is still authoritative. Preserve Goals behavior and all unrelated changes. Make minimal additive edits in shared files; do not replace or revert those files. Never include unrelated work in the eventual change report as your own.

## New top-line direction: Portfolio at a glance

The page must answer “What’s going on across the work?” before asking the manager to read full briefs. Implement this concrete first pass, using the approved palette and editorial language:

1. **Compact heading and summary.** Keep Projects unmistakable as the page name, with “Keep things moving” as the editorial line if useful. Reduce the current prototype's large top spacing. Follow with one restrained horizontal summary band, not four large dashboard cards:
   - Open projects: excludes Completed and Cancelled.
   - At risk / past due: distinct open projects with recorded At risk status OR a past local-calendar due date; count each project once.
   - Missing a recent update: open projects with no check-in or latest check-in older than 14 days. Explain the rule; this is missing context, not project risk.
   - Your open next moves: actual saved, incomplete manager follow-through, including any on closed projects so they are not lost.
   Show neutral counts unless an attention condition warrants amber. Counts are clickable filters/doors to the underlying records. Attention categories may overlap; do not depict them as a partition or sum them into a synthetic score. Partial or failed data is unavailable, never an all-clear or zero.
2. **A compact portfolio scan beneath the band.** A single calm list/table with project + owner, latest dated update excerpt, recorded status and attention reason. Keep exact note text; truncate visually with a full-text route. A missing update gets an explicit absence, not invented movement. Purpose and goal connection remain in the brief below. No completion chart, average progress, inferred blocker, “needs a decision” classification or generated executive summary.
3. **Bound the opening footprint.** Show up to five rows, exceptions first, with a clear “Showing 5 of N · Show all” control when needed. Show all reveals the remaining compact rows; this is not pagination infrastructure. Each row focuses/scrolls to its project brief, with keyboard-accessible navigation and a visible focus treatment. All scoped open briefs remain reachable below; this is a scan layer, not a return to an empty detail-selection screen. For one project, show its single row and meaningful empty fields without a sea of empty tiles.
4. **Filters work together.** Keep search and owner filter close to the overview, plus Open projects / My follow-through / Closed. Identity keys are IDs, never names. Overview counts use the current owner/search scope; the selected attention filter narrows the scan and briefs without recursively shrinking the other category counts. Label the scope and provide a clear reset. Do not show open-project summaries misleadingly over Closed or My follow-through; adapt the heading/count to that view.
5. **Responsive behavior.** On desktop around 1440 × 900, the first viewport should include the compact heading, summary and several portfolio rows without requiring a full brief first. On phone, convert scan rows to compact stacked entries rather than a horizontally scrolling table. Scribe-open layout follows available content width. Avoid a tall sticky stack.

This overview is authorized design latitude, not an already-tested prototype revision. Build and visually inspect one strong version; adjust only where the result fails its scanning purpose. Do not create multiple new concepts or a visualization library.

## Preserve the approved brief and contribution loop

- Tighten vertical padding and repeated labels. Purpose and latest situation must remain visible together; do not solve density by hiding both behind selection. Aim for a materially shorter brief than the prototype, adapting height to content rather than enforcing a clipping-prone fixed height. Long content can use an explicit expansion, with a useful excerpt still visible.
- Show real project owner (or You under existing unassigned semantics), explicit team/department, purpose/description, explicit goal connection or neutral Standalone, due date, and recorded status. Standalone is valid. Never infer a goal or ownership from names, notes or scope.
- Keep inline Record an update: status, optional whole-number 0–100 completion, optional note. Blank means no new completion; zero is real. Retain earlier non-null completion and its own date on note-only updates. Do not introduce Goals numeric-measure configuration to Projects.
- Save against the real check-in path, update the brief/overview/history from confirmed results and provide restrained success feedback with reduced-motion support. Keep failed drafts and prevent duplicate submissions. A successful write followed by a failed refresh must not invite resubmitting the write.
- The record shows full dated notes, each entry's recorded status and only percentages entered in that entry. Preserve explicit Beyond meeting source links and real navigation. History failure is not “no updates.” Load detail on demand, not full histories per overview row. Derive any missing counts in a bounded response or omit decorative counts rather than create N+1 queries.
- Preserve create/edit/delete, status-only edits, optional associations, date clearing, full description, manual entry, dictation and existing reviewed AI text assistance. A status-only edit does not create a dated check-in or refresh its evidence timestamp. Keep forms in place and provide a clear return path. Retain honest empty/loading/error states.
- Keep the real PageShell, app navigation, Quick add, account controls and Scribe, including selected-project context. Reuse semantic tokens and real logo assets. Do not port the prototype shell, fixture people, fixed dates, preview toggles, explanatory source dialogs or local-only persistence.

## Private follow-through: bounded real capability

Implement the prototype's Your next move and My follow-through as durable, owner-scoped functionality. This approval includes the necessary small backend/schema work; do not leave it as a pretend button or browser-only state.

One current manager-authored next move per project is sufficient: write/edit, mark done, reopen, and replace with the next move. Retain completed records when adding a new move so completion does not silently erase the previous action. A simple completed section in the project's follow-through area is enough; do not build a task-management timeline. Define a clear one-open-item constraint and safe behavior if reopening conflicts with a newer open item. Project status and follow-through status remain independent. My follow-through includes open actions on closed projects, with their project state labeled.

Inspect the commitments model first and reuse it if the association and ownership semantics fit cleanly. Its current public create contract requires a direct report and creates `source_type=manual`; it cannot simply be called for a manager-owned standalone project or treated as if project linking already works. Do not fabricate a report relationship. Prefer a narrow project-owned association/write path using existing structures where sound. If safe reuse would force unrelated commitment infrastructure changes, choose a minimal project-specific representation and explain the tradeoff briefly. Make one implementation decision, not a broad architecture study.

No contributor assignments, due-date system, reminders, notifications, dependencies, workflow automation, subtasks or new top-level task page. Do not automatically surface these actions in unrelated meeting prep or employee views. Saving is private and never implies sending.

## Prepare a review

Implement the local presentation flow as a secondary action. Choose projects from the currently visible scope, initially none selected. Preview exactly the title, purpose, owner and goal connection to be displayed; status and due date remain opt-in. Let the manager explicitly compose an optional discussion question for each selected project. Questions are temporary presentation state, never inferred from private notes or saved into project history automatically.

Presentation includes only selected records and approved fields/questions. Exclude stored update notes, private follow-through, meeting links and manager controls. Provide accessible exit/Escape and focus restoration. Do not include hidden records because they happen to exist in the account. Do not claim that this view shows the latest situation: its current purpose is discussion of chosen project context and a deliberate question. No sharing, exporting, collaboration or new permissions.

## Correctness and integration boundaries

All frontend API calls go through lib/api.ts. Backend requests use authenticated clients and current owner/RLS rules. Validate related IDs and ownership, including reads and mutations of follow-through. Never broaden visibility through a project link. Existing AI remains draft-then-review through ai_core.py; no new AI pipeline is required.

Use actual local dates for due/freshness logic. Newest note date, current status and last asserted percentage date can differ. Preserve richer enrichment after base-field mutation responses. Keep drafts associated with the correct project/account and protect unsaved edits during navigation; clear incompatible state on sign-out.

The project check-in helper was historically insert-then-status-update. Inspect what exists now and ensure the changed project save path cannot falsely report success after a partial write or duplicate on retry. Reuse the new goal path's applicable pattern if suitable without converting project percentages into measured goal values or rewriting shared write infrastructure. Preserve confirmed Beyond writes and legacy callers.

Any schema change requires a dated migration, matching schema.sql and the local verification required by CLAUDE.md. Preserve existing rows/contracts. No production migration execution. Limit consumer checks to the contracts actually changed: Goals/shared check-ins, Beyond, and current project/commitment consumers as applicable.

## Token and scope discipline

- Make one short plan, then execute. Use focused searches, bounded reads and batched independent inspection. Reuse findings; no repository/history preload or repeated context summaries.
- No new advisory process, research, user-study prerequisite, subagents, parallel audits, speculative variants, generated assets, dependency upgrades or unrelated cleanup unless explicitly requested or required by a binding project rule.
- Reuse existing forms, tokens and tested compatible helpers. Extract only what is genuinely shared. Do not redesign Goals or other pages.
- Inspect existing tests, then add focused coverage for new data semantics and material regressions. Avoid style snapshots, mirrored implementation tests and exhaustive cross-products of states.
- Run relevant checks after coherent changes; repeat only affected checks after subsequent edits or to resolve failures. Required repository checks still apply. Efficiency never means skipping auth, write reliability or visual verification.
- Keep updates and final reporting concise. Update current docs only where behavior changed; no historical session narrative or duplicate architecture documents.

## Acceptance and stopping point

Use fictional local/test data for all write checks. Verify:

1. The opening viewport communicates portfolio state; summary counts/filtering match records, overlap is honest, Show all exposes the complete scan, and row navigation reaches the right brief.
2. Purpose and latest situation remain readable in tighter briefs. Missing/stale evidence, standalone/manager-owned projects, a narrative-only project and long content remain understandable.
3. Update, status-only edit, create/edit/delete, source/history navigation and failed-save draft retention work. Blank versus zero and the older percentage timestamp remain correct. Check retry/partial failure on the affected write path.
4. Follow-through persists, respects ownership, can complete/reopen safely, retains completed actions when replaced and never changes project status or assigns to someone else.
5. Review starts with explicit selection, excludes private notes/actions, shows only chosen fields/questions and exits accessibly.
6. Relevant type/lint/build and focused backend/database checks pass. Inspect rendered desktop (~1440), tablet (~1024), phone (~390) and Scribe-open behavior, plus representative empty/error states and keyboard/focus behavior. Test the overview with more than five projects. Combine scenarios in a small fixture; no broad new testing program.

Stop when these behaviors work, relevant checks pass and the rendered hierarchy meets the reference plus the new top-line requirement. Report what changed, tests actually run, limitations and migration prerequisites. Do not claim deployment or perform commit/push/deployment without separate authorization.
