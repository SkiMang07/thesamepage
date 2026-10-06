# Product analytics

What we measure about how managers use the app, how it is collected, and the rules any new event has to follow. The goal is to answer behaviour questions ("do new managers get to a first prep sheet?") without collecting anything a manager typed.

## Stack

- **PostHog Cloud, US region**, project `627412` ("Default project"), free plan with no card on file. 1M events a month are free; past that PostHog drops events instead of billing, so the cost ceiling is $0.
- Vercel Analytics was considered and rejected: on Hobby it records page views only, and custom events need Pro.
- Keys: `NEXT_PUBLIC_POSTHOG_KEY` (Vercel, Config type) and `POSTHOG_PROJECT_KEY` (Railway) hold the same `phc_` project key. It is public by design. See ENGINEERING.md, "Rotating secrets". With either key unset, that side sends nothing.

## How events are collected

**Browser (`frontend/lib/analytics.ts`).** Started from `instrumentation-client.ts`. Sends `$pageview` on every route change (`capture_pageview: "history_change"`) and nothing else. `<AnalyticsUser />` in `app/app/layout.tsx` calls `identify(<Supabase user id>)` on sign-in and `reset()` on sign-out.

- Off in code: autocapture, rage/dead clicks, heatmaps, session replay, surveys, product tours, web experiments, exception capture (Sentry covers errors), performance capture, page-leave events.
- `advanced_disable_flags: true`: the SDK never fetches PostHog's remote config, so a toggle flipped in the PostHog UI cannot switch any of the above back on. Feature flags are therefore unavailable until this is revisited.
- `disable_external_dependency_loading: true`: PostHog loads no extra scripts.
- `before_send` cuts the query string and fragment from every URL-valued property, and replaces the `/invite/<token>` path segment with `/invite/[token]`.
- Events post to `/ingest` on the app's own domain; `next.config.js` rewrites that to `us.i.posthog.com`. So the CSP needs no PostHog host and ad blockers drop fewer events. `skipTrailingSlashRedirect: true` is required for this (PostHog's paths end in `/`).
- The first page view of a load is only recorded once the tab is visible. A page opened in a background tab records its page view when it is brought forward. Route changes are recorded either way.

**Backend (`backend/analytics.py`).** `capture(user_id, event, properties)` posts to PostHog on a two-thread background pool and returns immediately. A failure is logged at `warning` and never reaches the request. Every server event carries `environment`, `$lib: tsp-backend` and `$geoip_disable: true`. Server-side is the default for anything the backend already knows (the first save of something, a count), because ad blockers can't drop it.

**Identity.** One id everywhere: the Supabase user id, the same one Sentry uses. A manager's page views and server events join on it. No email, name or org name is ever sent as an event or person property.

**Project settings (PostHog UI).** "Discard client IP data" on; session replay off; autocapture off. The code enforces the same things, so these settings are a second layer, not the only one.

## Privacy rules for any event

1. Properties are flags, counts, ids or fixed enum values. Never free text: no note, prompt, transcript, agenda item, name or email.
2. No URLs with query strings, and no tokens in paths. `before_send` handles this for the browser; a backend event should not carry a URL at all.
3. Prefer a server event to a browser event when the backend can see the moment.
4. If a new event needs anything beyond rule 1, write down why here first.

## Event catalog

|Event|Sent from|When|Properties|
|---|---|---|---|
|`$pageview`|browser|every route change in the app, `/auth` and `/invite`|PostHog defaults, URLs scrubbed as above|
|`$identify`|browser|first time a signed-in session is tied to the user id|none of ours|
|`ai_draft_resolved`|server; browser-computed surfaces arrive via `POST /api/telemetry/ai-draft`|an AI draft or proposal is saved, thrown away, or left open (see "AI-draft quality")|`surface`, `outcome`, `edited_before_save`, `edit_bucket`, `seconds_to_confirm`; `items_drafted` / `items_kept` / `items_added` on wrap-ups|
|`prep_sheet_saved`|`POST /api/one-on-ones/prep`|every time a prep sheet is generated and saved|`is_first` (bool): no sheet existed for this manager before this one. `regenerated` (bool): this 1:1 already had a sheet and it was replaced|
|`first_run_roster_added`|`POST /api/telemetry/first-run-roster`|the roster step on `/app/start` adds at least one direct report|`count` (int): how many were added. No names|
|`setup_step_started`|`POST /api/telemetry/setup-step-started`|the manager opens a setup step from the setup card (browser click, sent through the server so ad blockers can't drop it)|`step` (`org`, `expectations` or `goals`), `is_next` (bool): the step was the highlighted next step|
|`setup_step_completed`|server, `GET /api/onboarding/status`|the first time a setup step's condition is seen to hold. Fires once per step per manager; a step that stops holding later does not fire again|`step` (enum as above), `done_count` (int): steps holding at that moment|
|`set_up`|server, `GET /api/onboarding/status`|the first time all setup steps hold and `users.set_up_at` is stamped. Fires once per manager|none|
|`onboarded`|server, `GET /api/onboarding/status`|the first time the manager is set up, has a logged 1:1, and has a later prep sheet for the same person; `users.onboarded_at` is stamped. Fires once per manager. Accounts grandfathered by the 2026-09-29 migration never fire it|none|
|`wrapup_reminder_sent`|server, `jobs/wrapup_reminder.py`|the first-1:1 wrap-up reminder is handed to HubSpot (the evening of the manager's first 1:1 date, nothing logged yet). Fires once per manager|`tz_known` (bool): the series had a real timezone rather than the UTC default|
|`notes_dump_parsed`|server, `POST /api/onboarding/notes-dump/parse`|the manager runs the notes dump and the one AI read returns (nothing is saved at this point)|`input_size` (`under_1k`, `1k_5k`, `5k_20k` or `over_20k` characters), `files` (int), `truncated` (bool), `proposed_org_units`, `proposed_roles`, `proposed_goals`, `proposed_notes`, `proposed_expectations`, `proposed_commitments` (ints, after ranking and the cap), `overflow` (int, found but not shown), `unmatched_people` (int). No text, names or file names|
|`notes_dump_applied`|server, `POST /api/onboarding/notes-dump/apply`|the manager saves what they kept from the review|`kept_org_units`, `kept_roles`, `kept_goals`, `kept_notes`, `kept_commitments` (what the manager owes), `kept_owed_to_you` (what people owe the manager) (ints, saved), `kept_expectations`, `roles_created`, `drafts_queued`, `not_drafted` (ints), `skipped_existing` (int, already there so not duplicated), `refused` (int, failed validation), `dropped` (int, proposed and not kept), `edited` (int, kept rows the manager changed)|
|`file_text_extracted`|server, `POST /api/files/extract-text`|the manager attaches a file to a note field and its text is read back (nothing is saved, no model runs)|`surface` (`one_on_one_notes`, `team_meeting_notes`, `beyond_meeting_notes` or `other`), `kind` (`pdf`, `docx`, `txt`, `md`, `vtt`, `srt` or `other`), `size` (`under_1k`, `1k_5k`, `5k_20k` or `over_20k` characters), `truncated` (bool). No text or file names|
|`notes_dump_skipped`|`POST /api/telemetry/notes-dump-skipped`|the manager chooses "Nothing to add" on the notes dump|none|
|`person_intake_drafted`|server, `POST /api/person-intake/{id}/draft`|the manager runs "Read" on what they know about one person (nothing is saved at this point)|`input_size` (`under_1k`, `1k_5k` or `over_5k` characters), `commitments`, `thoughts` (ints, drafted), `side_unclear` (ints, commitments whose owner the words did not state), `held_back` (int, sentences naming another person, not read), `already_there` (int, already open), `dropped` (int, not tied to the manager's words), `truncated` (bool). No text or names|
|`role_draft_composed`|server, `POST /api/role-expectations/import`, or a batch draft's background run|the one AI read of a job description and/or a description of the role returns (nothing is saved at this point)|`source` (`job_description`, `description`, `both` or `batch`; a batch run sends `outcome` (`composed` or `failed`), `items` and `typical` only), `input_size` (same buckets as the notes dump, of the text sent), `file` (bool), `items` (int, lines drafted into the role), `typical` (int, of those, lines marked typical for the role and held as suggestions). No text, role names or file names|
|`role_level_split`|server, `POST /api/role-expectations/roles/{id}/split`|the manager answers the level question by splitting the role into two levels|`moved` (int, people moved to the new level), `items` (int, lines the new level starts with). No names or titles|
|`org_goals_parsed`|server, `POST /api/onboarding/org-goals/parse`|the manager runs the org-goals read and the one AI call returns (nothing is saved at this point)|`input_size` (same buckets), `files` (int), `truncated` (bool), `proposed` (int, after the cap), `overflow` (int, found but not shown)|
|`org_goals_applied`|server, `POST /api/onboarding/org-goals/apply`|the manager saves what they kept from the org-goals review|`kept` (int, saved), `skipped_existing` (int), `refused` (int), `dropped` (int, proposed and not kept), `edited` (int, kept rows the manager changed)|
|`org_goals_unknown`|server, `POST /api/onboarding/org-goals/unknown`|the manager answers "Don't know yet" on org goals|`had_boss_meeting` (bool): the item was added to an existing meeting with their boss now, rather than held for the first one|
|`org_goal_reconfirmed`|server, `POST /api/onboarding/org-goals/{goal_id}/confirm`|the manager answers "Yes" on the "Still current?" line for an org goal|`days_since` (`under_90`, `90_180` or `over_180`: time since it was last confirmed or added)|
|`setup_intro_resolved`|server, `POST /api/onboarding/intro-seen`|the manager closes the entry modal ("what setup is and why"). Fires once per manager, the first time only|`action` (`started`: chose the first step, `later`: closed it or chose Later)|
|`setup_card_dismissed`|server, `POST /api/onboarding/card-dismissed`|the manager chooses "Not now" on the setup card, which snoozes it|`dismissals` (int, including this one), `level_before` (`full` or `quiet`)|
|`setup_step_skipped`|server, `POST /api/onboarding/skip-step`|the manager chooses "Skip for now" on a setup step, or undoes it. Fires on each change, not on a repeat of the same state|`step` (enum as above), `skipped` (bool: `false` is an undo)|
|`set_up_receipt_seen`|server, `POST /api/onboarding/receipt-seen`|the manager closes the completion modal after setup finishes. Fires once per manager, the first time only|none|

`is_first` is worked out before the write by `_manager_has_prep_sheet()` in `routes/one_on_ones.py`: any 1:1 row for this manager with `prep_guide` set, planned or completed.

## AI-draft quality

`ai_draft_resolved` measures how much of the AI's work survives review, one event per draft. It is the anchoring measurement the draft-then-review decision records say is missing. No draft or saved text leaves the app: the comparison happens where both texts already sit, and only the result is sent.

**Surfaces.**

|`surface`|Draft|Accepted when|Discarded when|Compared in|
|---|---|---|---|---|
|`one_on_one_wrapup`|summary, commitments, follow-ups, opening line|the 1:1 log saves|"Back to notes"|browser|
|`person_intake`|the drafted commitments and kept thoughts for one person (capture by person)|the manager saves the review|"Back to what I wrote"|browser|
|`team_wrapup`|summary, commitments, carry-forward|the team meeting log saves|"Back to notes"|browser|
|`beyond_wrapup`|summary, commitments, check-in and report notes, carry-forward|the outside meeting log saves|"Back to notes"|browser|
|`development_plan`|"Draft with AI" plan suggestion, or a "Revise with AI" rewrite of the plan|the plan text saves|"Dismiss" on the suggestion|browser|
|`development_note`|"Revise with AI" rewrite of a private note|the note saves|n/a|browser|
|`scribe_proposal`|a Scribe draft card's editable fields|the card is confirmed|the card is discarded|browser|
|`document_extraction`|the Librarian's category, freshness and effective date for an upload|the manager confirms it|the upload is deleted while still in review|server, from `correction_log`|
|`assessment_item`|one AI judgment, or one redraft revision, on an assessment item|accepted as proposed, or overridden (`set`, counted as edited)|unassessed, or the manager's prior judgment chosen over it; a revision dismissed|server, first manager action on an untouched AI judgment only|
|`role_suggestion`|one AI suggestion on a role expectations draft|accepted (applied as written)|dismissed|server|
|`notes_dump`|the notes dump's ranked drafts (team structure, roles, role expectations, what the manager owes people, goals, notes about a person)|at least one row is saved from the review|the manager saves with nothing kept (closing the review without saving sends nothing, so there is no abandoned outcome)|server, counts sent with the apply call (`edited` and `proposed` are counts only)|
|`org_goals`|the org-goals read's ranked drafts (company and department goals with period and who set them)|at least one row is saved from the review|the manager saves with nothing kept (closing the review without saving sends nothing)|server, counts sent with the apply call (`edited` and `proposed` are counts only)|

**Properties.**

- `outcome`: `accepted`, `discarded`, or `abandoned` (a browser draft still open when its page closed or unmounted; best effort). A new draft replacing an open one counts the old one as `discarded`. Scribe cards are never `abandoned`, because closing the drawer leaves them pending and they come back.
- `edit_bucket`: word-level edit distance between draft and saved text, as a share of the draft's words. `none` (identical, ignoring case and spacing), `light` (<10%), `moderate` (10–40%), `heavy` (40%+). `document_extraction` uses the share of its three fields corrected (one is `moderate`, two or more `heavy`). Always `none` unless `accepted`. `edited_before_save` is `edit_bucket != none`.
- `seconds_to_confirm`: from the draft appearing to its resolution, capped at 86,400. Server surfaces measure from the stored proposal time (assessment judgment or revision, role suggestion `created_at`, document upload). Scribe measures from the card appearing.
- `items_drafted` / `items_kept` / `items_added` (wrap-ups only): drafted commitments, saved commitments recognisably from the draft (anything short of a `heavy` rewrite), and saved commitments that were not.

**Where the code is.** `frontend/lib/aiDraftTelemetry.ts` (bucket, item counts, one-shot `DraftTracker`; `npm run test:ai-drafts`) and `lib/useAiDraft.ts` (React wiring, abandon on unmount or `pagehide`). `backend/routes/telemetry.py` accepts only the fixed enums and non-negative ints (`extra="forbid"`) and refuses server-side surfaces. `analytics.ai_draft_resolved()` drops any value outside the vocabularies instead of sending it, and `analytics.edit_bucket()` must stay identical to the browser's `editBucket()`. Tests: `backend/tests/test_ai_draft_telemetry.py`.

**Not covered.** Prep sheets (the manager's own working sheet, not a record; `prep_sheet_saved` covers them), the retired `/expectations/draft`, `/draft-org-values` and `/roles/import/draft` endpoints, and the "Draft with AI" opportunity suggestions, which are added one at a time and not yet measured.

## Pathways

### Golden path: new manager to first prep sheet

The one behaviour that says the product is working for a new user: they get in, find prep, and leave with a saved sheet for a real 1:1.

- **Saved insight:** "Golden path: new manager to first prep sheet" (`us.posthog.com/project/627412/insights/wyddMxdR`). It is a funnel of unique users, a 30-day conversion window, showing the last 30 days.
- **Steps:**
    1. Opened the app: `$pageview`, current URL contains `/app/start` or `/app/dashboard`. (Update the saved insight in PostHog: step 1 is now an OR.)
    2. Opened a prep sheet: `$pageview`, current URL contains `/prep`.
    3. Saved first prep sheet: `prep_sheet_saved` where `is_first = true`.
- **Reading it:** the drop between 1 and 2 is discovery (can they find prep?). The drop between 2 and 3 is the prep page itself (did generation work, was it worth saving?).
- **Known gaps:** existing managers never reach step 3, so the funnel only means something for people who signed up inside the window. Step 1 misses a manager whose first page wasn't the dashboard (an invite that lands elsewhere).

### Setup mode

How far new managers get through setup after the first prep sheet. Count only; nothing here says why anyone stopped, the day-1 and day-7 calls do.

- **Steps:** `org`, `expectations`, `goals`. Knowledge documents and the first logged 1:1 are not setup steps.
- **Read per step:** `setup_step_started` reached, `setup_step_completed` finished. Started without a later completed for the same `step` is abandoned. `setup_step_skipped` with `skipped` true marks a step the manager parked; one later followed by `setup_step_completed` was skipped and then done.
- **Notes dump:** `notes_dump_parsed` (ran), then `notes_dump_applied` (saved something) or `notes_dump_skipped` (chose "Nothing to add"). Parsed without a later applied is abandoned or discarded. `proposed_*` against `kept_*` is how much of the ranked draft survived.
- **Expectations on-ramp:** `role_draft_composed` by `source` shows how many managers attach a job description versus describe the role. `typical` against later `role_suggestion` outcomes shows how much of the "typical for this role" material survives review.
- **Org goals:** `org_goals_parsed`, then `org_goals_applied` (saved something) or `org_goals_unknown` (chose "Don't know yet"). Parsed without a later applied or unknown is abandoned or discarded. `org_goal_reconfirmed` counts the quarterly "Still current?" answers.
- **Entry and fading:** `setup_intro_resolved` by `action` shows how many start straight from the modal versus leave it for the card. `setup_card_dismissed` with a rising `dismissals` count marks managers the card is losing; compare their `setup_step_completed` against managers who never dismiss. The Mission Control candidate that returns a manager to the next step reports through the existing `cta_clicked` and `setup_dismissed_today` events, with `candidate_type` `resume_setup_step`.
- **Completion:** `set_up` is the fact, `set_up_receipt_seen` is the manager seeing the receipt. The gap between them is how long a finished manager takes to return to Mission Control.
- **`is_next`:** compare completion of the highlighted step against the others to see whether the highlight helps.
- **Activation ladder:** `prep_sheet_saved` (`is_first`) is activated, `set_up` is set up, `onboarded` is onboarded. Build the PostHog funnel from those three.
- **Known gap:** a step the manager finishes on its own page without ever clicking the card still fires `setup_step_completed`, with no matching `setup_step_started`.

### Next pathways (not built)

Add a row here when one is decided, then add its events to the catalog above. Candidates so far:

- **Prep to logged 1:1.** Does a saved sheet turn into a logged meeting? Needs a server event on `POST /api/one-on-ones` (`was_prepped` flag).
- **Weekly return.** Does a manager come back the following week? PostHog retention on `$pageview` is enough; no new event.
- **Team setup completion.** Share of new managers who add at least one direct report. Needs a server event when the first report is created.
- **Draft trust.** Share of `ai_draft_resolved` accepted with `edit_bucket` `none` or `light`, by `surface`. Needs no new event.
- **Dictation use.** Share of saved sheets that used the mic. Needs a flag the frontend already knows, passed on the prep request.

## Adding an event

1. Decide whether the browser or the server sees the moment; prefer the server.
2. Server: `analytics.capture(user_id, "<noun>_<past_verb>", {flags})` after the write succeeds. Browser: `posthog.capture(...)` through a helper in `lib/analytics.ts`, never directly from a component.
3. Add a row to the event catalog, and a pathway if it feeds one.
4. Add a unit test next to `backend/tests/test_analytics.py` for any logic that decides a flag.