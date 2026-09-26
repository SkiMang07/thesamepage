# Beyond the team — Overview and conversation continuity

Status: approved by Andrew on 2026-09-25 (his build prompt superseded the "awaiting approval" line) and implemented. Scope decision: group conversations stay individual group-meeting records; recurring group series and persistent group homes are deferred and never inferred. Current behaviour is `docs/systems/beyond.md`; the text below is the original handoff, kept as the design reference.

Visual reference: `overview-revised.png` in this folder. This supersedes the original two-option page composition. Retain option A’s continuity principle; option B was not selected. All names, dates, quotations and project details in the mockup are fictional. Do not seed them into the application.

## Product direction

Beyond helps a manager answer: “Where did we leave things, and what do we need from each other next?” It should reward small contributions with better preparation and visible continuity, not become a CRM or another task-management system.

Borrow Team’s clear browsing structure and Goals’ hierarchy, readable substance and useful contribution loop. Do not copy goal cards or the Relationship Desk layout wholesale. Follow CLAUDE.md, docs/DESIGN.md and docs/systems/brand.md. The authenticated app uses the carbon theme, teal actions and selection, amber attention and blue only for AI/information.

## Four views

**Overview opens by default.** Show a short “What needs you next?” brief, followed by three compact previews: People, My manager, Group conversations. The brief crosses all three spaces. Previews show substantive recent reviewed outcomes, next meetings and commitments, not merely counts. Use three columns when space permits and stack at narrower content widths, including when Scribe is open.

**People:** Peers, cross-functional counterparts, skip-levels, indirect reports and other individuals, excluding the direct manager category. Show each person’s relationship label, latest reviewed outcome with meeting source/date, next individual conversation, carried topics and commitments in both directions. People without a next meeting remain visible. Keep adding/editing a person available but secondary. Open the person’s existing detail workflow for deeper history and preparation.

**My manager:** The direct manager relationship, using the same continuity structure with emphasis on team updates, asks and decisions needed. Skip-levels remain under People even though existing prep treats them as managing-up conversations. Do not assume the database enforces exactly one manager record; handle zero or multiple records honestly.

**Group conversations:** Meetings with multiple participants, with attendees, reviewed outcomes, open commitments and upcoming/draft meetings. Group membership does not replace individual relationships. A group meeting remains a group meeting even if the direct manager attends. Its explicitly sourced commitments/context may also appear in individual views without duplicating records.

A durable home for a recurring group conversation is desirable but is not currently supported. Group meetings must not be merged into an inferred series because titles or attendees match. If continuity across a group series is built, require explicit manager-created grouping and recurrence; otherwise present individual group meetings and label that limitation. Do not imply this capability already exists.

## Overview brief

Use a small, useful set of items (target three, fewer when evidence is sparse), each with a reason, source and direct action. Never fill space with speculative advice. Deterministic facts work without AI.

- Scheduled: upcoming conversations; an explicit cadence with no next meeting. Use date-only semantics and distinguish a missing future occurrence from proof that a conversation was missed. Absence of a logged record is not evidence that people did not meet.
- Recorded: open commitments with explicit owners/due dates, reviewed carry-forward topics, notes awaiting review. Say “recorded as open,” not “they have not done it.” Counterpart commitments are not the manager’s tasks.
- AI suggestion: possible dependencies or useful conversations grounded in reviewed Beyond records and permitted goal/project context. Label as a suggestion; show both sources and why the connection may matter. Same-person mentions alone are insufficient evidence.

Andrew wants reconnect suggestions from both explicit cadence and substantive open work. Without a cadence, elapsed time alone must not produce an overdue judgment. An AI reconnect prompt needs a concrete recorded topic, commitment or work dependency. No relationship-health score, invented urgency, unsupported progress or automatic status updates.

Suggested prioritization is a design recommendation: dated near-term preparation and promises first, unfinished review next, evidence-backed suggestions when useful. Deduplicate prompts about the same action. Avoid turning the brief into a long feed.

## Primary interaction and contribution loop

The mockup’s review inset shows an AI-proposed connection between a reviewed meeting commitment and a project requirement. Display source excerpts with links; missing or inaccessible sources must not be represented as inspected evidence.

- **Add to prep:** Show editable wording and require selection/confirmation of the target conversation. Save a private preparation item. If no next conversation exists, offer an explicit plan/create choice; do not silently schedule a meeting. Acceptance does not confirm a durable work connection.
- **Confirm connection:** Separately confirm the exact meeting and goal/project plus the reason. This creates a source relationship, not a new check-in or status/progress change.
- **Dismiss:** Remove the suggestion without changing its source records. Remember dismissal for that suggestion; material new evidence may justify a newly identified suggestion.

After saving, show a specific receipt and the preparation item in the chosen conversation. Nothing is sent or shared. In deeper views, retain A’s “Add a thought” shortcut to saved meeting notes, with the thought visible next time and available to prep. It is not an agreed commitment.

## Verified foundation and proposed additions

Verified against current docs/code and read-only signed-in Beyond page during this session:

- Outside people with relationship types; individual and group meetings; drafts and reviewed logged outcomes.
- Individual 1:1 recurrence, carry-forward and AI preparation. Group recurrence is not built.
- Commitments owned by manager, counterpart or a direct report, retaining meeting source. Completion controls exist on the person page. Preserve actual owner identity rather than folding report-owned commitments into “You.”
- Wrap-up is draft-then-review. Confirmed meeting outcomes can create commitments, goal/project check-ins and explicit meeting links. Check-ins retain their meeting source. Therefore there is already a limited goal/project connector.
- The current overview chiefly supplies people, meetings and commitment counts. Detail readers supply richer commitment/link data. Reuse those capabilities or expose a scoped aggregate; do not claim that counts contain the underlying detail.

Proposed additions, not verified existing capabilities: four-view composition and richer previews; persistent thought-to-prep wiring; cadence-gap prompts; cross-source AI suggestions with evidence, editable acceptance and persistent dismissal; confirming a standalone relationship without creating a check-in. Explicit recurring group homes/recurrence are a separate backend addition if included in the approved scope. Verify existing contracts before choosing storage; this brief does not prescribe a schema.

## Privacy, truth and useful fallback

All Beyond data and new suggestion/prep records remain owner-scoped and manager-private. Preserve existing prep exclusions: assessments, direct-report 1:1 notes, development plans, individual goals, project-owner details and secondhand report commentary are not material for outward-facing conversation preparation. Do not broaden this boundary through the new AI brief. Secondhand accounts remain attributed and never become facts.

AI does not write reviewed outcomes, connections, commitments or work updates without explicit review and confirmation. Preserve the distinction between a conversation topic, an agreed commitment, a goal outcome and a project. Missing dates, outcomes, progress and schedules remain unknown. Failed/partial loading is not an all-clear. AI failure leaves deterministic items and normal manual workflows available.

## Review checklist

The design is successful if a manager can immediately identify the next useful action and its evidence, scan all three spaces without opening records, and see how adding one private thought improves preparation. Verify no sources are inferred from person-name overlap, no group series is fabricated, no acceptance changes unrelated work status, and no saving implies sending. Preserve current navigation, meeting logging and review workflows while making them easier to reach.

Before building: obtain Andrew’s selection/approval of `overview-revised.png` and resolve whether recurring group homes belong in the first implementation. This mockup does not constitute that approval.
