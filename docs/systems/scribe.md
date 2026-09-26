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

### Citations

Every record Scribe names is a chip in the drawer that opens that record.
Scribe writes `[[type:id|Name]]` in its reply, where `type` is `person`,
`goal`, `project`, `org_unit` or `document`. Before the reply leaves
`run_assistant_turn`, `backend/scribe_citations.py` checks each marker against
the ids Scribe's read tools returned in this turn (`collect`), plus markers
already stored on earlier assistant turns in the thread (`seed_from_thread`):

- a known id keeps its marker, with the label replaced by the record's stored
  name (brief items carry no name, so Scribe's own label is kept);
- an unknown id or unsupported type is flattened to its label as plain text.

So a chip can only ever point at a record the tools supplied for this manager.
Check-ins, commitments, 1:1s and notes are cited through the goal, project or
person they belong to. The validated markers are stored in
`assistant_messages.content`; there is no citation table.

`frontend/lib/scribeCitations.ts` parses the markers and builds routes from
type + id: person → `/app/reports/<id>`, goal → `/app/goals?goal=<id>`,
project → `/app/projects?project=<id>`, team → `/app/org`, document →
`/app/context`. When the target goal or project page is already open, the chip
sends a `tsp:open-record` event instead of navigating, and the page opens the
record through its own unsaved-edits guard (`useOpenRecord`). Below `md` the
drawer is a full-screen sheet and closes on a chip click; beside the page it
stays open. The mechanism is a text convention rather than Anthropic
search-result blocks because Scribe's tools return JSON rows, not documents,
and the drawer renders plain text; it adds no model call.

Not yet: chips are not measured in analytics, and `org_unit` opens the org
chart rather than the specific team.

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

The frontend has more page kinds than the server verifies: `goal`, `goals`,
`team_meeting` and `mission_control` exist to key the drawer's starters and
launchers. `sendAssistantMessage()` in `lib/api.ts` forwards `entity_type` and
`entity_id` only for `direct_report` and `project`; every other kind sends the
bounded label alone, the same display-only context any generic page has.
Scribe resolves a goal from the label with `list_goals`, like any named goal.

## Frontend

`frontend/components/ScribeDrawer.tsx` renders the conversation, draft cards,
persisted lifecycle state, receipts, discard, and the supported undo paths. A
New button clears the server-managed conversation after confirmation.

The empty drawer says what Scribe is for ("Ask about your team, or tell me what
happened. I answer from your notes, 1:1s, goals, projects and the documents in
Knowledge. When something should be saved, I draft it and you confirm.") and
offers three starter prompts keyed on the page context's `entity_type`:

- `direct_report` (the Relationship Desk, using the person's first name from
  the display-only `subject` field): how they are doing against their role
  expectations; what's still open between us; help me get ready for the next
  1:1.
- `goals` / `goal`: goals with no update this month; goals that look at risk;
  projects not linked to a goal.
- `mission_control`: what to get to first this week; who I haven't had a 1:1
  with in a while; help me get ready for a hard conversation.

Starters are static strings. Clicking one fills the composer; nothing is sent
until the manager presses Send, so they cost nothing unused.

**In-page launchers.** `components/AskAboutButton.tsx` calls
`useDrawer().ask(prompt, context?)`, which opens the drawer with the prompt in
the composer. They appear as "Ask about {first name}" on the Relationship Desk
header, "Ask about this goal" on each goal card and the goal detail view, "Ask
about this project" in each project brief's action row, and "Ask about this
meeting" on a team meeting. A launcher may pass a narrower context (one goal on
the Goals board, one project); that override lasts until the drawer closes or
the route changes, then the page's own context returns. Scribe has no meeting
tool, so the meeting launcher carries the agenda (up to six items) in its
prompt, and a logged meeting asks what is still open from it, which Scribe
reads from commitments.

`frontend/lib/drawer-context.tsx` owns drawer state, hydrates the server thread,
refreshes it after lifecycle changes, carries structured page context, and
holds the launcher's pre-fill and context override (`ask`, `prefill`).
`frontend/lib/api.ts` is the only frontend boundary for Scribe API calls and the
normal source-record endpoints used on Confirm.

The direct-report, project and team-meeting pages register page context;
Mission Control and the Goals board get theirs from the drawer's path fallback.
Generic app pages may provide a bounded display label only.

## Evaluation

`eval/test_assistant.py` uses mocked application data and the real Anthropic API
(`ANTHROPIC_API_KEY` in `backend/.env` or the shell; it cannot run against the
deployed app). Each tool round reads the system prompt, tool definitions and
the thread so far from the prompt cache (`docs/ENGINEERING.md` → AI calls).
It contains 31 cases covering the six write verbs plus:

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
  citation requests;
- citation markers with real ids (case 31, graded on the marked-up text; every
  other case is graded on the label-only text a reader sees).

The full-suite exit bar permits at most two misses. The Scribe runs with the
model's default thinking and a 4,000-token budget per round
(`AI_SCRIBE_THINKING`, `SCRIBE_MAX_TOKENS` in `assistant_engine.py`); the
longest round in the suite uses about 2,250 output tokens. On
`claude-sonnet-5` that configuration lands at 28–30/30; with thinking off it
holds at 27/30, missing the same grounding and honest-refusal cases, so
thinking stays on at roughly a quarter more cost per turn. The misses that
remain are run-to-run: case 3 sometimes asks whether "cut onboarding time"
duplicates the existing "Improve Onboarding Efficiency" goal instead of
drafting it (a defensible question the checker scores as a miss), and case 22
sometimes leaves the Leadership Principles document out.

Checkers read answers, so they are string tests with the usual false
negatives. `claims()` treats a phrase as asserted only when no negation or
hedge precedes it ("I don't have evidence that Jordan is disengaged" is the
answer case 16 wants), and `NO_SOURCE_PHRASES` is the shared list of honest
"there is no source for that" phrasings for cases 27 and 30. When a miss
looks wrong, read the full answer with `SCRIBE_EVAL_SHOW_OUTPUT=1` before
changing the prompt; widen a checker only for an answer that meets its stated
intent, and say so in the commit.
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
- Citation chips open the record's page, not a specific check-in, commitment
  or 1:1 inside it; those are cited through their goal, project or person.
