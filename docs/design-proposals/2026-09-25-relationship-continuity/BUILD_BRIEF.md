# Relationship Desk: conversation continuity

## Status and design authority

Andrew selected and locked this version on September 25, 2026, and requested a Claude implementation prompt. Implement this design for the individual Relationship Desk at /app/reports/[id]. Proceed with implementation rather than another design exploration.

The approved visual and interaction reference is the unchanged [prototype.html](prototype.html). [EXPLORATION.md](EXPLORATION.md) records the rationale, capability inventory, observed boundaries, and API dependencies. [VALIDATION.md](VALIDATION.md) records prototype checks and their limits. This brief turns that exploration into implementation direction. It does not claim the implementation has shipped.

Preserve the prototype and both prior design packages. Preserve unrelated work and any active docs/HANDOFF.md; this scoped brief does not replace another task’s handoff. Inspect the current checkout before editing because Team and shared components may have changed since exploration.

The prototype controls marked as local simulations or destination boundaries explain the journey; their implementation shortcuts are not production requirements. In conflicts, keep the approved composition while honoring verified current data semantics, privacy rules, and the boundaries below. Do not copy fixtures or invent records to reproduce the populated example.

## Read and inspect first

Read CLAUDE.md, docs/DESIGN.md, docs/ENGINEERING.md, docs/systems/brand.md, docs/systems/one-on-ones.md, docs/decisions/next-one-on-one-workspace.md, gtm/personas/new-manager.md, and gtm/brand/voice-rules.md.

Then read this package and open prototype.html in a browser. Read docs/systems/development.md, expectations.md, assessments.md, and check-ins.md for the capabilities being preserved; capacity.md when touching capacity behavior.

Review the selected Mission Control and Team references for visual consistency:
- docs/design-proposals/2026-09-24-week-in-focus/BUILD_BRIEF.md and prototype-source.html
- docs/design-proposals/2026-09-25-team-overview/BUILD_BRIEF.md and prototype.html

Team’s brief included evidence-backed preparation, effortless capture, and visible confirmed outcomes beyond its original prototype. Do not assume that prototype demonstrated all three or copy Team’s data semantics into 1:1s. Inspect any now-shipped shared patterns before creating new ones.

Inspect the actual person page, its prep and log routes, shared wrap-up review, relevant components, frontend/lib/api.ts, frontend/lib/one-on-one-workspace.ts, backend/routes/one_on_ones.py, backend/routes/commitments.py, and relevant schema. Treat exploration-time findings as a starting point to verify, not a substitute for current code.

## Purpose and approved composition

The recurring job is understanding and supporting one person over time. Within ten seconds, the manager should recognize the person, remember the last conversation, see what is gathering for the next one, and recognize their own follow-through.

Use the prototype’s carbon ground, teal primary/selected states, editorial headings, readable metadata, named avatars, purposeful whitespace, and progressive disclosure. Keep this a Relationship Desk rather than a miniature Team dashboard. No score strip, relationship-health judgment, AI personality description, motivational subtitle, or new manually maintained relationship summary.

1. **Identity.** Name and avatar, role/level, team, existing person notes when present, and an accurate privacy statement. Person settings and Log a 1:1 are secondary actions. Move the latest assessment context into Growth, preserving access, rather than displaying it beside the person’s name.
2. **Relationship / Work / Growth / Private notes.** Relationship is the default. Keep the tab row visually quiet, accessible, and usable on narrow screens.
3. **Last-to-next conversation.** One connected surface: a short literal excerpt from the latest completed reviewed summary above the next occurrence. The excerpt opens its full summary. The next section shows actual date or undated state, preparation state, repeat rule when applicable, one carried topic with access to all, compact source disclosures, and the primary Review & prepare or Start 1:1 action.
4. **Capture immediately below.** One field and one explicit Keep for next 1:1 action. Explain that it is private prep context. Saving makes it available to source review, not a sent message or automatically published agenda.
5. **Follow-through beside the conversation.** Explicit You and person-name groups, factual counts, dated/undated commitments, and quiet done/drop/reopen actions. Show three initial rows per owner, then a count-accurate expansion. Prioritize overdue/earliest due records deterministically and keep undated records reachable.
6. **Compact work and growth previews.** Show actual scoped records and a literal saved-plan excerpt with destinations to their respective views. Avoid an additional authored synthesis. Omit unsupported metadata rather than filling it with assumptions.
7. **Past conversations.** A compact dated timeline of completed conversations, expandable reviewed summaries, and text search over the fetched summary records. No wall of expanded notes, inferred themes, or generated historical headlines. The unfinished next occurrence stays in its own surface.

Adapt dimensions to the existing shell; retain the reference’s hierarchy and proportions. Reuse PageShell, semantic tokens, existing components, and current logo assets. Keep real global navigation, person switching, Quick add, Scribe, account controls, mobile navigation, and dictation. The prototype’s simplified shell is not a replacement specification.

## Real interactions and canonical workspaces

Implement the Relationship Desk’s actual reads/writes, disclosures, filtering, source links, and post-save feedback. Do not ship explanatory placeholder dialogs in place of existing functionality.

- Preparation and running a 1:1 remain on the canonical prep/call route. Preserve source review, saved situation summary, rationale/questions, live call notes, and the mandatory final closing question. The prototype’s literal selected-source list is only a simulation, not the agenda-generation algorithm.
- Date & repeat opens or focuses the existing canonical scheduling controls, or reuses those controls and write path without creating a second scheduling model. Preserve 1–4 week repeats, date-only semantics, timezone handling, and no-invitation copy.
- Log a 1:1 retains the canonical ad-hoc workflow. Keep the prepared-occurrence versus different-conversation choice where applicable.
- Work shows actual person-scoped goals, project status, check-in text/date, and explicit links. Edits and check-ins stay in Goals and Projects. Preserve standalone projects. No relationship is inferred merely from a shared owner.
- Growth remains on the person page, with the complete existing development functionality. Keep plan narrative separate from aspiration, opportunities, training, and private notes. Preserve aspiration timeline/notes, opportunity source links, training date/cost/completion/removal, manual writing, and optional reviewed AI assistance.
- Expectations show the actual assigned role’s metrics/skills/values and applicable organization-wide values. Preserve missing-role assignment and missing-configuration states. Assessment editing remains on its canonical page; maintain read-only summary access from Growth.
- Private notes remain the manager’s append-only notebook, with existing manual entry and optional AI revision. They are never included automatically in prep. Do not add edit/delete semantics that the current API lacks.
- Person settings preserve cadence override/inheritance, capacity overrides/defaults, weekly availability context, and time-off operations. The condensed prototype dialog is not the full editor.
- Reviewed history detail can expand in place or reuse a read-only detail surface. Expose existing record data with verified access. The exploration found no 1:1 summary-correction endpoint; do not assume Team’s correction workflow exists here or introduce it as part of this redesign.

Read the full preservation table in EXPLORATION.md and reconcile it against current code before considering the migration complete.

## Capture, sources, and factual evidence

Use existing capture operations. Clear the input only after a successful save, retain text on failure, prevent duplicate submissions, and return focus for another entry. Refresh counts and the next workspace from real results. Keep saving/saved/failure states truthful; never label browser-only call drafts as account-synced.

Captures are consumed by successful preparation according to existing semantics. They are not a permanent history store. After preparation, show the persisted guide; preserve saved source notes when reviewing/revising it and distinguish newer captures from the already prepared sheet.

Carry-forward topics already belong to the unfinished occurrence. Do not insert duplicate copies when they are inspected. Commitments remain live accountability records; excluding one from a prep selection never resolves or deletes it.

The compact work-update disclosure uses actual check-in records with their source and date. “Since the last 1:1” requires a known prior meeting date and a qualifying event timestamp. Otherwise use “Latest recorded update,” label the true basis, or show an honest empty state. A current status is not evidence of a transition. Distinguish a failed source fetch from no updates.

Keep the existing prep-source contract. At exploration it included at-risk goal suggestions and the development plan. The prototype’s active-goal update is read-only evidence; this approval does not add arbitrary check-ins or sensitive observations to the agenda automatically.

## Commitment provenance and confirmed outcomes

These are part of the selected experience, not optional placeholders. Use the smallest scoped API changes needed:

- Logging already stored commitment source_type/source_id, but the inspected commitment list and frontend type omitted them. Verify current contracts, expose the fields if still missing, and validate source access under existing manager/person scope.
- Link commitments to their actual conversation and derive per-conversation counts from those explicit links. Preserve manual/other-source commitments with truthful source labeling. Handle missing, deleted, inaccessible, and legacy sources without synthesizing associations.
- After successful reviewed logging, return the manager to the Relationship Desk with a compact dismissible receipt: the reviewed summary, actually persisted commitments with owners/dates, confirmed carry-forward topics, and the resulting next occurrence/date or undated requirement.
- Decisions remain part of the reviewed summary. Do not create a new decision database or save extra records to manufacture the receipt.
- Construct the receipt from verified server results. The inspected log response returned meeting and next_session, not the newly created commitments. Reuse an updated response or refresh/filter by real source relationships to get authoritative records. Do not report every submitted draft as saved merely because it was submitted.
- Retain a failed draft and show the error. A successful meeting write with a failed receipt refresh must not encourage re-logging; label the remaining fetch problem and retry the read. Audit retries/partial failure in the logging path and avoid duplicate commitments or next occurrences. Fix any narrowly necessary correctness issue rather than masking it with client-only success feedback.
- The immediate receipt can show confirmed outgoing topics. An occurrence’s carry_forward_items are inputs to that occurrence, not a complete historical outbound ledger. Do not reconstruct old carry-forward provenance from them.
- A receipt is feedback on one confirmed operation, not a permanent new object. Scope its state to the manager, person, and logged meeting; clear incompatible state on navigation/sign-out. Reconstruct only what persisted records actually support.

## Privacy and lifecycle invariants

Keep private notebook entries, capture notes, prepared agendas, raw call notes, and reviewed summaries distinct. Nothing on this manager-facing page is newly shared with the employee. Saving and status changes send no message.

Preserve existing auth/RLS and verify actual scope rather than broadening access to fill a card. All frontend calls go through frontend/lib/api.ts; all AI calls go through ai_core.py. AI remains draft-then-review. Do not add any automatic AI promotion into the record or agenda. Preserve existing canonical preparation behavior and flag any discovered conflict with the project’s AI-review rule explicitly rather than silently inventing a replacement contract.

Use the canonical meeting-date and cadence resolvers. Due by cadence is not a scheduled date. A past scheduled date does not mean completed; completion follows the recorded summary. Show unknown dates/times honestly.

Logging leaves the appropriate unfinished workspace. Recurrence anchors to the scheduled date and skips past slots when logging late. Ad-hoc logging can leave an undated workspace. Preserve separate-occurrence logging, merging into an existing suitable open workspace, live commitments, and frozen logged agendas. Dismissing an unfinished occurrence stops its series according to existing behavior.

Honor entitlement/read-only states, existing draft recovery, loading skeletons, independent section failures, and refresh behavior. Keep note text and sensitive content out of logs and analytics.

## Implementation scope and exclusions

Implement within the existing Next.js/FastAPI application. Extract focused components where helpful and reuse shared meeting/review patterns without coupling Team and 1:1 semantics. Avoid a large replacement monolith.

The approved scope includes the presentation, current-capability interactions, commitment source exposure, and reliable outcome receipt. It excludes new employee sharing, generated relationship judgments, permanent topic threads, new summary editing, standalone decisions, and a new development workspace.

No schema change is expected for source-field exposure. If a necessary correctness change does require one, follow CLAUDE.md: dated migration plus schema.sql, locally verified with the stub and functional checks. Do not apply production migrations as part of this task.

Do not ship fictional records, fixed dates, example AI drafts, preview labels, reset/empty-state switches, local-only save behavior, raw prototype DOM code, or an iframe. Preserve prototype files as the visual reference.

## Validation and completion

Inspect the real rendered implementation against the reference around 1440px, 1024px, and 390px, including Scribe open. Test empty/sparse data, long names and summaries, many commitments/captures/history entries, missing roles/assessments, undated/past meetings, no check-ins, stale check-ins, source failures, and prepared state after capture consumption. Use readable contrast, visible focus, semantic tabs/dialogs, touch targets, and reduced-motion support. Preserve keyboard focus after updates and drafts across appropriate view changes.

Use targeted tests for:
- Auth/person scoping and inaccessible source links; no cross-person receipt or draft leakage.
- Group counts, overflow, due ordering, all commitment status transitions, and source-specific history counts.
- Capture success/failure, duplicate-submit prevention, saved-source retention, and private-note exclusion.
- Selected prep sources versus live commitments; no duplicate carry-forward topics.
- Both logging paths, actual meeting date, undated/recurring rollover, preserved prepared occurrence, reviewed inclusion, failed confirmation, retry safety, and accurate receipts.
- Honest unknown/error states, work/check-in links, role prerequisites, and preservation of development/settings capabilities.

Run the repository’s relevant type/build/lint checks and targeted backend/frontend tests. Verify writes in local/test fixtures, not Andrew’s live records. The prototype’s validation is not evidence that backend persistence or auth is correct. Report any unverified check precisely.

Once implemented, update relevant canonical Design/1:1/development documentation to describe shipped behavior and preserve superseded durable material per project rules. Keep this proposal as the selected reference. Summarize changed behavior, visual verification, tests, and remaining limitations.

Do not commit, push, deploy, or apply production migrations unless separately requested. Proceed autonomously on routine implementation choices; ask only for a genuine blocker or a material product decision outside this brief.
