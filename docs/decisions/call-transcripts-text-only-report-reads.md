# Call transcripts: text only, the report reads theirs, gaps stay neutral

**Status:** Accepted 2026-10-23 (Andrew). Implemented for 1:1s: server
pipeline and review fixes 2026-10-23, capture engine and meeting screen
2026-10-24, wrap-up and the report's read-only view 2026-10-24. Team and
Beyond meetings not yet built.

## Context

The Same Page records 1:1s with no meeting bot: audio is captured on the
manager's computer and transcribed. That creates a new kind of record about
two people, and a new boundary. Until now `one_on_ones.notes` was the writing
manager's alone, and nothing a manager recorded about a 1:1 reached the report.

## Decision

- **Only text is kept.** Audio is sent to the transcription vendor and dropped
  in the same request; never Storage, disk or a log. Transcript text is never
  logged either.
- **The report can read their own 1:1 transcript, read-only, from day one**,
  wherever they have a login, with no notification, **once the call has
  ended** (review fix, 2026-10-23: never while it's being transcribed). RLS grants it through the
  SECURITY DEFINER `call_transcript_ids_for_report()`; there is no cross-manager
  read and no access to team or Beyond transcripts.
- **Gaps are neutral to the report.** Paused, off-the-record and stopped time
  all reach them as start/end only. `kind` lives in `call_transcript_gaps`, a
  table the report cannot read, and `call_transcript_report_gaps()` has no
  kind column.
- **Speaker labels come from the track, never from voice.** No voiceprint is
  built, which keeps Illinois's biometric law (BIPA) out of scope.
- **Usage is a ledger, not a property of the transcript.** Deleting a
  transcript never refunds hours; only `add_transcription_seconds()` writes it.
  It counts meeting time: each 3-minute slot bills once, at its longest
  track (review fix, 2026-10-23), so adding the other side of a call never
  halves the allowance.
- **Nothing said in a gap becomes text** (review fix, 2026-10-23). The server
  drops lines inside a pause or off-the-record gap, on upload and on read, so
  off the record doesn't rest on the browser alone.
- **Deleting is never behind the paywall** (review fix, 2026-10-23). A
  read-only account can still delete a transcript and withdraw consent.

## Rejected alternatives

- **Gaps as jsonb on `call_transcripts`.** The report can read that row, so
  hiding `kind` would rest on every query remembering to strip it.
- **Report access later, behind a share action.** Andrew chose transparency
  from day one: the transcript is of a conversation the report was in.
- **Keeping audio for re-transcription.** A larger privacy promise to keep,
  and against the dictation precedent of transcribe-and-drop.
- **Voice-based speaker separation.** Biometric exposure for a problem the
  track already solves in remote 1:1s.

## Consequences

- `one_on_ones.notes` is no longer the only manager-written record of a 1:1;
  the privacy boundary in ENGINEERING.md lists transcripts separately.
- Off-the-record notes must never enter the transcript or the wrap-up prompt
  (meeting-screen and wrap-up sessions).
- Counsel reviews consent and report access before launch.

## Reopen if

Counsel advises against report access or the consent model, a vendor can't
guarantee no retention, or managers stop transcribing because the report can
read it.
