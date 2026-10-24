# Call transcription

Built-in transcription of 1:1s (later team and Beyond meetings) with no
meeting bot. Audio is captured on the manager's own computer, posted in
segments, transcribed, and thrown away. Only text is kept.

**Built so far:** the server pipeline (session 1, plus the session 1b review
fixes of 2026-10-23), the meeting experience (session 3: Meet, the meeting
screen, the recording pill) and the browser capture engine that records the
mic and the call tab and queues segments on the device (session 2, with the
server's echo dedupe), and the wrap-up that drafts from the transcript plus
the report's read-only view (session 4). Team and Beyond meetings and the
launch surface are later build sessions; the plan lives in the gitignored
`docs/CALL_TRANSCRIPTION_BUILD_SCOPING.md`, the decision record in
`docs/CALL_TRANSCRIPTION_SCOPING.md`.

## The promises this code keeps

- **No audio is stored.** A segment's bytes live in memory for one request,
  go to the transcription vendor, and are dropped. Never Storage, disk or a
  log line. Same retention as dictation (`docs/systems/dictation.md`).
- **No transcript text in logs.** `ai_call` and `call_segment_stored` log ids,
  sizes, counts and seconds only.
- **Speaker labels come from the track, never from voice.** `self` = the
  manager's mic, `other` = the call tab, `mixed` = mic only (in person). No
  voiceprint is ever built (BIPA stays out of scope).
- **Draft-then-review is untouched.** A transcript is evidence. Nothing from
  it enters the record until the manager saves a wrap-up that drew on it.
- **The report never learns why a gap exists.** Paused, off-the-record and
  stopped intervals all reach them as start/end only.
- **Nothing said in a gap becomes text.** The client stops sending audio while
  paused or off the record; the server also drops any line whose time falls
  inside a gap, on upload and again on every read.
- **The report reads a call only once it has ended.** Never while it is being
  transcribed (a resumed call is hidden again until it ends).
- **Deleting a transcript never refunds hours.**

## Shape

```
capture client (browser now, Mac helper later)
  POST /api/call-transcripts                    start: meeting, capture_mode, consent
  POST /api/call-transcripts/{id}/segments      one 3-min track: audio + seq, track, offset_ms, duration_ms
        → ai_core.transcribe_call_segment()     OpenAI, AI_CALL_TRANSCRIBE_MODEL (whisper-1)
        → call_transcript_segments.lines        [{t_ms, text}]
        → add_transcription_seconds(segment)    bill once
  POST /api/call-transcripts/{id}/pause         {kind: pause|off_record, at_ms}
  POST /api/call-transcripts/{id}/resume        {at_ms}  (also after a stop: same row)
  POST /api/call-transcripts/{id}/end           {reason, at_ms, seqs_by_track}
  GET  /api/call-transcripts/{id}               status, interleaved lines (echoes removed), gaps
  GET  /api/call-transcripts?one_on_one_id=…&status=recording
  GET  /api/call-transcripts/usage              hours used / allowed
  PUT  /api/call-transcripts/consent            per-person consent on/off
  DELETE /api/call-transcripts/{id}             the manager deletes it
```

`/health` reports `"call_transcription": true|false` (is `OPENAI_API_KEY` set).

| File | Owns |
|---|---|
| `backend/routes/call_transcripts.py` | every endpoint above; allowance check, staleness, interleaving, echo dedupe |
| `backend/ai_core.py` → `transcribe_call_segment()` | the vendor call, its own 4 MB cap (dictation's 8 MB is separate), lines with timestamps, whisper's invented lines dropped |
| `backend/config.py` → `TRANSCRIPTION_ALLOWANCES`, `AI_CALL_TRANSCRIBE_MODEL` | hours per tier; the call model (dictation keeps `AI_TRANSCRIBE_MODEL`) |
| `backend/main.py` → `_read_only_exempt()` | delete and consent pass the read-only gate |
| `database/schema.sql` → CALL TRANSCRIPTION | tables, policies, the four SECURITY DEFINER functions |

## Data

- `call_transcripts`: one per recorded meeting, exactly one of
  `one_on_one_id` / `team_meeting_id` / `outside_meeting_id`. `status` is
  stored (`recording`, `finishing`, `ready`, `failed`) because it describes a
  running process. One `recording` row per manager (partial unique index).
  `ended_at_ms` and `ended_reason` record the last stop. `expected_seqs` is
  every seq the client said it sent, per track (`{"mixed": [0], "self": [1],
  "other": [1]}`); `last_seq` is the highest of them.
- `call_transcript_segments`: one per transcribed track of a segment, unique
  on `(transcript_id, seq, track)`. Immutable to users (no UPDATE grant), so
  `billed_at` can only be set by `add_transcription_seconds()`.
- `call_transcript_gaps`: `kind` (`pause`, `off_record`, `stopped`),
  `start_ms`, `end_ms` (null while a pause runs), on the segments' ms timeline.
  A table, not jsonb on the transcript, because the report can read the
  transcript row and must never see `kind`.
- `transcription_usage`: seconds per user per UTC month, no content, no link
  to transcripts. It counts **meeting time**: a seq bills once, at its
  longest track, so an hour with Jordan's side added uses one hour. Each
  segment keeps its own `billed_seconds` for cost reporting. Users can read their own rows; nothing but
  `add_transcription_seconds()` writes them.
- `one_on_ones.private_notes`: notes typed while off the record. Manager only
  (`one_on_ones` has no report policy). Never sent to the wrap-up. Save log
  on the meeting screen writes it.
- `transcription_consent_at` on `direct_reports` and `outside_people`: set the
  first time a 1:1 with that person starts with consent confirmed (or by
  `PUT /consent`), kept on later ticks, cleared from the person's page.

**Access.** Owner-scoped (`owner_id = auth.uid()`), with `owner_id`
denormalized onto segments and gaps behind a composite FK so no policy
subqueries another table. The report reads their own 1:1 transcripts and
segments read-only through `call_transcript_ids_for_report()`, only once the
call has ended (`ended_at` set and status `finishing` or `ready`); never gaps,
except start/end via `call_transcript_report_gaps()`. The route also builds
the report's response field by field, so `kind`, `capture_mode`,
`ended_reason` and consent dates never leave for them.

## Behaviour worth knowing

- **Start** checks the meeting belongs to the manager, consent is confirmed,
  the key is set (503 otherwise), the allowance isn't used up, and nothing else
  is recording. It stamps the person's consent the first time.
- **Allowance.** `transcription_allowance_state()` names the tier (read-only,
  then paid/comped, founding, test account, trial); config gives the hours:
  paid and comped 30/month, founding 20/month, test accounts 20/month, trial 5
  total, read-only, IC and no-subscription 0. Checked **at start only**: a call
  that crosses 100% finishes, and the next start is refused with **403**
  `{code: "allowance_reached", message, resets_on, allowed_hours, tier}`. Not
  402: `api.ts` treats every 402 as the read-only banner.
- **Usage shown.** Settings → Your account always shows a "Call transcription"
  line ("12 of 30 hours used this month. Resets November 1."; the trial reads
  "3 of 5 trial hours used."). Read-only accounts see that transcription is off
  and that deleting transcripts and clearing consent still work; an IC sees no
  block. The pill's menu re-reads `GET /usage` each time it opens during a
  transcribed meeting and adds one muted line from 80% up, so it is right to
  within one stored segment. At 100% it says the current 1:1 keeps
  transcribing. All wording lives in `frontend/lib/transcriptionUsage.ts`
  (tests: `npm run test:transcription-usage`): "Under 1" below half an hour,
  one decimal below 10 hours, whole hours above.
- **Segments are idempotent.** A stored `(id, seq, track)` returns the stored
  result without calling the vendor; billing is per segment row and runs again
  harmlessly, so a crash between store and bill is billed on the retry.
- **Billing seconds:** the vendor's reported duration if it gives one;
  otherwise the client's `duration_ms` capped at 3 minutes + 15s. Each track
  is capped at 2 hours per transcript (409 `max_length`). A segment whose
  measured length is over 4 minutes is refused (413 `segment_too_long`) and
  not stored: a real segment is 3 minutes, so that is a client that isn't
  rotating or one trying to be billed for less than it sent.
- **Model and timestamps.** Calls use `AI_CALL_TRANSCRIBE_MODEL`, `whisper-1`,
  asked for `verbose_json` segment timestamps: one line per spoken segment
  and the audio's measured length. Segments whisper itself flags as failed
  (judged silent and unsure, or looping repetition) are dropped, because on a
  quiet track they are invented lines. Another model in config gives one
  line per audio segment at its `offset_ms`. **Never a diarizing model**
  (`gpt-4o-transcribe-diarize`): it labels speakers by voice (BIPA). The
  real-call check compares accuracy on names before launch.
- **One timeline.** Every `offset_ms` and `at_ms` is milliseconds since the
  transcript's `started_at`, by the wall clock, across reloads, pauses and
  resumes.
- **Tracks are the truth.** Jordan's side can be added or dropped mid-call,
  so the mic's segments switch between `mixed` and `self`. `capture_mode`
  means how the call started.
- **Interleaving** sorts every line by `t_ms`, then `self` before `other`.
- **Echo dedupe** (`drop_echo()`, on every read, after interleaving). Without
  headphones the mic hears the other person through the speakers, so their
  words land on `self` too. A `self` line is dropped when at least 80% of its
  words appear in `other` lines spoken at the same moment (within 1.5 s either
  side of the lines' spans); lines under three words need an exact match
  within 2 s. It never touches `mixed`, never drops an `other` line, and keeps
  a manager line that only partly overlaps, so a manager restating the other
  person afterwards stays. Stored lines are never changed. It relies on
  whisper-1's per-line timestamps.
- **End** sets `finishing`; it becomes `ready` once every `(track, seq)` in
  `seqs_by_track` is stored, so a late `other` segment holds it. (An older
  client sending only `last_seq` gets the old check: each seq on some track.)
  **Resume** after a stop reopens the same row (`recording`) and records the
  stopped time as a `stopped` gap, but only within **30 minutes** of the stop
  (409 `resume_window_passed` after): resume skips the allowance check.
- **Staleness.** A `recording`/`finishing` row with no segment, pause, resume
  or end for 30 minutes is closed on the manager's next read (`ready` with
  segments, `failed` without), with `ended_at` set to its last activity, so
  reading an old call never reopens its resume window. An open pause keeps a
  call alive for up to 3 hours. A late segment turns `failed` into `ready`.
- **Read-only accounts:** every write is behind the 402 gate except
  `DELETE /{id}` and `PUT /consent`: removing a record of someone's words, or
  withdrawing their consent, is never behind the paywall. `GET`s stay open.
  A trial that expires mid-call loses the rest of that call (accepted as rare).
- **Rate limits:** every write has its own limit (30/minute; start 10).
- **Export and deletion:** all four tables are exported (a report's export
  leaves out their manager's transcripts, like `direct_reports`).
  `private_notes` and `expected_seqs` export with their rows.
  `delete_my_account()` deletes `call_transcripts` by owner; usage cascades
  from the login. The persona reset script clears all four.

## The meeting experience and the capture engine (frontend)

| File | Owns |
|---|---|
| `lib/recorder/RecorderProvider.tsx` | the active meeting and the pill's state; start / pause / resume / end through `lib/api.ts`; rebuilt from the server after a reload (`GET ?status=recording`, open gaps); the 30-minute resume window and the 2-hour stop |
| `lib/recorder/types.ts` | the `CaptureEngine` interface: `start`, `reattach`, `addCallTab` (inside the click), `hold`/`release` (cut the segment at Pause / Off the record), `stop` (returns `seqs_by_track`), `onAutoStop` |
| `lib/recorder/browserEngine.ts` | the engine `createEngine()` returns: mic and call-tab recorders, 3-minute rotation, hold/release, the level meter and the three auto-stops |
| `lib/recorder/queue.ts` | the on-device queue (IndexedDB `tsp-recorder`) and the uploader; recovery after a reload or crash |
| `lib/audioFormat.ts` | mime negotiation, 32 kbps and the mic settings, shared with dictation |
| `public/recorder/level-worklet.js` | the AudioWorklet that measures loudness on the audio thread |
| `lib/recorder/stubEngine.ts` | a no-audio engine kept for design work on the meeting screen; not used by the app. `window.__tspRecorderStub.autoStop(reason)` exists only on it |
| `lib/recorder/prefs.ts` | "Ask for the call tab", "tip shown" and the Transcribe switch's last choice, in localStorage (try/catch) |
| `lib/meeting-draft.ts` | the local draft per 1:1 row: call notes and off-the-record notes apart, covered ticks, added topics; cleared on Save log, with a copy kept 30 minutes for Undo |
| `components/meet/MeetingWrapUp.tsx` | the in-place wrap-up (B7) |
| `lib/report-transcript.ts`, `app/app/ic/transcripts/[id]/page.tsx`, `app/app/ic/page.tsx` | the report's read-only transcript and the list on their landing page |
| `components/meet/RecordingPill.tsx` | the pill in every state, its menu, the one-time tip and our explainer before the share dialog |
| `components/meet/MeetPicker.tsx`, `StartOneOnOne.tsx`, `useStartMeeting.tsx` | Meet in the top bar, Start 1:1 on the Desk, Start on the Last → next card and Mission Control; consent asked once per person; a 409 `already_recording` offered back ("Go back to it" / "End it and start this one") |
| `components/meet/MeetingRoom.tsx`, `MeetingColumns.tsx` | `/app/reports/[id]/meet`: three columns from 980px of content, two (agenda and history tabbed) from 640px, phone tabs below; widths follow the content column so Scribe is accounted for |

- **Starting** needs a 1:1 row: `POST /api/one-on-ones/open/{id}` returns the
  open occurrence or creates an empty one (no AI call).
- **Off the record** switches the notes field to the private note. Save log
  sends it as `private_notes` on `POST /api/one-on-ones`; it never reaches the
  wrap-up draft.
- **End 1:1** stops transcription and turns the screen into the wrap-up (below).
  "Back to the 1:1" resumes the same transcript, with the stopped time as a gap.
- The `Permissions-Policy` header allows `display-capture=(self)` for the call
  tab, alongside `microphone=(self)`.

**The wrap-up** (`MeetingWrapUp.tsx`, `POST /api/one-on-ones/wrapup`)

- **In place, three columns.** Left: Covered, then "Carry into the next 1:1"
  with unticked prepped and added topics pre-ticked, plus what the draft found
  left open. Centre: Summary, Commitments and "Open next time with". Right,
  "What's kept": transcribed and not-transcribed minutes, audio discarded,
  the private-note count, how a gap reads in the report's copy, the
  off-the-record note itself, and Delete the transcript (asks first; the draft
  stays). The left and right columns need no AI and show at once.
- **Waiting for the transcript.** The client polls `GET /{id}` until the
  transcript is `ready` or `failed`, for up to 20 seconds, then drafts anyway
  and says the end may be missing. After a reload or an Undo it finds the 1:1's
  newest ended transcript itself. One AI call drafts everything; the centre
  shows skeletons until it lands. **Save log stays disabled until the draft is
  ready**, so End 1:1 → Save log is two clicks.
- **The request carries call notes and `transcript_id` only.** There is no
  field for off-the-record notes. The route reads only the caller's own
  transcript, and only one attached to a 1:1 with that same person (404
  otherwise), through `lines_for_wrapup()`: interleaved, echoes dropped, and
  every line inside a gap removed again.
- **The prompt** takes two labelled inputs, the manager's notes and the
  transcript, with each line numbered, timed and labelled by track (`YOU
  (manager)`, the report's first name, or `MIC (both of you, speaker
  unknown)`). The notes win on emphasis; owners come from the labels; no long
  quotes. Each commitment cites its line (`L14`) or `notes`. The server checks
  the citation against the real lines and turns it into "From the call,
  12:03"; a line from the `mixed` track always marks the owner as unsure, and a
  citation that doesn't exist is dropped. Calls past 120,000 characters keep
  their start and say so.
- **Owners.** Each owner chip is a one-tap You ↔ report switch. With only the
  mic on: "Only your mic was on, so check who owns each one. Tap a name to
  switch it." Source and unsure flags are display only, never saved.
- **Eval:** `eval/test_wrapup_transcript.py` runs three fictional calls
  (two-track, mic only, an off-the-record gap) against the real model and
  checks commitments, `committed_by`, the unsure flags, and that no
  off-the-record speech or note reaches the prompt.

**The report's view** (`/app/ic`, `/app/ic/transcripts/[id]`)

- Their landing page lists their 1:1 transcripts; each opens read-only, without
  the manager's navigation. RLS shows a call only once it has ended.
- Labels are turned round: their track is "You", the manager's is the
  manager's first name (read as the report, so "Your manager" where RLS
  doesn't show it). Mic-only lines carry no label, with one line saying why.
- Every gap reads "Not transcribed · N min", built from start and end only.
  "Machine transcript" and audio discarded are stated. No notification, and
  transcripts never feed prep.

**The capture engine**

- **Rotation without timers.** Each recorder runs with a 1-second timeslice,
  and each data event is the clock: a window 3 minutes old is closed and the
  next one opened (the next opens first, so no word falls between them).
  The Same Page is usually a background tab behind the call, where timers are
  throttled but recorder events keep coming.
- **One seq per window.** All tracks open and close together and share a seq,
  which is what billing by seq position needs. Adding or dropping the call
  tab closes the window too, so the mic switches between `mixed` and `self`
  at a seq boundary. `seq = max(last + 1, whole seconds since started_at)`, so
  it stays unique after a reload even if storage was lost.
- **Hold** (Pause, Off the record) closes the window at that moment. The
  streams stay open so Resume is instant; nothing is recorded while held.
- **The queue.** IndexedDB `tsp-recorder`: `chunks` (each 1-second chunk as it
  arrives, so a reload or crash loses about a second), `segments` (closed
  segments waiting to send) and `transcripts` (every seq queued per track,
  which `stop()` returns for End across reloads, plus time captured for the
  2-hour stop). Memory stands in when IndexedDB can't open. One tab uploads at
  a time (Web Locks), oldest first. A segment is deleted on success or a
  duplicate reply. Network errors, 401, 402, 408, 429 and 5xx retry with
  backoff (5 s doubling to 5 min) for up to 24 hours; a success, a reload or
  coming back online sends everything waiting at once. Other refusals drop the
  segment; 409 `max_length` also stops the call.
- **After a reload** the provider calls `reattach()`: leftover chunks become a
  segment, the queue is flushed, and recording resumes on the same timeline
  (the mic is `mixed`: the call tab can't survive a reload). Any page load
  also sends what a closed tab left behind once its chunks have been quiet
  for 30 seconds. A tab that finds another tab already recording the call
  (Web Lock `tsp-recorder-live:{id}`) only shows the pill.
- **Silence.** The worklet posts each track's loudness four times a second;
  RMS above 0.006 (about −44 dBFS) counts as speech. Ten minutes with no
  track above it stops the call. A window nobody spoke in is not uploaded
  (cost, and whisper invents text on silence). If the meter can't run (no
  AudioWorklet, or a reloaded page that hasn't been clicked yet: the first
  click or key starts it), the silence clock stands still and every window is
  sent.
- **The 2-hour stop** counts recorder time (pauses excluded) from the
  `transcripts` record; the server's per-track cap backs it up.
- **The call tab ending** (closed, or Stop sharing) fires `share_ended` from
  the track's `ended` event, or on the next recorder tick if the track is over
  without one.
- **Sandbox checks** build with `NEXT_PUBLIC_RECORDER_TEST_TIMINGS` =
  `segmentMs,silenceMs,maxMs` to see rotation and the auto-stops in seconds.
  Never set in a deploy. Chromium in the sandbox doesn't end a capture when
  its tab is closed, so the real-call check confirms that on a real Chrome.

## Analytics

`call_transcription_started`, `call_transcription_ended`,
`call_transcription_allowance_hit`, `call_transcript_used_in_wrapup` (a saved
1:1 log whose meeting has a transcript with a stored segment, checked by
`meeting_has_transcript()`, which never fails the save),
`call_transcript_deleted` and `transcription_consent_cleared` (only a real
clear); see `product-analytics.md`.

## Public wording

The privacy policy's transcription edits (a Call Transcripts section, the
OpenAI row, retention and deletion, and consent under people on your team)
live in `website/prototype/legal-body-privacy.html`, behind a counsel-review
draft note, and are pasted into HubSpot when transcription goes live. Site copy
is held in `gtm/site/homepage.md` → Call transcription copy until the real-call
check passes.
