# Assessments: AI-led preparation, manager-owned judgment

September 25, 2026. Product/design handoff for Andrew’s Claude session. This is the latest direction; it supersedes the earlier three-option exploration’s manual-first framing and frequent rolling-use assumption. The earlier comparison remains useful as a code inspection snapshot, not current product intent. Andrew has approved the refinement toward immediate usefulness, lightweight context confirmation, focused review and a useful finished assessment. The v2 sketches express that direction; exact layout remains rough and no application implementation has been performed.

## Andrew’s clarified intent

Assessments normally happen quarterly or biannually and support traditional performance reviews. A manager can also assess off-cycle when there is a reason. Do not build an experience that encourages weekly re-rating or marks ratings stale after a few weeks.

AI should lead this particular experience. Its main value is assembling the person’s relevant work and context, checking the picture with the manager, drafting an assessment, and discussing/refining it until the manager is satisfied. Manual completion must remain fully available. The previous project convention that AI is a secondary assist is intentionally superseded **for Assessments**; the requirement that AI-generated judgments need manager confirmation remains fully in force.

The product question is: “What can I reasonably say about this person against their role’s expectations, what is still uncertain, and what should we discuss?”

## Read first and stay focused

Read `CLAUDE.md`, relevant parts of `docs/DESIGN.md`, `docs/systems/brand.md`, `docs/systems/assessments.md`, and `docs/systems/expectations.md`. Inspect current assessment pages, `backend/routes/assessments.py`, assessment contracts in `frontend/lib/api.ts`, and the Relationship Desk Growth entry point. Verify changes since this handoff rather than assuming it describes today’s implementation perfectly. Retrieve engineering and source-system docs only as needed.

Reference sketches in this folder:

1. `01-check-the-picture-v2.png`
2. `02-draft-and-discuss-v2.png`
3. `03-complete-assessment-v2.png`

Use the v2 images; the original images are preserved as superseded exploration. They show successive stages of one design, not competing options. All Maya Chen content is fictional. The walkthrough occurs after September 30, so its full July–September period is illustrative rather than a claim about data available on this document’s date. The three stages, boundaries and reading order matter more than exact dimensions or card styling.

## The intended experience

### Enter and scope

The overview helps the manager start, resume or view an assessment for a person. Lead with assessment period/status and last completion when those records exist; keep the saved overall label as context. Avoid team rankings and invented urgency. Existing legacy item ratings must not be presented as completed period assessments.

Start assessment is the primary action. Offer Quarterly, Biannual and Off-cycle shortcuts with explicit, editable start/end dates. These describe the assessment being started; no organization-wide calendar, automatic cycle scheduler or reminder engine is required. A manual path is visible and uses the same expectations, review and completion semantics.

### 1. Check the picture before generating ratings

AI assembles relevant authorized person-linked records for the chosen period and presents a concise, inspectable account of work, effort, outcomes and impact. Show source records and dates, unresolved questions, and missing evidence. Separate observations from interpretation. Earlier records can provide labeled background, never silently count as in-period results.

Ask: “Does this reflect their work, effort, results and impact? What is missing or needs context?” The manager can add unlogged contributions, constraints, outcomes or corrections and exclude irrelevant material from this assessment without altering original records. Ask focused follow-ups when useful; do not turn this into an interrogation or require additions when the picture is sufficient.

Manager additions remain labeled as manager-provided context. They do not become independently verified facts or silently edit goals, notes, commitments or meeting records. “Confirm context & draft” approves the inputs for drafting, **not the ratings**.

### 2. Draft and discuss

Draft skills, values, metrics and a separate overall judgment against configured role expectations and each item’s own scale. Make scale meanings readable. Show saved prior judgments separately from this pass’s proposals. Show the reason, supporting sources and limitations of each proposal. Do not force coverage or infer numeric metric results from activity.

Use Expectation lens within this stage: standard → evidence → prior / proposed judgment. Allow direct editing and assessment-specific AI conversation. Discussion can address one item or the whole assessment. AI may explain or challenge a conclusion; it must not simply inflate a rating to agree with the manager. Concrete new claims need source context or manager attribution.

AI revisions are visible proposals. Accepting them updates the draft, never the confirmed assessment record. Do not silently overwrite manual edits, previously reviewed items or unrelated sections. Context changes that affect reviewed judgments make the affected proposals need review again. Provide an explicit way to include, edit or leave an item unassessed. Do not require a repetitive per-item approval ritual: the final review may confirm an explicitly displayed set together, with every included judgment and its reason available in that review. No hidden or collapsed-only content is silently approved; opening a page or generating a draft never counts as review. Pending inclusion is draft state, not a write to the confirmed record. Preserve the draft through navigation, reload and generation failure; support resuming the in-progress assessment.

### 3. Confirm completion

A final review presents the complete narrative and exactly which judgments will be recorded, their reasons, the period and acknowledged gaps. It includes any proposed conversation wording so no fresh AI-generated advice appears as manager-confirmed after completion. The manager explicitly completes the assessment. A missing reading does not prevent completion when the manager chooses to leave it unassessed.

Untouched prior scores are context only. Deliberately reaffirming the same rating for this period is valid, but it requires explicit selection/review and must not happen through prefilled inputs. New metrics require real values and their measurement periods. Overall is independently selected, never an average of incompatible scales.

Completion produces a coherent, retrievable period assessment and an accurate success receipt. It updates the existing latest-rating consumers for confirmed items while retaining historical records. Repeated submission/retry must not duplicate writes; partial failure must not claim completion. A completed view distinguishes newly confirmed items, prior context and unassessed items. Completion history must preserve the expectation/scale meaning and evidence used at the time, rather than silently changing when configuration or sources change later.

Completion does not share, notify, schedule a meeting, create an agenda or write a development plan. Offer ordinary links to the existing Relationship Desk, 1:1 prep and Growth workspace. Off-cycle work starts another explicitly scoped assessment; avoid silent overwrites of completed records. Reopening/correction versioning is a later scope decision unless already supported.

## Experience bar: recognition, relief and control

This is a requirement for the experience, not optional polish. The manager should feel helped from the first screen: “It remembered what I would have forgotten, and it is asking what it missed.” Success is useful completion on a quarterly/biannual cadence, not frequent visits or repeated ratings.

- **Useful picture before effort.** Begin with a concise account of meaningful contributions and supported impact, grounded in inspectable sources. Separate activity from outcome: a completed checklist is not proof of improved retention. Do not open with a source checklist or an administrative rating form. Keep source coverage, dates, gaps and failures discoverable and show material limitations inline.
- **Lightweight context confirmation.** One natural question—“What’s missing or needs context?”—with room for a free-form response and a clear “Nothing to add” path. Clarifications should target consequential ambiguities; no mandatory interview and no required source-by-source audit.
- **Focused review, complete visibility.** Lead with uncertain judgments, contradictory context and changes from prior ratings. Explain why an item needs attention; do not invent a confidence percentage or use rating severity as a proxy. Show the assessment’s readable narrative alongside this attention view. Keep all expectations and judgments accessible, then present the complete included set for explicit final confirmation. Group confirmation is allowed; implicit approval is not. Direct editing and AI discussion remain equally usable.
- **A worthwhile finished result.** Completion opens the confirmed assessment itself: a readable synthesis of contributions, strengths where supported, areas for attention/observation, and acknowledged gaps, with underlying expectations, ratings, sources and manager-added context inspectable. Include concise reviewed discussion wording when useful, not a full agenda. A technical receipt or rating count is secondary. The completed narrative must agree with final reviewed item judgments, distinguish prior context from current-period findings, and never invent positive impact to make the artifact feel complete.

Preserve practical states: if records are sparse, say what is available and invite manager context or manual assessment; do not manufacture a rich summary. If retrieval or generation fails, preserve the work and provide recovery and manual paths. Never make the most useful part of the assessment depend on clicking every disclosure.

Design checks: Does the first screen convey something useful before asking for input? Can a manager move straight to drafting when nothing is missing? Can they find the judgments that require thought without mechanically approving rows? Does the finished assessment help them explain their view and start a useful conversation? These are design checks, not validated claims about customer engagement.

## Evidence scope: broad, inspectable and honest

The target is all relevant **authorized and attributable** context for this person—not merely the last few meetings. Inspect existing sources and include those that can be reliably linked: reviewed 1:1 summaries; commitments with actual ownership and outcomes; person-linked goals and check-in results; attributable project contributions; existing development context; relevant authorized person-linked knowledge. Do not equate assignment to a project with ownership of all its results, or activity volume with performance.

Produce a short source coverage matrix before implementation: source, existing retrieval/permissions, date semantics, what will actually be included, and gaps. If a source cannot be reliably retrieved, surface that limitation and allow manager context; do not quietly call a narrow source set “everything.” Scope any necessary retrieval work explicitly. General document ingestion, arbitrary attachments and new third-party integrations are not automatically included.

Private manager notes and raw meeting notes are not automatically included merely because they are readable. Preserve existing purpose/access boundaries. Recommend an explicit manager-controlled inclusion route for private material if needed; do not introduce automatic private-note mining. An assessment remains manager-facing and must not widen access to its source material.

Distinguish “no records found,” “not connected/not inspected,” “retrieval failed,” and “insufficient support for a judgment.” Source coverage is not performance coverage. AI omission alone proves none of these. Make source identity/date inspectable; generated prose is not itself evidence.

## Current capability gap, verified during exploration

The current system stores rolling item ratings and overall snapshots, not a completed assessment session with period, draft conversation and completion state. The `performance_reviews` table is dormant. Inspect its fit before proposing a new table; do not activate it merely because of its name.

Current AI drafting reads up to five non-null 1:1 summaries, a bounded commitment set and individual goal titles/status/success metrics. It does not provide comprehensive period retrieval, goal check-in readings, source citations or conversation-based revision. Its output is proposed scores and free-text reasons, and the page merges these into pending form inputs.

The scorecard contract already carries configured scales and latest item records, including skill/value and overall reasons. Saved reasons are not fully surfaced in the current interface. Skill/value buttons currently show numbers with meanings in tooltips despite the documentation’s wording. Metric draft notes are not persisted by the current save contract. Do not claim preserved metric provenance without addressing that gap.

## Scope discipline and acceptance

This is a focused assessment workflow change, not an HR performance-management suite. Exclude employee self-reviews, peer/360 feedback, calibration, compensation, promotion decisions, signatures, employee delivery, automated recurring cycles, employee rankings and performance prediction. No duplicate goals, private notebook, development editor or meeting-prep workspace.

Before implementation, reconcile the requested experience with current code and present a concise bounded scope with the source coverage matrix and smallest viable data-model approach. Make routine implementation choices autonomously; raise only material product decisions or scope reductions. Do not silently reduce this to a prettier rating form or keep AI as a secondary button. The mockups communicate intent; Andrew’s implementation authorization in the Claude session governs whether to build. This document alone does not authorize a push or deployment.

Essential verification once building is authorized:

- A quarterly/biannual/off-cycle assessment uses the selected period and labeled prior context.
- The manager sees evidence coverage and can add context before AI proposes ratings.
- Direct edits and conversational revisions coexist without silent overwrites; partial evidence and generation/retrieval failures are honest and recoverable.
- Different scales remain distinct; every included judgment is manager-reviewed; unsupported metrics remain empty; untouched prior ratings are not re-logged.
- Drafts resume; completion is durable, coherent and safe to retry; latest-rating consumers reflect only confirmed writes.
- No completion action shares content or changes other workspaces; existing authorization boundaries remain intact.

Follow project rules for auth, AI calls, frontend APIs and migrations. Test the important behavioral boundaries; avoid exhaustive polish or unrelated refactors. Update canonical docs only when implementation changes their current truth.
