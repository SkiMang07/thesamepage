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

`is_first` is worked out before the write by `_manager_has_prep_sheet()` in `routes/one_on_ones.py`: any 1:1 row for this manager with `prep_guide` set, planned or completed.

## AI-draft quality

`ai_draft_resolved` measures how much of the AI's work survives review, one event per draft. It is the anchoring measurement the draft-then-review decision records say is missing. No draft or saved text leaves the app: the comparison happens where both texts already sit, and only the result is sent.

**Surfaces.**

|`surface`|Draft|Accepted when|Discarded when|Compared in|
|---|---|---|---|---|
|`one_on_one_wrapup`|summary, commitments, follow-ups, opening line|the 1:1 log saves|"Back to notes"|browser|
|`team_wrapup`|summary, commitments, carry-forward|the team meeting log saves|"Back to notes"|browser|
|`beyond_wrapup`|summary, commitments, check-in and report notes, carry-forward|the outside meeting log saves|"Back to notes"|browser|
|`development_plan`|"Draft with AI" plan suggestion, or a "Revise with AI" rewrite of the plan|the plan text saves|"Dismiss" on the suggestion|browser|
|`development_note`|"Revise with AI" rewrite of a private note|the note saves|n/a|browser|
|`scribe_proposal`|a Scribe draft card's editable fields|the card is confirmed|the card is discarded|browser|
|`document_extraction`|the Librarian's category, freshness and effective date for an upload|the manager confirms it|the upload is deleted while still in review|server, from `correction_log`|
|`assessment_item`|one AI judgment, or one redraft revision, on an assessment item|accepted as proposed, or overridden (`set`, counted as edited)|unassessed, or the manager's prior judgment chosen over it; a revision dismissed|server, first manager action on an untouched AI judgment only|
|`role_suggestion`|one AI suggestion on a role expectations draft|accepted (applied as written)|dismissed|server|

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
    1. Opened the app: `$pageview`, current URL contains `/app/dashboard`.
    2. Opened a prep sheet: `$pageview`, current URL contains `/prep`.
    3. Saved first prep sheet: `prep_sheet_saved` where `is_first = true`.
- **Reading it:** the drop between 1 and 2 is discovery (can they find prep?). The drop between 2 and 3 is the prep page itself (did generation work, was it worth saving?).
- **Known gaps:** existing managers never reach step 3, so the funnel only means something for people who signed up inside the window. Step 1 misses a manager whose first page wasn't the dashboard (an invite that lands elsewhere).

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