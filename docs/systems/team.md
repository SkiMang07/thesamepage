# Team Mission Control (`/app/team`)

One home for "my team as a unit." Scoped to the caller's **own direct reports**,
not an org_unit rollup — that's a different concept, see `org-scoping.md`.

Backend: `routes/team.py`. Frontend: `frontend/app/app/team/page.tsx`.

## Page structure, top to bottom

1. **Team dropdown** — which team you're looking at.
2. **KPI strip** — goals on track, active initiatives, commitments due within 7
   days, days until the next meeting. All computed client-side from data the page
   already fetches.
3. **This week's focus** — Initiatives, Goals, Commitments as three cards.
4. **Meetings row** — Critical callouts left, Meetings right. The meeting card
   carries the agenda and its own logging action; there is no separate
   "log a past meeting" box.
5. **Roster** — a row of cards at the bottom that expand into a shared detail
   panel on click.

Initiatives reuse `getProjects()` filtered client-side to
`active`/`on_track`/`at_risk` — the same subset Mission Control's Key Initiatives
card uses. Completed and cancelled work stays off the page; full history lives on
`/app/goals` and `/app/projects`.

## Endpoints (`/api/team`)

| Route | Notes |
|---|---|
| `GET ""` | the roster — `direct_reports` merged in Python with each report's active projects, individual-level goals, and latest message |
| `GET /goals` | goals at `level in ('company','department','team')` |
| `GET`/`POST /{report_id}/messages` | per-report update log |
| `GET`/`POST /meetings`, `PATCH`/`DELETE /meetings/{id}` | team meetings + agenda items |
| `POST /meetings/{id}/wrapup` | raw notes → **draft only**, nothing written |
| `POST /meetings/{id}/log` | the confirmed write, then series rollover |
| `GET`/`POST /commitments` | team-flagged commitments |
| `GET`/`PUT /callout` | critical callouts |
| `GET`/`PUT /dev-focus` | team training focus (see `development.md`) |

## Team dropdown and org_unit filtering

The dropdown lists `org_units` where `leader_user_id` is the caller (`GET
/api/org-units/led`) — there is no separate "which team am I a member of"
concept. **"All teams" is the default.**

Most filtering is free: roster, initiatives, and commitments key off
`direct_report_id` → `direct_reports.org_unit_id`; goals and projects carry
`org_unit_id` directly. Only `team_meetings` and `team_callouts` needed a
real `org_unit_id` column.

**A null `org_unit_id` means "applies to all teams"** — such a row shows under
every specific team's filter, not only under "All teams."

### Hierarchy cascade

`ancestorChain()` (client-side, in `page.tsx`) walks `org_units.parent_unit_id`
upward from the selected team using the already-fetched `orgUnits` list, building
a set of the team plus every ancestor. `visibleInitiatives` / `visibleGoals` match
against that set instead of exact equality, and anything inherited is labeled
"inherited from parent."

**Deliberate scope limit: cascade applies to goals and initiatives only.**
Commitments, roster, meetings, and callouts stay exact-match. And this
downward cascade is a different concept from `org_unit_projects_rollup()`'s
upward aggregation — the two do not agree, on purpose. See ENGINEERING.md → Scope
discipline.

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

Agenda edits replace the item set wholesale. That is safe because per-item
notes only exist after a meeting is logged, and a logged meeting's agenda is
never editable.

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

### Wrap-up

`POST /meetings/{id}/wrapup` is a pure AI call — **nothing is written**. It
returns a draft summary, commitments, and carry-forward items;
`components/team/MeetingWrapUpReview.tsx` is the confirm step, shared from the
first pass so the dedicated meeting screen and external-notes ingestion reuse
it rather than forking. Extraction failure returns an empty draft, never an
error.

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
should read before joining on `direct_reports`. A manager-owned team commitment
has no report to derive a team from, so it shows under every team — same
convention as a null `org_unit_id` row.

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
