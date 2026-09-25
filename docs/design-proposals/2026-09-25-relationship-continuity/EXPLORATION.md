# Relationship Desk: conversation continuity

September 25, 2026. Exploration record. Andrew subsequently selected and locked this concept and requested an implementation prompt. See [BUILD_BRIEF.md](BUILD_BRIEF.md) for implementation direction. The approved prototype remains unchanged; the observations below describe the original exploration.

Open [prototype.html](prototype.html). It is self-contained, works offline, calls no account API, uses no browser storage, and resets on refresh. Every person and record in it is fictional. No application code, live records, existing proposal packages, or implementation handoffs were edited.

## Assessment and organizing ideas

The current Relationship Desk has useful boundaries: one persistent next conversation, live commitments, Work / Growth / History / Private notes, and person settings. Its weakness is how much reading precedes an action. Long carry-forward lists and commitments push capture and history down; the prior conversation is spatially disconnected from preparation. The manager’s ownership is also less explicit than the report’s.

Three directions were considered:

1. **Conversation continuity, recommended.** Connect the latest reviewed summary directly to the next occurrence, with commitments grouped by owner alongside it. This supports the recurring job: remember where we left things, prepare, and follow through.
2. **Person notebook.** Lead with a searchable dated record and weave work and growth into the timeline. Strong for recall and review season; weaker when the manager needs to prepare immediately.
3. **Support plan.** Lead with goals, aspirations, and the manager’s support. Strong for deliberate development conversations; risks creating another planning artifact to maintain and giving sparse accounts an empty home.

The concept uses the first direction and borrows compact, searchable history from the second. It adds no relationship score, progress chart, generated personality description, or new editable “relationship summary.”

Within ten seconds, the manager should recognize the person, see the latest conversation’s own words, identify the next date/preparation state, and see their own outstanding commitments. The last-summary excerpt is literal text, not an AI interpretation of the person.

## What to explore

- Read the latest reviewed summary, then follow one of its explicitly linked fictional commitments.
- Open all carried topics and the dated goal update. They reveal source context without becoming duplicate agenda records.
- Keep a thought; inspect the captured thoughts; review sources. Excluding a commitment changes this preparation only.
- Open the prepared example, start the abbreviated meeting simulation, enter notes, then review outcomes. The optional example AI draft is fictional and editable. Exclude a commitment, edit an owner or date, simulate failure, then confirm.
- Inspect the confirmation receipt, next occurrence, and new history entry. The initial fictional two-week series rolls from September 25 to October 9, independent of the entered logging date.
- Mark a commitment done, drop it from its detail view, or reopen it under Resolved commitments. Counts reconcile. Owner groups show three rows initially and expose overflow when needed.
- Search reviewed summaries. Search does not include private notes, raw notes, inferred themes, or uninspected records.
- Open Work, Growth, and Private notes. Edit the illustrative plan or aspiration; save an append-only private note and verify it stays out of prep.
- Try an empty relationship, date/repeat controls, and the ad-hoc Log a 1:1 path. When prep exists, “a different conversation” preserves that prepared occurrence.
- Global navigation, Scribe, full settings, role configuration, assessment editing, and full opportunities/training editors open boundary explanations. Their abbreviated dialogs are not proposed replacement screens.

## Current capability inventory

Inspected source: frontend/app/app/reports/[id]/page.tsx, its prep page, shared wrap-up-review.tsx, frontend/lib/api.ts, frontend/lib/one-on-one-workspace.ts, the 1:1 and commitment routers, and relevant schema fields. The subsystem references below complement this code inspection.

| Existing capability | Proposed placement and boundary |
|---|---|
| Name/initial avatar, role/level, team, optional person notes; manager-only disclosure | Identity stays prominent. Show existing person notes when present. The fictional example supplies no person-notes value. |
| Latest assessment label | Growth owns the read-only assessment context and canonical assessment door. Deliberately removed from beside the person’s name to avoid making a rating their identity. |
| Last conversation, next date or cadence-due truth | Connected last/next surface. Actual server meeting date and due computation remain authoritative; an undated gathering shell is not a scheduled meeting. |
| Gathering, scheduled, planned, completed states | Derived from existing occurrence fields. Prepared state shows the saved agenda, not an empty list of consumed captures. |
| Review sources, edit/resume prep, situation summary and agenda titles | One canonical /prep workflow. Relationship surface previews, then hands off. The dialog is a local walkthrough of that boundary. |
| Carry-forwards, captures, live commitments, at-risk goals and plan signals | Compact source disclosures. Recent history remains grounding. No private notebook or assessment observations automatically promoted into agenda topics. |
| Date, repeat 1–4 weeks, scheduling changes, unfinished-occurrence dismissal | Date/repeat is a proposed shortcut to the same canonical controls. Dismissal remains in the canonical workflow and stops the series; it is not simulated here. Scheduling sends no invitation. |
| Start/run prepared conversation, live call notes, wrap-up review | Canonical prep/call screen retains rationale, suggested questions, and mandatory final closing question. Prototype offers a condensed simulation, not a new meeting editor. |
| Ad-hoc log with date and prepared-occurrence choice | Header Log a 1:1. Distinguish the prepared meeting from a different conversation; retain separate-occurrence semantics and carry-forward merging. |
| Editable reviewed summary, owners, due dates, add/remove commitments and follow-up topics | Existing shared review remains the write boundary. Prototype uses include checkboxes as an equivalent exclusion interaction; no unchecked draft becomes a commitment. |
| Open, done, dropped and reopened commitments | Separate You / Maya groups, source detail, resolved disclosure. Preserve committed_by meaning; manager remains record-keeper under existing RLS. |
| Completed meeting summaries in meeting-date order | Collapsed chronological excerpts with full reviewed text on expansion. Unfinished next occurrence never masquerades as history. |
| Goals, recorded check-ins, projects and explicit goal links | Work view with compact relationship-page preview. Goal/project editing and check-ins remain canonical. No percentage when none is recorded. |
| Development narrative, aspiration role/timeline/notes | Growth stays on the person. The condensed aspiration demonstration edits only its direction; timeline/notes remain capabilities of the real editor. |
| Skill/knowledge opportunities and optional assessment origin; training date/cost/completion/removal | Growth disclosure leads to the existing in-person editor. Full forms are outside the prototype. No separate top-level development product. |
| Optional AI opportunities/plan drafts and text revision | Retain explicit draft/review. Manual editing remains available. Aspirations and training are not AI-drafted. No actual AI in this concept. |
| Assigned-role metrics, skills and values, including org-wide values; missing-role assignment | Growth and canonical role configuration. Missing prerequisites remain explicit rather than fabricated assessment coverage. |
| Private manager notebook with append-only notes and optional AI revision | Separate Private notes context; never merged with plan text or capture inbox. Prototype demonstrates manual append only; AI revision remains a capability to preserve. |
| Person cadence override, inherited defaults, capacity overrides, available weekly hours, time-off CRUD | Person settings and Work → Capacity. Prototype does not invent capacity values or simulate these configuration writes. |
| Section-level load failures and skeletons | Preserve independent loading/failure labels. No optional-source failure becomes “nothing outstanding.” Loading and source-failure layouts are outside this disposable example. |
| Global navigation, person switcher, Quick add, Scribe context, dictation | Preserve the real application shell. Simplified shell is not permission to remove its person strip, mobile menu, global actions, or dictation. |

## Feasibility

### Presentation with existing data

The last/next composition, explicit owner groups, bounded commitment lists, collapsed summary excerpts, source/privacy labels, Work/Growth separation, and literal plan preview primarily rearrange existing records. Summary search filters history already fetched; it is not a cross-account search service.

Latest goal update text and date are available through enriched goals. The concept shows one fictional check-in, with its date and scope; it does not infer a transition from current status. A comparison to the last conversation is shown only when that date boundary exists.

### New interactions using existing capabilities

Inline capture, source review handoff, status changes, date/repeat shortcuts, plan edits, append-only private notes, and inspecting full summary text can use current operations. The next workspace remains the only accumulating conversation object. Capture is an inbox consumed at successful generation, not a durable journal.

A post-confirmation receipt can use the successful logging response’s meeting and next_session, plus verified refreshed commitment records. The current UI simply navigates back after logging. The receipt must distinguish successful writes from failed or partial operations and must not save extra “outcome” records.

The prepared example is a literal list of selected inputs, with a final support question. It is not the proposed AI output shape or an agenda-quality recommendation. Current preparation reviews inputs before generation, then persists the generated guide; wrap-up reviews drafted outputs before confirmation. This exploration does not silently introduce a second agenda-persistence contract.

### API exposure or product decisions

- **Historical commitment provenance:** logging writes source_type = one_on_one and source_id. The current commitment list endpoint and frontend type omit them. The source links and per-conversation commitment counts demonstrated here require exposing and validating those existing relationships. A shared owner or similar wording cannot substitute for a link.
- **Durable receipt reconstruction:** the log response returns meeting/next occurrence, but not an authoritative list of new commitments. Source-field exposure or a richer response is needed for precise reconstruction after navigation/reload. Retry atomicity and idempotency were not tested; do not infer production-safe retries from this simulation.
- **Broader work-update selection for prep:** current deterministic suggestions include up to three at-risk goals and the development plan. The active-goal check-in shown here is read-only evidence. Selecting arbitrary check-ins as structured prep sources requires a contract/product choice.
- **Historical carry-forward provenance:** occurrence carry_forward_items describes that occurrence’s inputs, not a durable outbound decision log. This concept therefore does not reconstruct historical outbound lists. The immediate receipt can show confirmed outgoing topics; persistent historical provenance needs an explicit design.
- **Editing logged 1:1 summaries:** no summary-correction endpoint was found in the inspected 1:1 router. The proposed conversation detail is read-only. Team’s correction flow must not be assumed to exist for 1:1s.
- Permanent topic threads, pinned person insights, shared employee records, transcript analysis, and AI relationship judgments are absent. Each would introduce product/data decisions and maintenance beyond this exploration.

## Integrity and privacy

All saves are in-memory simulations. No requests, storage, email, invitations, or AI calls occur. The date is fixed at September 25, 2026 so due labels and recurrence demonstrations remain coherent.

Private manager notes, temporary captures, prepared agendas, raw call notes, and reviewed summaries remain distinct. None is claimed to be shared with Maya. “Commitments from your conversations” describes accountability, not employee access. Saving is never described as sending.

The production date/cadence resolvers, manager-scoped auth/RLS, central API and AI layers, capture-consumption behavior, and logging/recurrence semantics remain authoritative. Logging creates or reuses the correct next occurrence; recurrence anchors to the scheduled date and skips past slots. Open commitments stay live and are not copied into it. The separate-conversation path preserves existing prep. Logged agendas remain frozen.

## Reference review and live observation

Read: project guide; Design; Brand; 1:1s; next-1:1 decision; new-manager persona; voice rules; Development; Expectations; Assessments; Check-ins; and both selected Mission Control and Team packages. Inspected the selected prototypes in the browser and their HTML/source structure.

Mission Control contributes editorial hierarchy, teal/carbon, compact evidence, and optional detail. Team contributes person presence, restrained context, and canonical-workspace boundaries. Team’s **brief adds** evidence-backed preparation, effortless capture, and confirmed outcomes beyond its existing prototype. This concept explores person-specific equivalents; it does not claim those refinements were already demonstrated or shipped.

A signed-in Relationship Desk was inspected read-only on September 25. Its visible structure included seven carry-forwards, seven open commitments, two completed conversations and two resolved commitments. This density informed progressive disclosure. No buttons that save, resolve, schedule, generate, or delete account records were used. Private notebook contents, growth detail, source associations, and hidden settings values were not inspected and remain unknown. No live narrative or account record is reproduced here.

## Candid tradeoffs

The first screen privileges conversation continuity over a complete person dossier. Growth still needs a deliberate visit, and first-sentence excerpts will not always capture the most important point. Use a transparent excerpt before inventing an AI headline or requiring another field.

Preparation, running, and wrap-up appear in dialogs only to keep the exploration clickable. Building parallel meeting editors inside the Relationship Desk would add drift. Real navigation should preserve canonical flows.

Three commitments per owner and one carried topic keep the page readable, but must expose the rest reliably. A dense-record fixture, long names, Scribe-open layout, and broader keyboard/failure coverage are next-refinement work, not claims made by this first prototype.

## Verification

Browser checks and limits are recorded in [VALIDATION.md](VALIDATION.md). These are checks of the disposable concept, not application, backend, authentication, or production persistence tests.
