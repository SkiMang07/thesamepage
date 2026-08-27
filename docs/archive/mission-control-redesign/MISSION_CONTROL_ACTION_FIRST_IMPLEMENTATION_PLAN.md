# Mission Control action-first redesign — implementation plan

**Status:** Proposed build plan; no product code has changed.

**Authority:** This plan implements
`MISSION_CONTROL_ACTION_FIRST_DECISION.md` and the approved
`mission-control-bounded-synthesis.html`. The mockup's records and copy are
reference material, not customer evidence.

## Rule provenance used in this plan

Every rule below is marked with one or more labels:

- **Existing support** — current records or shared logic can establish the fact honestly.
- **Product assumption** — a proposed threshold or behavior, not learned from customers.
- **New persistence** — requires the proposed Mission Control event table.
- **Validate** — must be tested with first-time or newly promoted GTM managers.

No assessment rating, private 1:1 note, capture-note text, expectation text,
goal/project check-in note, or commitment description is shown on Mission
Control. Names, dates, status fields, counts, cadence sources, and source-page
links are sufficient for the first viewport.

## 1. Current implementation and reusable assets

### Frontend

| Existing asset | Reuse | Constraint or change |
|---|---|---|
| `frontend/app/app/dashboard/page.tsx` | Date helpers, current goal/project staleness concepts, page route | Replace the client-side six-endpoint merge and zone-map/grid presentation in the new variant. Keep it temporarily as the rollback component. |
| `frontend/components/PageShell.tsx` | Page container and spacing | Use the existing `8xl` tier. |
| `frontend/lib/tokens.ts` | `CARD`, buttons, surface, type, amber/teal/blue roles | Add only recurring recommendation-control strings if repetition earns them. Ordinary attention remains amber. |
| `frontend/components/CheckInPanel.tsx` | The existing 14-day staleness rule and check-in vocabulary | Do not import UI helpers into ranking. Put the shared value in backend ranking tests and keep the existing frontend display constant aligned. |
| `frontend/components/ZoneMap.tsx` | Icons, `NAV_GROUPS`, `SECTION_GAP`, `NAV_STRIP_HEIGHT`, route context | Remove `ZoneMap` from the new dashboard. Update nav group labels to People / Work / Workspace and separate Settings. |
| `frontend/components/Sidebar.tsx` | Persistent wayfinding | Render group headings when expanded and pin Settings separately at the bottom. The rail, not Mission Control, remains the map. |
| `frontend/components/AppNav.tsx` | Quick add, Scribe, avatar | Keep. Scribe remains visible but secondary to the Suggested focus CTA. |
| `frontend/lib/api.ts` | Sole frontend-to-backend boundary | Add brief, event, reconciliation, and optional explanation types/calls here only. |
| Quick Add context | Empty/new-account CTA | “Add your first direct report” opens the existing modal. |

The present `useZoneData()` fetches nine data sources from `AppNav` on every
authenticated page even though the shell needs only profile and roster data.
That is pre-existing inefficiency, not a redesign prerequisite. Do not combine a
global data-fetch refactor with this build. Only stop calling the hook from the
new dashboard; keep its shell behavior intact.

### Backend and data

| Existing asset | Honest use in the brief |
|---|---|
| `resolve_cadence_days()` and `GET /api/one-on-ones/overview` | Canonical 1:1 due state and custom/org/default cadence source. |
| Derived 1:1 status | `prep_guide != null && summary == null` means prep in progress; `summary != null` means completed. No new status column. |
| `commitments` | Open/done/dropped, due date, who committed, source, completion time. Do not show description on Mission Control. |
| `goals`, `projects`, `check_ins` | Explicit status, due date, current progress, trend, latest check-in, and the existing 14-day stale threshold. |
| `capacity.py` | Supply-only availability and actual-time-off precedence. Capacity may corroborate a dated commitment; it cannot establish overload or demand. |
| `setup_status.py` and expectations coverage | Identify whether a selected early-use report has a role and role-grounding. Missing expectations do not block the current prep flow, so they do not earn a ranked setup recommendation in v1. |
| `get_authenticated_client()` and RLS | All reads and event writes remain manager-scoped. |
| `ai_core.generate_text()` | Optional explanation only. It never receives or returns a score or rank. |
| Current `/api/dashboard/insight` | Keep only for the legacy rollback variant. It must not power the new variant because it asks AI to choose the priority. |

### Honest limits found in the implementation

1. The live workflow does not create scheduled 1:1 dates. `one_on_ones.scheduled_at`
   exists in schema but the prep/log UI and API do not write or return it.
   Therefore “scheduled Thursday,” “due tomorrow,” and “choose a date” are not
   production-safe Mission Control claims. Adding scheduling is a separate scope.
2. Capacity is supply-only. There are no allocations or effort estimates.
   “Overloaded,” “has spare capacity,” “reassign this work,” and causal workload
   claims are unsupported.
3. A null `projects.direct_report_id` can mean the manager's own initiative; it
   does not mean “unowned.” No ownership-gap recommendation is eligible.
4. Assessments have no review cadence and contain sensitive judgment. They do not
   produce v1 candidates.
5. There is no trustworthy “critical people concern” record. V1 uses no red
   recommendation state. The current dashboard's red treatment for “never met”
   or more than 2× cadence must not carry forward; lateness remains amber.
6. `database/schema.sql` is missing both the applied `assistant_messages` table
   and the applied 1:1 cadence columns. Before verifying any new migration, fold
   both existing migrations into `schema.sql` without reapplying them live.

## 2. Recommended API and engine shape

Add `backend/mission_control_engine.py` as a pure, clock-injected module. It
accepts normalized records, generates candidates, deduplicates them, applies
dispositions, ranks them, and selects the truth signal. It contains no Supabase,
FastAPI, or AI calls and is directly unit-testable.

`backend/routes/dashboard.py` remains the route owner and adds:

- `GET /api/dashboard/brief?local_date=YYYY-MM-DD&timezone=Area/City`
  — fetch each domain independently, normalize it, call the deterministic
  engine, and return the first-viewport plus supporting sections.
- `POST /api/dashboard/events` — batch impressions and record Why this?, CTA,
  Addressed, Snooze, Not relevant, setup dismissal, and AI result events.
- `POST /api/dashboard/reconcile` — non-blocking analytics reconciliation of
  prior CTA clicks against later source-record changes. It writes analytics
  only, never product records.
- `POST /api/dashboard/explain` — optional, rate-limited plain-language
  paraphrase of the already-selected candidate. The route recomputes and matches
  `candidate_key + evidence_fingerprint` before calling AI.

The existing `GET /api/dashboard/insight` remains unchanged while the legacy UI
is available, then is removed with the legacy variant after rollout.

The brief response should contain:

```text
variant, brief_id, mode, generated_at, stale_after,
primary, secondary[0..2], truth_signal,
supporting { conversations, changes },
coverage { domain -> ok | partial | unavailable },
early_use_context_prompt?, suppressed_count (analytics only; never rendered)
```

Each candidate contains an opaque stable `candidate_key`, an
`evidence_fingerprint`, type, title, deterministic explanation, CTA, subject,
score, ordered rank components, and evidence items. Each evidence item contains
only a reason code, factual label, source label, observed/due timestamp, and
freshness. Raw note or description fields are never serialized.

The browser supplies its local date and IANA timezone because the user model has
no timezone field. The backend accepts only a local date within one day of UTC
today. This fixes day-boundary behavior without a timezone migration.
**Existing support:** dates already exist. **Product assumption:** client-local
day is the correct comparison day. **Validate:** managers in multiple US zones.

## 3. Exact candidate eligibility

All date comparisons use the accepted manager-local date. Archived reports,
completed/cancelled goals/projects, non-open commitments, and disposed instances
are excluded before ranking.

| Candidate | Exact eligibility and action | Provenance |
|---|---|---|
| Resume saved prep | Active report has a derived planned session (`prep_guide` set, `summary` null). CTA resumes `/app/reports/{report_id}/prep?resume={session_id}`. It may be eligible without a scheduled date; copy says “saved prep,” not “upcoming meeting.” | **Existing support.** **Validate:** whether saved-but-not-due prep feels worth surfacing. |
| Start due 1:1 prep | Canonical `is_due == true` and no planned session. “Never met” is eligible but is not assigned an invented overdue duration. CTA starts the existing prep flow. | **Existing support.** Cadence threshold already locked. |
| Commitment follow-up | Group by active report. At least one open commitment has `due_date <= local_date + 7 days`. Missing due dates are not urgent. Copy distinguishes “your commitment” only when every included row is manager-committed; otherwise it says “review commitments with {name}.” It never shows descriptions. | Due/status are **Existing support**. Seven-day window and grouped action are **Product assumptions / Validate**. |
| Goal review | Status is active/on-track/at-risk and at least one is true: explicit `at_risk`; due within 14 days or overdue; latest check-in older than 14 days; or no check-in and the goal itself is older than 14 days. CTA opens Goals. | Status/dates/check-ins and 14-day staleness are **Existing support**. Due window is **Product assumption / Validate**. |
| Project review | Same rule as Goal review, opening Projects. | Same provenance as Goal review. |
| Status-integrity review | Goal/project parent status differs from the latest check-in status. This replaces the normal review candidate for that entity and says the two records disagree; it does not decide which is correct. | Mismatch is **Existing support**. Surfacing it as a priority is a **Product assumption / Validate** and a data-integrity safeguard. |
| Capacity corroboration | Never creates a standalone candidate. If a report has actual logged time off overlapping the current week and also has an eligible dated commitment, add the factual time-off reduction as one reason on that commitment candidate. Assumed annual off-hours, low absolute hours, and profile defaults never increase rank. | Logged time off and precedence are **Existing support**. Cross-domain corroboration is a **Product assumption / Validate**. |
| Add first report | Zero active reports. This is the empty/early-use primary CTA, not a warning and not part of mature ranking. | **Existing support.** |

Explicit v1 exclusions:

- Missing role, team, expectations, org, capacity defaults, or documents do not
  enter the mature queue. The current product still works without them.
- In early use, if the selected report lacks role-grounding, show one optional
  inline prompt: “Add {name}'s role to ground future prep in agreed
  expectations.” It is not ranked, is dismissible until the next local day, and
  states that prep still works without it. **Product assumption / New
  persistence / Validate.**
- “Goal has no project” is excluded. The relationship is optional today, so
  treating its absence as a problem would be an unsupported product assumption.
- No candidate uses assessment scores, capture-note content, private 1:1 notes,
  or inferred employee-risk labels.

## 4. Deterministic ranking, merging, and tie-breaking

Eligibility comes first. Eligible candidates receive one shared, domain-neutral
score; there is no hidden “people beats work” weight.

### Score components

| Component | Points | Rule provenance |
|---|---:|---|
| Overdue 8+ days | 40 | **Product assumption / Validate** |
| Overdue 1–7 days | 35 | **Product assumption / Validate** |
| Due today | 30 | **Product assumption / Validate** |
| Due in 1–3 days | 24 | **Product assumption / Validate** |
| Due in 4–7 days | 16 | **Product assumption / Validate** |
| Due in 8–14 days | 8 | **Product assumption / Validate** |
| Never-recorded first 1:1 | 24 | Fact is **Existing support**; weight is **Product assumption / Validate** |
| Explicit at-risk status | 20 | Fact is **Existing support**; weight is **Product assumption / Validate** |
| Parent/latest-check-in mismatch | 25 | Fact is **Existing support**; weight is **Product assumption / Validate** |
| Stale 15–29 days | 8 | Threshold is existing; weight is **Product assumption / Validate** |
| Stale 30+ days | 12 | **Product assumption / Validate** |
| Saved prep already in progress | 15 | Fact is **Existing support**; weight is **Product assumption / Validate** |
| Each additional distinct corroborating reason | +5, maximum +15 | **Product assumption / Validate** |
| CTA opens the exact workflow | +5; source-page review +2 | **Product assumption / Validate** |

Only the strongest time bucket applies. Other components may stack. The UI does
not lead with the numeric score; Why this? shows the same components in plain
language (“due now,” “prep already saved,” “two records point to the same
conversation”). An internal details row may expose points during dogfood but is
not production copy until tested.

### Deduplication and selection

1. Build raw candidates.
2. Group person candidates by `person:{direct_report_id}`. Keep the highest-score
   action and merge only compatible factual reasons into it. Never show two
   first-viewport actions for the same person.
3. If a goal and its linked project both request the same “refresh/review” action,
   keep the higher score and mention the linked record as evidence; do not spend
   two slots on the same work chain. **Product assumption / Validate.**
4. Apply Addressed / Snooze / Not relevant to the exact
   `candidate_key + evidence_fingerprint` instance.
5. Sort by: total score descending; strongest time bucket descending; number of
   distinct reasons descending; exact-workflow bonus descending; oldest
   attention timestamp ascending; stable candidate key ascending.
6. First result is Suggested focus; next two are secondary. No diversity quota
   silently promotes a lower-scoring domain. More candidates remain on their
   source pages; Mission Control does not show an anxiety-producing backlog count.

The `evidence_fingerprint` hashes only reason codes and relevant source IDs,
statuses, and dates. Addressed or Not relevant suppresses the same evidence, but
a new due date, check-in, status, planned session, or qualifying commitment
creates a new fingerprint and can re-enter. This behavior requires **New
persistence** and needs **Validation**.

## 5. Sparse, stale, incomplete, conflicting, and unavailable evidence

- **Sparse account:** early-use mode when there is at least one active report but
  zero completed 1:1s, zero goal/project check-ins, and zero resolved
  commitments. Existing goals/projects alone do not imply management history.
  This threshold is a **Product assumption / Validate**.
- **Stale work record:** staleness can make a goal/project eligible, but its old
  note is never presented as current truth. Show “last checked in N days ago.”
- **No check-in:** a newly created goal/project is not instantly stale. “Never
  checked in” becomes eligible only after the record itself is 15 days old.
- **Missing due date:** excludes due-based commitment urgency. It never becomes
  “overdue.”
- **Default cadence:** remains usable and is labeled “default” or “org default.”
  It is not treated as manager-confirmed evidence in Why this?.
- **Assumed capacity:** can appear only as neutral supporting context and never
  makes a candidate eligible or raises its score.
- **Conflicting goal/project status:** use the integrity-review rule above; do not
  choose a winner or show an all-clear for that domain.
- **Commitment inconsistency:** if `status != done` but `completed_at` is present,
  status controls eligibility and coverage marks Commitments partial. Do not infer
  completion.
- **Partial domain failure:** generate from successful domains only. Any
  cross-domain reason requires every participating domain to be `ok`. Show
  “Some sources could not be checked” with the exact domain labels. Never claim
  all-clear while a required domain is unavailable.
- **Core reports failure:** no person recommendation or early-use classification.
  Show a retry state rather than a guessed focus.
- **Stale response:** do not silently reuse it as current. A last successful brief
  may remain in session memory only, collapsed under “Last checked at …”; disable
  dispositions and AI explanation until refresh. Source-page CTAs may remain.
- **AI failure:** deterministic title, explanation, rank, evidence, and CTA remain.
  Inside Why this?, show “An extra AI explanation is unavailable; the ranking and
  evidence are unchanged.” AI failure never becomes partial data coverage.

## 6. Evidence, source, freshness, and Why this?

The primary card always has a deterministic one- or two-sentence explanation.
Why this? expands three blocks:

1. **Observations** — up to four factual evidence rows with source and freshness.
2. **Ranking basis** — the human-readable score components and any defaults used.
3. **Boundaries** — when relevant: “Capacity reflects available hours, not assigned
   workload,” “No scheduled meeting date is recorded,” or “Some sources were
   unavailable.”

Source labels are fixed vocabulary: 1:1 history; saved prep; commitment record;
goal record; goal check-in; project record; project check-in; logged time off;
manager cadence; org/default cadence. Freshness is computed, not AI-written:
Today, Yesterday, N days ago, Due today, Due in N days, Overdue N days, or No
check-in recorded (record created N days ago).

The optional AI endpoint receives only the already-approved action sentence and
these evidence labels. It is instructed to paraphrase in one sentence, add no
facts or causality, and return null if it cannot. The deterministic evidence
always remains visible and authoritative. **AI wording is provisional and needs
customer validation.**

## 7. Addressed, Snooze, Not relevant, and record boundaries

Add one append-only manager-scoped table:

```sql
mission_control_events (
  id uuid primary key default uuid_generate_v4(),
  manager_id uuid not null references auth.users(id) on delete cascade,
  brief_id uuid not null,
  parent_event_id uuid references mission_control_events(id) on delete set null,
  event_type text not null check (event_type in (
    'impression', 'why_opened', 'cta_clicked', 'addressed', 'snoozed',
    'not_relevant', 'setup_dismissed_today',
    'ai_explanation_succeeded', 'ai_explanation_failed',
    'downstream_completed'
  )),
  candidate_key text,
  evidence_fingerprint text,
  candidate_type text,
  entity_type text,
  entity_id uuid,
  rank smallint check (rank between 1 and 3),
  score integer,
  snoozed_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
)
```

Allowed events: `impression`, `why_opened`, `cta_clicked`, `addressed`,
`snoozed`, `not_relevant`, `setup_dismissed_today`, `ai_explanation_succeeded`,
`ai_explanation_failed`, and `downstream_completed`.

Indexes: `(manager_id, created_at desc)`,
`(manager_id, candidate_key, evidence_fingerprint, created_at desc)`, and a
partial unique index preventing more than one `downstream_completed` event per
parent CTA event. RLS permits select/insert only where
`manager_id = auth.uid()`; no update/delete policy. Metadata may store reason
codes, coverage states, and attribution method, never names or raw record text.

Behavior:

- **Addressed:** insert event and immediately remove that fingerprint. It never
  calls a 1:1, commitment, goal, project, assessment, capacity, expectation, or
  setup update endpoint. If a source update is sensible, show a separate link or
  explicit reviewed action: e.g. “This did not close the commitment. Open Leah's
  record to update it.” **New persistence; meaning already locked.**
- **Snooze:** choices Tomorrow, Next Monday, and One week. Browser computes the
  local boundary and sends UTC; backend validates future time within 90 days.
  Hide until then, then restore unchanged evidence/rank unless the source changed.
  **New persistence / Product assumption / Validate choices.**
- **Not relevant:** insert event, hide the same fingerprint, and do not permanently
  mute the person/domain. A changed fact may reappear. **New persistence / Product
  assumption / Validate resurfacing.**
- **Dismiss for today:** only the optional early-use setup prompt; hide until the
  next local day. **New persistence.**
- **Why this?:** analytics only; never changes rank or source records.

No source-record endpoint is called by a disposition handler. Add a backend test
that mocks every domain writer and proves all three disposition routes insert only
into `mission_control_events`.

## 8. Required interface states

| State | Required behavior |
|---|---|
| Normal week | One primary, at most two secondary, factual truth, supporting sections. |
| Busy week | Same three-item cap; copy acknowledges competing signals without showing a hidden backlog total. Ranking remains identical. |
| Early use | One real action (normally first due 1:1 prep), explicit limited-evidence message, no team-level judgment, optional dismissible role-grounding prompt. |
| Empty/new | Zero reports: calm “Add your first direct report” primary CTA via Quick Add. No setup backlog. |
| All-clear | Only when Conversations, Commitments, Goals, and Projects all loaded successfully and no eligible candidate remains. State exactly what rules were checked; offer one quiet non-urgent link. |
| Loading | Stable skeleton matching primary/truth layout; no flashing legacy grid or “all clear.” |
| Stale data | Last brief labeled with timestamp and collapsed; dispositions/AI disabled until refresh. |
| AI failure | Deterministic brief unchanged; quiet inline fallback inside Why this?. |
| Partial failure with candidate | Show candidate from successful sources, coverage warning, and omit failed-domain claims. |
| Partial failure without candidate | “Could not establish a focus from the sources available,” retry, and direct source-page links. Never all-clear. |
| Source conflict | Integrity-review candidate or partial coverage marker; never silently choose a record. |

Truth-signal selection is deterministic: most recent non-zero category this
week in this order—completed 1:1s, resolved commitments, goal/project check-ins,
saved prep. If none, show number of reports currently on cadence. If there is no
positive fact and no eligible candidate with full coverage, show genuine
all-clear. If evidence is sparse or partial, show the explicit limited-evidence
truth instead. The category order is a **Product assumption / Validate**.

“Upcoming conversations” remains provisional and cannot ship under that name
without scheduled dates. V1 supporting copy should be **1:1 rhythm**, showing
Due now, Prep saved, or On cadence—facts the current model supports. “What has
changed” can list completed 1:1s, resolved commitments, and goal/project
check-ins from existing timestamps; no new activity table.

## 9. Coherent reference/demo data

Use a fixed injected clock of Monday, 2026-08-24. Store canonical raw fixtures in
`backend/tests/fixtures/mission_control_reference.json`; do not seed production or
Andrew's dogfood account. The same engine output becomes frontend fixture
responses for visual verification.

| Scenario | Coherent records and expected result |
|---|---|
| Normal week | Leah: 14-day cadence, last completed 1:1 on Aug 9, saved prep Aug 23, one open commitment due Aug 25. David: current cadence, one commitment due Aug 26, 8h logged time off Aug 26. Beth: completed 1:1 Aug 24. Goal “Q3 expansion readiness”: on track, last check-in Aug 7. Project “Renewal playbook”: on track, Aug 21 check-in. Roles/expectations configured for all three. Expected: Leah resume-prep primary; David commitment and goal refresh secondary; Beth completion truth. |
| Busy week | Maya: two commitments due Aug 25/26 plus 8h logged time off; Leah: 1:1 overdue with no prep. “Customer launch” project: at risk, due Aug 28, stale check-in. “Support hiring” goal: at risk, due Sep 4, stale check-in. Additional healthy goal/project and current expectations prevent an all-warning dataset. Expected: deterministic competition and only top three shown. |
| Early use | Leah is the only report; no completed 1:1, check-in, or resolved commitment; no planned prep; one newly created goal; default capacity only; role assigned but no expectations. Expected: prepare first 1:1, limited-evidence truth, optional dismissible role-grounding prompt, no team diagnosis. |
| All-clear | Three reports on cadence, no saved prep, no commitments due within seven days, goals/projects on track with check-ins under 14 days, all core sources successful. Expected: genuine all-clear and one non-urgent source link. |
| Partial | Same as normal, but Goals unavailable. Expected: Leah primary may render; no goal candidate or all-clear; coverage warning names Goals. |
| Conflict | Project parent status `on_track`, latest check-in `at_risk`. Expected: integrity-review candidate and no inferred winner. |

Each scenario includes conversations, commitments, goals, projects, role
expectations, capacity profile/default sources, and time off even when a domain
does not produce a candidate. This prevents a visually convenient but logically
incoherent fixture.

## 10. Analytics and attribution

Record one impression per rendered candidate per `brief_id`; Why opens; CTA
clicks; all dispositions; AI result; and reconciled completion. “Disagreement” is
the Not relevant rate, reported separately from Addressed and Snooze.

`POST /reconcile` checks CTA clicks from the last seven days and writes one
`downstream_completed` event when current records establish:

- start-prep candidate → planned prep created after click;
- commitment candidate → included commitment changed to done/dropped after click;
- goal/project candidate → new check-in after click or status leaves the eligible
  condition after click.

Resume-prep and capacity-corroborated actions have no honest completion signal in
the current model; report CTA click only. Do not count them as failed completion.
Completion attribution is explicitly labeled inferred and is a **Product
assumption / Validate**. Analytics must segment by mode, candidate type, rank,
coverage completeness, default-vs-custom cadence, and reference/demo versus real
account.

Initial dashboard metrics:

- primary impression → Why-open rate;
- primary impression → CTA-click rate;
- Addressed / Snooze / Not relevant rate and time-to-disposition;
- Not relevant by candidate type and rank component;
- CTA click → inferred completion among trackable candidates;
- recommendation resurfaced after snooze;
- candidate churn between consecutive loads without source changes (target zero);
- partial-data and AI-failure rates.

## 11. Reversible rollout

Add backend settings `MISSION_CONTROL_ACTION_FIRST_MODE=off|allowlist|on` and
`MISSION_CONTROL_ACTION_FIRST_ALLOWLIST`. The authenticated brief endpoint decides
the variant from user ID; no user IDs enter the frontend bundle.

1. Extract the current page as `LegacyMissionControl.tsx` without behavior changes.
2. New dashboard shell requests `/brief`; `variant=legacy` renders the legacy
   component. Keep `/insight` available.
3. Enable only Andrew/reference QA, then 3–5 invited managers, then all users.
4. Roll back by changing mode to `off`; the new event table and additive endpoint
   are harmless. No source data needs reversal.
5. After a stable full rollout, delete the legacy component and `/insight` in a
   separate cleanup change. Only then rewrite `docs/systems/mission-control.md`
   to current behavior and archive superseded implementation detail.

## 12. Production copy status

Safe to carry because the language is locked or purely structural:

- Mission Control
- Suggested focus
- Why this?
- Addressed
- Snooze
- Not relevant
- Dismiss for today (setup prompt only)
- Scribe

Safe only as dynamic factual templates:

- “{N} prep sheets are saved.”
- “{N} 1:1s were completed this week.”
- “Last checked in {N} days ago.”
- “{N} commitments are due by {date}.”

Provisional and requiring manager testing:

- greeting and weekly subtitle;
- “Also worth attention”;
- all candidate titles and deterministic explanation sentences;
- “What has changed”;
- “1:1 rhythm” as the replacement for unsupported “Upcoming conversations”;
- early-use and all-clear language;
- all AI-generated paraphrases.

Do not carry:

- “scheduled Thursday,” “due tomorrow,” or “choose a date” until scheduling is real;
- “No critical people concerns are currently flagged” because there is no such
  comprehensive record;
- causal workload language (“before assigning launch work,” “ownership gap blocks
  handoff”) not established by current data;
- any mockup name, count, or distribution as production evidence.

## 13. Cheapest credible target-manager test

Run five 30-minute moderated remote sessions with first-time or newly promoted
GTM managers who currently manage 3–10 people. Recruit outside the founder's
close collaborators; pay a modest interview incentive. Use the staging action-
first build with the coherent normal/busy/early fixtures, then let each manager
map one real upcoming management moment into a simple card without importing
sensitive employer data.

Tasks: open cold and say what to do next; explain why TSP chose it; use Why this?;
choose Addressed vs Snooze vs Not relevant in three short situations; react to
early-use and partial-data states.

Pass gate:

- at least 4/5 identify the primary action within 10 seconds;
- at least 4/5 can restate the evidence without adding causal claims;
- at least 4/5 distinguish Addressed, Snooze, and Not relevant correctly;
- no more than 1/5 describes the page primarily as surveillant, judgmental, or a
  generic task tracker;
- at least 3/5 say the action would change or accelerate what they do next.

If the gate fails, change copy/thresholds first. Reopen the direction only for
the failure conditions already named in the approved decision.

---

## 1. Recommended architecture and scope

Build one deterministic backend brief endpoint backed by a pure ranking engine,
one append-only manager-scoped event table, a new action-first frontend variant,
and an optional post-selection AI explanation. Keep the current page and insight
endpoint as a feature-flagged rollback path. Include conversations, commitments,
goals, projects, actual logged time off as corroboration, early-use, truth,
supporting change/rhythm sections, dispositions, analytics, and partial-failure
handling. Do not add scheduling, capacity demand, assessment recommendations,
critical-risk inference, onboarding redesign, or source-record automation.

## 2. Open founder decisions, only if materially necessary

None beyond approval of this plan. The one migration, initial thresholds,
allowlist rollout, and provisional copy are explicit above and can be adjusted
reversibly after manager testing. Scheduling remains a separate future decision,
not a blocker.

## 3. Ordered implementation plan

1. **Schema hygiene and events:** fold the already-applied cadence columns and
   `assistant_messages` table into `schema.sql`; add
   `database/migrations/2026-08-22_mission_control_events.sql` and matching schema,
   indexes, checks, and RLS.
2. **Pure engine and fixtures:** add `backend/mission_control_engine.py`, exact
   rules above, injected clock, fingerprints, disposition filtering, reference
   JSON, and pytest coverage before wiring routes.
3. **Backend brief:** extend `backend/routes/dashboard.py` with independent domain
   fetches, coverage status, deterministic `/brief`, and feature mode in
   `backend/config.py`. Keep `/insight` intact.
4. **Persistence and analytics routes:** add batched events and idempotent
   reconciliation; prove they never mutate source records.
5. **Optional AI:** add rate-limited `/explain` through `ai_core.py`, matched to the
   current fingerprint, with deterministic fallback.
6. **Frontend API and variant:** add types/calls in `frontend/lib/api.ts`; extract
   `frontend/app/app/dashboard/LegacyMissionControl.tsx`; implement the new page
   from small components under `frontend/components/mission-control/`.
7. **Navigation:** update `NAV_GROUPS` and `Sidebar.tsx` to People / Work /
   Workspace with Settings separate; keep provisional labels easy to revert.
8. **State and accessibility pass:** implement every state table row above;
   keyboard/menu/focus/live-region behavior; mobile collapse; amber-only ordinary
   attention; no color-only meaning.
9. **Reference QA and allowlist:** generate all fixture outputs, visually verify
   desktop/mobile and dark theme, enable Andrew only, then run the five-manager
   test.
10. **Rollout and docs:** widen allowlist only after the gate; turn on globally;
    later remove legacy code and update current-state docs in a separate cleanup.

Expected affected files:

- `backend/config.py`
- `backend/mission_control_engine.py` (new)
- `backend/routes/dashboard.py`
- `backend/tests/test_mission_control_engine.py` (new)
- `backend/tests/test_mission_control_routes.py` (new)
- `backend/tests/fixtures/mission_control_reference.json` (new)
- `database/migrations/2026-08-22_mission_control_events.sql` (new)
- `database/schema.sql`
- `frontend/lib/api.ts`
- `frontend/app/app/dashboard/page.tsx`
- `frontend/app/app/dashboard/LegacyMissionControl.tsx` (temporary, new)
- `frontend/components/mission-control/ActionBrief.tsx` (new)
- `frontend/components/mission-control/SuggestedFocus.tsx` (new)
- `frontend/components/mission-control/PriorityList.tsx` (new)
- `frontend/components/mission-control/WhyPanel.tsx` (new)
- `frontend/components/mission-control/BriefStates.tsx` (new)
- `frontend/components/ZoneMap.tsx`
- `frontend/components/Sidebar.tsx`
- `docs/systems/mission-control.md` only after the new variant ships globally
- `docs/ENGINEERING.md` to remove the resolved schema-drift note and record the
  manager-scoped event model
- `docs/SESSION_HISTORY.md` only during normal session close-out

## 4. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Arbitrary cross-domain weights feel wrong | Transparent components, no domain base weight, reference fixtures, allowlist, Not relevant analytics, manager test. |
| Dispositions hide a still-important fact | Suppress only the exact fingerprint; new evidence may resurface; source records remain unchanged. |
| “Addressed” is mistaken for record completion | Explicit receipt saying the source was not changed; separate reviewed source action; route-level mutation test. |
| Partial failure looks like all-clear | Coverage carried in the API and rendered; all-clear requires all four core domains. |
| Capacity implies workload demand | Actual logged time off only corroborates a dated commitment; boundary copy; no standalone capacity candidate. |
| Sensitive details leak | Strict response model and tests asserting forbidden fields never serialize; analytics metadata contains codes, not text/names. |
| AI invents causality | AI runs after rank, sees only evidence labels, may return null, and never replaces deterministic Why this?. |
| Recommendations churn on refresh | Stable candidate keys, deterministic tie-break, evidence fingerprints, and a churn test. |
| Schema verification starts from a false source of truth | Fold the two confirmed drift items before applying/testing the new migration. |
| Rollout harms the daily landing page | Server-side off/allowlist/on mode and intact legacy component/endpoint. |

## 5. Verification and acceptance criteria

Backend and schema:

- Verify both database paths against fresh local Postgres: (a) the corrected
  pre-Mission-Control schema plus the new migration, proving the upgrade path;
  and (b) the final updated `schema.sql` alone, proving a fresh install. Do not
  apply a non-idempotent create-table migration on top of a final schema that
  already contains the same table and mistake the duplicate-table error for a
  product defect.
- Functional SQL proves manager A cannot select/insert manager B's events and no
  update/delete policy exists.
- `pytest` covers every eligibility boundary, point boundary, tie-break,
  deduplication, fingerprint change, disposition, early-use, all-clear, conflict,
  sparse, partial, and fixed-clock fixture.
- Route tests force each domain and AI failure independently.
- Disposition tests prove no domain table update method is called.
- Python compile and real `import main` pass with dummy environment values.

Frontend and accessibility:

- `npx tsc --noEmit` and `next build` pass.
- Visual QA covers desktop, collapsed sidebar, narrow/mobile, Scribe open, and all
  required states with reference fixtures.
- Suggested focus is the first meaningful heading after the page title; only one
  teal page CTA is primary within the brief.
- Why/menu controls are keyboard operable, expose `aria-expanded`, close on Escape
  and outside click, restore focus, and disposition receipts use a polite live
  region.
- Ordinary overdue/at-risk/stale states are amber; no red recommendation is
  emitted by any fixture.
- No private/sensitive text appears in the DOM, API response, or analytics event.

Product acceptance:

- Exactly one primary and at most two secondary candidates.
- Same inputs and local date always produce the same order and copy template.
- Why this? names observations, sources, freshness, defaults, and rank basis.
- Addressed/Snooze/Not relevant survive refresh and another device.
- Addressed changes no source record.
- New evidence changes the fingerprint and can legitimately resurface.
- All-clear is impossible with partial core coverage.
- Early-use creates no team-level judgment.
- The five-manager test meets its pass gate before global rollout.

## 6. Explicit approval gate before code changes

**Stop here. Do not edit product code, schema, migrations, tests, or current-state
system documentation until Andrew explicitly approves this implementation plan.**
