# Goals

`/app/goals` — what the manager is working toward and how they will know it
worked. Frontend: `app/app/goals/page.tsx`, `components/goals/`, `lib/goals.ts`.
Backend: `routes/goals.py` (check-in helpers in `routes/check_ins.py`, see
`check-ins.md`). Approved design: `docs/design-proposals/2026-09-25-goals-in-view/`
(`prototype-v2.html` is the visual reference).

## The page

- **Board.** One sheet per goal: scope label and status chip, the serif title,
  the success measure, the latest update (date, note, any recorded completion
  %), review reasons in amber, then "+ Add an update" and "Details". Every open
  goal in the selected level and scope is on the board; goals with a reason
  (marked at risk, past due, or last check-in over 14 days ago) sort first and
  nothing healthy is hidden. Closed goals (completed / cancelled) sit behind
  the Closed filter and a "N closed goals →" door. There is no KPI strip.
  Columns follow the board's own width (3 / 2 / 1), so it reflows when the
  Scribe drawer opens.
- **Level and scope.** Individual / Team / Department / Company. Scope is by id
  — direct report id at Individual, org unit id at Team and Department —
  never by name (a repeated name gets a counter in the picker). "No person /
  team / department linked" is its own scope, distinct from All. The page opens
  on the first level that has goals unless the URL says otherwise.
- **Filters and search.** All (open), Needs review, No check-ins, Closed, and a
  search over title, scope, success criterion and measure label.
- **Updates.** The same check-in rows, newest first, for the level and scope
  (`GET /api/goals/updates`, bounded). Each row shows only what that check-in
  recorded: status, an entered value, an entered completion %, the note, and a
  link to the meeting beyond the team it came from. A note-only row never
  repeats an older reading.
- **Details.** A focused view (`?goal=<id>`, back button and browser back return
  to the board): status-only change, full success criterion, the measure with
  every recorded value as a table, latest update with source, full history,
  parent / child / project connections, description, Edit and Delete.
- **Create / edit** use one form (`GoalForm`) in the focused view, with the
  optional measure section. Description and success criterion are `NoteField`s,
  so dictation is available.
- **Review together.** Pick goals from the current level and scope (open goals
  only, all ticked by default, status opt-in), then a full-screen local
  presentation: title, success criterion, due date and recorded measure. Never
  shown: update notes, descriptions, source links, other records or any
  manager control. ← / → move, Esc ends and returns focus. Nothing is sent or
  shared.
- **Unsaved work.** Update drafts are kept per goal in the page; leaving with a
  typed draft or goal edit asks first, and the browser warns before unload.

## Success measure: written, and optionally one number

`success_metrics` stays the free-text written criterion and is shown verbatim.
It is never parsed. Separately, a goal can have **one optional numeric measure**
(`goals.measure_*`): a label ("customer calls led independently"), a format,
an optional display unit, a comparison and a target.

| Format | Validation (target and readings) |
|---|---|
| `count` | whole number, 0 or more |
| `number` | any finite number |
| `percent` | any finite number, not capped at 100 (NDR runs past it) |

Comparison is `at_least`, `at_most` or `below`. The API returns these as
`goal.measure` (null when none), and all five columns are set together or not
at all (`goals_measure_complete`).

**Readings** are `check_ins.measured_value`, entered explicitly in "Add an
update". Blank means no new value; 0 is a value. Readings are never derived
from notes, status or completion %. Completion % (`progress`) remains a
separate, manually asserted field for unmeasured and legacy goals; the UI
calls it "completion" and never mixes it with a percent-valued measure.

The goal list carries `latest_reading` (value + its own date — it can be older
than `last_check_in_at`), `recent_readings` (newest 12) and `reading_count`.
Full history is fetched lazily per goal.

**The target is always the current target.** It can be edited; plots and
comparisons label it "current target", earlier readings are not re-judged, and
no target history is kept. A reading that meets it gets a factual line
("Recorded value meets the current target.") — status is never changed
automatically.

**Once a reading exists, format and unit are locked** and the measure cannot be
removed: the API returns 409 and the `goals_guard_measure_change` trigger backs
it up. The label, comparison and target stay editable. A different measure is a
new goal. Existing goals stay unmeasured until someone configures a measure;
nothing was backfilled.

The plot (`MeasurePlot`) draws real readings positioned by time against a
dashed current-target line, only with two or more readings, with a screen
reader summary and the readings table as the readable alternative.

## Writing a goal update

`POST /api/goals/{id}/check-ins` calls `record_goal_check_in()` (SQL, security
invoker, so RLS applies). It validates the reading against the measure, inserts
the check-in and writes the status through to `goals.status` in one
transaction. The client sends a `client_request_id` per draft; a retry with the
same key returns the row already written instead of a duplicate (unique on
`owner_id, client_request_id`). The client keeps the key after a network or
5xx failure and replaces it after a 4xx. After a confirmed save the page
refetches the goal list; a failed refresh is reported as a refresh failure and
never re-sends the write.

Callers that predate measures (the Scribe) send only status / progress / note
and behave as before. Project check-ins and confirmed Beyond check-ins still
use `create_check_in()`.

## API notes

- `PUT /api/goals/{id}` touches the measure only when the body includes
  `measure` (`null` removes it), so older callers never clear one.
- Create / update return the goal re-read with joins and enrichment; the
  status-only `PATCH` returns base columns, and the page merges only `status`.
- Create / update check references: a direct report must be the caller's, an
  org unit must be visible and match the level, and a parent must be the
  caller's own goal without making a cycle (walk bounded at 50). A report or
  unit that doesn't fit the level is dropped, as the form does.
- A status-only change writes no check-in and does not move any evidence date.

## Verification

`backend/tests/test_goals.py` covers the route and enrichment semantics with an
in-memory client. The SQL function, trigger, constraints and owner isolation
were exercised against local Postgres (`local_verify_stub.sql` + `schema.sql`,
and the pre-change schema + the migration).
