# Call transcription

Built-in transcription of 1:1s (later team and Beyond meetings) with no
meeting bot. Audio is captured on the manager's own computer, posted in
segments, transcribed, and thrown away. Only text is kept.

**Built so far:** the server pipeline (session 1, plus the session 1b review
fixes of 2026-10-23) and the meeting experience (session 3: Meet, the meeting
screen, the recording pill, running on a stub capture engine that sends no
audio). The browser capture engine (session 2), the wrap-up's use of the
transcript (session 4) and the launch surface are later build sessions; the plan lives in the gitignored
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
  GET  /api/call-transcripts/{id}               status, interleaved lines, gaps
  GET  /api/call-transcripts?one_on_one_id=…&status=recording
  GET  /api/call-transcripts/usage              hours used / allowed
  PUT  /api/call-transcripts/consent            per-person consent on/off
  DELETE /api/call-transcripts/{id}             the manager deletes it
```

`/health` reports `"call_transcription": true|false` (is `OPENAI_API_KEY` set).

| File | Owns |
|---|---|
| `backend/routes/call_transcripts.py` | every endpoint above; allowance check, staleness, interleaving |
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
  (`one_on_ones` has no report policy). Never sent to the wrap-up. The
  meeting screen and wrap-up sessions write it.
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
  Echo de-duplication is not built yet (capture-engine session).
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

## The meeting experience (frontend)

| File | Owns |
|---|---|
| `lib/recorder/RecorderProvider.tsx` | the active meeting and the pill's state; start / pause / resume / end through `lib/api.ts`; rebuilt from the server after a reload (`GET ?status=recording`, open gaps); the 30-minute resume window and the 2-hour stop |
| `lib/recorder/types.ts` | the `CaptureEngine` interface session 2 implements: `start`, `reattach`, `addCallTab` (inside the click), `hold`/`release` (cut the segment at Pause / Off the record), `stop` (returns `seqs_by_track`), `onAutoStop` |
| `lib/recorder/stubEngine.ts` | the stand-in engine: no audio is sent, but "Add Jordan's side" opens the browser's real share dialog. `window.__tspRecorderStub.autoStop(reason)` fires the timed auto-stops in sandbox checks. Swap it in `createEngine()` |
| `lib/recorder/prefs.ts` | "Ask for the call tab", "tip shown" and the Transcribe switch's last choice, in localStorage (try/catch) |
| `lib/meeting-draft.ts` | the local draft per 1:1 row: call notes and off-the-record notes apart, covered ticks, added topics; cleared on Save log |
| `components/meet/RecordingPill.tsx` | the pill in every state, its menu, the one-time tip and our explainer before the share dialog |
| `components/meet/MeetPicker.tsx`, `StartOneOnOne.tsx`, `useStartMeeting.tsx` | Meet in the top bar, Start 1:1 on the Desk, Start on the Last → next card and Mission Control; consent asked once per person; a 409 `already_recording` offered back ("Go back to it" / "End it and start this one") |
| `components/meet/MeetingRoom.tsx`, `MeetingColumns.tsx` | `/app/reports/[id]/meet`: three columns from 980px of content, two (agenda and history tabbed) from 640px, phone tabs below; widths follow the content column so Scribe is accounted for |

- **Starting** needs a 1:1 row: `POST /api/one-on-ones/open/{id}` returns the
  open occurrence or creates an empty one (no AI call).
- **Off the record** switches the notes field to the private note. Save log
  sends it as `private_notes` on `POST /api/one-on-ones`; it never reaches the
  wrap-up draft.
- **End 1:1** stops transcription and, until session 4, opens the existing
  wrap-up review drafted from the notes. Unticked agenda topics are offered as
  carry-forwards.
- The `Permissions-Policy` header allows `display-capture=(self)` for the call
  tab, alongside `microphone=(self)`.

## Analytics

`call_transcription_started`, `call_transcription_ended`,
`call_transcription_allowance_hit`; see `product-analytics.md`.
