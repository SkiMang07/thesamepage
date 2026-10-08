# Development plans

Individual growth plans plus a lightweight team training focus. Activated from
schema that was dormant in the original scaffold.

Backend: `routes/development.py`. Placement: a section on the person page — no
dedicated top-level page.

## Data model

| Table | Notes |
|---|---|
| `development_plans` | one per direct report, bootstrapped on first access. `plan_text` is the primary always-writable plan narrative, upserted in place |
| `dev_plan_aspirations` | desired role/path + timeline; one row per plan (`dev_plan_aspirations_plan_uq`), upserted as a unit |
| `dev_plan_opportunities` | skills + knowledge. `source_kind` / `source_config_id` optionally trace an opportunity back to the skill or value assessment item that prompted it |
| `dev_plan_training` | training needed + projected cost |
| `dev_plan_manager_notes` | private to the manager, append-only — no edit or delete |
| `team_dev_focus` | the team-level counterpart, mirroring `team_callouts`' upsert/uniqueness mechanics exactly rather than inventing a new pattern. `GET`/`PUT /api/team/dev-focus` |

**`plan_text` and `dev_plan_manager_notes` are genuinely separate concepts and
stay on separate fields and surfaces.** Manager notes had been accidentally
absorbing the AI assist meant for the plan itself; don't merge them back.
On the person page they live in the explicit **Private notes** context, separate
from Growth and from the temporary **Keep for next time** capture that feeds the
next 1:1. Private notes persist on the person, are visible only to the manager,
and are never included in 1:1 preparation automatically.

## Two AI operations, deliberately different shapes

Both ground themselves in the shared `_fetch_evidence()` / `_role_label()` helpers.

- **`POST /{id}/draft`** — evidence-gated. Can honestly return nothing when the
  evidence is thin. Drafts opportunities plus a synthesis suggestion
  (`DevelopmentDraft.plan_note`) targeting `plan_text`.
- **`POST /{id}/notes/revise`** — always answerable. Takes the manager's own
  already-written text as the primary input; evidence is only for grounding, so
  thin evidence never blocks it. Reused unchanged for both manager notes and the
  plan narrative — revising manager-written text is the same operation regardless
  of which field it lands in.

These are not one prompt behind a flag.

**Aspirations and training are never AI-drafted.** Only opportunities and the
synthesis note, where evidence-grounding actually applies.

`PUT /{id}/plan` writes `plan_text`.

## Manual entry is the default everywhere

Every surface here is manually writable, with AI as an optional assist ("Draft
with AI" for a first pass, "Revise with AI" for existing text). Nothing in this
flow is AI-gated. "Draft with AI" can also be started from the Relationship
view's Growth direction preview when no plan is saved; it runs the same draft
on the Growth tab (see one-on-ones.md → Relationship Desk).

## Career conversations

Growth runs as a recurring conversation inside the 1:1 rhythm rather than a
form the manager visits. On a timer, one of a person's ordinary 1:1s becomes
their **career conversation**: chosen ahead of time, titled differently, never a
separate meeting. Rules: `backend/career_rhythm.py` (pure, clock-injected).
Routes: `backend/routes/career.py` (`/api/career`).

**Data.** `organizations.career_conversation_interval_days` (default 90; null =
off), set in Settings → Operating defaults → Conversation rhythm (Off / 60 / 90
/ 120 / 180). `career_conversations`: one row per planned, held or skipped
conversation, at most one `planned` per person (partial unique index);
`planned_for` is the 1:1's date, `one_on_one_id` links the occurrence once it
exists, `heads_up_sent_at` records the manager marking the heads-up sent.

**Timing.**
- Due: the latest held or skipped conversation + the interval; with none,
  the day the person was added + 30. Never stored.
- The prompt opens 14 days before the due date (at once when past).
- Suggested 1:1: the first known occurrence (the open one, then its series
  steps) on or after max(due − 7, today + 7), so there is at least a week to
  book a longer slot and send a heads-up. The manager may pick any of the next
  four. No dated occurrence → no choices; the card says to set the 1:1 date.
- A planned conversation more than 7 days past with no log is **missed**:
  "It happened" (held), pick a new date, or "Not this time".
- "Not this time" records a skipped row dated today; the clock restarts from it.

**Staying on its 1:1.** `one_on_ones.py` calls `career.on_session_moved` after a
schedule change (the plan follows the occurrence's new date) and
`career.on_session_logged` after a log (the plan becomes held). Both match by
linked id, or by date when not yet linked, and never fail the 1:1 write.
Re-planning or moving the date clears `heads_up_sent_at`: the note named the
old date.

**Surfaces.**
- Person page, Relationship view: the career card under the next conversation
  (proposed → pick a 1:1; planned → book 45–60 minutes, a calendar title to
  copy, the heads-up message to copy and "Mark sent", Change date / Not this
  time / Undo the choice; missed → It happened / new date). Not due → one line
  with the due date and the last one. The next-conversation eyebrow reads
  "Next conversation · Career conversation" when it is that 1:1.
- Mission Control: the planned 1:1's row in the week carries "Career"; on the
  current week one line under the week lists what each person needs (a missed
  one to confirm, a 1:1 to pick, a heads-up to send), each linking to the
  person page. Helpers in `frontend/lib/career.ts`.
- `/app/1-1s` marks the next 1:1 "Career conversation"; the prep page titles
  it "Review the career conversation" / "Career conversation with …".

**The product never contacts the report.** The heads-up is deterministic text
(`career_rhythm.heads_up_text`) the manager copies and sends; the calendar is
not written (the title is copied).

Not built yet (docs/CAREER_CONVERSATIONS_SCOPING.md, gitignored): a career prep
sheet and wrap-up that feeds the plan; "last career conversation" on the Team
roster; the cold-start draft without assessments; the HubSpot email.
