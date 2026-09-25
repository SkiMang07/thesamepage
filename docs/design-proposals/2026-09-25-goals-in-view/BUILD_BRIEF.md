# Goals: outcomes first — approved build brief

## Authority and completion scope

Andrew approved the second Goals concept on September 25, 2026 and requested a prompt for Quad to implement it. Build the real `/app/goals` experience. The visual and interaction authority is **prototype-v2.html**, not prototype.html. Preserve both prototypes unchanged. This brief resolves the exploration's pending implementation choices; historical statements in REVISION_2.md about waiting for approval or interviewing managers are no longer prerequisites.

Deliver the approved goal board, optional numeric measures, inline updates, dated Updates view, scoped filtering, details and local Review together presentation. Numeric measures are part of the build, not a placeholder or a requirement to migrate existing goals. No new design exploration or advisory review is needed. Deployment, production migration execution, commit and push require a separate request.

## Efficient starting context

Read CLAUDE.md, this brief, docs/DESIGN.md, docs/ENGINEERING.md, docs/systems/brand.md and docs/systems/check-ins.md. Open prototype-v2.html and exercise a measured update and Review together. Then inspect the current Goals page, CheckInPanel, relevant API types/client functions, goals/check-in routes, schema and nearby tests. Read other files only when a dependency or ambiguity makes them relevant.

Start with a scoped working-tree check; implementation and other unrelated tasks may have advanced. Do not overwrite, revert or include unrelated changes. Do not preload historical session logs, every subsystem, all previous prototypes or the whole repository. REVISION_2.md is background when needed; its proposed research exercise is not a build task. Use VALIDATION.md only for prototype limits and useful scenarios.

## The experience to implement

1. **Goal board.** Editorial goal titles and readable success criteria/measures lead each goal. Match the reference's carbon/teal roles, proportions, whitespace and calm hierarchy. Every open goal in the selected scope remains reachable and visible in the board; exceptions lead without hiding healthy goals. Closed goals have a separate filter/door. No dashboard KPI strip or default side-by-side record browser.
2. **Level and scope.** Retain Individual, Team, Department and Company. Filter the records the caller actually has access to. Individual scope uses direct-report IDs; team/department scope uses org-unit IDs. Names are display labels, never grouping keys. Explicitly distinguish unassociated goals from All. Preserve first-populated-level behavior and deep links from other app surfaces.
3. **A clear success measure.** Written success criteria work without numeric setup. Optional numeric measures show actual value, unit, target/comparison and the reading date prominently. A goal without a measured value shows its target and an honest absence. Never infer a reading from prose, status or completion percentage.
4. **Recorded movement.** Small responsive plots contain real measured readings positioned by time, with an explicitly current-target reference. No forecast, synthesized health, averaged unrelated metrics or automatic goal completion. One reading needs no trend line. Provide a readable values/history alternative. Use existing primitives or simple SVG rather than adding a charting dependency.
5. **Add an update on the goal.** Expand a compact form in place with status, optional measured value (for a measured goal), optional completion percentage (for a legacy/unmeasured goal), and note. Use the existing check-in record/write path, extended as necessary. Blank means no new value; zero is a real value. Note-only updates must retain the older value and its date. Saving returns truthful feedback, refreshes the goal/history/feed from confirmed records, and uses a brief reduced-motion-aware acknowledgment.
6. **Updates.** A chronological view of existing check-ins in the selected level and scope. Show goal, date, recorded status, explicitly entered value/percentage when present, note and available source link. A note-only row must not claim an older reading was entered again. No new journal or activity-log product. Preserve canonical meeting source links.
7. **Details and existing functionality.** Keep goal create/edit/delete, all optional associations, status-only changes, full description and success metric, history, and explicit parent/child/project links. Details are a deliberate focused view with a clear return path. Reuse the same forms/write paths. Preserve manual entry, dictation and existing optional reviewed AI text revision. Global nav, Quick add, account controls, Scribe and mobile navigation remain the real app shell.
8. **Review together.** First choose goals from the current level/scope and preview exactly what will be displayed. Presentation shows their titles, exact success criteria, dates and recorded measures; status is opt-in. Exclude update notes, private descriptions, source links, other people records and manager controls. Provide next/previous, keyboard controls and a clear exit with focus restoration. It is a local presentation mode, not sharing, invitation, employee access or publishing. Nothing is sent. Never include hidden goals merely because they exist in the account.

Retain PageShell, existing semantic tokens, logo assets, app APIs and auth/RLS. Adapt the prototype to the real shell and Scribe reflow; do not copy its simplified shell, fixtures, fixed dates, explanatory destination dialogs or preview controls. A production action must execute its actual authorized operation, not display a prototype explanation.

## Optional numeric measures: bounded first version

The current success_metrics field is free text and check-in progress is a manually entered completion percentage. Neither is a measured actual value. Implement the smallest complete optional measure workflow:

- One optional numeric measure per goal, configured within goal creation/editing. Keep title, description and written success criterion. Configuration includes a descriptive label, unit/display format, target and comparison rule (at least, at most or below). No separate measure library or top-level page.
- Support counts, ordinary numeric values and percentages with appropriate formatting/validation. Counts use whole non-negative values; numeric values must be finite; percentages are not universally capped at 100 because NDR can exceed 100. Do not introduce guesses based on a unit's name or a goal's wording. Apply compatible validation to target and readings. General configurable bounds, currencies/conversion and formula fields are out of scope.
- Add a real measured-value input to check-in creation and return the persisted reading, date and context. Prefer extending the current goal/check-in model if sound; do not create a parallel history service. Preserve project check-ins and old callers that do not send new fields.
- Existing goals stay unmeasured until the manager explicitly configures a measure. Existing completion percentages and narrative history remain intact. Do not backfill measured values by parsing notes or translating percentages.
- Once readings exist, prevent silently changing their unit/format/meaning. Use a small clear restriction in the editor rather than building a measure-versioning system. Wording-only clarification can be edited without changing what the stored values mean. A different measure can be a new goal; multiple measures/replacement/version histories are deferred.
- Target changes may be supported in the existing editor, but all plots and comparisons must label the reference as the current target. Do not assert that this target applied historically, recompute old statuses, or manufacture an old target history. Show the actual saved criterion and measure together so any mismatch is visible to the manager.
- Values meeting the target may receive a factual acknowledgment. They never automatically change the recorded status to Completed or evaluate a person. Percentage completion and percent-valued outcomes must remain distinct in UI and API names.
- For unmeasured goals, render the written criterion honestly. The observed prototype's specially styled target fragments were hand-authored from inspected text; they are not a production parser. Do not build automatic extraction or AI measurement setup in this task.

Resolve routine schema/component choices autonomously. Ask only if a verified constraint requires a material change to this scope. Do not silently omit numeric setup merely because the prototype used fixed sample definitions.

## Correctness and compatibility

All frontend calls stay in frontend/lib/api.ts; authenticated backend paths use get_authenticated_client; existing AI stays draft-then-review through ai_core.py. Keep owner/RLS scoping and validate referenced goals, reports, org units and sources. Company/department classification does not grant visibility into other managers' named records.

A check-in must not report success while only part of its reading/status/history update persisted. Make the changed write path atomic or otherwise safely reconcile partial failure; prevent double submissions and avoid duplicate inserts on retry. Keep any fix narrowly scoped to the affected goal check-in path while preserving shared project and Beyond behavior. Do not refactor unrelated write infrastructure.

A successful write followed by a failed refresh is a refresh error, not a reason to repeat the write. Keep failed drafts and restore focus appropriately. Confirm navigation before discarding unsaved changes. Associate receipts/drafts with the correct manager, goal and scope; clear incompatible state on navigation/sign-out. Preserve richer enrichment fields when a mutation response returns only base goal columns, or refetch them.

Use actual dates/timezones. Newest check-in and newest non-null reading may have different dates. Status-only changes do not refresh evidence timestamps. Unknown, uninspected, inaccessible and failed data are not zero values or empty successful results. Protect against missing parents/cycles without an unbounded graph. Shared person/team names never imply a work relationship.

Extend API responses efficiently for the board/feed instead of issuing a full-history request for each card. Use a bounded recent history/summary and lazy detail where appropriate. Do not add an analytics warehouse, general search backend, websocket layer or premature performance framework.

Required schema changes need a dated migration and matching database/schema.sql, locally verified against database/local_verify_stub.sql per CLAUDE.md. Use backward-compatible optional fields/contracts and preserve existing rows. Do not run migrations against production in this build task.

## Scope and token discipline

- Make one short implementation plan, then execute it. No repeated restatement, speculative alternatives or repeated permission requests for routine choices.
- Search narrowly; read relevant ranges; batch independent reads. Reuse known findings. Read new context only to resolve a concrete dependency, failure or decision.
- Reuse existing components where they fit and extract only what this change genuinely shares. Do not rewrite global navigation, redesign other pages, upgrade dependencies or clean up unrelated code.
- No new advisory sessions, user-study tasks, research rounds, design variations, decorative asset generation, recurring automations, subagents or broad parallel audits unless Andrew asks or a binding project rule requires them.
- No multiple-measure OKR system, reminders, shared employee accounts, notifications, AI status/measure extraction, forecasts, points/streaks, retrospective corrections or target-versioning platform.
- Inspect existing test coverage before adding tests. Add focused behavior tests for changed data semantics and regression risks, not snapshots or tests that restate styling/implementation.
- Run relevant checks once after a coherent change. Re-run only what subsequent edits affect or what a failure requires. Broaden testing only for an identified risk or repository requirement.
- Keep progress updates brief: result, blocker or decision. Avoid giant logs and long transcripts. Update current docs only where behavior changed; no session-history narrative or duplicate architecture documents.
- Efficiency means eliminating unrelated work and repeated context loading. It does not justify skipping required correctness, preserving workflows, visual verification or complete measured-goal functionality.

## Acceptance and verification

Use local/test fixtures, never Andrew's live records for write testing. Existing project-required checks remain mandatory. Match the testing depth to the touched surfaces:

- Focused backend/database tests: owner isolation; optional measure configuration and validation; legacy/project caller compatibility; true zero versus blank; note-only retention of value/date; separate status and completion; reliable goal check-in writes and retry behavior; unchanged legacy records.
- Focused UI/integration checks: scope by IDs; inline save/error/draft retention; updates/readings consistent after save; goal forms and canonical links preserved; numeric setup actually usable; presentation excludes notes and respects selected records/status opt-in.
- Relevant frontend type/lint/build checks and touched backend tests. Run the normal suite if repository rules require it or the affected scope merits it; avoid unrelated exploratory test expansion.
- Inspect the actual rendered app against prototype-v2 at approximately 1440, 1024 and 390 pixels, plus Scribe-open reflow. Verify one populated measured example, a written-only/legacy goal, empty and failed states, long content, keyboard/focus behavior and reduced motion. Combine scenarios in a small representative fixture rather than exhaustively permuting them.
- Check existing Goals consumers only where the modified contracts/enrichment can affect them: Mission Control, Team, Relationship Desk, Projects/shared check-ins and Beyond. Do not redesign or broadly retest unrelated workflows.

Stop when the agreed experience works, scoped checks pass, the rendered result matches the approved hierarchy, and relevant current documentation is accurate. Report changed behavior, checks performed, any unverified checks and migration/deployment prerequisites. Do not label the build deployed. Do not commit, push, deploy or apply production migrations without a separate request.
