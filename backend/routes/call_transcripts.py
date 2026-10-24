"""
Call transcription: the server pipeline (docs/systems/call-transcription.md).

No meeting bot. A capture client on the manager's own computer (the browser
now, a Mac helper later) records a meeting in 3-minute segments, one per
track, and posts each here. The segment is transcribed through
ai_core.transcribe_call_segment(), its text is stored, and the audio is
dropped: the bytes live in memory for one request and are never written to
Storage, disk or a log. Only text is kept.

Speaker labels come from the track, never from voice: `self` is the manager's
microphone, `other` the call tab, `mixed` the mic alone (in person). Nothing
here builds a voiceprint.

Draft-then-review is unaffected: a transcript is evidence. Nothing from it
enters the record until the manager saves a wrap-up that drew on it.

The report can read their own 1:1 transcript, read-only (RLS, through
call_transcript_ids_for_report()). They never see why a gap exists: every
paused, off-the-record or stopped interval reaches them as start/end only.

Allowances: checked at start only, by the tier the database names and the
hours in config.TRANSCRIPTION_ALLOWANCES. A call that crosses 100% partway
through finishes; the next start is refused. Billing is per stored segment,
once, by add_transcription_seconds(), so a retried upload is never billed
twice and deleting a transcript never refunds hours.
"""
import logging
import math
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from postgrest.exceptions import APIError
from pydantic import BaseModel

import analytics
from ai_core import MAX_CALL_SEGMENT_BYTES, transcribe_call_segment
from config import TRANSCRIPTION_ALLOWANCES, settings
from routes.transcribe import _ALLOWED_PREFIXES, _EXT_BY_PREFIX
from utils import get_authenticated_client, get_entitlement, limiter

logger = logging.getLogger(__name__)

router = APIRouter()

SEGMENT_MS = 180_000            # the client rotates its recorder every 3 minutes
BILL_SLACK_MS = 15_000          # a client duration is never billed past segment + 15s
MAX_TRACK_MS = 2 * 60 * 60_000  # 2-hour cap per call, per track
MAX_SEGMENT_DURATION_MS = 600_000
STALE_AFTER = timedelta(minutes=30)
MAX_PAUSE = timedelta(hours=3)            # an open pause keeps a call alive this long, no longer
RESUME_WINDOW = timedelta(minutes=30)     # a stopped call can be resumed this long after it stopped
MAX_SEGMENT_AUDIO_SECONDS = 240           # a 3-minute segment, with slack; longer is refused unstored
TRACKS = ("self", "other", "mixed")
_TRACK_ORDER = {t: i for i, t in enumerate(TRACKS)}

_TRANSCRIPT_COLUMNS = (
    "id, owner_id, one_on_one_id, team_meeting_id, outside_meeting_id, capture_mode, "
    "consent_confirmed_at, started_at, ended_at, ended_at_ms, ended_reason, last_seq, "
    "status, last_activity_at, created_at, expected_seqs"
)


# ── helpers ───────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _next_month(month: date) -> date:
    return date(month.year + (month.month == 12), month.month % 12 + 1, 1)


def _hours(seconds: float) -> float:
    return round(seconds / 3600, 1)


def _meeting_type(row: dict) -> str:
    if row.get("one_on_one_id"):
        return "one_on_one"
    if row.get("team_meeting_id"):
        return "team_meeting"
    return "outside_meeting"


def _api_code(err: APIError) -> Optional[str]:
    return getattr(err, "code", None)


def allowance_for(user_id: str, supabase) -> dict:
    """This manager's allowance and use. The tier comes from the database
    (it reads subscriptions and test_account_patterns); the hours from config."""
    try:
        get_entitlement(user_id, supabase)  # creates the subscriptions row on first use
    except Exception:
        logger.warning("entitlement lookup failed before allowance check", exc_info=True)
    state = supabase.rpc("transcription_allowance_state", {}).execute().data or {}
    tier = state.get("tier") or "none"
    hours, period = TRANSCRIPTION_ALLOWANCES.get(tier, (0, "month"))
    allowed = int(hours * 3600)
    used = int(state.get("month_seconds" if period == "month" else "total_seconds") or 0)
    month = date.fromisoformat(state["month"]) if state.get("month") else _now().date().replace(day=1)
    return {
        "tier": tier,
        "period": period,
        "used_seconds": used,
        "allowed_seconds": allowed,
        "used_hours": _hours(used),
        "allowed_hours": hours,
        "remaining_seconds": max(0, allowed - used),
        "percent": round(100 * used / allowed) if allowed else 100,
        "at_limit": used >= allowed,
        "resets_on": _next_month(month).isoformat() if period == "month" else None,
    }


def _allowance_message(a: dict) -> str:
    if a["allowed_seconds"] == 0:
        return "Call transcription isn't included on this account."
    hours = f"{a['allowed_hours']:g}"
    if a["period"] == "total":
        return f"You've used the {hours} transcription hours in your trial."
    resets = date.fromisoformat(a["resets_on"])
    month = (resets - timedelta(days=1)).strftime("%B")
    return f"You've used your {hours} hours for {month}. Resets {resets.strftime('%B')} 1."


def _load(supabase, transcript_id: str) -> dict:
    rows = (
        supabase.table("call_transcripts").select(_TRANSCRIPT_COLUMNS)
        .eq("id", transcript_id).limit(1).execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Transcript not found")
    return rows[0]


def _load_own(supabase, transcript_id: str, user_id: str) -> dict:
    row = _load(supabase, transcript_id)
    if row["owner_id"] != user_id:
        # The report can read it; only the manager who recorded it can change it.
        raise HTTPException(status_code=403, detail="Only the manager who recorded this can change it")
    return row


def _update(supabase, transcript_id: str, fields: dict) -> dict:
    rows = supabase.table("call_transcripts").update(fields).eq("id", transcript_id).execute().data
    return rows[0] if rows else {}


def _touch(supabase, transcript_id: str, extra: Optional[dict] = None) -> dict:
    return _update(supabase, transcript_id, {"last_activity_at": _now().isoformat(), **(extra or {})})


def _stored(supabase, transcript_id: str) -> set[tuple[str, int]]:
    """Every (track, seq) stored for this transcript."""
    rows = (
        supabase.table("call_transcript_segments").select("seq, track")
        .eq("transcript_id", transcript_id).execute().data or []
    )
    return {(r["track"], r["seq"]) for r in rows}


def _missing(row: dict, stored: set[tuple[str, int]]) -> set[tuple[str, int]]:
    """What End said was sent and isn't stored yet. With expected_seqs (per
    track, from End) every listed (track, seq) must be in: a late `other`
    segment holds the call in finishing even when `self` for that seq landed.
    With only last_seq (an older client), every position 0..last_seq needs at
    least one track, as before."""
    expected = row.get("expected_seqs")
    if isinstance(expected, dict) and expected:
        want = {(track, int(seq)) for track, seqs in expected.items() for seq in (seqs or [])}
        return want - stored
    last_seq = row.get("last_seq")
    if last_seq is None or last_seq < 0:
        return set()
    have = {seq for _, seq in stored}
    return {("*", seq) for seq in range(last_seq + 1) if seq not in have}


def _gaps(supabase, transcript_id: str) -> list[dict]:
    return (
        supabase.table("call_transcript_gaps").select("start_ms, end_ms, kind, created_at")
        .eq("transcript_id", transcript_id).order("start_ms").execute().data or []
    )


def outside_gaps(lines: list[dict], gaps: list[dict]) -> list[dict]:
    """Drop any line whose time falls inside a gap (an open gap runs on).
    The client stops sending audio while paused or off the record; this is
    the server's own guarantee, so audio that slipped through anyway (a
    recorder bug, a segment cut late) never becomes text anyone can read."""
    spans = [(g["start_ms"], g.get("end_ms")) for g in gaps or []]
    if not spans:
        return lines
    return [
        line for line in lines
        if not any(start <= int(line.get("t_ms", 0)) and (end is None or int(line.get("t_ms", 0)) < end)
                   for start, end in spans)
    ]


def _close_if_stale(supabase, row: dict) -> dict:
    """A recording/finishing row with no activity for 30 minutes is closed:
    ready if it has segments, failed if not. An open pause keeps it alive
    (a long interruption is not an abandoned call) for up to 3 hours.
    ended_at is the last activity, not the moment someone looked, so reading
    an old call never reopens its resume window."""
    if row.get("status") not in ("recording", "finishing"):
        return row
    last = _parse_ts(row.get("last_activity_at")) or _parse_ts(row.get("started_at"))
    if last and _now() - last < STALE_AFTER:
        return row
    open_gaps = [g for g in _gaps(supabase, row["id"]) if g.get("end_ms") is None]
    if open_gaps:
        opened = _parse_ts(open_gaps[0].get("created_at"))
        if opened and _now() - opened < MAX_PAUSE:
            return row
    status = "ready" if _stored(supabase, row["id"]) else "failed"
    fields = {"status": status}
    if not row.get("ended_at"):
        fields["ended_at"] = (last or _now()).isoformat()
    return _update(supabase, row["id"], fields) or {**row, **fields}


def _settle(supabase, row: dict) -> dict:
    """finishing -> ready once everything End said was sent is stored."""
    if row.get("status") != "finishing":
        return row
    if _missing(row, _stored(supabase, row["id"])):
        return row
    return _update(supabase, row["id"], {"status": "ready"}) or {**row, "status": "ready"}


def _close_open_gap(supabase, transcript_id: str, at_ms: int) -> bool:
    open_gaps = (
        supabase.table("call_transcript_gaps").select("id, start_ms")
        .eq("transcript_id", transcript_id).is_("end_ms", "null").execute().data or []
    )
    for gap in open_gaps:
        supabase.table("call_transcript_gaps").update(
            {"end_ms": max(at_ms, gap["start_ms"])}
        ).eq("id", gap["id"]).execute()
    return bool(open_gaps)


def _bill(supabase, segment: dict) -> Optional[int]:
    """Bill a stored segment once. Safe to call again for the same segment."""
    if segment.get("billed_at"):
        return None
    return supabase.rpc("add_transcription_seconds", {"p_segment_id": segment["id"]}).execute().data


def billable_seconds(audio_seconds: Optional[float], duration_ms: int) -> int:
    """The vendor's measured duration when it reports one; otherwise the
    client's duration, capped at the segment length + 15s. Never an uncapped
    client number."""
    if audio_seconds is not None and audio_seconds >= 0:
        seconds = math.ceil(audio_seconds)
    else:
        seconds = math.ceil(min(max(duration_ms, 0), SEGMENT_MS + BILL_SLACK_MS) / 1000)
    return max(0, min(seconds, 900))


def interleave(segments: list[dict]) -> list[dict]:
    """All tracks' lines on one timeline. Ties keep the manager's line first."""
    lines = []
    for seg in segments:
        for line in seg.get("lines") or []:
            text = (line or {}).get("text")
            if not text:
                continue
            lines.append({
                "t_ms": int(line.get("t_ms", seg.get("offset_ms", 0))),
                "speaker": seg["track"],
                "text": text,
                "_key": (seg["seq"], _TRACK_ORDER.get(seg["track"], 9)),
            })
    lines.sort(key=lambda l: (l["t_ms"], l["_key"][1], l["_key"][0]))
    for line in lines:
        del line["_key"]
    return lines


def _summary(row: dict, user_id: str) -> dict:
    owner = row["owner_id"] == user_id
    out = {
        "id": row["id"],
        "status": row["status"],
        "meeting_type": _meeting_type(row),
        "one_on_one_id": row.get("one_on_one_id"),
        "team_meeting_id": row.get("team_meeting_id"),
        "outside_meeting_id": row.get("outside_meeting_id"),
        "started_at": row.get("started_at"),
        "ended_at": row.get("ended_at"),
        "label": "machine transcript",
        "viewer": "owner" if owner else "report",
    }
    if owner:
        out.update({
            "capture_mode": row.get("capture_mode"),
            "ended_reason": row.get("ended_reason"),
            "ended_at_ms": row.get("ended_at_ms"),
            "last_seq": row.get("last_seq"),
            "consent_confirmed_at": row.get("consent_confirmed_at"),
        })
    return out


# ── models ────────────────────────────────────────────────────────────────

class StartIn(BaseModel):
    one_on_one_id: Optional[str] = None
    team_meeting_id: Optional[str] = None
    outside_meeting_id: Optional[str] = None
    capture_mode: Literal["tab", "screen", "mic_only", "desktop"]
    consent_confirmed: bool = False


class PauseIn(BaseModel):
    kind: Literal["pause", "off_record"] = "pause"
    at_ms: int


class ResumeIn(BaseModel):
    at_ms: int


class EndIn(BaseModel):
    reason: Literal["manager", "silence", "max_length", "share_ended", "allowance"] = "manager"
    at_ms: Optional[int] = None
    last_seq: Optional[int] = None
    # Every seq the client sent, per track: {"mixed": [0, 1], "self": [2, 3], "other": [2, 3]}.
    # A call tab added mid-call starts at a later seq, and the mic's label
    # changes when it is added, so one last_seq can't say what to wait for.
    seqs_by_track: Optional[dict[Literal["self", "other", "mixed"], list[int]]] = None


class ConsentIn(BaseModel):
    direct_report_id: Optional[str] = None
    outside_person_id: Optional[str] = None
    consented: bool


# ── routes (fixed paths before /{transcript_id}) ──────────────────────────

@router.get("/usage")
def usage(auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    return allowance_for(user_id, supabase)


@router.put("/consent")
@limiter.limit("30/minute")
def set_consent(request: Request, body: ConsentIn, auth=Depends(get_authenticated_client)):
    """Per-person consent: ticked once (the date is kept on later ticks),
    cleared from the person's page."""
    user_id, supabase = auth
    if bool(body.direct_report_id) == bool(body.outside_person_id):
        raise HTTPException(status_code=422, detail="Name one person")
    table, key, owner_col, pid = (
        ("direct_reports", "id", "manager_id", body.direct_report_id) if body.direct_report_id
        else ("outside_people", "id", "owner_id", body.outside_person_id)
    )
    rows = (
        supabase.table(table).select("id, transcription_consent_at")
        .eq(key, pid).eq(owner_col, user_id).limit(1).execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Person not found")
    current = rows[0].get("transcription_consent_at")
    if body.consented and current:
        return {"transcription_consent_at": current}
    value = _now().isoformat() if body.consented else None
    supabase.table(table).update({"transcription_consent_at": value}).eq(key, pid).eq(owner_col, user_id).execute()
    return {"transcription_consent_at": value}


@router.get("")
def list_transcripts(
    one_on_one_id: Optional[str] = None,
    team_meeting_id: Optional[str] = None,
    outside_meeting_id: Optional[str] = None,
    status: Optional[str] = None,
    auth=Depends(get_authenticated_client),
):
    """The caller's transcripts (RLS: their own, plus a report's own 1:1s),
    newest first, optionally for one meeting or one status ("recording" finds
    a call still running after a reload)."""
    user_id, supabase = auth
    query = supabase.table("call_transcripts").select(_TRANSCRIPT_COLUMNS)
    for col, value in (("one_on_one_id", one_on_one_id), ("team_meeting_id", team_meeting_id),
                       ("outside_meeting_id", outside_meeting_id)):
        if value:
            query = query.eq(col, value)
    rows = query.order("created_at", desc=True).order("id").limit(50).execute().data or []
    rows = [_close_if_stale(supabase, r) if r["owner_id"] == user_id else r for r in rows]
    if status:
        rows = [r for r in rows if r.get("status") == status]
    return {"transcripts": [_summary(r, user_id) for r in rows]}


@router.post("")
@limiter.limit("10/minute")
def start(request: Request, body: StartIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth
    links = {k: v for k, v in (("one_on_one_id", body.one_on_one_id),
                               ("team_meeting_id", body.team_meeting_id),
                               ("outside_meeting_id", body.outside_meeting_id)) if v}
    if len(links) != 1:
        raise HTTPException(status_code=422, detail="Start a transcript for exactly one meeting")
    if not body.consent_confirmed:
        raise HTTPException(status_code=422, detail="Confirm the other person knows the call is transcribed")
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="Call transcription isn't available right now")

    (link, meeting_id), = links.items()
    table, owner_col, cols = {
        "one_on_one_id": ("one_on_ones", "manager_id", "id, org_id, direct_report_id"),
        "team_meeting_id": ("team_meetings", "manager_id", "id"),
        "outside_meeting_id": ("outside_meetings", "owner_id", "id, org_id"),
    }[link]
    meeting = (
        supabase.table(table).select(cols).eq("id", meeting_id).eq(owner_col, user_id)
        .limit(1).execute().data
    )
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    meeting = meeting[0]

    allowance = allowance_for(user_id, supabase)
    if allowance["at_limit"]:
        analytics.capture(user_id, "call_transcription_allowance_hit", {"plan_state": allowance["tier"]})
        raise HTTPException(status_code=403, detail={
            "code": "allowance_reached",
            "message": _allowance_message(allowance),
            "resets_on": allowance["resets_on"],
            "allowed_hours": allowance["allowed_hours"],
            "tier": allowance["tier"],
        })

    running = (
        supabase.table("call_transcripts").select(_TRANSCRIPT_COLUMNS)
        .eq("owner_id", user_id).eq("status", "recording").execute().data or []
    )
    for row in running:
        if _close_if_stale(supabase, row).get("status") == "recording":
            raise HTTPException(status_code=409, detail={
                "code": "already_recording", "id": row["id"],
                "message": "Another call is still being transcribed.",
            })

    now = _now().isoformat()
    try:
        created = supabase.table("call_transcripts").insert({
            "owner_id": user_id,
            "org_id": meeting.get("org_id"),
            link: meeting_id,
            "capture_mode": body.capture_mode,
            "consent_confirmed_at": now,
            "started_at": now,
            "last_activity_at": now,
        }).execute().data
    except APIError as err:
        if _api_code(err) == "23505":
            raise HTTPException(status_code=409, detail={
                "code": "already_recording", "message": "Another call is still being transcribed.",
            })
        raise

    # Ticked once in the Meet picker: stamp the person the first time.
    if link == "one_on_one_id" and meeting.get("direct_report_id"):
        try:
            supabase.table("direct_reports").update({"transcription_consent_at": now}) \
                .eq("id", meeting["direct_report_id"]).eq("manager_id", user_id) \
                .is_("transcription_consent_at", "null").execute()
        except Exception:
            logger.warning("could not stamp per-person transcription consent", exc_info=True)

    row = created[0]
    analytics.capture(user_id, "call_transcription_started", {
        "capture_mode": body.capture_mode, "meeting_type": _meeting_type(row),
    })
    return {"transcript": _summary(row, user_id), "allowance": allowance}


@router.post("/{transcript_id}/segments")
@limiter.limit("30/minute")  # two tracks every 3 minutes, plus a queue flushing after an outage
def upload_segment(
    request: Request,
    transcript_id: str,
    file: UploadFile = File(...),
    seq: int = Form(...),
    track: str = Form(...),
    offset_ms: int = Form(...),
    duration_ms: int = Form(...),
    vocabulary: str = Form(""),
    auth=Depends(get_authenticated_client),
):
    user_id, supabase = auth
    if track not in TRACKS:
        raise HTTPException(status_code=422, detail="track must be self, other or mixed")
    if seq < 0 or offset_ms < 0 or not 0 < duration_ms <= MAX_SEGMENT_DURATION_MS:
        raise HTTPException(status_code=422, detail="Invalid segment position")
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type and not content_type.startswith(_ALLOWED_PREFIXES):
        raise HTTPException(status_code=415, detail=f"Unsupported audio format: {content_type}")

    row = _load_own(supabase, transcript_id, user_id)

    def stored():
        found = (
            supabase.table("call_transcript_segments")
            .select("id, seq, track, offset_ms, duration_ms, lines, billed_seconds, billed_at")
            .eq("transcript_id", transcript_id).eq("seq", seq).eq("track", track)
            .limit(1).execute().data
        )
        return found[0] if found else None

    def reply(segment: dict, duplicate: bool) -> dict:
        _bill(supabase, segment)  # a no-op once billed: retries are never billed twice
        current = _load(supabase, transcript_id)
        if current.get("status") == "failed":
            current = _update(supabase, transcript_id, {"status": "ready"}) or current
        current = _settle(supabase, current)
        return {
            "duplicate": duplicate,
            "segment": {
                "seq": segment["seq"], "track": segment["track"],
                "offset_ms": segment["offset_ms"], "duration_ms": segment["duration_ms"],
                "line_count": len(segment.get("lines") or []),
            },
            "status": current.get("status"),
        }

    existing = stored()
    if existing:
        return reply(existing, duplicate=True)

    used_ms = sum(
        r["duration_ms"] for r in (
            supabase.table("call_transcript_segments").select("duration_ms")
            .eq("transcript_id", transcript_id).eq("track", track).execute().data or []
        )
    )
    if used_ms >= MAX_TRACK_MS:
        raise HTTPException(status_code=409, detail={
            "code": "max_length", "message": "Calls are transcribed for up to 2 hours.",
        })

    raw = file.file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="Empty segment")
    if len(raw) > MAX_CALL_SEGMENT_BYTES:
        raise HTTPException(status_code=413, detail="Segment too large")

    ext = _EXT_BY_PREFIX.get(content_type, "webm")
    result = transcribe_call_segment(
        raw, offset_ms,
        filename=f"segment.{ext}",
        content_type=content_type or "audio/webm",
        vocabulary=vocabulary,
    )
    del raw  # the audio goes no further than this request

    audio_seconds = result.get("audio_seconds")
    if audio_seconds is not None and audio_seconds > MAX_SEGMENT_AUDIO_SECONDS:
        # A real segment is 3 minutes. Longer is a client that isn't rotating,
        # or one trying to get more transcribed than it is billed for.
        logger.warning("call_segment_too_long", extra={"fields": {
            "transcript_id": transcript_id, "seq": seq, "track": track, "audio_seconds": audio_seconds,
        }})
        raise HTTPException(status_code=413, detail={
            "code": "segment_too_long", "message": "Segments are at most 4 minutes long.",
        })
    lines = outside_gaps(result["lines"], _gaps(supabase, transcript_id))

    try:
        inserted = supabase.table("call_transcript_segments").insert({
            "transcript_id": transcript_id,
            "owner_id": user_id,
            "seq": seq,
            "track": track,
            "offset_ms": offset_ms,
            "duration_ms": duration_ms,
            "lines": lines,
            "billed_seconds": billable_seconds(audio_seconds, duration_ms),
        }).execute().data
    except APIError as err:
        if _api_code(err) == "23505":  # a concurrent retry stored it first
            winner = stored()
            if winner:
                return reply(winner, duplicate=True)
        raise

    _touch(supabase, transcript_id)
    logger.info("call_segment_stored", extra={"fields": {
        "transcript_id": transcript_id, "seq": seq, "track": track,
        "lines": len(lines), "dropped_in_gaps": len(result["lines"]) - len(lines),
        "status_before": row.get("status"),
    }})
    return reply(inserted[0], duplicate=False)


@router.post("/{transcript_id}/pause")
@limiter.limit("30/minute")
def pause(request: Request, transcript_id: str, body: PauseIn, auth=Depends(get_authenticated_client)):
    """Pause or go off the record. Neither is transcribed; the client stops
    sending audio until resume. Notes typed while off the record are the
    client's to keep apart from the wrap-up."""
    user_id, supabase = auth
    row = _load_own(supabase, transcript_id, user_id)
    if row["status"] != "recording":
        raise HTTPException(status_code=409, detail="This call isn't being transcribed")
    if body.at_ms < 0:
        raise HTTPException(status_code=422, detail="at_ms must not be negative")
    try:
        supabase.table("call_transcript_gaps").insert({
            "transcript_id": transcript_id, "owner_id": user_id,
            "kind": body.kind, "start_ms": body.at_ms,
        }).execute()
    except APIError as err:
        if _api_code(err) == "23505":
            raise HTTPException(status_code=409, detail="Already paused")
        raise
    return {"transcript": _summary(_touch(supabase, transcript_id) or row, user_id)}


@router.post("/{transcript_id}/resume")
@limiter.limit("30/minute")
def resume(request: Request, transcript_id: str, body: ResumeIn, auth=Depends(get_authenticated_client)):
    """Resume after a pause, or after a stop ("Back to the 1:1", or Resume
    after an auto-stop). A stopped call continues the same row: status back
    to recording, and the stopped time recorded as a gap."""
    user_id, supabase = auth
    row = _load_own(supabase, transcript_id, user_id)
    if body.at_ms < 0:
        raise HTTPException(status_code=422, detail="at_ms must not be negative")

    if row["status"] != "recording":
        stopped = _parse_ts(row.get("ended_at")) or _parse_ts(row.get("last_activity_at"))
        if not stopped or _now() - stopped > RESUME_WINDOW:
            # Resume skips the allowance check, so it only continues a call
            # that just stopped. Anything older is a new start.
            raise HTTPException(status_code=409, detail={
                "code": "resume_window_passed",
                "message": "This call stopped more than 30 minutes ago. End the 1:1, or start a new one.",
            })

    _close_open_gap(supabase, transcript_id, body.at_ms)
    if row["status"] == "recording":
        return {"transcript": _summary(_touch(supabase, transcript_id) or row, user_id)}

    stopped_at = row.get("ended_at_ms")
    if stopped_at is None or stopped_at > body.at_ms:
        stopped_at = body.at_ms
    try:
        reopened = _touch(supabase, transcript_id, {
            "status": "recording", "ended_at": None, "last_seq": None, "expected_seqs": None,
        })
    except APIError as err:
        if _api_code(err) == "23505":
            raise HTTPException(status_code=409, detail={
                "code": "already_recording", "message": "Another call is still being transcribed.",
            })
        raise
    if body.at_ms > stopped_at:
        supabase.table("call_transcript_gaps").insert({
            "transcript_id": transcript_id, "owner_id": user_id,
            "kind": "stopped", "start_ms": stopped_at, "end_ms": body.at_ms,
        }).execute()
    return {"transcript": _summary(reopened or row, user_id)}


@router.post("/{transcript_id}/end")
@limiter.limit("30/minute")
def end(request: Request, transcript_id: str, body: EndIn, auth=Depends(get_authenticated_client)):
    """Stop transcribing. finishing until every segment up to last_seq is in,
    then ready."""
    user_id, supabase = auth
    row = _load_own(supabase, transcript_id, user_id)
    if row["status"] != "recording":
        return {"transcript": _summary(_settle(supabase, row), user_id)}
    if body.at_ms is not None:
        if body.at_ms < 0:
            raise HTTPException(status_code=422, detail="at_ms must not be negative")
        _close_open_gap(supabase, transcript_id, body.at_ms)
    if body.last_seq is not None and body.last_seq < -1:
        raise HTTPException(status_code=422, detail="last_seq must be -1 or more")
    expected_seqs = None
    if body.seqs_by_track is not None:
        expected_seqs = {}
        for track, seqs in body.seqs_by_track.items():
            if len(seqs) > 1000 or any(s < 0 for s in seqs):
                raise HTTPException(status_code=422, detail="Invalid seqs_by_track")
            expected_seqs[track] = sorted(set(seqs))
    last_seq = body.last_seq
    if last_seq is None and expected_seqs:
        last_seq = max((max(v) for v in expected_seqs.values() if v), default=-1)

    ended = _touch(supabase, transcript_id, {
        "status": "finishing",
        "ended_at": _now().isoformat(),
        "ended_at_ms": body.at_ms,
        "ended_reason": body.reason,
        "last_seq": last_seq,
        "expected_seqs": expected_seqs,
    }) or row
    merged = {**row, **ended, "last_seq": last_seq, "expected_seqs": expected_seqs}
    settled = _settle(supabase, merged)

    missing = _missing(merged, _stored(supabase, transcript_id))
    started = _parse_ts(row.get("started_at"))
    minutes = (_now() - started).total_seconds() / 60 if started else 0
    analytics.capture(user_id, "call_transcription_ended", {
        "ended_reason": body.reason,
        "minutes_bucket": "<15" if minutes < 15 else "15-30" if minutes < 30 else "30-60" if minutes < 60 else "60+",
        "segments_failed": len(missing),
    })
    return {"transcript": _summary(settled, user_id)}


@router.get("/{transcript_id}")
def get_transcript(transcript_id: str, auth=Depends(get_authenticated_client)):
    """Status plus the interleaved lines. The manager also gets each gap's
    kind; the report gets gaps as start/end only."""
    user_id, supabase = auth
    row = _load(supabase, transcript_id)
    owner = row["owner_id"] == user_id
    if owner:
        row = _close_if_stale(supabase, row)

    segments = (
        supabase.table("call_transcript_segments").select("seq, track, offset_ms, lines")
        .eq("transcript_id", transcript_id).order("seq").order("track").execute().data or []
    )
    if owner:
        gaps = [
            {"start_ms": g["start_ms"], "end_ms": g.get("end_ms"), "kind": g["kind"]}
            for g in _gaps(supabase, transcript_id)
        ]
    else:
        raw = supabase.rpc("call_transcript_report_gaps", {"p_transcript_id": transcript_id}).execute().data or []
        # Built field by field: whatever the function returns, kind never leaves.
        gaps = [{"start_ms": g["start_ms"], "end_ms": g.get("end_ms")} for g in raw]

    return {
        **_summary(row, user_id),
        "segment_count": len(segments),
        "lines": outside_gaps(interleave(segments), gaps),
        "gaps": gaps,
    }


@router.delete("/{transcript_id}")
@limiter.limit("30/minute")
def delete_transcript(request: Request, transcript_id: str, auth=Depends(get_authenticated_client)):
    """The manager deletes a transcript at any time. Segments and gaps go with
    it; the hours it used stay used."""
    user_id, supabase = auth
    _load_own(supabase, transcript_id, user_id)
    supabase.table("call_transcripts").delete().eq("id", transcript_id).eq("owner_id", user_id).execute()
    return {"deleted": True}
