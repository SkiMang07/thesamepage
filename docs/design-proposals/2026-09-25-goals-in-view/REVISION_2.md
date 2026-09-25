# Revision 2: outcomes first

September 25, 2026. Andrew rated the first concept B-minus: functional, but insufficiently engaging for a core management tool. His test is that a manager can open Goals and immediately make the outcomes and measurements understandable to the team. This revision is a proposal, not an approved application change. The original `prototype.html` is preserved; open `prototype-v2.html` for this revision.

## Subsequent approval

Andrew approved this revision and requested an implementation prompt on September 25, 2026. BUILD_BRIEF.md is now the implementation authority, including bounded optional numeric measures. The prototype stays unchanged. Earlier pending-approval language and the proposed user-study exercise below describe the exploration stage, not build prerequisites.

## Recommendation

Give each open goal enough space to show its outcome and success measure together. Make an update a small, direct contribution to that goal, with a visible result. Let the record become more useful over time through dated evidence. Provide an optional presentation mode for an intentional goal discussion.

The first version solved retrieval and maintenance. Its opening view hid most success metrics behind selection, led with exception counts, and asked managers to inspect a detail panel before making a contribution. The redesign moves the outcome and measure to every goal’s opening surface. Details remain available when needed.

## Advisory review

This was a simulated review using the advisory-board skill's Customer, Product & Technology, and People & Management lenses, facilitated within one agent. No independent advisors, agents, customer interviews or user testing were involved. These are design judgments, not validated customer findings.

Shared brief: improve comprehension, repeat use and contribution without turning Goals into an execution tool, broadening record visibility, inventing measurements or breaking current canonical editors. There is no external deadline; this is a reversible local prototype. Existing evidence includes the inspected account, repository schema and current interactions, Andrew’s critique, and the primary references below.

| Lens | Strongest call | Risk and what would change the call |
|---|---|---|
| Customer | Put the outcome and measure together immediately; make updating it take one local action. | More fields can turn a visit into data-entry work. If a manager needs an explanation or setup session to add a useful update, simplify. |
| Product & Technology | A typed value and target can be more meaningful than a generic completion percentage. Prototype it explicitly as optional new capability. | Units, direction, multiple measures and history corrections are real product/model decisions. If users mainly use narrative goals, keep the narrative surface excellent and defer numeric machinery. |
| People & Management | The page should support a conversation about the outcome, the evidence and needed support. Keep status separate from mathematical target attainment. | A reached number does not prove a goal is complete, and a manager's private notes are not presentation material. If the presentation encourages misleading or unreviewed claims, narrow it to chosen goal text and measures. |

The substantive disagreement is how much new measurement structure to add. The product lens sees value in actual-versus-target values; the customer lens resists more setup. The provisional resolution is an optional, small numeric measure for goals that fit, alongside first-class written success criteria. Neither a compulsory OKR model nor percentage completion inferred from a target is proposed.

## What changed

- **Outcomes on the opening screen.** Editorial goal titles and the success metric occupy each goal surface. Open goals remain visible, including current goals; exceptions lead the ordering and retain explicit reason labels. Closed goals have a separate door.
- **Typed measures, demonstrated separately.** The illustrative dataset includes actual values, units, targets, target direction and dated readings. The numeric pair is legible without opening details. Small plots show only recorded readings with a reference line for the current target. Missing readings remain absent.
- **Direct contribution.** Add an update expands on that goal. A value, a note or both can be entered; status remains editable. Failed saves retain entries. Successful saves update the goal, dated evidence and Updates view, with a short confirmation and reduced-motion-aware highlight.
- **A growing record.** Updates gathers existing check-ins in date order within the chosen level/scope. It does not invent themes, require journal maintenance, or create a second record type.
- **A discussion view.** Review together first asks which open goals to display. It shows the selected goals, their exact success criteria, due dates and dated values. Status is optional. It excludes update notes, private narrative, related-record doors and manager controls. It neither sends nor publishes records and grants no employee access. The manager reviews wording before displaying it.
- **Useful scope and detail.** Existing level filters remain; a local scope filter selects a person/team/department within that level. Details, history, canonical project doors, creation, editing and deletion remain accessible.

## Existing capability versus proposed addition

| Can use existing data and operations | Requires a separate product/implementation decision |
|---|---|
| Outcome-first composition, level/scope filtering, narrative metrics, manual completion percentages, inline check-in, dated updates, goal editor and explicit connections | Typed numeric measure definition: unit, comparison rule, target and recorded value history |
| Local presentation of manager-selected records without publishing or permission changes | Any shared employee view, invitations, collaboration or notifications; none is simulated here |
| A literal visual treatment of written targets | Automatic extraction from text; any future assist must create a reviewed draft rather than quietly converting prose |
| Separate recorded status and date-qualified completion | Target attainment, completion, aggregation, forecasting and inferred performance; no automatic conversion is proposed |

Current `goals.success_metrics` is free text. Check-ins currently store status, an optional integer completion percentage and a note. They do not store the numeric measure structures shown in the fictional example. The prototype never presents a measured reading as an existing account value. Its observed snapshot retains inspected written targets and recorded completion percentages; no new readings are invented.

The observed snapshot's typographic numeric emphasis is authored literally from inspected success-metric text. It is not a tested parser. Production can use the full written metric immediately; structured emphasis should be manager-authored or explicitly reviewed. A target such as 100% net dollar retention is distinct from 100% goal completion.

The numeric walkthrough fixes one measure definition per fictional goal and supports value updates. Creation and editing retain the existing goal-field model; a full measure-definition editor, multiple measures, historical corrections, unit changes and target revision history are not implemented. Editing goal wording preserves the sample's reading history. Any implementation must resolve how metric wording and a structured definition stay consistent before shipping.

Plots position readings by date, make no forecasts, and use a current-target reference. They do not claim that the present target applied to every historical point. Two same-day entries have the same horizontal date position. Percent shares in the sample are bounded at 100; count examples accept non-negative integers. The future model must specify ranges per measure because some percentages, such as net dollar retention, legitimately exceed 100.

## Why this direction

These references inform the design; they do not validate this product or imply that copying another application's features will improve retention:

- [Linear’s project overview](https://linear.app/docs/project-overview) places a brief summary and detailed context in one workspace. The applicable idea here is clear outcome context with detail available nearby; Linear's task-derived forecasts and project model are not being imported.
- [Linear’s project updates](https://linear.app/docs/initiative-and-project-updates) keeps a latest update and dated history available and describes reviewing updates during weekly syncs. This supports exploring a return visit built around evidence and discussion; it is not evidence for introducing shared updates or Slack here.
- [Nielsen Norman Group on progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) supports keeping frequent work visible while deferring less-frequent controls. In this revision, the success measure is primary, while editing, deletion and connection inspection sit one step deeper.

The engagement hypothesis is that clear outcomes plus satisfying, useful contribution will make the page worth returning to. Streaks, rankings, points and compulsory celebrations are not part of the proposal. Visual polish alone cannot establish sustained use.

## Smallest next test and revisit trigger

Andrew reviews the new concept now. Before implementation, ask three target managers to open a populated example, explain one goal's success criterion, distinguish the target from its latest value, add an update and prepare a discussion view. This is a proposed test, not one already run.

A directional threshold: all three can identify the outcome and success criterion without opening Details; at least two can add an update and explain its effect without help. Ask whether they would maintain an actual measure or prefer narrative updates. If two need coaching, mistake a target for an actual value, or see the numeric setup as additional administration, simplify the measure design before building it. If the presentation proves irrelevant, omit it from the first build.

Revisit after that small test, or immediately if Andrew rejects the stronger numeric direction. There is no approved migration, implementation brief, deployment or production write at this checkpoint.
