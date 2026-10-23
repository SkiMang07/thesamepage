# Call transcription

Built-in transcription of 1:1s (later team and Beyond meetings) with no
meeting bot. Audio is captured on the manager's own computer, posted in
segments, transcribed, and thrown away. Only text is kept.

**Built so far: the server pipeline.** The capture engine in the browser, the
meeting screen, the wrap-up's use of the transcript and the launch surface are
later build sessions; the plan lives in the gitignored
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
- **Deleting a transcript never refunds hours.**

## Shape

```
capture client (browser now, Mac helper later)
  POST /api/call-transcripts                    start: meeting, capture_mode, consent
  POST /api/call-transcripts/{id}/segments      one 3-min track: audio + seq, track, offset_ms, duration_ms
        → ai_core.transcribe_call_segment()     OpenAI, AI_TRANSCRIBE_MODEL
        → call_transcript_segments.lines        [{t_ms, text}]
        → add_transcription_seconds(segment)    bill once
  POST /api/call-transcripts/{id}/pause         {kind: pause|off_record, at_ms}
  POST /api/call-transcripts/{id}/resume        {at_ms}  (also after a stop: same row)
  POST /api/call-transcripts/{id}/end           {reason, at_ms, last_seq}
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
| `backend/ai_core.py` → `transcribe_call_segment()` | the vendor call, its own 12 MB cap (dictation's 8 MB is separate), lines with timestamps |
| `backend/config.py` → `TRANSCRIPTION_ALLOWANCES` | hours per tier |
| `database/schema.sql` → CALL TRANSCRIPTION | tables, policies, the four SECURITY DEFINER functions |

## Data

- `call_transcripts`: one per recorded meeting, exactly one of
  `one_on_one_id` / `team_meeting_id` / `outside_meeting_id`. `status` is
  stored (`recording`, `finishing`, `ready`, `failed`) because it describes a
  running process. One `recording` row per manager (partial unique index).
  `ended_at_ms` and `ended_reason` record the last stop; `last_seq` is the
  highest seq the client said it sent.
- `call_transcript_segments`: one per transcribed track of a segment, unique
  on `(transcript_id, seq, track)`. Immutable to users (no UPDATE grant), so
  `billed_at` can only be set by `add_transcription_seconds()`.
- `call_transcript_gaps`: `kind` (`pause`, `off_record`, `stopped`),
  `start_ms`, `end_ms` (null while a pause runs), on the segments' ms timeline.
  A table, not jsonb on the transcript, because the report can read the
  transcript row and must never see `kind`.
- `transcription_usage`: seconds per user per UTC month, no content, no link
  to transcripts. Users can read their own rows; nothing but
  `add_transcription_seconds()` writes them.
- `transcription_consent_at` on `direct_reports` and `outside_people`: set the
  first time a 1:1 with that person starts with consent confirmed (or by
  `PUT /consent`), kept on later ticks, cleared from the person's page.

**Access.** Owner-scoped (`owner_id = auth.uid()`), with `owner_id`
denormalized onto segments and gaps behind a composite FK so no policy
subqueries another table. The report reads their own 1:1 transcripts and
segments read-only through `call_transcript_ids_for_report()`; never gaps,
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
  is capped at 2 hours per transcript (409 `max_length`).
- **Timestamps.** Models in `_TIMESTAMP_MODELS` (`whisper-1`) are asked for
  segment timestamps and give one line per spoken segment. Others (the
  `gpt-*-transcribe` family, today's default) give one line per audio segment
  at its `offset_ms`, so interleaving degrades to segment order.
- **Interleaving** sorts every line by `t_ms`, then `self` before `other`.
  Echo de-duplication is not built yet (capture-engine session).
- **End** sets `finishing`; it becomes `ready` once every seq `0..last_seq`
  has a segment. **Resume** after a stop reopens the same row (`recording`)
  and records the stopped time as a `stopped` gap.
- **Staleness.** A `recording`/`finishing` row with no segment, pause, resume
  or end for 30 minutes is closed on the manager's next read (`ready` with
  segments, `failed` without). A late segment turns `failed` into `ready`.
- **Read-only accounts:** every write is behind the 402 gate, including
  delete. `GET`s stay open.
- **Export and deletion:** all four tables are exported (a report's export
  leaves out their manager's transcripts, like `direct_reports`).
  `delete_my_account()` deletes `call_transcripts` by owner; usage cascades
  from the login. The persona reset script clears all four.

## Analytics

`call_transcription_started`, `call_transcription_ended`,
`call_transcription_allowance_hit`; see `product-analytics.md`.
