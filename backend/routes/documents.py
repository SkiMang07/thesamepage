"""
Context Engine — Session II: extraction + Librarian pipeline (backend only,
no frontend UI this session — see docs/CONTEXT_ENGINE_BUILD_PLAN.md).

One endpoint does the whole pipeline synchronously (build-plan resolution
#4 — immediate processing, no batching, no cost cap):
  1. Accept a PPTX/PDF/plain-text upload.
  2. PPTX is converted to PDF via headless LibreOffice first (resolution
     #1) — see backend/nixpacks.toml for the Railway apt package this
     requires in production.
  3. The raw file is uploaded to the `context-engine-docs` Storage bucket
     at Session I's path convention: {org_id}/{document_id}/{filename}.
  4. A `documents` row is created with status='processing'.
  5. A single structured Librarian call (`generate_text_from_document()`
     for PPTX/PDF, `generate_text()` with the text inlined for .txt)
     extracts full text and proposes category / scope / freshness_class /
     effective_date / summary_card / novelty_score / series in one shot —
     one Librarian judgment per upload (resolution #3, per-document not
     per-category-question).
  6. The row is updated to status='pending_review' with those fields
     filled in. `confirmed_at` stays null — Session III's confirm-card is
     what a user reviewing this proposal writes back to.

Series detection (build-plan Session II spec) is folded into the same
Librarian call rather than a second pass: the prompt is given the org's
existing `document_series` names/cadences and asked to either match one or
propose a new one; `_resolve_series()` below does the lookup-or-create.

Scope (`document_scopes`) is deliberately NOT set here — the framework doc
and build plan put scope confirmation in the Librarian's confirm-card
(Session III, user-confirmed), not as an AI-only proposal on upload. A doc
with no `document_scopes` row is invisible to Session IV's cascade until a
scope is added.

Out of scope for this session (see build plan): the confirm-card UX itself
(Session III), retrieval (Session IV), and citation writes (also Session
IV) all come later. GET "" below is a minimal list endpoint added for
manual verification of this pipeline — not a review queue.

--------------------------------------------------------------------------
Session III addition (2026-08-12, same day): PUT /{id}/confirm and
DELETE /{id}, backing the confirm-card UX (frontend lives in
frontend/app/app/context/page.tsx). Confirming is the only place
`document_scopes` gets written (per the framework doc, scope is
user-confirmed, not an AI-only proposal) and the only place
`confirmed_as_is`/`correction_log` get set — see
database/migrations/2026-08-12_context_engine_confirm.sql for the two new
columns that capture the "log corrections distinctly from confirms-as-is"
requirement (a training signal, not wired to anything downstream yet).
--------------------------------------------------------------------------
Session V addition (2026-08-12, same day): GET /coverage, backing the Brain
visualization (frontend: app/context/page.tsx's new "The Brain" section).
Thin route — all the actual scoring logic (decay, fill, gap questions,
citation rollup) lives in context_engine.py's compute_category_coverage(),
alongside Session IV's retrieval helper, since both are "how much should we
trust/weight this document" logic. See that module's docstring.
--------------------------------------------------------------------------
"""
import base64
import json
import subprocess
import tempfile
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel

import context_engine
from ai_core import generate_text, generate_text_from_document
from config import AI_DEFAULT_MODEL_HEAVY
from utils import ensure_org, get_authenticated_client, get_email_from_token, limiter

router = APIRouter()

_CATEGORIES = (
    "where_we_are_going",
    "who_we_are_and_how_we_operate",
    "who_we_serve",
    "what_we_offer",
    "how_people_grow_here",
)
_FRESHNESS_CLASSES = ("evergreen", "dated", "stream_instance")

_PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
_PDF_MIME = "application/pdf"
_TEXT_EXTENSIONS = {".txt", ".md"}
_STORAGE_BUCKET = "context-engine-docs"

# Raw file size ceiling — the pipeline is synchronous and feeds the whole
# document into one AI call, so an unbounded upload would just turn into a
# slow request or a rejected AI call. 25MB comfortably covers a large deck.
_MAX_UPLOAD_BYTES = 25 * 1024 * 1024


# ---------------------------------------------------------------------------
# File-type handling
# ---------------------------------------------------------------------------

def _infer_file_type(filename: str, content_type: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix == ".pptx" or content_type == _PPTX_MIME:
        return "pptx"
    if suffix == ".pdf" or content_type == _PDF_MIME:
        return "pdf"
    if suffix in _TEXT_EXTENSIONS or (content_type or "").startswith("text/"):
        return "text"
    raise HTTPException(
        status_code=422, detail="Unsupported file type — upload a .pptx, .pdf, or .txt/.md file"
    )


def _convert_pptx_to_pdf(pptx_bytes: bytes) -> bytes:
    """Headless LibreOffice conversion (build-plan resolution #1). Requires
    the `libreoffice` binary on PATH — see backend/nixpacks.toml. Raises a
    502 if the binary is missing or conversion fails; the caller marks the
    document row status='failed'."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        input_path = tmp_path / "input.pptx"
        input_path.write_bytes(pptx_bytes)
        try:
            subprocess.run(
                [
                    "libreoffice",
                    "--headless",
                    "--norestore",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    str(tmp_path),
                    str(input_path),
                ],
                check=True,
                capture_output=True,
                timeout=120,
            )
        except FileNotFoundError:
            raise HTTPException(
                status_code=502,
                detail="PPTX conversion is unavailable on this server (libreoffice not installed)",
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            raise HTTPException(status_code=502, detail=f"PPTX-to-PDF conversion failed: {e}")

        output_path = tmp_path / "input.pdf"
        if not output_path.exists():
            raise HTTPException(status_code=502, detail="PPTX-to-PDF conversion produced no output file")
        return output_path.read_bytes()


# ---------------------------------------------------------------------------
# Librarian extraction call
# ---------------------------------------------------------------------------

def _build_extraction_prompt(existing_series: list[dict], embedded_text: str | None = None) -> str:
    series_lines = (
        "\n".join(f"- {s['name']} (cadence: {s.get('cadence') or 'unspecified'})" for s in existing_series)
        or "(none yet — this would be the first)"
    )

    document_section = (
        f"""The document's full text follows, delimited by triple dashes — this is a plain-text
upload, not a deck/PDF, so there is nothing else to read:
---
{embedded_text}
---"""
        if embedded_text is not None
        else "Read the attached document (a PDF, possibly converted from a slide deck) in full."
    )

    return f"""You are the Librarian, the resident context-curation agent for The Same Page, a
management operating system. A manager just uploaded a document to their team's Context Engine —
your job is to read it and propose how it should be filed. You curate; you do not give advice.

{document_section}

Respond with ONLY a single JSON object (no markdown code fences, no commentary before or after) with
exactly these keys:

{{
  "extracted_text": "the document's full text content, transcribed as faithfully and completely as
    you can — this is what future retrieval will search, so completeness matters more than brevity.
    For a plain-text upload, this can simply be the text you were given, lightly cleaned up.",
  "category": "one of: where_we_are_going, who_we_are_and_how_we_operate, who_we_serve,
    what_we_offer, how_people_grow_here — pick the single best fit",
  "freshness_class": "one of: evergreen (timeless — values, charters), dated (true as of a specific
    point but not perishable — an annual plan), stream_instance (a dated, perishable update — a town
    hall deck, a monthly report)",
  "effective_date": "YYYY-MM-DD — when the content is/was true, inferred from the document's own
    content (a date on a title slide, a quarter or month reference, etc.). null if you genuinely
    cannot infer one — do not guess the upload date.",
  "summary_card": "2-4 sentences, in your own first-person voice as the Librarian, summarizing what
    this document tells the team and why it matters. This is the trust moment — the manager reads
    this to confirm you actually understood their document.",
  "novelty_score": integer 0-100 — how much CURRENT, SUBSTANTIVE information this document actually
    adds. A generic template, boilerplate, or a near-duplicate of something already known scores low.
    A specific, current, information-dense document scores high. Be honest, not generous — junk
    uploads should not move the org's context coverage.,
  "series_name": "if this looks like an instance of a recurring document (a town hall, a
    monthly/quarterly update), the series it belongs to. Match one of the existing series listed
    below by name/topic if it clearly fits — reuse that exact name. Otherwise propose a short new
    series name. null if this is not a recurring document.",
  "series_cadence": "only set if series_name is a NEW series (does not match one listed below) — your
    best guess at cadence, e.g. 'monthly', 'quarterly', 'weekly'. null otherwise, including when
    series_name matches an existing series (its cadence is already known)."
}}

Existing document series in this org (match against these before proposing a new one):
{series_lines}

Categories are about what QUESTION the document answers, never its document type (deck vs. memo vs.
PDF is not the axis):
- where_we_are_going: what is this team trying to achieve, and why (strategy, vision, OKRs, roadmap)
- who_we_are_and_how_we_operate: what does this team believe and how does it run (values, norms,
  charter, operating cadence)
- who_we_serve: who is this work for, what do they need (personas, segments, key accounts,
  voice-of-customer)
- what_we_offer: what does this team sell or deliver, on what terms (pricing, product, service
  catalog, SLAs)
- how_people_grow_here: what does progression look like on this team (career frameworks, leveling,
  promotion criteria)

Return ONLY the JSON object — no ```json fences, no leading/trailing text."""


def _parse_librarian_response(raw: str) -> dict:
    raw_clean = raw.strip()
    if raw_clean.startswith("```"):
        start = raw_clean.find("{")
        end = raw_clean.rfind("}") + 1
        raw_clean = raw_clean[start:end] if start != -1 else raw_clean
    try:
        parsed = json.loads(raw_clean)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Librarian response was not valid JSON: {e}")
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="Librarian response was not a JSON object")
    return parsed


def _clamp_novelty(value) -> int | None:
    try:
        score = int(value)
    except (TypeError, ValueError):
        return None
    return max(0, min(100, score))


def _resolve_series(supabase, org_id: str, existing_series: list[dict], series_name, series_cadence) -> str | None:
    """Match the Librarian's proposed series name against existing
    document_series (case-insensitive exact match); create a new one if it
    looks recurring but nothing matches. None if the doc isn't recurring."""
    if not series_name or not isinstance(series_name, str) or not series_name.strip():
        return None
    series_name = series_name.strip()

    for s in existing_series:
        if s["name"].strip().lower() == series_name.lower():
            return s["id"]

    result = (
        supabase.table("document_series")
        .insert({
            "org_id": org_id,
            "name": series_name,
            "cadence": series_cadence.strip() if isinstance(series_cadence, str) and series_cadence.strip() else None,
        })
        .execute()
    )
    return result.data[0]["id"] if result.data else None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/coverage")
async def get_coverage(auth=Depends(get_authenticated_client), authorization: str = Header(None)):
    """The Brain's data source (Session V) — per-category fill/decay/gap/
    citation/staleness data for app/context/page.tsx's coverage
    visualization, plus (Session VI) cross-category-pair conflict flags.
    Org-wide (not org_unit-scoped like retrieval): the Brain is one coverage
    map per org, matching the framework doc's single-Space-per-org framing,
    not a per-team view. See context_engine.compute_category_coverage() and
    .find_scope_conflicts() for the actual scoring/detection.

    Response shape changed this session: was a bare list of categories
    (Session V), now {"categories": [...], "conflicts": [...]} — conflicts
    span categories pairwise so they don't belong nested under any single
    one. Frontend (lib/api.ts's getContextCoverage(), context/page.tsx)
    updated to match in the same session.
    """
    user_id, supabase = auth
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    today = date.today()
    return {
        "categories": context_engine.compute_category_coverage(supabase, org_id, today),
        "conflicts": context_engine.find_scope_conflicts(supabase, org_id),
    }


@router.get("")
async def list_documents(status: str | None = None, auth=Depends(get_authenticated_client)):
    """Minimal list endpoint for verifying the pipeline manually — NOT the
    Session III review queue. RLS scopes to the caller's own org."""
    user_id, supabase = auth
    query = supabase.table("documents").select(
        "id,title,file_type,status,category,freshness_class,effective_date,"
        "summary_card,novelty_score,series_id,confirmed_at,created_at"
    )
    if status:
        query = query.eq("status", status)
    return query.order("created_at", desc=True).execute().data


@router.post("/upload")
@limiter.limit("10/minute")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    title: str | None = Form(None),
    auth=Depends(get_authenticated_client),
    authorization: str = Header(None),
):
    user_id, supabase = auth
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))

    original_filename = Path(file.filename or "upload").name  # strip any path components
    file_type = _infer_file_type(original_filename, file.content_type)

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")
    if len(raw_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large — 25MB limit")

    doc_title = (title or "").strip() or Path(original_filename).stem or "Untitled document"
    document_id = str(uuid.uuid4())
    storage_path = f"{org_id}/{document_id}/{original_filename}"

    # Upload the raw file to Storage first, through the caller's own
    # RLS-scoped client (never service-role — same rule as every other
    # write in this app; storage.objects' insert policy checks
    # (storage.foldername(name))[1] = current_org_id()).
    try:
        supabase.storage.from_(_STORAGE_BUCKET).upload(
            storage_path,
            raw_bytes,
            {"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Storage upload failed: {e}")

    # Create the documents row up front (status='processing') so a failure
    # partway through extraction leaves an auditable row instead of an
    # orphaned Storage object with no trace in the database.
    insert_result = (
        supabase.table("documents")
        .insert({
            "id": document_id,
            "org_id": org_id,
            "uploaded_by": user_id,
            "title": doc_title,
            "storage_path": storage_path,
            "file_type": file_type,
            "status": "processing",
        })
        .execute()
    )
    if not insert_result.data:
        raise HTTPException(status_code=500, detail="Failed to create document record")

    existing_series = supabase.table("document_series").select("id,name,cadence").execute().data

    try:
        if file_type == "text":
            embedded_text = raw_bytes.decode("utf-8", errors="replace")
            prompt = _build_extraction_prompt(existing_series, embedded_text=embedded_text)
            raw = generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=3000)
        else:
            pdf_bytes = _convert_pptx_to_pdf(raw_bytes) if file_type == "pptx" else raw_bytes
            document_b64 = base64.b64encode(pdf_bytes).decode("ascii")
            prompt = _build_extraction_prompt(existing_series)
            raw = generate_text_from_document(
                prompt, document_b64, media_type="application/pdf",
                model=AI_DEFAULT_MODEL_HEAVY, max_tokens=4000,
            )
        parsed = _parse_librarian_response(raw)
    except HTTPException:
        supabase.table("documents").update({"status": "failed"}).eq("id", document_id).execute()
        raise
    except Exception as e:
        supabase.table("documents").update({"status": "failed"}).eq("id", document_id).execute()
        raise HTTPException(status_code=502, detail=f"Extraction failed: {e}")

    series_id = _resolve_series(
        supabase, org_id, existing_series, parsed.get("series_name"), parsed.get("series_cadence")
    )

    category = parsed.get("category")
    freshness_class = parsed.get("freshness_class")
    effective_date = parsed.get("effective_date")

    update_payload = {
        "status": "pending_review",
        "category": category if category in _CATEGORIES else None,
        "freshness_class": freshness_class if freshness_class in _FRESHNESS_CLASSES else None,
        "effective_date": effective_date if isinstance(effective_date, str) and effective_date else None,
        "summary_card": parsed.get("summary_card") if isinstance(parsed.get("summary_card"), str) else None,
        "extracted_text": parsed.get("extracted_text") if isinstance(parsed.get("extracted_text"), str) else None,
        "novelty_score": _clamp_novelty(parsed.get("novelty_score")),
        "series_id": series_id,
    }

    updated = supabase.table("documents").update(update_payload).eq("id", document_id).execute()
    if not updated.data:
        raise HTTPException(status_code=500, detail="Failed to save extraction results")
    return updated.data[0]


# ---------------------------------------------------------------------------
# Session III — confirm-card support
# ---------------------------------------------------------------------------

# Fields the Librarian proposes and the confirm-card lets the user correct —
# exactly the set the build plan names ("edit category/scope/freshness/
# effective-date before confirming"). summary_card and extracted_text are
# shown read-only on the card; title isn't a Librarian-proposed field at
# all (it's derived from the filename at upload) so it's not part of this
# comparison either.
_CORRECTABLE_FIELDS = ("category", "freshness_class", "effective_date")


class DocumentConfirmIn(BaseModel):
    category: str
    freshness_class: str
    effective_date: str | None = None
    # Each entry is an org_unit_id, or null for company-wide. At least one
    # required — a confirmed doc with zero scopes would be invisible to
    # Session IV's retrieval cascade, which is a footgun, not a valid state.
    org_unit_ids: list[str | None]


def _validate_category(category: str):
    if category not in _CATEGORIES:
        raise HTTPException(status_code=422, detail=f"category must be one of {_CATEGORIES}")


def _validate_freshness(freshness_class: str):
    if freshness_class not in _FRESHNESS_CLASSES:
        raise HTTPException(status_code=422, detail=f"freshness_class must be one of {_FRESHNESS_CLASSES}")


def _dedupe_scope_ids(org_unit_ids: list) -> list:
    """Preserve order, drop exact duplicates, allow at most one null
    (company-wide) entry — mirrors the two partial unique indexes on
    document_scopes so a bad client payload can't hit an IntegrityError."""
    seen_null = False
    deduped: list = []
    for uid in org_unit_ids:
        if uid is None:
            if not seen_null:
                deduped.append(None)
                seen_null = True
        elif uid not in deduped:
            deduped.append(uid)
    return deduped


def _replace_scopes(supabase, document_id: str, org_unit_ids: list) -> list[dict]:
    """Confirm always sends the full desired scope set, not a delta — clear
    and re-insert rather than diffing. Cheap: a document has at most a
    handful of scopes."""
    supabase.table("document_scopes").delete().eq("document_id", document_id).execute()
    rows = [{"document_id": document_id, "org_unit_id": uid} for uid in org_unit_ids]
    result = supabase.table("document_scopes").insert(rows).execute()
    return result.data


@router.put("/{document_id}/confirm")
async def confirm_document(document_id: str, body: DocumentConfirmIn, auth=Depends(get_authenticated_client)):
    user_id, supabase = auth

    _validate_category(body.category)
    _validate_freshness(body.freshness_class)

    existing = supabase.table("documents").select("*").eq("id", document_id).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Document not found")
    doc = existing[0]
    if doc["status"] != "pending_review":
        raise HTTPException(
            status_code=409,
            detail=f"Document is '{doc['status']}', not ready to confirm (must be 'pending_review')",
        )

    unit_ids = _dedupe_scope_ids(body.org_unit_ids)
    if not unit_ids:
        raise HTTPException(status_code=422, detail="At least one scope is required")

    non_null_ids = [u for u in unit_ids if u is not None]
    if non_null_ids:
        # RLS already scopes org_units to the caller's own org, so a count
        # mismatch here means a foreign/nonexistent id was submitted.
        found = supabase.table("org_units").select("id").in_("id", non_null_ids).execute().data
        if len(found) != len(non_null_ids):
            raise HTTPException(
                status_code=422,
                detail="One or more scopes reference an org unit outside your organization",
            )

    new_values = {
        "category": body.category,
        "freshness_class": body.freshness_class,
        "effective_date": body.effective_date,
    }
    correction_log = {
        field: {"proposed": doc.get(field), "confirmed": new_values[field]}
        for field in _CORRECTABLE_FIELDS
        if doc.get(field) != new_values[field]
    }
    confirmed_as_is = len(correction_log) == 0

    updated = (
        supabase.table("documents")
        .update({
            **new_values,
            "status": "confirmed",
            "confirmed_at": datetime.now(timezone.utc).isoformat(),
            "confirmed_as_is": confirmed_as_is,
            "correction_log": correction_log or None,
        })
        .eq("id", document_id)
        .execute()
    )
    if not updated.data:
        raise HTTPException(status_code=500, detail="Failed to confirm document")

    scopes = _replace_scopes(supabase, document_id, unit_ids)
    return {**updated.data[0], "scopes": scopes}


@router.delete("/{document_id}")
async def delete_document(document_id: str, auth=Depends(get_authenticated_client)):
    """Discard a document — any status (a bad extraction stuck in
    'pending_review', a 'failed' upload, or a 'confirmed' doc the manager
    no longer wants). Best-effort Storage cleanup: if the object is already
    gone, the row still deletes — Storage and the DB row are separate
    systems and one lagging the other shouldn't block the user."""
    user_id, supabase = auth

    existing = supabase.table("documents").select("id,storage_path").eq("id", document_id).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Document not found")

    try:
        supabase.storage.from_(_STORAGE_BUCKET).remove([existing[0]["storage_path"]])
    except Exception:
        pass  # best-effort — see docstring above

    supabase.table("documents").delete().eq("id", document_id).execute()
    return {"deleted": True}
