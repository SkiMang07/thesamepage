# Goals, in view

September 25, 2026. Proposed design, awaiting Andrew's review. Goals is the selected next page; this composition is not yet approved for application implementation.

## Three organizing ideas

1. **Goal review, recommended.** A compact, exception-first list opens a focused goal beside it. The success metric, current recorded status, latest check-in and its date answer what the goal means and where it stands. Check-in is the primary action. Existing level filters remain. This supports recurring review without requiring additional records.
2. **Alignment map.** Parent and child goals lead, with linked projects underneath. Strong for explaining why work matters; weaker as a recurring home when many valid goals have no parent or project. Existing parent links are optional and do not imply weighted progress rollups.
3. **People and goals.** Each person leads a compact set of outcomes and recent updates. Strong for individual preparation; less suitable for company, department and team goals, which have no named accountable-person field. It would duplicate more of Team and the Relationship Desk.

The proposed concept uses Goal review, borrows explicit links from Alignment map, and retains person grouping at the Individual level. It does not add a planning object, computed health score, inferred blocker, required project, or second project editor.

## Live observation and provenance

The signed-in `/app/goals` screen was inspected read-only on September 25, 2026, including Team, Department and Company filters and one Team check-in history disclosure. No account records were changed. The initial view was Team. Five open team goals and one cancelled team goal appeared in the grid. Two open goals showed recorded progress (25% and 10%) with a freshness label of 44 days. Three open team goals had no check-ins. Department contained one active goal; Company contained two active goals. The Individual tab was not inspected.

The read-only snapshot in the prototype reproduces those nine goal titles, scopes, dates, statuses and the two observed percentages. It includes selected goal descriptions and success metrics from the visible screen. It omits personal check-in narrative; the AU history date was inspected as August 11, and US history was not opened. Relative freshness remains the observed 44-day label rather than reconstructing an unknown timestamp. The optional parent relationships for the two LATAM team goals were explicitly visible. The KPI reported no projects attached for every open goal in the inspected levels. Closed-goal project associations and uninspected history remain unknown.

The separate illustrative dataset is entirely fictional and includes dated check-ins, parent/child links, individual owners, linked projects, at-risk and overdue examples. It enables local editing and failure demonstrations. No actual account writes, API calls, AI, browser storage, external assets, messages or invitations are used. Refresh resets changes. Reference date: September 25, 2026.

## Capability inventory and proposed placement

| Existing capability | Proposed placement |
|---|---|
| Individual / Team / Department / Company level filters; first populated level on entry | Persistent level controls. Snapshot starts on Team. Illustrative starts on Team. |
| Owner grouping for individual goals | Person headings in the list; no invented accountable person on shared goals. |
| Create/edit title, description, success metric, level, report/team/department association, parent, status, due date | One inline goal form within the focus area. Existing optional associations stay optional. |
| Five manual statuses and lightweight status change | Inline status select in the focus area; status-only changes do not masquerade as a dated check-in. |
| Check-in status, optional integer percent and optional note | Primary action beside the latest evidence; in-place editable form with a saved receipt. |
| Latest non-null progress and newest check-in | Shown separately with dates. A note-only update preserves the earlier percentage and its provenance. |
| Check-in history | Full readable notes and recorded values in dated rows. No truncation of the evidence within an opened history. |
| Linked meetings beyond the team | Source door next to the relevant history context. Production must preserve the existing Beyond link lookup; the prototype's fictional source opens a boundary explanation. |
| Parent goal and projects | Explicit Connections disclosure and canonical project destination. Child links are derived only from available parent IDs. No rollup math. |
| Delete goal | Secondary action with exact local consequences explained. Prototype unlinks children/projects and removes that goal's history. Real backend semantics stay authoritative. |
| AI revision in long-text fields | Preserve existing NoteField assist in implementation. Prototype explains this boundary and never fabricates generated results. |

## Attention and progress rules

- Counts are scoped to the selected level. Search and the secondary filter narrow the list, not those counts. Labels explicitly say so.
- Open excludes completed/cancelled. Needs review means an open goal explicitly at risk, past its due date, or with an existing check-in older than 14 days. Reasons remain visible. No check-ins is a separate factual filter, rather than an implied risk rating.
- Due-soon is visible factual context within 14 days; it does not alone turn a goal into a risk claim. At-risk status remains amber after a new check-in until the manager changes it.
- The initial list shows Needs review, then No check-ins. Other current goals and closed goals remain discoverable through disclosures. A selected goal stays visible in its focus area after an update even if it no longer matches the list filter; a message explains the mismatch.
- Blank percent means no new percentage, not zero and not a reassertion of the old number. This deliberately improves the current pre-filled check-in interaction; implementation should agree this small behavior change explicitly.
- The focus area names both the date of the newest check-in and the date of the newest percentage. The goal list's enriched API response lacks the latter date, so it does not imply the newest check-in reasserted that percentage. Production can obtain provenance through existing history on selection; do not invent it before loading.
- No average across unlike goals, no percent inferred from status, and no parent progress inferred from children. Missing project and missing parent are neutral.

## Implementation boundaries and effort

Most of this is a frontend composition of existing list data, lazy history and mutations. Preserve PageShell, app navigation, central API client, authentication/RLS, Scribe reflow and existing scope semantics. Goal levels are classification, not authority to see other managers' named records. Org rollups remain aggregate-only.

Date-qualified progress in the focus area uses existing check-in history. Connection graphs must tolerate missing parents and cycles without recursion failure; a missing/inaccessible parent cannot be treated as absent. The prototype uses one-hop connections, never invented organizational ancestry.

The current CheckInPanel hides history errors as an empty list. The proposed flow distinguishes error, empty, loading and partial coverage. Its blank-percent change and failure retention require deliberate integration into the shared component without breaking Projects. The current backend inserts a check-in then writes status in a second operation; the prototype's clean failure simulation does not prove atomic or idempotent production retries.

Goal updates may return fewer enrichment fields than GET. Preserve/refetch progress metadata after edits; do not replace a rich goal with an un-enriched write response. A status change must remain independent of check-in recency. No implementation or backend changes are authorized by this exploration alone.

## Review paths

Start in the observed snapshot to compare the same account records with the current grid. Switch to the illustrative example for a full note-driven review: inspect a goal, enter a note with a blank percentage, save and inspect the dated receipt/history. Try Needs review and No check-ins, another goal level, explicit parent/child links, inline editing, a new goal and deletion. The preview toolbar supplies Empty, Load error and failure-on-next-save states; these are testing controls outside the proposed product UI.

See VALIDATION.md for checks actually performed. Approved Mission Control, Team and Relationship Desk packages are unchanged.
