# Roles & expectations — approved direction

Andrew approved the three-screen prototype on September 26, 2026. Build this as a real, persistent product experience. This is a design-to-implementation brief, not a request for another concept or an onboarding redesign.

## Why this matters

Role expectations define what good looks like and ground coaching, 1:1 preparation, development, and assessments. The current experience fragments role descriptions, ladders, levels, metrics, skills, and values across settings. Managers struggle with both entering information and articulating standards. Helping them articulate success is itself product value, especially for newer managers.

The role-and-level model is appropriate. Support teams with many distinct roles and few people sharing each ladder as well as teams with substantial reuse. This must work for brand-new users and established users equally.

## Approved navigation change

Create **Roles & expectations** as its own menu item in the existing **Workspace** group, alongside **Org** and **Knowledge**. Verify the current navigation in `frontend/components/ZoneMap.tsx`; preserve the real app shell. A suitable dedicated route is `/app/expectations`, subject to checking current routes.

This overrides the prototype's illustrative “Foundation” group and placement. Move the role/ladder/level/expectations management experience out of Settings. Preserve old entry points through redirects or links; avoid parallel editors. Keep unrelated Settings functionality intact. Keep person-page read summaries linked to the canonical editor.

## Design reference

- `prototype.html`: standalone interactive reference.
- `prototype-source.html`: original fragment.

Use the screen hierarchy, editorial headings, restrained surfaces, plain-language role document, collapsible source JD, coaching panel, and review flow as the approved visual direction. Match current product tokens and shell. The sample people, job content, counts, and interactions are fictional and simulated; they are not production logic or customer data.

The prototype is not a complete functional specification. In particular, its new-role button jumps to a sample draft, reanalysis is simulated, persistence is local interaction state, and approval does not store separate published and draft versions. Implement these properly. Do not copy prototype state shortcuts, notices about simulated AI, or fake functionality into the product.

## Screen 1: overview

A clear roles-and-ladders overview led by **Needs review** when actionable items exist.

- Group levels under their ladder, with role title, assigned people, and understandable status.
- Show concrete unfinished decisions, not merely counts of metrics/skills/values.
- Each attention item opens the relevant draft or unresolved decision directly.
- Distinguish unapproved drafts, revisions awaiting approval, and approved roles with an unresolved detail.
- Remove resolved items from Needs review. Do not keep healthy roles styled as warnings.
- Support the existing essential operations: create/edit ladders, add/edit levels, assign or retain role associations, reuse expectations, and existing merge/deletion behavior where appropriate. Audit existing capabilities before moving the surface so nothing important disappears.
- Company values are defined once and reused. Do not multiply generic company values across role-level records.
- Provide a coherent first-use empty state and a real Define a role flow using the existing JD import as a starting point.

Onboarding can lead into this same experience later. Building general account onboarding is outside scope.

## Screen 2: draft and coaching workspace

**Draft first, then focused questions.** Start with the supplied job description; do not require a long interview before producing a useful draft.

Preserve the JD as source material and make it available in a collapsible pane during review. Audit how JD text is stored today; raw-file retention is not required by this decision. Andrew explicitly withdrew a proposed multi-document/Knowledge onboarding requirement: do not expand scope into that integration.

Present a coherent, editable role definition:

- Responsibilities and successful results.
- Relevant skills and observable behaviors.
- Shared company values and any justified role-specific expectations.
- Clear descriptions of meeting expectations, with exceeding expectations where useful.

Map plain-language content to the existing domain model without forcing the manager to classify every sentence manually. Do not introduce a parallel expectations model merely to match the mockup. Audit existing scales and assessment contracts; preserve their compatibility and semantics. Do not require managers to manufacture “exceeds” wording for every item just to complete the form.

AI acts as a thought partner. Ask focused questions tied to real gaps or ambiguity in the current draft. Let the manager answer through direct edits or a contextual answer field, whichever best fits the question. Answers and prior decisions must survive saving and reanalysis.

**Never invent a numerical target.** This is an explicit user constraint. Source-supported numbers may be extracted with provenance; manager-supplied targets may be used. Where a source says “drive retention” with no target, draft the responsibility and ask about the measure. Do not replace missing numbers with generic benchmarks, fabricated defaults, or misleading zero values. Distinguish source-derived information, proposed wording, and manager decisions.

Actions:

1. **Save & reanalyze:** persist the working draft, then analyze the latest text and answers. Preserve manager edits. Show updated questions and separately reviewable suggestions; do not silently replace their wording or alter approved expectations. If AI fails, keep the saved work and offer retry.
2. **Review for approval:** open the full review screen.
3. **Save & finish later:** persist the draft and return to the overview with a durable Needs review item.

## Screen 3: review and approval

Show the complete content that will become the active standard, with edit access and explicit unresolved details. The prototype's Edit actions return to the relevant field; inline editing is also acceptable if it preserves this coherent flow.

Approve the reviewed role definition as a whole. Do not force individual approval clicks on every expectation. AI suggestions that the manager has not accepted must not slip into the active record.

Allow approval of usable expectations even when a particular detail remains unresolved. Example: a renewal responsibility is approved while its numerical retention target is unset. The unresolved target remains visible and excluded from numerical evaluation. No target means no target, not zero or a guessed standard.

Require an explicit return path for deferred decisions, rather than letting them disappear. Persist the unresolved item, its role/level, and its follow-up timing or trigger. The prototype illustrates “in one week,” “before the next 1:1,” and “before assessment preparation.” Implement only triggers that can actually be honored. A date-based follow-up is a valid bounded first implementation; do not present event-based options without the underlying integration. Needs review must survive navigation and reload, remain accessible, and disappear when the approved resolution takes effect. Avoid notification-system scope creep.

## Approval and revision integrity

- Working drafts and approved expectations are distinct persisted states.
- Editing a previously approved role creates a working revision. Current approved expectations remain available to consumers until the manager approves the revision.
- Approval must be consistent across expectation kinds and follow-up state; avoid partial publication if one write fails.
- Preserve existing roles, assignments, values, and active expectations during rollout. Do not erase, reclassify as unapproved, or require reapproval of existing manually configured standards merely because this workflow is introduced.
- Audit how assessment periods consume expectations. Later changes must not silently rewrite historical or completed assessment standards; use the existing snapshot/version mechanism where available or add the smallest defensible mechanism.
- All downstream consumers must use approved content and understand unresolved fields. Use the shared expectations helper rather than creating divergent queries.

## Explicitly outside scope

- Employee editing, comments, collaboration, or acknowledgment workflows.
- Building the employee-facing area. Future employee access to expectations is read-only.
- A general onboarding rebuild or multi-document Knowledge ingestion redesign.
- New organization-wide approvals or department-head permission workflows. Respect current authorization boundaries.
- Automated performance judgments against missing standards.

## Implementation instructions

Read `CLAUDE.md`, then the relevant current docs: `docs/DESIGN.md`, `docs/ENGINEERING.md`, `docs/systems/expectations.md`, `docs/systems/assessments.md`, and `docs/systems/brand.md`. Inspect actual code and schema before choosing the implementation; do not treat documentation as proof of current code behavior.

Useful existing areas include:

- `frontend/components/ZoneMap.tsx`, current Settings page, `RoleImportPanel.tsx`, `DraftExpectationRows`, and `frontend/lib/api.ts`.
- `backend/routes/settings.py`, `expectations_ai.py`, `role_families.py`, `roles_import.py`, and the shared expectations helper in `direct_reports.py`.
- Existing expectation config/scale tables, role levels/families, org-wide values, and assessment snapshots or versions.

Follow project rules: authenticated user-scoped DB access; AI through `ai_core.py`; frontend API calls through `lib/api.ts`; migrations paired with schema updates and local verification; manager-reviewed AI writes only. Saving an unapproved working draft is not permission to publish its content to active expectations.

Check the working tree and preserve unrelated changes. Do not overwrite another task's handoff. This brief is the durable task context; do not assume unrelated `docs/HANDOFF.md` content belongs to this work.

Proceed with implementation using ordinary technical judgment. Surface only material product ambiguities that cannot be resolved from this brief. No deployment, push, or live customer-data migration is authorized by this brief alone.

## Acceptance and validation

Validate the meaningful flows, not just a screenshot:

1. Import a JD into a new role/level; review the draft and focused questions.
2. Edit expectations and supply a contextual answer; save/reanalyze without losing edits.
3. Supply a JD with no numerical target; verify no number is invented and no downstream evaluation assumes one.
4. Defer that detail; save, navigate away, reload, and return to the precise unresolved decision.
5. Approve the usable expectations with the gap explicit; verify approved content is available to existing consumers and the follow-up remains.
6. Resolve the gap in a working revision; verify active expectations remain unchanged until approval, then the review item clears.
7. Edit a previously configured role without losing assignments, shared values, or current expectations. Confirm historical assessments remain stable.
8. Exercise import collisions, save/AI failures, authorization isolation, and atomic approval behavior.
9. Check desktop and narrow layouts, keyboard access, source-pane behavior, and navigation from the Workspace menu and legacy links.

Use appropriate automated tests and build/type checks for the persistence, permissions, approval, and AI-output contracts. Verify the UI with fictional fixtures; do not fabricate a claim of real-job validation.

The final product acceptance checkpoint is **Andrew running an actual job description through the real flow**. Hand back a working local experience with concise testing instructions, what was verified, and any remaining limitations. Do not declare that real-job checkpoint complete before Andrew supplies/runs it.

Update canonical docs for the behavior actually implemented. Reference this selected direction in the project guide if appropriate, without overstating incomplete work.
