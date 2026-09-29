# First-Run Onboarding — Scoping Doc

**Scoped:** 2026-09-24 with Andrew · **Status:** approved 2026-09-29; session 1 (front door) built, session 2 not started
**Design:** `docs/design-proposals/2026-09-29-first-run/prototype.html`, in the app's own dark theme (onboarding matches the product, not the website; decided 2026-09-29)
**Direction:** A (straight to the first 1:1) plus B's one-line roster as the second screen.
**Covers backlog items:** P1-7, P1-8, P1-9, P1-10, P1-11, P2-5, P2-9, CUT-2's stale copy, and §7 H's golden-path walk.

---

## 1. Problem

The first run for a brand-new email today, traced in code:

1. `/app/login`: "Sign in or create your account". Works. "Use a password instead" is a dead end for a new user, who has no password and gets Supabase's "Invalid login credentials".
2. Magic link → `/auth/callback`. `@supabase/ssr` uses PKCE, so the link only works in the browser that asked for it. Asking on a laptop and tapping the email on a phone sends the user back to login with "it may have expired", which is the wrong reason. This is the worst dead end on the path because it happens before the product.
3. The callback lands on `/app/dashboard`. The `users` row exists (trigger); the entitlement row and founding number are assigned silently on first shell load. Nobody tells the manager they got a founding place.
4. Mission Control in empty mode: the full chrome with 11 destinations, the Settings door already "not finished", a "Start here" card that explains the product's needs ("The Same Page needs one real working relationship…"), and three empty cards below it (P1-7).
5. Quick add: one person per trip, a role dropdown that silently creates L1 roles, a pointer to Settings. Saving leaves the manager on the dashboard.
6. Mission Control with one person: "Start Priya's prep", beside a role nudge that promises "agreed expectations" (P2-9).
7. Prep: "The Same Page has gathered what may matter" over nothing, then a notes box and a "Build agenda" button that stays disabled with no reason given (P1-10). The backend already has a first-1:1 branch (`_build_prep_prompt`, `days_since_last is None`) and accepts empty notes. The UI blocks the one piece of value we can give with zero setup.
8. Prep sheet → call notes → wrap-up review → person page. Sound. The person page then says "Context gathers here automatically" and "Nothing gathered yet." (P1-9).

About 8 steps to a prep sheet, two of them typing, one with a hidden rule. Everything before step 7 is setup.

## 2. Goal

A new manager reaches a saved prep sheet for a real person in four moves: open the link, name the person, optionally list the rest, build the agenda. No step asks for structure (roles, teams, expectations, org) before that sheet exists.

The measure is the existing PostHog pathway, "new manager to first prep sheet", with step 1 widened to include `/app/start`.

## 3. The flow

```
Start free → /app/login → email → /auth/confirm (works on any device)
   → zero direct reports? → /app/start
        step 1  Who is your next 1:1 with?        (name, optional date)
        step 2  Who else do you have 1:1s with?   (one name per line, skippable)
   → /app/reports/{id}/prep?date=…  first-1:1 agenda, notes optional
   → prep sheet saved  → Mission Control, now with people in it
```

A manager who already has reports goes to `/app/dashboard` as today.

## 4. Screen by screen

Copy follows `gtm/brand/voice-rules.md`: labels literal, empty states one observational line, no encouragement, the product never talks about itself.

### 4.1 Login (`/app/login`)

No visible change to the default magic-link state.

- **Cross-device link.** Add `/auth/confirm` (a route handler) that calls `verifyOtp({ token_hash, type })`, which needs no code verifier and so works in any browser. The magic-link email template's link becomes `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`. **Andrew does this one step** in Supabase → Authentication → Email Templates, since it lives in the dashboard, not the repo. `/auth/callback` stays for invites and anything else that uses the code flow.
- **Password dead end (decided: hide it for new users).** "Use a password instead" only shows on a browser that has signed in with a password before, or at `/app/login?password`. When password sign-in fails with invalid credentials: "That email and password don't match an account. New here? Use the login link instead."

### 4.2 Routing into first run

- `/auth/confirm` and `/auth/callback`: after a session exists and no explicit `next` was passed, count the user's `direct_reports` through their own session (RLS applies, no service role). Zero → `/app/start`. Otherwise → `/app/dashboard`.
- `/app/dashboard`: when the brief comes back `mode === "empty"`, `router.replace("/app/start")`. This catches someone who bookmarked the dashboard before adding anyone.
- `/app/start` joins `NO_NAV_PATHS` in `app/app/layout.tsx`: no sidebar, no header, no Scribe. It keeps the dark theme so the jump into the app doesn't flash.
- If `/app/start` loads for someone who already has reports, it redirects to the dashboard.

### 4.3 `/app/start`, step 1

```
Founding place 7 of 20. Free until December 24.

Who is your next 1:1 with?

Name   [ e.g. Priya Patel              ]
Date   [ mm/dd/yyyy ]  Optional

[ Continue ]

Only you can see what you write here. Nothing is shared with the people you add.
                                                              Sign out
```

- The first line comes from `GET /api/entitlement`. With a founding number: "Founding manager {n} of 20 · Free until {date}" (an end date, not a countdown; decided). Founding is now a year free (`2026-09-29_founding_year.sql`). On a 14-day trial: "Free until {date}". Comped or active: no line.
- Andrew's welcome note sits beside the question once he has written it (`WELCOME` in `app/app/start/page.tsx`; the panel doesn't render while it's empty).
- The sharing line is present tense only, per the decided rule.
- No skip. The product has nothing to show without a person. "Sign out" is the only way out.
- Continue calls `createDirectReport({ name })`. Nothing is created until the button is pressed.

### 4.4 `/app/start`, step 2 (the roster)

```
Who else do you have 1:1s with?

One name per line. Roles and teams can be added later.

[ Sam Okafor                             ]
[ Lena Ruiz                              ]
[                                        ]

[ Add 2 and continue ]      Skip
```

- The button counts live: "Continue" when the box is empty, "Add {n} and continue" when it isn't.
- Parsing: split on new lines and commas, strip list markers ("-", "•", "1."), trim, drop blanks, drop duplicates and the step-1 name (case-insensitive), cap at 25. Names only; no role parsing.
- Creates through the existing `createDirectReport`, one call per name, all in parallel. No new endpoint. If some fail, the ones that saved stay saved and the line reads "{n} couldn't be added. Add them from Team later." before continuing.
- Both buttons go to `/app/reports/{firstId}/prep?date={date}` (with no `date` if step 1 left it blank).

**Risk, noted and accepted:** the roster sits before the first piece of value. It's one box and a Skip, and a manager with 4–11 reports gets a full Mission Control the first time they see it. If the funnel shows a drop at step 2, move the roster to after the prep sheet is saved; the component doesn't change.

### 4.5 Prep, first 1:1 (`/app/reports/[id]/prep`)

Changes to the existing review step, not a new page.

- `?date=` pre-fills the meeting date.
- **Intro line.** When nothing was gathered (no carry-forward, no topics, no commitments, no captures): "No earlier 1:1s with {first name} are recorded." Otherwise: "Pulled from goals, development, and your last 1:1 with {first name}. Remove anything you don't want in this one." This names the sources (P1-9) and drops "The Same Page has gathered".
- **Notes hint.** First 1:1: "Optional. Anything you already know about {first name}'s work, or want to raise." Otherwise: "Anything not already listed above." Retires "the record" (P1-10).
- **Build agenda.** Enabled with empty notes when no completed 1:1 exists for this person. In the other case, keep the rule and say it under the disabled button: "Add a note or keep an item above to build an agenda."
- **Backend prompt.** `_build_prep_prompt` tells the model every item must follow from something written down, which contradicts a first 1:1 with no notes. Add a branch for `days_since_last is None` with nothing else on record: the agenda covers how they like to work and communicate, what they're working on and where they're stuck, what they want from the role, and how the two of you will run these 1:1s, plus the closing question that's always there. `situation_summary` must say plainly that this is the first recorded 1:1 and nothing else is on record, and must not guess. Through `ai_core.py` as now. The prep sheet stays what it is today, a document the manager reviews and edits.

### 4.6 Mission Control after first run

- **P1-7.** In `early_use`, hide "Conversation runway" and "What has changed" when they're empty, and hide the "This week" aside when the truth signal is `limited`. A section with no data doesn't render (DESIGN.md, Empty states).
- **P2-9.** The role nudge reads: "Add {name}'s role to prep against the expectations you set." / "Optional. Prep works without it."
- The empty-mode "Start here" card stays as a fallback only (the redirect makes it unreachable in practice). Copy: "No direct reports yet." with the button "Add a direct report". The line about what The Same Page needs goes.
- The server's "The Same Page has limited evidence so far." goes with the hidden aside; no replacement needed.

### 4.7 The rest of the week-one surfaces

- **P1-8.** "Add your first one from Mission Control →" (`1-1s/page.tsx`) and the dashboard links in `capacity/page.tsx` and `assessments/page.tsx` become buttons that open Quick add in place: "Add a direct report".
- **P1-9 elsewhere.** The "Gathering context" chip becomes "Prep not started". "Context gathers here automatically…" becomes "Goals, development, and your last 1:1 with {first name} show up here before the next one." "Nothing gathered yet." becomes "Nothing recorded for {first name} yet."
- **CUT-2.** Hide Capacity's "By department" section; the stale "Build tab" copy goes with it.
- **P1-11.** Settings readiness stops requiring teams, role assignment for everyone, and expectations on every role. The Settings nav door shows no state at all. Inside Settings, those sections read as optional, not unfinished. A section is only flagged when something is actually broken.

### 4.8 Navigation on day one (P2-5)

> Superseded 2026-09-29 by §11: Assessments now shows locked until onboarded, and Org is a normal door again. The table below is the rule as first built.

Proposed rule: show a door once there's something behind it or a first 1:1 has been logged.

| Door | Day one | Appears when |
|---|---|---|
| Mission Control, Team, 1:1s, Goals, Projects, Knowledge, Settings | shown | always |
| Assessments | hidden | first 1:1 logged |
| Beyond the team | shown | always (it's useful before any 1:1) |
| Capacity, Org | hidden | hidden for launch (CUT-2 stronger option, CUT-3) |

This is the one part of the direction that changes what an existing user sees, so it's listed as an open question below.

## 5. Out of scope

- Importing the manager's existing per-person doc (B's larger idea). Worth its own scoping; it runs through Context Engine extraction plus a review step.
- Lifecycle email and the "week three, haven't opened it" answer.
- IC invites (stay behind `IC_INVITES_ENABLED = false`).
- Roles, teams, expectations during onboarding. They stay where they are.

## 6. Analytics

- The golden-path pathway's step 1 becomes `$pageview` containing `/app/start` **or** `/app/dashboard`.
- One new server event, `first_run_roster_added`, with `count` only (no names), fired from the roster step's completion. It tells us how many managers bring their team in and how big it is. Row in `docs/systems/product-analytics.md` before the event ships.

## 7. Build order

Two sessions, each shippable alone.

1. **Front door.** `/auth/confirm`, the template change (Andrew), the password error, routing into `/app/start`, and both `/app/start` steps with the founding line. Verify: new email, link requested on the laptop and opened on a phone.
2. **First value and the empty-state pass.** The first-1:1 prep changes (frontend and prompt branch), §4.6, §4.7, §4.8 as decided, and the analytics changes. Verify: the §7 H golden-path walk on a brand-new email, laptop and phone, console open, through to a logged wrap-up.

No schema change in either session.

## 8. Decisions (2026-09-29)

1. No skip on step 1. Sign out is the only way out. **Yes.**
2. Nav on day one (§4.8): Assessments hidden until the first 1:1 is logged; Capacity and Org hidden for launch. **Yes.** Session 2.
3. "Use a password instead" hidden for new users. **Yes.** Built as described in §4.1.
4. The founding line shows the end date, not a countdown. **Yes.**
5. Onboarding is styled as the product (dark theme, app components), not the website. The login page is the seam and stays light.

## 9. Session 1, as built (2026-09-29)

- `/auth/confirm` (token-hash verify, any device) and `/auth/callback` both land a zero-report manager on `/app/start`, others on the dashboard, unless the link named a page. The dashboard sends an `empty` brief to `/app/start` too.
- `/app/start`: steps 1 and 2 with the live Team panel, the founding line, and Sign out. Then `/app/reports/{id}/prep?date=…`; the prep page takes `?date=` when there's no open session.
- Founding places are a year: new migration, schema.sql, the notice copy ("Your founding year ends"), ENGINEERING.md.
- Auth email templates link to `/auth/confirm` (`docs/auth-emails/`). **They have to be pasted into Supabase after the push**, not before: until then the old template keeps working through `/auth/callback`.
- Not yet: `first_run_roster_added` (analytics), the §4.8 nav rule, and everything in session 2.

**Session 2 now follows the prototype's steps 3–5:** notes and the first-1:1 agenda written into the person's "Next conversation" card (with the §4.5 prompt branch and Build agenda enabled on empty notes), the save receipt, then Mission Control with the nav arriving, plus §4.6, §4.7, §4.8 and the golden-path walk.

## 9b. Session 2, as built (2026-09-29)

- §4.6: the early-use role nudge and the empty-mode card use the spec copy. The runway and "what has changed" cards no longer exist (Week in Focus), so nothing to hide.
- §4.7: `AddDirectReportButton` opens Quick add from the 1:1s, Capacity and Assessments empty states; "Prep not started" and the "Nothing recorded for {first name} yet." lines; Capacity's "By department" renders only with a led unit; Settings readiness no longer requires teams, roles or expectations, and the Settings door shows no state.
- §4.8: `visibleNavGroups()` (ZoneMap.tsx) drives the sidebar and the zone map.
- `first_run_roster_added`: `POST /api/telemetry/first-run-roster`, count only, fired after the roster step adds anyone. Catalog row added; the saved PostHog funnel's step 1 still needs the OR by hand.

## 9c. Live-walk fixes (2026-09-29)

- Mission Control: in `early_use` with no commitments and no completed 1:1, the three stat tiles and Follow-through don't render (`nothingRecorded` in `WeekInFocus.tsx`).
- Save receipt (prototype step 4–5): `/app/start` sends `?first=1`; the prep sheet then shows "Step 3 of 3" and a "Prep sheet saved" block with a "Go to Mission Control" button. The sheet is already saved when it is built, so the receipt states what is true.
- Bylines read "Drafted by AI" (prep sheet) and "Drafted by AI from today’s records" (morning line).
- Placeholders fit a first 1:1 with a direct report.

## 10. Open questions for Andrew (answered, kept for the record)

1. **No skip on step 1.** The only way out is Sign out. OK?
2. **Nav on day one (§4.8).** Hide Assessments until the first 1:1 is logged, and hide Capacity and Org for launch?
3. **Password toggle.** Keep it with the better error (proposed), or hide it for anyone who doesn't already have a password?
4. **Founding line date.** "Free until December 24." shows the end date, not a countdown. OK?

## 11. After the first prep sheet: setup mode

Design: `docs/design-proposals/2026-09-29-onboarding-path/` (`SETUP_MODE_BRIEF.md` is the current brief; `BUILD_BRIEF.md` and `prototype.html` are the earlier five-step proposal, superseded where they differ). Expert review behind the direction: the VP of Customer Success seat's `2026-09-29-onboarding-soup-to-nuts.md` and its two addenda.

**Three states**, all derived from real records on every call and stamped once (`backend/routes/onboarding.py`):

- **Activated:** a prep sheet exists. Reached in the first run.
- **Set up:** three steps hold. *Org:* at least one org unit, and every active direct report sits in one. *Expectations:* every active direct report has a role, and every role in use has expectations configured (a job description can supply them). *Goals:* an org-level goal (company or department) and a team goal; cancelled goals do not count. `users.set_up_at` is stamped the first time all three hold. Archiving a goal later does not undo it.
- **Onboarded:** set up, plus a logged 1:1 (a session with a summary), plus a later prep sheet for the same person, dated after that log by meeting date (`utils.meeting_day_of`). `users.onboarded_at` is stamped once. Accounts with reports when it first shipped were grandfathered as onboarded, and the 2026-09-29 migration marks them set up too.

Knowledge documents are not a setup step and the first 1:1 is not either. Documents arrive through the notes dump (chunk B) and stay optional. `users.knowledge_skipped_at` stays in the schema, unused.

**Decisions (Andrew, 2026-09-29).** Onboarded is set up + first 1:1 + a second, carried-forward sheet. Knowledge folds into the notes dump. Assessments unlocks per person, once their role has expectations. Org goals are fetched and added by the manager; team goals are theirs to write. No AI call unless one is needed: every status is computed, not drafted. Setup mode follows the seven design rules in `SETUP_MODE_BRIEF.md`. Nothing is locked; Andrew will iterate.

**Built (chunk A).**
- Migrations `2026-09-29_onboarding_state.sql` and `2026-09-29_setup_mode_state.sql`, with matching `schema.sql`: `users.set_up_at`, `onboarded_at`, and `setup_org_at` / `setup_expectations_at` / `setup_goals_at` (the first time each step was seen holding, so each step's analytics event fires once).
- `GET /api/onboarding/status`: `activated`, `set_up`, `onboarded`, `done_count` and `total` (of 3), `next_step` (the first step not done and not waiting on another), `assessable_people` (people whose role has expectations; null once set up), and `steps` (null once set up). Once set up the step queries stop; once onboarded the endpoint answers from the user row alone.
- `components/SetupPath.tsx` on Mission Control: the next step is highlighted with what it changes, a time estimate and one button; the others collapse to a line. Expectations shows locked ("Needs team and org") until org is done. The header chip reads "Setup n of 3" until set up, then goes.
- Locked doors carry a reason. The Assessments door in the nav locks only while setup is running and nobody has a role with expectations ("Opens for a person once their role has expectations."). On `/app/assessments`, a person with no role or a role without expectations shows locked with the reason and a link to fix it; someone added later starts locked the same way, permanently and quietly. A person with an assessment already open or completed is never locked. The lock is a UI lock: the assessment routes themselves are unchanged.
- Per-step analytics, count only (`docs/systems/product-analytics.md`): `setup_step_started` (browser click on the card, through `POST /api/telemetry/setup-step-started`), `setup_step_completed`, `set_up`, `onboarded`.

**Built (chunk B): the notes dump.** Plan and decisions: `docs/design-proposals/2026-09-29-onboarding-path/CHUNK_B_PLAN.md`. A button on the setup card ("Add what you already have") opens one modal: talk / type / paste (`NoteField`) or attach up to 5 PDF, Word or text files, then "Read this". `POST /api/onboarding/notes-dump/parse` (`backend/routes/notes_dump.py`) is the one AI call (`ai_core.generate_text`, heavy model, rate-limited 10 a minute). It is given the manager's roster, roles, teams and goals by short refs (P1, R1), never ids, and returns drafts only: new teams and departments, role or team for a person, goals (company, department, team), and short private notes about a person. Server-side it drops anything that does not point at a real person or role, anything that already exists, and bad dates; ranks setup-closing rows first, then notes about the person whose next 1:1 is soonest; and caps the list at 12 rows, 5 per group, with the overflow count shown. Nothing is written by parse and the input is not kept or logged. Rows the model marked as not stated plainly start unchecked. `POST .../apply` takes only the checked, possibly edited rows, re-validates each one on its own (person must be the caller's, role must exist, team must exist or be created in the same save), writes through the same rules as the normal screens, and skips rows that already exist so a double click cannot duplicate. Notes about a person go to `dr_capture_notes`, which prep, nightly prep, the Scribe and assessment evidence already read; role and team go to `direct_reports`; teams to `org_units`; goals to `goals`. People named in the text but not on the roster are shown as a hint and nothing is saved for them. Attached files are read once and discarded (not filed to Knowledge). No migration. What the dump did not find is not listed separately: the setup card recomputes from records after the save, so the remaining steps are the manager's path. "Nothing to add" is a valid answer. Analytics (catalog first): `notes_dump_parsed`, `notes_dump_applied`, `notes_dump_skipped`, plus a `notes_dump` surface on `ai_draft_resolved`; counts and enums only. Tests: `backend/tests/test_notes_dump.py`.

**Not built (chunks C and D).** Role-expectation on-ramps (attach a job description, draft from a description) and org-goal ingestion; the entry modal ("what setup is and why") and the completion modal (the notes dump's own parse-and-review modal is built); prompt fading and dismissals; the completion receipt and "next, when there is time" list; the split view; a Mission Control ranker candidate that returns a manager to the next step; the sheet's "Built without" line. Steps link to the existing pages for now.
