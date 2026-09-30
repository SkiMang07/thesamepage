"""
Attach a file to a note (upload chunk 1).

  POST /api/files/extract-text
      Reads ONE attached file and returns its plain text, so the browser can put
      it in the field the manager is already writing in (call notes, meeting
      notes). Nothing is saved, nothing goes to a model, nothing is uploaded to
      Storage, and the text is not kept. The manager reads it in their own
      field and the field's existing button is still what saves or drafts.

That keeps this outside draft-then-review on purpose, the same way dictation
is: the words are the manager's own material, not something a model wrote.

Reads .docx, .pdf, .txt and .md through the readers the notes dump already
uses, and caption files (.vtt, .srt) that meeting tools export, with the cue
numbers and timestamps stripped so what is left reads as a transcript.
Audio and video are refused by name: transcribing them is not built.
"""
import logging
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

import analytics
from routes.documents import _MAX_UPLOAD_BYTES
from routes.notes_dump import MIN_FILE_TEXT, read_files, size_bucket
from utils import get_authenticated_client, limiter

logger = logging.getLogger(__name__)
router = APIRouter()

# About an hour of talk is 50-60k characters. This leaves room for a long call
# and still fits the wrap-up prompt.
MAX_CHARS = 120_000
CAPTION_EXTENSIONS = {".vtt", ".srt"}
MEDIA_EXTENSIONS = {".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac", ".mp4", ".mov", ".webm", ".mkv", ".avi"}
KINDS = {"pdf", "docx", "txt", "md", "vtt", "srt"}
SURFACES = {"one_on_one_notes", "team_meeting_notes", "beyond_meeting_notes"}
UNSUPPORTED = "Attach a .docx, .pdf, .txt, .md, .vtt or .srt file, or paste the text"

_TIMING = re.compile(
    r"^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}.*$"
)
_VOICE = re.compile(r"<v(?:\.[^\s>]+)?\s+([^>]+)>")
_TAG = re.compile(r"</?[^>\n]+>")
_SKIP_BLOCKS = ("WEBVTT", "NOTE", "STYLE", "REGION")


def clean_captions(raw: str) -> str:
    """A .vtt or .srt reduced to what was said. Cue numbers, timestamps, header
    and style blocks go. A <v Name> voice tag becomes "Name: ", and runs by the
    same speaker are joined into one line so it reads as a transcript."""
    lines: list[tuple[str | None, str]] = []
    text = raw.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    for block in re.split(r"\n\s*\n", text):
        block_lines = block.split("\n")
        if block_lines and block_lines[0].strip().upper().startswith(_SKIP_BLOCKS):
            continue
        after_timing = False
        for line in block_lines:
            if _TIMING.match(line):
                after_timing = True
                continue
            if not after_timing:
                continue  # a cue number or id before the timing line
            voice = _VOICE.search(line)
            speaker = voice.group(1).strip() if voice else None
            said = _TAG.sub("", line).strip()
            if not said:
                continue
            if lines and lines[-1][1] == said and lines[-1][0] == speaker:
                continue  # rolling captions repeat the last line
            if speaker and lines and lines[-1][0] == speaker:
                lines[-1] = (speaker, f"{lines[-1][1]} {said}")
            else:
                lines.append((speaker, said))
    return "\n".join(f"{s}: {t}" if s else t for s, t in lines)


def _kind(suffix: str) -> str:
    kind = suffix.lstrip(".")
    return kind if kind in KINDS else "other"


@router.post("/extract-text")
@limiter.limit("30/minute")
def extract_text(
    request: Request,
    file: UploadFile = File(...),
    surface: str | None = Form(None),
    auth=Depends(get_authenticated_client),
):
    """One file in, its text out. Nothing is saved and nothing is kept."""
    user_id, _supabase = auth
    if not file or not file.filename:
        raise HTTPException(status_code=422, detail="Attach a file first")
    name = file.filename.replace("\\", "/").rsplit("/", 1)[-1]
    suffix = Path(name).suffix.lower()

    if suffix in MEDIA_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"{name} is an audio or video file, and those can't be read yet. Attach the transcript instead, or paste it.",
        )

    if suffix in CAPTION_EXTENSIONS:
        raw = file.file.read()
        if not raw:
            raise HTTPException(status_code=422, detail=f"{name} is empty")
        if len(raw) > _MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=f"{name} is too large. 25MB limit")
        text = clean_captions(raw.decode("utf-8", errors="replace")).strip()
        if len(text) < MIN_FILE_TEXT:
            raise HTTPException(status_code=422, detail=f"Couldn't read any text in {name}.")
    else:
        try:
            (_name, text), = read_files([file])
        except HTTPException as e:
            if e.status_code == 422 and "Unsupported file type" in str(e.detail):
                raise HTTPException(status_code=422, detail=f"Can't read {name}. {UNSUPPORTED}.")
            raise

    truncated = len(text) > MAX_CHARS
    if truncated:
        text = text[:MAX_CHARS]

    analytics.capture(user_id, "file_text_extracted", {
        "surface": surface if surface in SURFACES else "other",
        "kind": _kind(suffix),
        "size": size_bucket(len(text)),
        "truncated": truncated,
    })
    return {"name": name, "text": text, "chars": len(text), "truncated": truncated}
