# Goals

`/app/goals` — what the manager is working toward and how they will know it
worked. Frontend: `app/app/goals/page.tsx`, `components/goals/`, `lib/goals.ts`.
Backend: `routes/goals.py` (check-in helpers in `routes/check_ins.py`, see
`check-ins.md`), and `routes/role_goals.py` for From their role. Approved design: `docs/design-proposals/2026-09-25-goals-in-view/`
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
  never by name (a repeated name gets a counter in the picker). Every person,
  team or department is in the picker, not only those with goals, so a link to
  someone with none lands on them and their empty state. "No person / team /
  department linked" is its own scope, distinct from All. At Team and
  Department, when you lead a unit, the picker names units relative to you and
  lists yours first (the same labels as "Whose goal?"); the heading keeps the
  plain name. The page opens on
  the first level that has goals unless the URL says otherwise. With one
  person picked at Individual, **From their role** leads (below), then "{Name}'s
  own goals"; their empty board says their starting goals are above. Individual
  with All says each person starts with what their role expects.
- **Links in.** `goalsHref()` (`lib/goals.ts`) builds every link into the page:
  `?level=&scope=` to land on someone, plus `new=1` to open the New goal form
  prefilled for them and `supports=<goal id>` to set what it supports. `new`
  and `supports` are one-shot and stripped from the URL after load. `draft=1`
  (from the team-goals step in setup) fills the form from a suggestion held
  for one read in sessionStorage (`lib/goalDraft.ts`): title, due date,
  Supports and the measure with its target left blank. The form says where
  it started from and shows the role's bar beside the target. The person
  page, Team page, setup card, org-goals receipt, prep "Built without" and the
  Mission Control empty state all use it; nothing links to a bare
  `/app/goals` to add a goal.
- **"This reads like an expectation."** Saving a team or individual goal with
  no due date that reads as ongoing ("maintain", "every week", "or above") or
  repeats a role's expectation (two shared words, or all of a short one's)
  stops once with a notice: add a due date, save it as a goal anyway, or open
  the role instead. The page reads every role's measured items and skills for
  the match; without them the wording check still runs (`readsLikeExpectation`,
  `npm run test:goal-draft`).
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
  optional measure section. **"Whose goal?"** is one picker; the level is
  derived from the pick. When you lead a unit, units are named by how they
  relate to you (`frontend/lib/unitRelation.ts`): your units ("Member Support
  (your team)"), the group above ("Member Experience (your boss's group)",
  higher ones "(above your boss's group)"), the company, units under you
  ("Platform (Ines's team)", or "(a team under you)" when its leader has no
  account), then "Your people" by name and "Other teams and departments".
  Leading nothing keeps the company, then Departments / Teams / People groups.
  "Yours" follows `goal_relationship()` in `onboarding.py`.
  A team or department goal must name its unit when any exist; with exactly
  one, it is preselected. Unlinked is offered only when none of that kind
  exist yet, or to show an older unlinked goal, which must be linked on its
  next save. **"Supports"** (`parent_goal_id`) lists only goals above this
  one, never cancelled ones, with the owner's own team and department chain
  and company goals first; a company goal has no Supports. Description and success criterion are `NoteField`s,
  so dictation is available.
- **Review together.** Pick goals from the current level and scope (open goals
  only, all ticked by default, status opt-in), then a full-screen local
  presentation: title, success criterion, due date and recorded measure. With
  one person picked, "Start with what the {role} role expects" (ticked when the
  role has measured items or responsibilities) opens on one slide of each
  measured item's bar and latest reading and the responsibilities by name, and
  lets the review run before they have goals of their own. Never
  shown: update notes, descriptions, source links, other records or any
  manager control. ← / → move, Esc ends and returns focus. Nothing is sent or
  shared.
- **Unsaved work.** Update drafts are kept per goal in the page; leaving with a
  typed draft or goal edit asks first, and the browser warns before unload.

## From their role: expectations as starting goals

Decided by Andrew 2026-10-20 (`docs/decisions/expectations-are-starting-goals.md`).
Expectations belong to the role; a goal belongs to a period. A person's role
expectations are shown as their **starting goals**, read live from their current
approved role through `fetch_role_expectations()`. Nothing is copied per person:
a revision shows at once, a retired item drops off, and a role change switches
the list. These rows are not goal records. They don't appear in Needs review,
No check-ins or Closed, can't be cancelled and don't roll up. No AI anywhere.

Where: the Goals page with one person picked at Individual, and the person
page's Work view (compact; "add their role" opens the person's settings).
`components/goals/FromTheirRole.tsx`, helpers in `lib/roleGoals.ts`
(`npm run test:role-goals`).

- **Order.** Measured responsibilities, then responsibilities judged by
  observation, then skills and values behind one "And N skills and N values"
  disclosure, so a long role doesn't bury the person's own goals.
- **No role, or no expectations.** "Add {first}'s role to see what it expects"
  / "{Role} has no expectations yet. Define them in Roles & expectations."
- **Readings** of a measured item are `metric_entries`, the same rows a
  completed assessment writes: one number track. "+ Add a reading" takes any
  finite number (0 is a reading) and a period, prefilled from the item's
  `measurement_period` ("Oct 2026", "Q4 2026", "Week of Oct 19, 2026", "2026",
  else the date) and editable, plus an optional note. "Readings · N" lists them
  newest first; a manual one can be removed, one from a completed assessment
  can't (409). `GET /api/role-goals/{report_id}`,
  `GET|POST /api/role-goals/{report_id}/readings`,
  `DELETE /api/role-goals/{report_id}/readings/{entry_id}`. A reading is only
  for an item in the person's **current** role; the report must be the caller's
  (route check and the `metric_entries` policy's `with check`).
- **The bar.** The row shows "Bar: {target}" as written, "No target set yet…"
  for an unresolved target, or the meets wording. "Latest reading meets the
  bar." / "…is below the bar." appears only when the target text states exactly
  one number and a direction (in the target, or in meets wording that names no
  other number), read by `backend/expectation_bar.py`. Otherwise no verdict.
  A verdict never sets a status.
- **Make it {first}'s goal** opens the New goal form from that item: title is
  the item's name to rewrite, a measured item prefills the measure label and a
  direction from the bar with the target blank beside "The role's bar is …",
  and the goal keeps a link to the item (`goals.source_metric_config_id` or
  `source_skill_config_id`; at most one, individual goals only). The "reads like
  an expectation" check is skipped for it: it is linked on purpose, and it is
  not an AI suggestion, so no AI-draft telemetry. From the person page the draft
  travels through `saveGoalDraft()` and `?new=1&draft=1`.
- **A linked goal** shows "Stretch on “{item}”" (measured item and the goal has
  its own target) or "Builds on “{item}”" on its sheet, in Details and on the
  person page, plus "· that expectation was retired" when it was. A goal on a
  measured item has **no readings of its own** (D7): `latest_reading`,
  `recent_readings` and `reading_count` are the item's `metric_entries`
  (`readings_from: "role"`, each reading with its `period`), Details lists them,
  its update form takes status and a note only, and the check-in route refuses a
  `measured_value` (422). The item's row lists "Their own goal on this: …"; goals
  on items no longer in the role are listed under the section with why.
- **Link rules.** Create/update check a new link is one of the person's
  current, non-retired items of the right kind (422 otherwise). PUT touches the
  link only when the body sends it, so keeping a retired link is fine. A goal
  that stops being individual loses its link (`goals_source_individual`).
- **Assessments** show a linked goal under its expectation, never as a separate
  item (`assessments.md`).
- **Not built yet:** the prep sheet citing an item's latest reading ("below the
  bar on CSAT since September"), scoping B2.

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

## Org-goal period, owner and "Still current?"

Goals carry `period_label` ("FY26", "Q4 2026"), `set_by` ("CEO", "board deck"; the
manager's words, not a user reference) and `confirmed_on`. All nullable. Org
goals (company, department) come in through the setup card's org-goals modal
(`backend/routes/org_goals.py`: parse, review, apply); apply stamps
`confirmed_on`. `_shape_rows` sets `needs_confirmation` on an org goal that is
not cancelled or completed and is past its end date or whose `confirmed_on`
(else creation date) is 90 or more days old (`CONFIRM_AFTER_DAYS`). The page shows one "Still current?" panel
(`components/goals/StillCurrent.tsx`); "Yes, still current" calls
`POST /api/onboarding/org-goals/{id}/confirm`, "Edit" opens the goal. Team goals
are never drafted.

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
in-memory client; `backend/tests/test_role_goals.py` covers From their role (the
bar reader, the live view, readings, links, assessment grouping). The SQL function, trigger, constraints and owner isolation
were exercised against local Postgres (`local_verify_stub.sql` + `schema.sql`,
and the pre-change schema + the migration).
