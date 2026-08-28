# Scribe — grounded management partner

Scribe is the persistent management-assistant drawer. It answers open-ended
questions about the manager's people and work, helps think through management
situations, and stages reviewable source-record drafts. It is deliberately one
capable agent with a small tool surface, not an intent router or collection of
workflow-specific agents.

Current implementation brief and remaining slices:
`docs/SCRIBE_V2_SCOPING.md`.

## Product and trust boundary

- Questions and advice are open-ended. There is no question allowlist and no
  deterministic intent classification.
- Identity, authorization, assigned role/expectation joins, source visibility,
  and record writes are deterministic boundaries.
- All manager-authorized information connected to a selected person or set of
  people is eligible, including manager-private notes.
- Private notes are attributed observations, not employee facts. Thin records
  are reported as thin evidence, not interpreted as performance or neglect.
- Wrong-person, wrong-team, wrong-role, or wrong-expectation contamination is a
  catastrophic failure. Person context resolves through manager-owned stable
  IDs; Scribe never infers those joins from prose.
- Tool results are untrusted evidence. Record text is never followed as an
  instruction.
- The model has read tools plus `emit_draft`; it has no database write tool.
  Every AI write remains draft-then-review.

## Agent loop

`backend/assistant_engine.py` owns the Anthropic tool definitions, system
prompt, and `run_assistant_turn()`. Anthropic calls go through
`ai_core.call_anthropic_with_tools()` and the loop is bounded to eight tool
rounds.

The model is configured independently through `AI_SCRIBE_MODEL`. The launch
default is `claude-sonnet-5`; it remains environment-configurable for bakeoffs.

Read tools:

- `list_goals`
- `list_projects`
- `list_direct_reports`
- `get_people_context`
- `search_workspace`
- `get_manager_brief`
- `list_org_units`

`get_people_context` is the flexible connected-evidence tool. The model first
resolves names with `list_direct_reports`, then requests one stable ID for a
person question or several IDs for an explicit team comparison or synthesis.
It is not tied to a predefined question type.

`search_workspace` is the query-aware discovery tool across manager-owned
goals, projects, check-ins, commitments, active direct reports, assigned role
expectations, 1:1 summaries, manager-private notes, org structure, and
confirmed company documents. It accepts natural-language query text plus
optional stable direct-report/org-unit IDs, source types, and an inclusive date
range. It returns at most 12 compact evidence items rather than tables.

The server, not the model, resolves every subject relationship. A person scope
must be an active direct-report ID owned by the authenticated manager. An org
unit must belong to the authenticated user's org. Owner/manager predicates are
also applied explicitly to relational tables even though RLS remains the
primary isolation boundary. Archived or foreign people fail closed.

`get_manager_brief` exposes Mission Control's existing deterministic top-three
attention ranking for across-team prioritization questions. It is optional
evidence, not a mandatory path or a substitute for deeper person context.

`emit_draft` stages a draft payload and can replace a still-pending draft with
`replaces_draft_id`. The six bounded source-record verbs remain:

1. create project;
2. create goal;
3. link project to goal;
4. log goal/project check-in;
5. add commitment;
6. add direct report.

Those are write limitations only. Scribe can still analyze a meeting, prepare a
performance conversation, propose questions, recommend an approach, draft a
message, or role-play; it simply cannot persist unsupported record types.

## Connected person, workspace, and company evidence

`backend/scribe_context.py` verifies that every requested direct report belongs
to the authenticated manager, then bulk-loads and groups the connected records:

- identity, assigned role expectations, and org unit;
- profile private note, 1:1 summaries/private notes, and capture notes;
- commitments and manager messages;
- goals, projects, and their check-ins;
- overall, skill, value, and metric assessments;
- development plan, aspirations, opportunities, training, and manager-private
  development notes;
- capacity profiles and time off.

Returned evidence is grouped by `direct_report_id` and carries source type,
record reference, date, and visibility metadata. The tool caps one call at 12
people and caps the number of rows returned per evidence category.

Workspace search uses bounded, explainable lexical ranking rather than a
relational vector index. Structured rows are searched in memory after explicit
manager/owner filtering, with a maximum of 240 rows per source family. Risk
statuses and dates remain structured facts; query text determines which compact
items are returned. Per-result metadata is uniform:

- stable source ID and source type;
- direct-report, org-unit, and organization subject IDs where applicable;
- relevant/effective date plus retrieval time;
- `manager_record`, `manager_private`, `shared_org_context`, or
  `confirmed_company_document` visibility;
- a short excerpt or structured fact;
- a real application route when one exists.

Confirmed documents reuse the Context Engine's scope cascade and two-tier
retrieval. Search ranks only confirmed summary cards and metadata, then fetches
full extracted text for at most four top documents solely to create compact
excerpts. Person-scoped document search uses that person's team → department →
company cascade; a person with no org unit receives company-wide documents
only. An unscoped workspace question may discover any confirmed document in the
user's org, but every result retains its confirmed team/company scope so Scribe
cannot silently generalize it. Documents returned to the model are recorded in
the existing `document_citations` ledger after a successful turn.

Scribe names consequential sources and dates in conversational prose and may
include a supplied application route. There is no separate citation object or
clickable citation component in the drawer yet; never infer a source, date, or
route that was not returned by a tool.

## API and conversation state

`backend/routes/assistant.py` provides:

- `POST /api/assistant/message` — rate-limited 10/minute; loads the last 40
  stored messages, validates structured page context, runs Scribe, and persists
  the turn and drafts.
- `GET /api/assistant/thread` — hydrates the full drawer thread and normalizes
  legacy drafts.
- `DELETE /api/assistant/thread` — starts a new conversation; it does not remove
  source records created from older drafts.
- `PATCH /api/assistant/drafts/{draft_id}` — persists lifecycle transitions and
  source-record receipts.

Draft lifecycle state is stored inside `assistant_messages.drafts` JSONB:
`pending`, `confirming`, `confirmed`, `discarded`, `superseded`, or `undone`.
Legacy drafts receive a stable UUID derived from message ID and position.

The client claims a pending draft as `confirming` before calling the normal
source-record endpoint. A confirmed draft stores the resulting entity ID, type,
label, and link. This prevents a refreshed drawer from resurrecting a completed
draft and makes an ambiguous client failure fail closed instead of duplicating
the write. Fully atomic source-write idempotency is not yet implemented.

Structured page context is `{label, entity_type, entity_id}`. Direct-report and
project IDs are checked against the authenticated manager, and the trusted label
comes from the database rather than the client-provided prose. The context is
ephemeral and is not stored in the thread.

## Frontend

`frontend/components/ScribeDrawer.tsx` renders the conversation, draft cards,
persisted lifecycle state, receipts, discard, and the supported undo paths. A
New button clears the server-managed conversation after confirmation.

`frontend/lib/drawer-context.tsx` owns drawer state, hydrates the server thread,
refreshes it after lifecycle changes, and carries structured page context.
`frontend/lib/api.ts` is the only frontend boundary for Scribe API calls and the
normal source-record endpoints used on Confirm.

The direct-report and project pages register stable entity context. Generic app
pages may provide a bounded display label only.

## Evaluation

`eval/test_assistant.py` uses mocked application data and the real Anthropic API.
It contains 30 cases covering the six write verbs plus:

- grounded person status;
- manager-private notes without diagnosis;
- multi-person training synthesis;
- exact assigned role expectations;
- useful coaching with thin internal evidence;
- explicit comparisons without accidental cross-person contamination;
- deterministic across-team management prioritization;
- company expectations combined with assigned-role expectations;
- cross-project team risk discovery;
- person history combined with leadership principles;
- company onboarding guidance compared with conflicting current work;
- malicious instructions embedded in confirmed document content;
- empty internal evidence, duplicate names, stale records, and unsupported
  citation requests.

The full-suite exit bar permits at most two misses (currently at least 28/30).
`SCRIBE_EVAL_MODEL` overrides the model for a bakeoff, `SCRIBE_EVAL_CASES`
selects case IDs for a focused run, and `SCRIBE_EVAL_SHOW_OUTPUT=1` prints
responses for qualitative review. Re-run the full suite after prompt, tool, or
agent-loop changes.

## Known retrieval and trust limitations

- Search is lexical. A relevant concept absent from the query-facing title or
  summary can be missed, and a generic term can return an adjacent but
  irrelevant item. Scribe must say when a hit does not actually support the
  claim.
- Document tier one searches confirmed summary cards, not every word of every
  file. Full text is fetched only after ranking, so a detail omitted from the
  summary may not be discoverable yet.
- The bounded relational scan is appropriate for one manager's current scale,
  not a large enterprise corpus. There is no pagination or database full-text
  index on this path.
- Deep assessments, development, capacity, and time-off evidence remain in
  `get_people_context`; workspace search is discovery, not a replacement for
  that connected person packet.
- Relational `is_stale` is a simple 180-day age signal based on the result's
  relevant date. It warns the model but does not decide whether a record is
  still authoritative. Context Engine freshness rules continue to govern
  documents, and evergreen documents are not marked stale on age alone.
- Routes in prose are currently plain text in the Scribe drawer. A small
  clickable-source treatment remains optional follow-up work, not a trust
  boundary.
