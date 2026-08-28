"""
Dictation — talk-to-text into any capture field in the app.

One endpoint, one job: audio in, the manager's own words out. The client
records with MediaRecorder, stops, and POSTs a single blob here. There is no
streaming path, no job queue and no storage; a dictation is a person talking
into a text box for thirty seconds, not a meeting recording.

WHAT THIS IS NOT. It does not save anything. The transcript is returned to the
field the manager was typing in, they can edit it, and the field's own existing
save endpoint is still the only thing that writes to the database. That keeps
dictation entirely outside the draft-then-review boundary rather than
punching a new hole in it: no AI wrote these words, the manager said them.

Retention: none. The audio bytes live in memory for the length of this request
and are never written to Storage, disk, or a log. The UI says so on first use,
so any change here is a change to a promise.

See docs/systems/dictation.md.
"""
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from ai_core import MAX_DICTATION_BYTES, transcribe_audio
from utils import get_authenticated_client, limiter

router = APIRouter()

# Formats OpenAI's transcription endpoint accepts, intersected with what a
# browser will actually hand us from MediaRecorder. Chrome/Firefox/Edge give
# webm/opus; Safari below 18.4 gives mp4/aac and lies about isTypeSupported,
# which is why the client feature-detects inside a try/catch and why both are
# listed here rather than one being assumed.
_ALLOWED_PREFIXES = ("audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "video/webm")

_EXT_BY_PREFIX = {
    "audio/webm": "webm",
    "video/webm": "webm",   # some Chrome builds label an audio-only blob video/webm
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
}


@router.post("")
@limiter.limit("30/minute")
async def transcribe(
    request: Request,
    file: UploadFile = File(...),
    # Optional comma-separated vocabulary hint (direct-report names, team
    # nouns). The client sends what it knows about the surface the mic was
    # used on; see NoteField's `vocabulary` prop.
    vocabulary: str = Form(""),
    auth=Depends(get_authenticated_client),
):
    # Auth is required purely so dictation costs money only for signed-in
    # managers. Nothing here reads or writes a record, so there is no org or
    # ownership check to make.
    user_id, _supabase = auth

    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type and not content_type.startswith(_ALLOWED_PREFIXES):
        raise HTTPException(status_code=415, detail=f"Unsupported audio format: {content_type}")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="Empty recording")
    if len(raw) > MAX_DICTATION_BYTES:
        raise HTTPException(status_code=413, detail="Recording too long — 5 minutes max")

    ext = _EXT_BY_PREFIX.get(content_type, "webm")
    text = transcribe_audio(
        raw,
        filename=f"dictation.{ext}",
        content_type=content_type or "audio/webm",
        vocabulary=vocabulary,
    )
    return {"text": text}
