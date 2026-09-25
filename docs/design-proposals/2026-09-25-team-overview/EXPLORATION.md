# Team overview — design exploration

September 25, 2026. Exploration record. Andrew subsequently selected this concept and requested implementation, including three additional meeting-experience improvements. See `BUILD_BRIEF.md` for the current implementation authority; the prototype itself remains unchanged.

Open `prototype.html` in a browser. It is self-contained, uses no external resources or account APIs, and works without the preview server. Refreshing resets every illustrative edit. No application code or live data was changed for this exploration.

## Assessment and direction

The inspected Team page preserves the important workflows, but gives a large amber attention box almost the same weight as the meeting itself. Its text repeats the meeting and commitment states. Shared work is two disconnected lists, and the roster appears only after several sections and explanatory paragraphs.

Keep Team’s existing purpose: understanding and supporting direct reports as a unit. Use the selected Mission Control concept’s carbon ground, teal selection and primary action, editorial heading, readable metadata, compact summaries, and progressive disclosure. Team is organized around collective conversations and shared work rather than a weekly calendar, completion dashboard, or recommendation panel.

The concept keeps one meeting identity surface, two quiet context sections, exception-first work disclosures, compact follow-through with a three-row initial limit, and named Relationship Desk doors. There is no new team score, chart, inferred risk, or motivational subtitle. The top avatar row makes people present before the full roster.

## What to explore

- Change All teams to US Success or UK Success in the illustrative example. Watch meetings, commitments, private context, and direct reports change together. Parent work is explicitly labeled when inherited.
- Open “Make customer handoffs consistent” to see the goal, its linked project, named owner, and source-linked commitments. Open a commitment to inspect its source and mark it done locally. Counts and lists update together.
- Open the other goals and projects, including a standalone project. Standalone work is not treated as a problem.
- Open the meeting agenda, run it with per-item notes, or quick-log it after the fact. Uncheck a discussion item, then review wrap-up. Summary and commitment inclusion remain editable; nothing is confirmed by the illustrative AI-draft action.
- Edit Must-knows or training focus in place. Each is one private text block for the selected scope.
- Open a person’s Relationship Desk preview; expand Team details for the private update record and account-access explanation.
- Switch to Observed account snapshot. This is read-only, and deliberately exposes only All teams and US Success: those are the inspected scopes, not a replacement for the full live scope menu.

## Data provenance

The top preview toolbar is outside the proposed product interface. It clearly separates two datasets:

**Illustrative example:** all people, goals, projects, commitments, dates, updates, and relationships are fictional. Connection lines describe explicit sample relationships; they do not assert anything about Andrew’s account. No quantitative progress values were fabricated. Source-linked project commitments correspond conceptually to the existing `source_type = project` / `source_id` relationship; a shared owner alone must never create a work connection.

**Observed account snapshot:** inspected through the signed-in browser at `https://app.thesamepage.xyz/app/team` on September 25, 2026. No writes were made. The All teams view showed ten direct reports, four open commitments, seven goals, one active project, a LatAm GTM meeting needing logging, and meeting history count four. Its Must-knows and training focus were empty. The US Success view showed Jordan Breedlove and Leah Welborn, an undated four-item meeting, no open team commitments, three goals, one project, and history count two. Its Must-knows and training focus were empty.

Three goal titles, statuses, and due dates were inspected by expanding the US Success goal disclosure: Value Engine; Activate the Army; and >100% NDR Attainment for Corporate Segment. The project details, other goal details, check-in percentages, meeting history contents, and Relationship Desk contents were not inspected. The snapshot omits them or explicitly labels them unknown. Meeting agenda wording is lightly condensed. Commitment wording is retained. Date/status labels reproduce the observed UI, including its “Due soon” label for the September 24 item; they are not recalculated as current facts.

The live scope menu listed All teams, Customer Success, LatAm GTM, UK Success, and US Success. The illustrative menu is not the production menu specification.

## Functional boundaries to preserve

The reviewed references were `CLAUDE.md`, `docs/DESIGN.md`, `docs/systems/brand.md`, `docs/systems/team.md`, and the selected Mission Control `BUILD_BRIEF.md`, `prototype-source.html`, and clickable `prototype.html`. The Team page’s existing filter expressions and relevant schema relationships were also inspected read-only.

There is documentation drift in the Team scope description. Preserve the existing application behavior pending a separate decision; this exploration does not resolve or migrate scope semantics:

| Object | Current page code at inspection |
|---|---|
| Team choices | Led org units; All teams is the default |
| People | Caller’s own direct reports; exact selected org unit, no descendant roster rollup |
| Projects | Selected unit and its ancestors; null-team projects appear only in All teams |
| Goals | Company goals always visible; otherwise selected unit and ancestors. Null-team non-company goals do not become universal |
| Commitments | Explicit team first, fallback to the assignee’s team. No team and no assignee means All teams only. Null assignee means You, not “unassigned” |
| Meetings | Exact team plus null-team/all-teams meetings; no ancestor cascade |
| Must-knows | One exact-scope text block, including its separate All teams block |
| Training focus | One exact-scope text block, including its separate All teams block |

The prose subsystem document describes broader null-team inheritance for goals and callouts than the current page implements. Do not use that discrepancy to broaden data visibility during design implementation. Parent cascade applies only to goals/projects. All source data still requires existing manager auth and RLS. No team-page, private-update, training-focus, or Must-knows content becomes visible to reports.

Preserve both meeting paths: quick log on Team for a meeting already held, and the canonical meeting screen for running it. Both retain per-item notes, coverage checkboxes, off-agenda notes, draft review, and carry-forward. Dates alone do not imply Run is complete. Logged agendas freeze; summary correction remains allowed; deleting an unlogged meeting stops its series. Scheduling sends no calendar invitation. Actual rollover remains anchored to the prior scheduled date and existing repeat rule, with undated carry-forward when appropriate.

Use the existing Relationship Desk, Goals, Projects, Scribe, global Quick add, and account flows in implementation. Local destination dialogs and the static navigation rail in this disposable concept are explanations, not replacement product screens. In particular, the concept’s Quick add demonstrates one relevant path; it is not authorization to reduce the real global menu.

## Deliberate prototype limits

This file models local selection, editing, draft review, meeting creation, commitment creation/completion, and disclosure. It is not a second application. It does not call AI, persist browser storage, send messages, issue invites, implement auth, or simulate full recurring-series rollover. Logging gives an explicit receipt explaining the rollover limitation. Deletion and canonical destination dialogs explain their preserved behavior rather than executing it. A full project editor and Relationship Desk are outside this design’s scope.

A future approved design must handle loading, partial fetch failures, empty teams, dense rosters, long names, Scribe-open reflow, and source refresh using existing application conventions. Do not turn missing data into zero progress or an all-clear. Only introduce a chart if a recorded measure supports it. Verify all source links against the real API contracts before building.

## Review status

The local browser checks covered linked-work disclosure, exact team filtering and inherited work, meeting notes and carry-forward selection, wrap-up confirmation, local commitment count reconciliation, and observed US Success scope. Desktop and narrow layouts were visually inspected. This is prototype verification, not backend or application testing.

At the end of the original exploration, no implementation handoff had been made. Andrew subsequently requested one; `BUILD_BRIEF.md` now records that direction and the additional improvements. `docs/HANDOFF.md` was absent on initial inspection and was not created, edited, or replaced. The existing Mission Control proposal remains separate and untouched. Existing and concurrent changes elsewhere in the repository are outside this exploration.
