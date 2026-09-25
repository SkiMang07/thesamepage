# Projects: keep things moving

September 25, 2026 · Design exploration, not an application implementation or approved build brief.

Open [prototype.html](prototype.html). The default walkthrough is entirely fictional. The preview selector also exposes the separately labeled, read-only observed account, an empty example and a load failure. All writes are in memory and reset on refresh or dataset switch. No application API is called.

## The recurring manager job

**What has changed in the work that matters—and what do I need to do next?**

Andrew's “What are we moving forward, where does it stand, and where can I help?” is the right foundation. The refinement makes a return visit specific: recover the context, record a meaningful change, and remember your own intervention. “Where can I help?” cannot safely become an automatically generated help queue: the product has no structured requests for help, blockers or decisions. An at-risk status or old update does not establish what help is needed.

The proposed opening screen pairs purpose with a dated, literal update for every visible project. Ownership and goal connection stay adjacent. Written movement leads; a manually asserted percentage is secondary and date-qualified. Opening the record reveals what actually changed over time, without inventing a project trajectory.

## What was inspected

Read `CLAUDE.md`, Design, Brand, Check-ins, the Goals revision 2 rationale and prototype source, and the current handoff only to identify and preserve concurrent work. Inspected Goals revision 2 visually in the browser. Read the Projects page and form, Projects router, shared CheckInPanel and check-in helper; checked the commitment route's exposed creation fields. No broad historical audit or advisory process.

The signed-in production `/app/projects` was inspected read-only, including selecting its one project. It already has a response-grouped portfolio index and a selected detail workspace, not an untouched card grid. No live form was submitted or live record changed.

Observed account snapshot, September 25:

| Field | Visible value |
|---|---|
| Project | Templatized Onboarding Plan for New Hires |
| Owner label | You |
| Team | US Success |
| Status | Active |
| Purpose | No purpose statement added |
| Goal connection | Standalone project |
| Due date | None |
| Check-ins / percentage | No check-ins / no progress asserted |

The observed mode transcribes these values only. No purpose, person, goal, activity, trend or next move is invented for that record. The fictional example uses different titles and explicitly fictional people and relationships. It includes stale-but-on-track, at-risk, no-update, narrative-only, standalone and completed work.

## Current workflow inventory and friction

| Existing workflow | Current behavior | Proposal |
|---|---|---|
| Portfolio scan | Needs a decision / Needs an update / Moving / Closed; title, owner, scope, goal, percentage, reasons | Expanded project briefs expose purpose and latest exact note before selection; exceptions still lead; Closed remains separate |
| Focus project | Select a row to reveal purpose, current signal, latest note and controls; no initial selection | Focus by expanding an update, history or details in its project brief |
| Create / edit | Title, description, assignee, goal, team/department, status and due date | Same fields in an inline editor, including standalone and manager-owned options |
| Change status | Inline status selector updates the project without a dated check-in | Status is available in both update and Details → Edit; the prototype distinguishes those semantics |
| Record change | Status plus optional 0–100 integer completion and note; writes status through | Direct contribution from each brief, retains a failed draft, returns a visible receipt and dated record |
| History | Lazy-loaded check-ins, newest first; notes truncated; optional Beyond meeting links | Full literal notes, separated by date; load failure distinguished from absence |
| Delete | Existing delete action | Secondary Details action; explicit local confirmation in the prototype |
| Shell / Scribe | Global navigation, quick add, selected-project context and draft-then-review | Shell is illustrative here; these remain required application integration behavior |

The current composition is a sound start. Its recurring-use weakness is the information withheld from the scan: the manager must select each project to recover why it matters and what actually happened. In the inspected one-project account, most of the screen is initially a selection prompt. After selection, multiple blocks repeat missing progress/freshness, but do little to help build the first useful record.

Two labels also overstate their evidence: “Needs a decision” is derived from at-risk or overdue, without a recorded decision request; “Moving” means recently updated, not demonstrated movement. The concept uses literal reasons instead. The current history error path becomes an empty array, presenting a retrieval failure as no check-ins. This proposal shows an explicit history error and retry.

These are design and code observations, not customer research or a claim of measured retention impact.

## Three organizing ideas

| Direction | Advantage | Tradeoff |
|---|---|---|
| Enriched portfolio + focused desk | Compact at larger scale; most continuity with current implementation; stable place for longer context | Still asks the manager to select each project to understand its actual situation; improving the index may only partially solve the Goals v1 problem |
| Change journal, newest first | Strong repeat-visit rhythm; dated evidence is the main content | Recently updated projects crowd out silent work; purpose and responsibility become repetitive or hidden; no read/unread data exists |
| **Project briefs + private next move — recommended** | Purpose and latest situation visible together; direct updates; a manager can translate understanding into their own follow-through | Taller portfolio; large accounts require effective filtering; private follow-through needs explicit product and backend work |

This is not a Goals card grid. Goals foregrounds outcomes and measures. Projects foregrounds the connection between intent, the recorded situation and the manager's intervention. Horizontal briefs make that relationship readable, while inline history supplies the longer story only when needed. No chart, health score or required percentage is introduced.

## Interaction and visual decisions

- Teal/carbon anchors, readable ink scale, editorial headings and restrained rules reuse the approved language. The actual brand mark is copied into this isolated package. Status uses text and glyphs as well as color.
- Exceptions sort first: recorded at-risk or past due, then absent/older-than-14-day update. A stale on-track record retains its stated status. Standalone is neutral. Recently updated is not labeled “moving.”
- All open projects remain available in the primary view; search and owner filtering reduce a longer portfolio. All-owner counts reflect the active view and filters.
- Optional completion starts blank for each update. A note-only entry preserves the prior number and its date, rather than silently reaffirming it. Historical values do not manufacture a trend or health assessment.
- “Your next move” is deliberately narrow: one private, manager-authored action on a project; completing it does not complete the project. The separate My follow-through view answers “what did I say I would do?” It is not a task hierarchy, assignment system, dependency model or scheduling tool.
- A successful update expands the dated record, updates the brief and displays a local save receipt. Motion is a short border highlight and respects reduced motion. Drafts survive toggling their inline form and simulated save failures, but not refresh or dataset switching.

## Does a review mode earn its place?

Only as a secondary, deliberate preparation tool. It should not turn the manager's private record into a shared status dashboard. The prototype starts with no selected projects, previews exact purpose/owner/goal wording, offers status and due dates separately, and lets the manager write a question for that presentation. That question is temporary and never copied from private notes. Only checked projects appear. Saved check-in notes and private next moves are excluded; nothing is sent or published.

This supports an intentional conversation about purpose and a chosen question. It does **not** yet support sharing a curated narrative of latest movement. Do not claim that the presentation contains the full recorded situation. If managers mainly want to discuss a selected update, evaluate an explicit per-note preview/inclusion step later. Do not broaden defaults now. If review proves little-used, omit it from the first build; the brief/update/record loop is the central recommendation.

## Capability boundaries

| Uses current data / operations with UI work | Proposed or unresolved capability |
|---|---|
| Title, description-as-purpose, assignee (or You), explicit team, explicit goal, due date, current status | Private project-specific follow-through, its completion/reopening and cross-project view |
| Existing check-in note, status, integer percentage; latest note and full dated history | Durable follow-through needs a supported association and owner-scoped create/update/complete contract; inspect/reuse commitments where suitable rather than inventing a parallel task store |
| Exception ordering and search/owner filtering over visible projects | Review selection and temporary discussion questions are new frontend behavior; persistent review plans or saved questions would need a storage decision |
| Owner-scoped visibility; existing creation/edit/delete | Employee access, sharing, notifications, requests assigned to others and collaboration are not explored |
| Optional history of explicitly linked Beyond meetings | One fictional history entry has an explicit linked-meeting source and a local source preview. Production must retain CheckInPanel's existing Beyond source links and route to the actual meeting; that full cross-page workflow is not simulated here |

The prototype loads all fictional histories in memory. Production should preserve the existing list enrichment and fetch detailed histories on demand. The brief's date for an older non-null completion is not returned by current list enrichment: obtain it from history or extend the derived response with the timestamp of that value. Do not label the last note date as the percentage's date. Counts on “The record” also need history or a derived count; they are not current list fields.

Source labels are not attribution inferred from an assignee. The assignee is responsible for the project; the manager enters the check-in. Beyond provenance must use explicit meeting links, not names parsed from notes. A direct status edit changes the parent without adding history; the prototype does not pretend otherwise. A production write failure after a partially successful check-in requires careful reconciliation/idempotency; the local failure simulation is all-or-nothing and does not test that backend case.

AI is not needed for this contribution loop and is not simulated. Preserve Scribe's existing draft-then-review behavior and selected-project context in any build. Never auto-save an inferred blocker, action, status or purpose. No numeric-measure schema from Goals is assumed or changed.

## Review path

1. Open the fictional walkthrough. Read the handoff's purpose and latest situation without selecting it.
2. Record an update; turn on Fail next save and retry. Inspect its dated entry and the unchanged date of a prior completion percentage.
3. Save or complete Your next move; inspect My follow-through.
4. Prepare a review, choose a project and write a question. Confirm that private notes and next moves stay out.
5. Switch to the observed account to see the honest first-update state; then inspect phone or Narrow workspace.

Before implementation, test that a target manager can explain a project's purpose and current situation, distinguish project ownership from their own next move, record a useful update, and explain exactly what the review shows. This is a proposed user exercise, not validation already performed. The one-project observed account cannot establish usability for a large portfolio. Search/owner filtering and a denser alternative should be reconsidered if representative accounts regularly contain many projects.
