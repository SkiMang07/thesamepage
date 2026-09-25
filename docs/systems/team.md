# Team workspace (`/app/team`)

One home for "my team as a unit." Scoped to the caller's **own direct reports**,
not an org_unit rollup — that's a different concept, see `org-scoping.md`.

Backend: `routes/team.py`. Frontend: `frontend/app/app/team/page.tsx`, plus
`frontend/app/app/team/meetings/[id]/page.tsx` for a single meeting.

## Page structure, top to bottom

Selected design: `docs/design-proposals/2026-09-25-team-overview/` (the
prototype is the visual reference; its fixtures never shipped). Section
components live in `frontend/components/team/`.

1. **Heading** — editorial serif title naming the selected scope, the
   manager-only line, an avatar row of the people in scope, and the Team scope
   menu (All teams default, plus the caller's led units).
2. **In-page links** — Meetings, Shared work, Commitments, People.
3. **Team meetings** (`TeamMeetingsSection`) beside **Must-knows** and
   **Training focus** (`TeamContext`, each an exact-scope private text block
   edited in place). The meeting card shows scope, repeat rule, state chip,
   date, the Plan → Run → Wrap up steps, the first three agenda items,
   inline capture, a state-appropriate primary action and collapsed
   preparation. Other open meetings, Quick log, Edit plan, Delete and
   meeting history sit under the card.
4. **Shared work** (`SharedWork`) beside **Commitments** (`TeamCommitments`).
5. **People** (`TeamPeople`) — roster grid; the Relationship Desk is each
   person's primary door; "Team details & access" holds current work, the
   private update record and account access (invites stay behind
   `IC_INVITES_ENABLED = false`).

Layout is measured (ResizeObserver on the page root), not viewport-based,
so opening Scribe reflows it: ≥1000px content wide (meeting|280px context,
work|340px commitments, three roster columns); ≥740 medium; ≥600 split
(work stacks over a two-column commitment list); below that one column.

There is no attention brief, KPI strip or team score. Attention shows where
it applies: the meeting's "Needs wrap-up"/"Needs a date" chip, overdue
commitment text and rail, and "At risk" work rows.

### The meeting card's lifecycle

| Meeting | Current step | Primary action |
|---|---|---|
| undated | Plan (amber) | Set a date |
| dated, no agenda | Plan | Open meeting |
| dated, has agenda, not past | Run | Open meeting |
| date passed, not logged (`needs_log`) | Wrap up (amber) | Wrap up meeting (Quick log) |

Plan shows ✓ only when an agenda is recorded. **Run is never shown as done**
— nothing records that a meeting was run, and a passed date is not evidence.

### Shared work and commitments

Goals and active projects in scope are one list, exception-first: rows
marked `at_risk` show; the rest are behind "Show N other goals & projects".
A row expands to its latest check-in (progress only if a percentage was
recorded; amber after 14 days) and **explicit** connections only —
`projects.goal_id` and commitments whose `source_type`/`source_id` point at
the goal or project. A shared owner is never a link. A standalone project is
described as standalone, not as a problem. Inherited work says which parent
unit it belongs to.

Commitments: open ones ordered by due date (undated last), with "Overdue ·
date" (amber text and rail), "Due soon · date" (within 7 days), "Due date"
or "No due date". Filters All open / Overdue / Mine plus an Owner select;
counts come from the same list the rows do. Three rows first, then "View all
N". A row expands to its source (meeting, project, goal, 1:1 or "Added on
the Team page"), added date, Mark done and the owner's Relationship Desk.
Scope changes clear filters and expanded rows.

## Endpoints (`/api/team`)

| Route | Notes |
|---|---|
| `GET ""` | the roster — `direct_reports` merged in Python with each report's active projects, individual-level goals, and latest message |
| `GET /goals` | goals at `level in ('company','department','team')` |
| `GET`/`POST /{report_id}/messages` | per-report update log |
| `GET`/`POST /meetings`, `PATCH`/`DELETE /meetings/{id}` | team meetings + agenda items |
| `POST /meetings/{id}/agenda-items` | inline capture: append ONE item; 409 if logged; an existing line comes back with `created: false` |
| `POST /meetings/{id}/wrapup` | raw notes → **draft only**, nothing written |
| `POST /meetings/{id}/log` | the confirmed write, then series rollover; returns the saved meeting, `commitments`, `carried_forward`, `next_meeting`; 409 if already logged |
| `GET`/`POST /commitments` | team-flagged commitments, with `source_type`/`source_id` |
| `GET`/`PUT /callout` | critical callouts |
| `GET`/`PUT /dev-focus` | team training focus (see `development.md`) |

## Team scope

The scope menu lists `org_units` where `leader_user_id` is the caller (`GET
/api/org-units/led`) plus **All teams**, the default. There is no separate
"which team am I a member of" concept. Switching filters data already on the
page. The rules live in one module, `frontend/components/team/scope.ts`,
shared by the page and the meeting screen (whose scope is the meeting's own
`org_unit_id`):

| Object | Rule for a selected team |
|---|---|
| People | the caller's own direct reports with exactly that `org_unit_id` — no descendant rollup |
| Projects | that unit or any ancestor; a null-team project appears only under All teams |
| Goals | company goals always; otherwise that unit or any ancestor. A null-team non-company goal is **not** universal |
| Commitments | the commitment's own `org_unit_id`, else the assignee's team. Neither → All teams only. A null assignee is "You" |
| Meetings | exactly that unit, plus null-team (all-teams) meetings; no ancestor cascade |
| Must-knows, Training focus | the exact-scope text block (All teams has its own) |

Before 2026-09-25 this doc said a null `org_unit_id` goal or callout showed
under every team. The code never did that, and the redesign kept the code's
behaviour rather than broadening access. An inherited goal or project does
not widen which people, commitments or private records are shown.

### Hierarchy cascade

`ancestorChain()` walks `org_units.parent_unit_id` upward from the selected
team (capped at 20 hops as a cycle guard). Cascade applies to goals and
projects only, and is labelled with the owning unit. This downward cascade is
a different concept from `org_unit_projects_rollup()`'s upward aggregation —
the two do not agree, on purpose. See ENGINEERING.md → Scope discipline.

## Meetings

`team_meetings` — one row per occurrence, the team-side equivalent of
`one_on_ones`. Renamed from `team_meeting_notes` (2026-08-24), which held one
row per *note*: planning an agenda wrote a future-dated row, logging what
happened wrote a second unrelated row, and nothing joined them. The rename
preserved every row, the RLS policy and the index rather than copy-backfilling
into a new table.

Deliberately standalone: `one_on_ones.summary` stays where it is, and this
covers anything that isn't a 1:1. No attendee tagging — the org_unit is the
scope. `org_unit_id` is `ON DELETE SET NULL` here, unlike `team_callouts`.

### Status derives from `summary`, not from the date

The date only *orders* meetings; it never decides whether one is still open.

| Status | Rule |
|---|---|
| `open` | `summary` null, dated today or later (or undated) |
| `needs_log` | `summary` null, the date has passed |
| `logged` | `summary` set, whatever the date says |

Same no-stored-status discipline as `one_on_ones`. It is also the fix for two
old bugs: a meeting held and written up at 3pm used to sit in the "next
meeting" slot until midnight, and a second future-dated note used to disappear
into the past-meetings list. Everything unlogged is now simply a list.

`scheduled_at` is a date encoded at **noon UTC**, exactly like `one_on_ones` —
stable across timezones, and able to carry a real start time later without
another migration. The legacy `meeting_date` column was dropped by
`2026-08-25_drop_team_meeting_date.sql` once the backfill had been verified
against live data; that migration guards itself, refusing to drop the column
while any row still has a `meeting_date` but no `scheduled_at`.

### Agenda items

`team_meeting_agenda_items` — structured rows, not newline-split text (the
`team_callouts` trick), because carry-forward needs item identity: notes attach
to the item they belong to, and `carried_from_item_id` is what makes "carried
twice" answerable at all.

`manager_id` is **denormalized** onto the row so the policy stays a flat
`manager_id = auth.uid()` instead of a subquery into `team_meetings`.

Agenda edits (`PATCH agenda_items`) set the whole list but are **reconciled
by text**: an unchanged line keeps its row, id and `carried_from_item_id`;
removed lines are deleted and new lines inserted. Inline capture uses the
append endpoint instead, which never touches existing rows. Item ids matter
because the meeting screen keys the manager's browser-held notes by them. An
agenda holds at most 20 items.

`carried_from_item_id` is set when logging carries forward a line that
matches one of the logged meeting's agenda items. A carry-forward line typed
fresh during review has no source item and gets no lineage.

### What each state allows

| | Planned | Logged |
|---|---|---|
| Date, agenda, repeat rule | editable | **frozen** — `PATCH` returns 409 |
| Summary | n/a | editable in place |
| Delete | allowed | **refused** — 409 |

A logged meeting is history, and commitments point at it through `source_id`;
deleting one would orphan them. Freezing the agenda is what protects the
per-item notes, since `PATCH` replaces the item set wholesale. Correcting the
wording of a summary destroys nothing, so it is the one edit that survives
logging — `updateTeamMeetingSummary()` sends `summary` alone rather than the
shared PATCH body, whose nulls would otherwise read as "clear the repeat rule".

Deleting a planned meeting also deactivates its series, so "delete" and "stop
this repeating" are one action rather than two.

### Series and rollover

`team_meeting_series` owns the repeat rule (1–4 weeks), mirroring
`one_on_one_series`, with two partial unique indexes for the null-`org_unit_id`
"all teams" case. Setting a repeat **deactivates then inserts** rather than
updating, so the partial indexes never see two live series at once.

Logging rolls the next occurrence forward from the prior **scheduled** date
plus the interval — never from when the manager happened to log it — and skips
occurrences already in the past instead of creating stale shells. If an open
meeting for that team already exists, carried items are appended to it rather
than creating a second one. With no series but items carrying, an **undated**
meeting is created so nothing carried is silently dropped; the UI shows it as
needing a date.

No calendar invitation is sent, and the UI says so.

### Preparation, capture and the receipt

**Preparation** (`meeting-prep.ts`, `MeetingPrepPanel`) is collapsed under the
meeting on both surfaces and built deterministically from team-level
records:

- *Carried over* — agenda items with lineage, naming the source meeting and
  whether it was covered there; plus commitments made at the last logged
  meeting that are still open.
- *What changed* — since the **last logged meeting for exactly the same
  scope** (its `logged_at`): goal/project check-ins in scope, commitments
  marked done, and commitments added (excluding that meeting's own
  outcomes). With no earlier logged meeting it says there is nothing to
  compare, and claims no changes.
- *Needs a decision* — decision requests and blockers aren't recorded
  anywhere, so it says so instead of inferring one from an overdue date or
  an at-risk status.

Every entry has a "Why this?" disclosure with the reason and a source link.
"Add to agenda" only fills the capture box for the manager to edit and
confirm. Sources that failed to load are named. 1:1 notes, assessments,
Relationship Desk notes and private update records are never used.

**Capture** (`AgendaCapture`): "Add something to discuss…" appends one item
through `POST /meetings/{id}/agenda-items`. It shows "Added" only after the
server confirms, keeps the text and says so on failure, locks while saving,
refuses duplicates, and keeps focus for the next line. It has no
person/work association — agenda items have no column for one.

**Receipt** (`meeting-outcomes.ts`, `MeetingReceipt`): after confirming a
wrap-up, the log response is merged into the page's records and the page
re-reads meetings and commitments. The receipt then shows the reviewed
summary ("decisions are recorded here"), the commitments whose source is
this meeting (owner, due state), what carried forward and which occurrence
it landed on, with links. A logged meeting's record and history modal show
the same outcomes from stored records. Unticked or removed draft commitments
never appear, because only saved rows are read.

**Retries:** `/log` claims the meeting with a conditional update (`summary
is null`). A second attempt gets 409 and writes nothing. The review keeps
the draft on any failure, and on a 409 the page loads and shows what the
first save stored. Owners are validated before anything is written, so a bad
id can't leave a meeting half-logged.

### The meeting screen (`/app/team/meetings/[id]`)

Two columns, the same shape as the 1:1 call screen and for the same reason:
the screen open *during* a meeting has to answer "what were we going to cover"
and "what is actually happening" at once. Agenda, what carried in, and the
team's open commitments on the left; a live notes pane on the right.

There are deliberately **two logging paths, not two doors to the same one**.
The card's quick log is for "we already met, let me write it up"; this screen
is for running the meeting. Both assemble raw notes identically — each agenda
item that has notes, headed by the item, plus whatever came up off-agenda —
and both end in `MeetingWrapUpReview`.

Agenda items carry a checkbox and their own notes box. Unticking one keeps it
out of the notes and offers it as carry-forward, exactly as the quick log
does. Commitments list with the manager's own (null `direct_report_id`) shown
as "You" and resolvable in place through `PATCH /api/commitments/{id}`.

**Notes autosave to `localStorage`, not to the server.** `raw_notes` is only
written at log time and there is no draft-notes endpoint, so the pane buys
back a refresh or a closed tab and nothing more — it says so in as many words
rather than implying the notes are on the account, the same honesty posture as
store-only team messages. The key is per meeting, restored notes are merged
onto the *current* agenda by item id, every access is wrapped (localStorage
throws outright in some privacy modes), and the entry is cleared the moment
the meeting is logged.

A **logged** meeting opens as a read-only record — summary, per-item outcomes
and notes, raw notes — with the summary editable in place and nothing else.
An **undated** meeting (the carry-forward shell created when items carried
with no series) is the one place this screen writes outside the wrap-up: it
offers a date, since otherwise it is a dead end. Date only — the repeat rule
re-anchors a series and stays with the agenda edit on `/app/team`.

### Wrap-up

`POST /meetings/{id}/wrapup` is a pure AI call — **nothing is written**. It
returns a draft summary, commitments, and carry-forward items;
`components/team/MeetingWrapUpReview.tsx` is the confirm step (its summary,
commitments and footer are `WrapUpReviewShell.tsx`, shared with meetings beyond
the team — see `beyond.md`), shared by the
card's quick log and the dedicated meeting screen — and by external-notes
ingestion when it lands — rather than forked per surface. A second review
surface would drift from this one on the exact rule that must not drift.
Extraction failure returns an empty draft, never an error.

A `direct_report_id` the model returns that isn't on the roster is discarded
rather than trusted — a hallucinated id would attach a real person's name to a
commitment they never made.

## Critical callouts

`team_callouts` — **one manager-authored text block per (manager, org_unit)**,
overwritten in place on every edit. Not a dated log. The frontend splits on
newlines to render bullets; there is no per-line CRUD or history. Deliberately
small.

Uniqueness is two partial unique indexes (`team_callouts_manager_unit_uq` /
`team_callouts_manager_all_teams_uq`), and `org_unit_id` is **`ON DELETE
CASCADE`, not `SET NULL`** — with SET NULL, deleting an org unit whose manager
already holds an all-teams callout tries to write a second null row and fails the
entire `DELETE FROM org_units`. Reproduced against real Postgres before switching.

`GET /callout` returns a **list** (one per led team that's had one, plus at most
one all-teams row) so the frontend can switch teams without a round trip. `PUT`
does a manual look-up-then-write keyed on `(manager_id, org_unit_id)` rather than
supabase's `upsert()` — `on_conflict=` can't express "conflict on org_unit_id
equality including null = null."

## Team commitments

`commitments.is_team_commitment` (boolean) rather than a new table or a real
multi-assignee model. The flag only decides whether a commitment also appears on
the team-wide list. Resolving one reuses `PATCH /api/commitments/{id}` unchanged
— the flag changes where it's listed, not how it resolves.

**`direct_report_id` is optional: a null one is the manager's own** — see
`docs/decisions/nullable-commitment-owner.md`, which any new commitments surface
should read before joining on `direct_reports`.

**A team commitment belongs to a team through `commitments.org_unit_id`.** A
commitment logged from a team meeting takes the meeting's `org_unit_id`; one
added from the card takes the team selected on the page, or the assignee's team
under "All teams." The page and the meeting screen filter on `org_unit_id`,
falling back to the assignee's `direct_reports.org_unit_id` when it is null. A
row with neither (a manager-owned commitment added under "All teams," or one
created before the column existed) shows only under "All teams" and on
all-teams meetings — never under every team, which is how one team's list used
to fill with every other team's work.

Commitments extracted from a meeting carry `source_type = 'team_meeting'` and
`source_id` = the meeting, so each traces back to where it was made.

## Per-report messages

`team_messages` — free-text update log per direct report, manager-scoped.

**Store-only by design, not a gap.** There is no IC-facing view, so a message
reaches nobody but the manager who wrote it. It's groundwork for when the IC view
ships. The UI copy says so explicitly, so the behavior doesn't read as broken.

## IC login (auth primitives)

The account/claim mechanism is real and works; what an IC *sees* after logging in
is not built (`/app/ic` is a static placeholder).

- `direct_report_invites` — one-time token per report, 7-day TTL, manager-scoped.
  Issuing a new invite soft-expires any prior pending one, so an old copied link
  stops working.
- `POST /api/direct-reports/{id}/invite` — confirms ownership, backfills
  `direct_reports.email` (the invite form is the only place it gets set), creates
  the invite, returns a frontend URL. **No email is sent from the backend** — the
  manager copies the link and shares it, same manual-delivery posture as
  `team_messages`.
- `routes/invites.py` — `GET /{token}` is intentionally unauthenticated and uses a
  plain anon-key client plus `get_invite_preview()`, so the "never service-role
  for user data" rule holds with no authenticated user in the request. `POST
  /{token}/accept` runs after login through the normal authenticated dependency.
- `accept_direct_report_invite()` claims the row for `auth.uid()`, re-checks
  `auth.email()` against `invited_email` **inside the function** as defense in
  depth, and corrects `users.role` to `'ic'` (the signup trigger defaults everyone
  to `'manager'`).
- Auth reuses the existing passwordless magic link. `frontend/app/invite/[token]/`
  is public — deliberately not under `/app`, so `middleware.ts`'s gate doesn't
  apply — and sends the link with `emailRedirectTo` pointing at
  `/auth/callback?next=/app/ic?invite={token}`.

Manager login at `/app/login` keeps the magic link as the default and also
offers an explicit **Use a password instead** path backed by
`supabase.auth.signInWithPassword()`. The password option is useful for stable
demo and training accounts without changing the invite/claim flow above.
Managers can sign out either from the global avatar menu or from the explicit
**Account** section in `/app/settings`; both clear the Supabase session and
return to `/app/login` without changing workspace data.
