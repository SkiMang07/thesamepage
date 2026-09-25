# Projects

`/app/projects` — keep things moving. The page first answers "what's going on
across the work?", then gives each project a compact brief with its purpose and
latest recorded situation side by side. It is deliberately not project
management: no tasks, dependencies, contributor assignments, reminders,
notifications or workflow.

Design authority: `docs/design-proposals/2026-09-25-projects-in-motion/`
(`BUILD_BRIEF.md`, `prototype.html`). Frontend: `app/app/projects/page.tsx`,
`components/projects/`, pure helpers in `lib/projects.ts` (tested by
`npm run test:projects`). Backend: `routes/projects.py`, check-in helpers in
`routes/check_ins.py`.

## The data

A project has a title, optional purpose (`description`), status (shared enum
with goals), optional due date, and three optional links: an owner
(`direct_report_id`; null = "You"), a team or department (`org_unit_id`) and a
goal (`goal_id`; null = Standalone, which is valid). Create and edit check every
link against the caller's own records — a report they manage, a goal they own, a
team they can see — because a foreign key alone accepts anyone's id. Nothing is
inferred from names, notes or scope.

Owner-scoped RLS (`owner_id = auth.uid()`). `GET /api/projects` is enriched with
the check-in fields (`check-ins.md`) and `next_move` (below).

## Portfolio at a glance (Open projects view)

A band of four counts over the current owner + search scope:

- **Open projects** — not completed or cancelled.
- **At risk / past due** — distinct open projects marked at risk OR past their
  due date (local calendar day). Amber only when non-zero.
- **Missing a recent update** — open projects with no check-in, or none in 14
  days. Missing context, not risk; shown neutral.
- **Your open next moves** — your saved, open next moves, including on closed
  projects. Unknown ("—") if they couldn't be read, never 0.

The first three are filters (the chosen one narrows the scan and briefs, never
the counts); the fourth opens My follow-through. Categories overlap and are
never summed. Beneath: a scan of up to five open projects, exceptions first
(at risk / past due, then missing an update, then the rest; soonest due date,
then title), with owner, the exact latest note (visually truncated), status and
the reason it is flagged. "Show all" reveals the rest. A row moves focus to its
brief. No completion chart, averages, inferred blockers or generated summary.

Search and the owner filter (keyed by report id, "you" for unassigned) apply to
every view; Reset clears them and the attention filter. Layout follows the
available width (ResizeObserver), so Scribe opening reflows it; on a phone the
scan becomes stacked entries and the band a compact 2 × 2.

## Briefs

Title, status, owner · team · goal connection · due date, attention reasons,
then Purpose beside Latest update (dated, exact note, "recorded <status>" when
the latest entry's status differs from the current one). A completion % shows
only if one was ever entered, with its own date — which can be older than the
newest note. Long text clamps with an explicit Show more. Actions open in place:

- **Record an update** — status, optional whole-number completion 0–100, optional
  note. Blank completion = no new value; 0 is a value. Drafts live in page
  state per project, so closing or a failed save keeps them; unsaved drafts
  trigger the browser's leave warning.
- **The record** — loaded on demand: every entry newest first with its full
  note, recorded status and only the % that entry recorded. An entry confirmed
  from a Beyond meeting links to it. A failed load says so and offers retry.
- **Your next move** — see below.
- **Details & edit** — the facts, a status-only change (no dated entry, no new
  evidence timestamp), Edit project (the full form in place) and Delete (with
  confirmation; removes updates and next moves by cascade).

## The update write

`POST /api/projects/{id}/check-ins` calls `record_project_check_in()`: the
check-in insert and the status write-through to `projects.status` happen in
one transaction, and a `client_request_id` that already produced a row returns
that row. The page sends one key per draft: a 4xx wrote nothing, so the draft
gets a new key; a network error or 5xx keeps the key, so a retry cannot
duplicate. After a confirmed write the page re-reads the list; if that re-read
fails it patches the brief locally and says the update is saved and must not be
recorded again. The Scribe's project check-ins use the same endpoint without a
key. Confirmed Beyond check-ins still use `create_check_in()`.

## Private follow-through

`project_follow_throughs` holds the manager's own next move on a project: text,
`open` / `done`, `completed_at`. At most one open move per owner + project
(partial unique index); completed moves are kept, so setting the next move never
erases the last. It never changes project status, is never assigned to anyone,
and is not surfaced anywhere else (meeting prep, report pages, Mission Control).

- `GET /api/projects/{id}/follow-through` — all moves on one project, open first.
- `POST /api/projects/{id}/follow-through` — set the open move. If one is already
  open with the same wording (a retried submit) it is returned; different
  wording is refused (409) so nothing is silently replaced.
- `PATCH /api/projects/follow-through/{item_id}` — edit wording, mark done,
  reopen. Reopening while a newer move is open is refused (409).

RLS is owner-scoped and its WITH CHECK also requires the project to be the
caller's own. Not built on `commitments`: that table feeds Mission Control,
Team, 1:1 prep, Away and the report pages, so project next moves stored there
would surface in all of them.

**My follow-through** lists every open move in scope, closed projects included
and labelled, with Open project (switches to that project's view and opens its
follow-through) and Mark done.

## Prepare a review

A local presentation from the projects currently visible, none ticked to start.
Setup previews each project's title, purpose, owner and goal connection; the
manager may write one discussion question per selected project, and opt in to
status and due date. The presentation shows only those fields and questions —
never update notes, next moves, meeting links or controls. Questions live only
in page state; nothing is saved, sent or shared. Escape or Exit review returns
focus to the Prepare a review button.

## Scribe

The page sets Scribe context to the project last interacted with, or the
portfolio. Scribe writes remain draft-then-review.
