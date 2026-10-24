# Onboarding — first run, setup, and the states in between

How a new manager gets from the login link to a saved prep sheet, then
through setup to "onboarded". Current behaviour only. The scoping record and
the reasoning behind it is `docs/archive/scoping/ONBOARDING_SCOPING.md`;
designs are `docs/design-proposals/2026-09-29-first-run/` and
`2026-09-29-onboarding-path/` (`SETUP_MODE_BRIEF.md` is the current setup
brief). Intake by person is `docs/decisions/capture-by-person.md`.

Copy follows `gtm/brand/voice-rules.md`: literal labels, one-line empty
states, no encouragement, the product never names itself. Onboarding uses the
app's own theme; the login page is the seam and stays light.

## The path

One numbered path of six steps. First run is steps 1 to 3 (the two
`/app/start` questions, then the first prep sheet); setup is steps 4 to 6
(team and roles, role expectations, goals). The server counts setup as 3
(`done_count`, `total`); screens add `FIRST_RUN_STEPS` (`lib/api.ts`,
`routes/onboarding.py`).

```
Start free → /app/login → email → /auth/confirm (works on any device)
   → zero direct reports? → /app/start
        step 1  Who is your next 1:1 with?        (name, optional date)
        step 2  Who else do you have 1:1s with?   (one name per line, skippable)
   → /app/reports/{id}/prep?date=…&first=1   first-1:1 agenda, notes optional
   → prep sheet saved (step 3)  → Mission Control, setup card for steps 4–6
```

## Front door

- **Login** (`/app/login`) sends a magic link. "Use a password instead" shows
  only on a browser that has signed in with a password before, or at
  `/app/login?password`. A failed password reads "That email and password
  don't match an account. New here? Use the login link instead."
- **Any-device link.** `/auth/confirm` verifies a token hash
  (`verifyOtp({ token_hash, type })`), so a link asked for on a laptop works on
  a phone. The Supabase email templates link there (`docs/auth-emails/`; they
  live in the Supabase dashboard). `/auth/callback` stays for invites and
  anything else on the code flow.
- **Routing** (`lib/auth-landing.ts`): after a session exists and no `next`
  was named, the manager's `direct_reports` are counted through their own
  session. Zero → `/app/start`; otherwise → `/app/dashboard`. The dashboard
  also sends an `empty` brief to `/app/start`, and `/app/start` sends anyone
  with reports to the dashboard. `/app/start` has no sidebar, header or Scribe.

## `/app/start`

- **Step 1.** "Who is your next 1:1 with?" — name and an optional date. No
  skip; "Sign out" is the only way out. Above it, from `GET /api/entitlement`:
  "Founding manager {n} of 20 · Free until {date}" (an end date, not a
  countdown), "Free until {date}" on a trial, nothing when comped or paying.
  Andrew's welcome note renders beside it when `WELCOME` in
  `app/app/start/page.tsx` is non-empty. The sharing line is present tense:
  only the manager sees what they write.
- **Step 2.** "Who else do you have 1:1s with?" — one name per line. Split on
  new lines and commas, list markers stripped, blanks, duplicates and the
  step-1 name dropped, capped at 25. Each name is a `createDirectReport` call;
  failures leave the saved ones saved and say how many couldn't be added. The
  button reads "Continue" or "Add {n} and continue"; Skip is beside it.
  `first_run_roster_added` (count only) fires when anyone was added.
- Both go to the first person's prep with `?date=` (if given) and `?first=1`.

## The first prep sheet

- `?date=` pre-fills the meeting date when there is no open session.
- With nothing gathered: "No earlier 1:1s with {first name} are recorded." The
  notes hint for a first 1:1 is optional, and Build agenda is enabled with
  empty notes when no completed 1:1 exists. The prompt's first-1:1 branch
  (`_build_prep_prompt`, nothing on record) covers how they like to work, what
  they're on and where they're stuck, what they want from the role, and how
  the two will run these 1:1s, and says plainly that nothing else is recorded.
- With `?first=1` the sheet shows "Step 3 of 3" and a "Prep sheet saved"
  receipt with "Go to Mission Control". The receipt names the ways in for
  the 1:1 itself, in the site's words: Meet in the top bar transcribes it
  with no bot, or log it afterwards by saying it, pasting a transcript,
  uploading a file, or typing (backlog Block I).
- Promises in the note become commitments the manager confirms ("Promises in
  your note", `one-on-ones.md`); the first-run receipt links there while rows
  wait.

## Mission Control in early use

- With no commitments and no completed 1:1 (`nothingRecorded` in
  `WeekInFocus.tsx`) the counts and the commitments table don't render.
- The role nudge: "Add {name}'s role to prep against the expectations you
  set." / "The next prep sheet measures against it."
- The empty-mode card ("No direct reports yet." / "Add a direct report") is a
  fallback; the redirect makes it unreachable in practice.
- Elsewhere in week one: empty states on 1:1s, Capacity and Assessments open
  Quick add in place (`AddDirectReportButton`); "Prep not started"; "Nothing
  recorded for {first name} yet."; Capacity's "By department" renders only with
  a led unit; Settings readiness doesn't require teams, roles or expectations,
  and the Settings door shows no state.
- Navigation: `visibleNavGroups()` (`ZoneMap.tsx`) drives the sidebar and zone
  map. The Assessments door is locked only while setup is running and nobody
  has a role with expectations ("Opens for a person once their role has
  expectations.").

## States

All derived from records on every call, each stamped once
(`backend/routes/onboarding.py`, `GET /api/onboarding/status`):

- **Activated:** a prep sheet exists.
- **Set up:** each of the three setup steps is done or skipped.
  `users.set_up_at` is stamped the first time; archiving a goal later doesn't
  undo it.
- **Onboarded:** set up, plus a logged 1:1, plus a later prep sheet for the
  same person dated after that log by meeting date (`utils.meeting_day_of`).
  `users.onboarded_at`. Accounts with reports when this shipped were
  grandfathered as onboarded and set up.

`status` returns `activated`, `set_up`, `onboarded`, `done_count`, `total`,
`next_step` (the first not done and not waiting on another),
`assessable_people` and `steps` (both null once set up), plus the prompt
fields below. Once set up the step queries stop; once onboarded it answers
from the user row alone. `setup_org_at`, `setup_expectations_at` and
`setup_goals_at` record the first time each step held, so each step's event
fires once.

## The setup steps

- **4 · Team and roles:** at least one org unit, and every active direct report
  in one with a role. The card's button opens Settings → People & structure
  (`?section=people&from=setup`) in setup mode: a "Setup · step 4 of 6" banner
  says how many people have a team and a role and names who is left, turns to
  "Team and roles: done", and offers "Back to setup" (`#setup`). The area list
  with its green checks, the status badge and the Scope line are hidden there.
  Setup mode opens with **"What are you setting up?" My team / My department**
  (`SetupUnitPanel`): the answer creates the team or department you lead
  (`leader_user_id` = you), or claims one already made with no leader (its type
  follows the answer; a department with teams under it can't become a team),
  optionally under your boss's group (team path) or the group above yours
  (department path), a department reused by name. `POST /api/org-units/setup`;
  then everyone without a team goes in. Once you lead a unit it collapses to
  one line with a link to Org. The path is not stored: it is read from the top
  unit you lead. The free-standing "Create a new team" dialog (Team/Department
  dropdown) is not offered in setup mode; it stays outside it. Sub-teams led by
  your own people are not in setup yet.
- **5 · Expectations:** every role in use has expectations. Locked ("Needs team
  and roles") until step 4 is done or skipped. The card names the next person
  and role, ordered by soonest 1:1 (`steps.expectations.next_role`, `queue`),
  or asks for a role first. The role's start screen takes a job description or
  "Describe the role"; described-only drafts mark each line "from your
  description" or "typical for this role, not from you" (typical lines capped
  at 3, offered as suggestions). Approval is the normal path
  (`expectations.md`).
- **6 · Goals:** a goal above your unit and a goal on it, counted by
  relationship (`goal_relationship()` in `onboarding.py`), not by unit type;
  cancelled goals don't count. "Above" is the company or any unit over the
  top unit you lead; "yours" is that unit. An older goal with no unit counts
  on the line of its level. The card checks the halves separately — "Goals
  above your team / department" and "Your team's / department's goal" — each
  with a "Counts:" hint naming the units, and reads "1 of 2 done · … next".
  On the department path a third line, "Teams under you: N of M have a goal",
  is shown and never required. When you lead no unit (older accounts, or step
  4 skipped) it counts by level as before: "Company or department goals" (any
  company or department goal) and "Your team's goal" (any team goal). Org
  goals open `OrgGoalsModal` (paste, talk or up to 3 files →
  `POST /api/onboarding/org-goals/parse`, nothing saved → `apply`), where each
  row's owner can be changed; your own units are not offered there. Owners
  read "The company" and each department named relative to you ("Member
  Experience (your boss's group)"); leading nothing keeps "Department goal ·
  {name}". The read
  is told which unit you lead: a goal the text says comes from above you (a
  boss, director, VP or their deck) is a department goal even when it shares
  your team's customers, segment or numbers, and a goal it can't place starts
  unchecked rather than being dropped. A group the text names that isn't set
  up yet comes back as `suggested_unit_name` and prefills the boss's-group
  name. When no
  unit sits above yours (or, leading none, no department exists), a row can be
  **"Your boss's group (name it)"**: one name, saved as a department above
  your unit (`POST /api/org-units/setup/above`) before the goals apply. The
  receipt's primary action is "Write your team's goal" (or department's),
  which opens the team-goals step with Supports set to a department goal
  just saved.
  **Team-goals step** (`TeamGoalsModal`, `routes/team_goals.py`): your own
  unit's goal is the second half of step 6, and every way in opens this step
  on Mission Control (`?setup=team-goal`, also the server's
  `own_goal_target`): the card's action once goals above you exist (or the
  step is parked), "Or write your team's goal first", and the org-goals
  receipt. It sets the job beside this period from your own records
  (`GET /api/onboarding/team-goals/context`, no AI): up to four expectation
  lines from the roles your people hold, against your unit's open goals,
  each side with what it gets you. A quick test line follows ("If hitting it
  just means everyone doing their job well, it's already an expectation").
  Then up to three goals to start from (`POST .../team-goals/suggest`, the
  one AI call, cached per unit for the visit), each from one expectation
  (raise the bar for a period, close a gap) or one goal above you (your
  unit's part of it). The server drops a suggestion with a number its source
  doesn't contain, a date in the title, or a title that repeats an
  expectation or an existing goal; due dates come only from the end of this
  or next quarter or a goal above's due date; targets are left blank for the
  manager, with the role's bar shown beside them. "Use this" opens the New
  goal form filled in (`lib/goalDraft.ts`, one sessionStorage read); only
  "Add goal" there saves. With no expectations and no goals above, there is
  nothing to draft from and the step says so. The footer says individual
  goals aren't set here and can be added from each person's page.
  **"Don't know yet"** stamps `users.org_goals_unknown_at`: with a team goal
  the step reads "Waiting on your boss" and `next_step` skips it, and an ask
  goes on the next meeting with a boss in Beyond. Adding an org goal clears it.
  An open org goal past its end date or 90+ days unconfirmed shows "Still
  current?" on `/app/goals`.
- **Skipping.** Any step can be skipped for now (`users.setup_skipped_steps`).
  A skipped step isn't done or stamped, counts toward ending setup, and can be
  undone. Skipping team and roles unblocks expectations.

Knowledge documents and the first 1:1 are not setup steps.

## Setup prompts

- **Setup card** (`components/SetupPath.tsx`, Mission Control): the next step
  highlighted with what it changes, a time estimate and one button; the others
  one line each. The header chip reads "Setup n of 6 done" until set up.
- **Entry modal** (`SetupIntroModal`): once, on the first Mission Control load
  after the first prep sheet (`intro_pending`); stamps `setup_intro_seen_at`.
- **Fading** (`card_level()`): `full`, `quiet` (one line) after the first "Not
  now" or 7 days without progress, `hidden` while a snooze runs. "Not now"
  snoozes 1, 3, 7, then 14 days. Completing a step resets dismissals. The
  header chip never fades; clicking it or landing on `#setup` shows the full
  card for that visit.
- **Completion** (`SetupCompleteModal`): once, when all three steps hold and
  `setup_receipt_seen_at` is null. It opens at once ("Counting what is on
  record…" until `GET /api/onboarding/receipt` loads), lists what is on record
  and up to three optional next things, and closes only on Done, Escape (once
  loaded) or a "next" link — never a backdrop click.
- **Ranker candidate** `resume_setup_step` (`mission_control_engine.py`):
  offered only when the card is quiet or hidden, fixed at 10 points so it
  ranks below anything dated, never changes the brief's mode.
- **"Built without"** on a prep sheet (`prep_built_without()`): the setup
  inputs missing for that person when it was built, each linking to where it
  is fixed, beside "Drew on".

## Intake: capture by person

Setup intake is `PersonIntake` on each person's page ("Add what you know",
`POST /api/person-intake/{id}/draft`): the person is fixed by the page, other
roster names are held out, every row needs an exact quote, and the manager
picks who owes each commitment. The setup card no longer opens the old notes
dump. That dump (`routes/notes_dump.py`, `intake_slices.py`,
`intake_placement.py`, `NotesDumpModal.tsx`) is retired: nothing in the app
opens it, its routes are still mounted, and its code is pending removal.

## The return for the first wrap-up

One email per manager, on the evening of their first 1:1's date (18:00 in the
series timezone, New York when unset) if nothing is logged, up to 48 hours
late. `jobs/wrapup_reminder.py` writes the date to the manager's HubSpot
contact and the "First 1:1 wrap-up reminder" workflow sends it ("Product
reminders" subscription type). From Andrew, doesn't name the report, links to
Mission Control. `users.wrapup_reminder_sent_at`; `wrapup_reminder_sent`.
Mechanics: `docs/ENGINEERING.md` → Background worker.

## Analytics

Count- and enum-only events, catalogued in `product-analytics.md`:
`first_run_roster_added`, `setup_step_started`, `setup_step_completed`,
`set_up`, `onboarded`, `setup_intro_resolved`, `setup_card_dismissed`,
`set_up_receipt_seen`, `role_draft_composed`, `org_goals_parsed`,
`org_goals_applied`, `org_goals_unknown`, `org_goal_reconfirmed`,
`person_intake_drafted`, `wrapup_reminder_sent`. The golden-path PostHog
funnel's step 1 is `/app/start` or `/app/dashboard`.

## Not built

The split view (a setup step on the left, the sheet gaining lines on the
right), held until a with-context versus without-context sheet comparison.
"Built without" and the ranker candidate cover the delta meanwhile.
