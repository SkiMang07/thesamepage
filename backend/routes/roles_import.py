"""
Role JD import (Session 44 — see docs/ROLE_JD_IMPORT_SCOPING.md).

One endpoint: POST /api/roles/import/draft. A manager pastes a job
description (or drops a .pdf/.docx/.txt/.md) and ONE AI call comes back
with everything the review screen needs:

  1. is_job_description — an honest refusal for a recipe or a random memo,
     rather than a confidently-invented role (scoping §3.3).
  2. role — the extracted identity (title, level, team, responsibilities).
     job_responsibilities is the text that actually gets stored on the
     role_levels row; it grounds every later re-draft and 1:1 prep prompt.
  3. match — attach to an existing ladder / create a new one / "this exact
     role+level already exists, back-fill its expectations". Ladder
     fragmentation was already visible in dogfood data (Session 42 §7 P3),
     so proposing attach-vs-create is a first-class requirement here, not
     polish (locked decision 2).
  4. expectations — metrics/skills/values in the exact same shape
     /api/expectations/draft returns, drafted from the same verbatim
     definitions block (expectations_ai._EXPECTATION_DEFINITIONS) and run
     through the same clamps (expectations_ai.parse_draft_items), so a
     JD-imported role calibrates identically to one drafted in the
     coverage grid.

NOTHING IS SAVED HERE and nothing is uploaded to Storage — same pure-AI
contract as /api/expectations/draft. A JD is role config, not a Context
Engine document; the raw file is read into memory, converted if needed,
sent to the model, and dropped. The commit is client-orchestrated through
the endpoints the manual forms already use (POST /api/role-families, POST/
PUT /api/settings/role-levels, POST /api/expectations/{kind}/batch) — no
new write endpoints, and no migration: every column this flow writes
(job_responsibilities, role_family_id, nullable value_configs.role_level_id)
already exists.

File handling: PDFs go to Claude natively via generate_text_from_document;
.txt/.md and pasted text go through generate_text with the JD inlined.
.docx is text-extracted in pure Python (_extract_docx_text below) and goes
down the same inline-text path — originally it went through documents.py's
LibreOffice convert_to_pdf, but the first live test (Session 44, same day)
502'd because LibreOffice never actually made it into the Railway image
(both the nixPkgs and aptPkgs attempts — see nixpacks.toml). A JD is text,
not layout; unlike Context Engine decks there's nothing for vision to see,
so shelling out to a 300MB office suite was never load-bearing here. The
25MB cap is still shared with documents.py.
"""
import base64
import io
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from ai_core import generate_text, generate_text_from_document
from config import AI_DEFAULT_MODEL_HEAVY
from routes.documents import _MAX_UPLOAD_BYTES
from routes.expectations_ai import (
    _EXPECTATION_DEFINITIONS,
    ExpectationsDraft,
    _compute_coverage,
    _format_existing_configs,
    parse_draft_items,
)
from routes.settings import _CONFIG_TABLES
from utils import get_authenticated_client, limiter

router = APIRouter()

_PDF_MIME = "application/pdf"
_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_TEXT_EXTENSIONS = {".txt", ".md"}

_VALID_ACTIONS = {"attach", "create_new", "exists"}
_VALID_CONFIDENCE = {"high", "medium"}

# Matches RoleForm's own <input type="number" min=1 max=10> in
# app/app/settings/page.tsx — a JD that reads "L14" is the model
# hallucinating, not a real ladder.
_MIN_LEVEL = 1
_MAX_LEVEL = 10

# How many existing ladders get their full expectations inlined for
# calibration. Every family's LEVEL NAMES go in the prompt (the model needs
# them all to propose a match at all), but inlining every family's configs
# would blow the prompt up on an org with a dozen ladders — so the shortlist
# below picks the closest name matches and only those get their configs.
_MAX_CALIBRATION_FAMILIES = 2


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class ImportedRole(BaseModel):
    job_role: str
    job_level: int = 1
    functional_team: str | None = None
    job_responsibilities: str | None = None


class ImportMatch(BaseModel):
    """Where the AI thinks this role belongs. Every id on this model is
    validated against the caller's own ladders before it goes out — the
    review screen preselects from it, so a hallucinated family id would
    become a 422 at commit time instead of a visible bad suggestion."""
    suggested_action: str = "create_new"  # attach | create_new | exists
    role_family_id: str | None = None
    role_family_name: str | None = None
    existing_role_level_id: str | None = None
    confidence: str = "medium"
    rationale: str | None = None


class RoleImportDraft(BaseModel):
    is_job_description: bool = True
    # Set only when is_job_description is false — one honest line the input
    # screen re-renders above the (preserved) pasted text.
    reason: str | None = None
    # Multi-role JD (scoping §3.3): v1 extracts the primary role only and
    # says so out loud instead of silently dropping the rest.
    other_roles_note: str | None = None
    role: ImportedRole | None = None
    match: ImportMatch | None = None
    expectations: ExpectationsDraft = ExpectationsDraft()


# ---------------------------------------------------------------------------
# Input handling
# ---------------------------------------------------------------------------

def _infer_import_type(filename: str, content_type: str | None) -> str:
    """-> "pdf" | "docx" | "text". Deliberately narrower than documents.py's
    _infer_file_type: a slide deck is not a job description, so .pptx isn't
    accepted here even though the conversion path would handle it."""
    suffix = Path(filename or "").suffix.lower()
    if suffix == ".pdf" or content_type == _PDF_MIME:
        return "pdf"
    if suffix == ".docx" or content_type == _DOCX_MIME:
        return "docx"
    if suffix in _TEXT_EXTENSIONS or (content_type or "").startswith("text/"):
        return "text"
    raise HTTPException(
        status_code=422,
        detail="Unsupported file type — paste the text, or upload a .pdf, .docx, .txt or .md file",
    )


_DOCX_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _extract_docx_text(raw_bytes: bytes) -> str:
    """Pure-Python .docx text extraction — a .docx is a zip whose body text
    lives in word/document.xml as <w:t> runs inside <w:p> paragraphs. One
    line per paragraph is plenty of structure for a JD prompt; tables'
    cells fall out as their own paragraphs, which reads fine. Exists so
    this flow has zero system-binary dependencies (see module docstring for
    the LibreOffice story)."""
    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as archive:
            document_xml = archive.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError):
        raise HTTPException(
            status_code=422,
            detail="That .docx couldn't be read — is it a real Word document? (Older .doc files aren't supported — save as .docx or paste the text.)",
        )
    try:
        root = ElementTree.fromstring(document_xml)
    except ElementTree.ParseError:
        raise HTTPException(status_code=422, detail="That .docx couldn't be read — its contents look corrupted.")

    paragraphs = []
    for paragraph in root.iter(f"{_DOCX_W_NS}p"):
        text = "".join(t.text or "" for t in paragraph.iter(f"{_DOCX_W_NS}t")).strip()
        if text:
            paragraphs.append(text)
    return "\n".join(paragraphs)


def _parse_json_object(raw: str) -> dict:
    """Strict JSON extraction. Unlike expectations_ai's parse (which falls
    back to an empty dict, yielding an honest "nothing to draft"), an
    unparseable response here has to 502: an empty object would render as
    "this isn't a job description", blaming the manager's input for the
    model's bad output."""
    raw_clean = raw.strip()
    if raw_clean.startswith("```"):
        start = raw_clean.find("{")
        end = raw_clean.rfind("}") + 1
        raw_clean = raw_clean[start:end] if start != -1 else raw_clean
    try:
        parsed = json.loads(raw_clean)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI response was not valid JSON: {e}")
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="AI response was not a JSON object")
    return parsed


# ---------------------------------------------------------------------------
# Family shortlisting — the "cheap pre-pass" from scoping §3.1
# ---------------------------------------------------------------------------

# Mirrors SENIORITY_PREFIXES / stripSeniorityPrefix() in
# app/app/settings/page.tsx (Session 43's ladder-merge nudge). Same
# normalization on both sides of the app so "Senior Corporate CSM" and
# "Corporate CSM" are recognized as one ladder here exactly the way the
# merge nudge already recognizes them in the UI.
_SENIORITY_PREFIXES = ("senior ", "sr. ", "sr ", "lead ", "staff ", "principal ", "junior ", "jr. ", "jr ", "associate ")


def _strip_seniority_prefix(name: str) -> str:
    lowered = (name or "").strip().lower()
    for prefix in _SENIORITY_PREFIXES:
        if lowered.startswith(prefix):
            return lowered[len(prefix):].strip()
    return lowered


_STOPWORDS = {"the", "and", "of", "for", "a", "an", "to", "in", "at", "on", "&"}


def _tokens(name: str) -> set[str]:
    return {t for t in _strip_seniority_prefix(name).replace("/", " ").replace("-", " ").split() if t and t not in _STOPWORDS}


def _shortlist_families(signal: str, families: list[dict]) -> list[dict]:
    """Rank existing ladders against whatever text signal we have BEFORE the
    AI call — the pasted JD text, or the uploaded file's name (a PDF's
    contents aren't readable server-side without a second extraction call,
    and one call is the whole point). Only the winners get their existing
    expectations inlined for calibration; the match decision itself is still
    the model's, made against the full list of ladder names.

    Scoring is deliberately dumb: exact/containment match on the
    seniority-stripped family name, else token overlap. A miss costs
    calibration quality on one draft, never correctness."""
    if not signal or not families:
        return []
    signal_lower = signal.lower()
    signal_tokens = _tokens(signal_lower)

    scored: list[tuple[float, dict]] = []
    for family in families:
        stripped = _strip_seniority_prefix(family.get("name") or "")
        if not stripped:
            continue
        score = 0.0
        if stripped in signal_lower:
            score += 10.0 + len(stripped) / 100.0  # longer exact hits beat shorter ones
        family_tokens = _tokens(family.get("name") or "")
        if family_tokens:
            overlap = len(family_tokens & signal_tokens) / len(family_tokens)
            score += overlap * 5.0
        if score > 0:
            scored.append((score, family))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [family for score, family in scored[:_MAX_CALIBRATION_FAMILIES] if score >= 1.0]


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

def _build_ladders_block(families: list[dict], role_levels: list[dict], coverage_by_id: dict) -> str:
    if not families and not role_levels:
        return "(none yet — this manager has not set up any roles. Every match should be create_new.)"

    levels_by_family: dict = {}
    ungrouped: list[dict] = []
    for rl in role_levels:
        if rl.get("role_family_id"):
            levels_by_family.setdefault(rl["role_family_id"], []).append(rl)
        else:
            ungrouped.append(rl)

    def _level_line(rl: dict) -> str:
        counts = coverage_by_id.get(rl["id"], {})
        return (
            f"    L{rl['job_level']} — {rl.get('job_role') or ''} "
            f"[role_level_id: {rl['id']}] "
            f"({counts.get('metrics_count', 0)} metrics, {counts.get('skills_count', 0)} skills, "
            f"{counts.get('values_count', 0)} role-specific values configured)"
        )

    lines = []
    for family in families:
        levels = sorted(levels_by_family.get(family["id"], []), key=lambda r: r.get("job_level") or 0)
        lines.append(f"  • Ladder \"{family['name']}\" [role_family_id: {family['id']}]")
        if levels:
            lines.extend(_level_line(rl) for rl in levels)
        else:
            lines.append("    (no levels yet)")
    if ungrouped:
        lines.append("  • Levels not in any ladder (\"Ungrouped\" — attaching to one of these is not possible; propose create_new or a real ladder):")
        lines.extend(_level_line(rl) for rl in sorted(ungrouped, key=lambda r: (r.get("job_role") or "", r.get("job_level") or 0)))
    return "\n".join(lines)


def _build_calibration_block(shortlist: list[dict], levels_by_family: dict, configs_by_level: dict) -> str:
    if not shortlist:
        return ""
    parts = []
    for family in shortlist:
        for rl in sorted(levels_by_family.get(family["id"], []), key=lambda r: r.get("job_level") or 0):
            configs = configs_by_level.get(rl["id"], {})
            if not any(configs.get(k) for k in ("metrics", "skills", "values")):
                continue
            parts.append(
                f"{family['name']} · L{rl['job_level']}:\n"
                f"  Metrics:\n{_format_existing_configs(configs.get('metrics', []), 'metric_name')}\n"
                f"  Skills:\n{_format_existing_configs(configs.get('skills', []), 'skill_name')}\n"
                f"  Values:\n{_format_existing_configs(configs.get('values', []), 'value_name')}"
            )
    if not parts:
        return ""
    return (
        "\n\nThe closest existing ladder(s) already have expectations configured. Use them ONLY to calibrate "
        "scope and tone across levels (a higher level should read as more ownership, not just \"more\"), and to "
        "judge whether this job description really is another level of the same ladder. Never copy them "
        "verbatim:\n\n" + "\n\n".join(parts)
    )


def _build_org_values_block(org_values: list[dict]) -> str:
    if not org_values:
        return (
            "This org has no company-wide values configured yet. Still keep role-specific values sparse — "
            "generic company values belong in the org-wide values list, not on this role."
        )
    return (
        "Company-wide values already configured in this org (they apply to EVERY role automatically — "
        "do NOT repeat any of them as role-specific values):\n"
        + _format_existing_configs(org_values, "value_name")
    )


def _build_import_prompt(
    jd_text: str | None,
    ladders_block: str,
    calibration_block: str,
    org_values_block: str,
) -> str:
    jd_section = (
        "The job description follows, delimited by triple dashes — this is the manager's pasted text, "
        f"there is nothing else to read:\n---\n{jd_text}\n---"
        if jd_text is not None
        else "Read the attached document in full — it is what the manager uploaded as the job description "
        "(a PDF, possibly converted from a Word file)."
    )

    return f"""You are helping a first-time manager turn a job description into a configured role in The Same Page, a management operating system. In ONE pass you must: confirm the document really is a job description, extract the role's identity, propose where it belongs among the ladders this manager has already set up, and draft the expectations for it. The manager reviews and edits everything before anything saves — an incomplete but honest answer beats a padded one.

{jd_section}

LADDERS ALREADY SET UP IN THIS ORG (a "ladder" is a role family; L1/L2/L3… are levels inside it):
{ladders_block}
{calibration_block}

{org_values_block}

{_EXPECTATION_DEFINITIONS}

HOW TO DECIDE THE MATCH:
- "attach": this job is another level of an EXISTING ladder above (same job, different seniority — e.g. a senior version of a role already listed). Set role_family_id to that ladder's id.
- "exists": this exact job AND level is already listed above. Set role_family_id AND existing_role_level_id. Prefer this over "attach" when the level number you inferred already exists in that ladder — the manager is most likely back-filling a role they set up but never described.
- "create_new": nothing above is the same job. Leave role_family_id null. Say so plainly rather than forcing a weak attach — a wrong attach quietly corrupts a ladder, a wrong create_new is one click to fix.
- confidence "high" only when the ladder name and the job description clearly describe the same job; "medium" otherwise (the review screen then shows create-new as an equally-weighted option).
- rationale: ONE short sentence, written to the manager ("Looks like the next level up on your Corporate CSM ladder").

Return ONLY valid JSON. No commentary, no markdown, no code fences.

{{
  "is_job_description": true,
  "reason": null,
  "other_roles_note": null,
  "role": {{
    "job_role": "the job title, cleaned up — no seniority noise the level number already captures",
    "job_level": 1,
    "functional_team": null,
    "job_responsibilities": "the responsibilities/scope of the role, rewritten as clean prose — this is stored on the role and grounds every future draft, so keep the substance and drop the boilerplate (benefits, EEO statements, how to apply, company blurb)"
  }},
  "match": {{
    "suggested_action": "create_new",
    "role_family_id": null,
    "existing_role_level_id": null,
    "confidence": "medium",
    "rationale": "one sentence shown to the manager"
  }},
  "expectations": {{
    "metrics": [{{"name": "...", "order_type": "primary", "expectation": "what good looks like, one sentence", "measurement_period": "month"}}],
    "skills": [{{"name": "...", "order_type": "primary", "expectation": "what good looks like, one sentence"}}],
    "values": [{{"name": "...", "order_type": "secondary", "description": "what living this value looks like in this role, one sentence", "value_type": "company"}}]
  }}
}}

RULES:
- job_level: infer from seniority language in the document (a "Senior"/"II"/"Lead" title, years of experience, scope of ownership). Default to 1 when the document gives you nothing to go on. Never above 10.
- functional_team: only when the document clearly names the team/function this role sits on. Otherwise null.
- measurement_period must be one of: month, week, quarter, annual, none. order_type must be one of: primary, secondary, tertiary. Empty arrays are valid, honest answers — do not invent items to fill a category.
- If this document is NOT a job description (a recipe, an invoice, a random memo, an empty page), set "is_job_description": false and put ONE plain sentence in "reason" saying what it looks like instead. Set role, match and expectations to null/empty — do NOT invent a role from a document that doesn't describe one.
- If the document describes MORE THAN ONE role (a job-req batch, a leveling guide covering a whole ladder), extract the PRIMARY/first role only and set "other_roles_note" to one sentence naming how many others it also describes. Otherwise leave it null."""


# ---------------------------------------------------------------------------
# Validation of the model's match proposal
# ---------------------------------------------------------------------------

def _validate_match(raw_match: dict, families: list[dict], role_levels: list[dict], job_level: int) -> ImportMatch:
    """Never trust the model's ids. A family id it invented, or one from
    another org (impossible through RLS, but the check is free), degrades to
    create_new rather than reaching the review screen as a preselected
    ladder that 422s at commit time.

    Also resolves collisions server-side: if the proposed ladder already has
    a level at the inferred number, the action becomes "exists" against THAT
    level — the review screen's own collision UI (scoping §3.2) then only
    has to handle collisions the manager creates by editing the level or
    ladder afterwards."""
    families_by_id = {f["id"]: f for f in families}
    action = raw_match.get("suggested_action")
    if action not in _VALID_ACTIONS:
        action = "create_new"

    family_id = raw_match.get("role_family_id")
    if not isinstance(family_id, str) or family_id not in families_by_id:
        family_id = None
    if family_id is None and action in ("attach", "exists"):
        action = "create_new"

    existing_level_id = raw_match.get("existing_role_level_id")
    levels_by_id = {rl["id"]: rl for rl in role_levels}
    if not isinstance(existing_level_id, str) or existing_level_id not in levels_by_id:
        existing_level_id = None
    elif levels_by_id[existing_level_id].get("role_family_id") != family_id:
        existing_level_id = None  # points outside the ladder it claims to be in

    # Collision: the ladder already has this level number.
    if family_id:
        collision = next(
            (rl for rl in role_levels if rl.get("role_family_id") == family_id and rl.get("job_level") == job_level),
            None,
        )
        if collision:
            action = "exists"
            existing_level_id = collision["id"]
        elif action == "exists":
            action = "attach"  # claimed "exists" but nothing sits at that level
            existing_level_id = None

    # A create_new proposal must not also carry a ladder: the review screen
    # preselects from role_family_id, so leaving one set here would render a
    # ladder the stated action says not to use. Only reachable when the
    # model returns an unrecognized action alongside a real family id.
    if action == "create_new":
        family_id = None
        existing_level_id = None

    confidence = raw_match.get("confidence")
    rationale = raw_match.get("rationale")
    return ImportMatch(
        suggested_action=action,
        role_family_id=family_id,
        role_family_name=families_by_id[family_id]["name"] if family_id else None,
        existing_role_level_id=existing_level_id if action == "exists" else None,
        confidence=confidence if confidence in _VALID_CONFIDENCE else "medium",
        rationale=rationale.strip() if isinstance(rationale, str) and rationale.strip() else None,
    )


def _validate_role(raw_role: dict) -> ImportedRole | None:
    job_role = (raw_role.get("job_role") or "").strip() if isinstance(raw_role, dict) else ""
    if not job_role:
        return None
    try:
        job_level = int(raw_role.get("job_level") or 1)
    except (TypeError, ValueError):
        job_level = 1
    job_level = max(_MIN_LEVEL, min(_MAX_LEVEL, job_level))

    team = raw_role.get("functional_team")
    responsibilities = raw_role.get("job_responsibilities")
    return ImportedRole(
        job_role=job_role,
        job_level=job_level,
        functional_team=team.strip() if isinstance(team, str) and team.strip() else None,
        job_responsibilities=responsibilities.strip()
        if isinstance(responsibilities, str) and responsibilities.strip()
        else None,
    )


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.post("/draft", response_model=RoleImportDraft)
@limiter.limit("10/minute")
async def draft_role_import(
    request: Request,
    file: UploadFile | None = File(None),
    text: str | None = Form(None),
    auth=Depends(get_authenticated_client),
):
    """Pure AI-call route — nothing is saved, nothing is uploaded to
    Storage. The review panel commits through the existing role/expectation
    endpoints (see this module's docstring)."""
    user_id, supabase = auth

    pasted = (text or "").strip()
    has_file = file is not None and bool(file.filename)
    if has_file and pasted:
        raise HTTPException(status_code=422, detail="Send either a file or pasted text, not both")
    if not has_file and not pasted:
        raise HTTPException(status_code=422, detail="Paste a job description or attach a file")

    # --- resolve the input into either inline text or PDF bytes ----------
    jd_text: str | None = None
    pdf_bytes: bytes | None = None
    signal = pasted  # what the family shortlist matches against

    if has_file:
        original_filename = Path(file.filename or "upload").name
        import_type = _infer_import_type(original_filename, file.content_type)
        raw_bytes = await file.read()
        if not raw_bytes:
            raise HTTPException(status_code=422, detail="Uploaded file is empty")
        if len(raw_bytes) > _MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File too large — 25MB limit")
        if import_type == "text":
            jd_text = raw_bytes.decode("utf-8", errors="replace")
            signal = jd_text
        elif import_type == "docx":
            jd_text = _extract_docx_text(raw_bytes)
            if not jd_text.strip():
                raise HTTPException(status_code=422, detail="Couldn't find any text in that .docx — paste the job description instead")
            signal = jd_text  # real text beats the filename for shortlisting
        else:
            pdf_bytes = raw_bytes
            # A PDF's text isn't readable here without a second extraction
            # call, so the filename is the only pre-call signal available
            # for shortlisting. JD files are usually named after the role.
            signal = Path(original_filename).stem.replace("_", " ").replace("-", " ")
    else:
        if len(pasted.encode("utf-8")) > _MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Pasted text too large — 25MB limit")
        jd_text = pasted

    # --- gather the org's existing ladders for the match proposal --------
    families = supabase.table("role_families").select("id,name").order("name").execute().data
    role_levels = (
        supabase.table("role_levels")
        .select("id,job_role,job_level,role_family_id")
        .order("job_role")
        .order("job_level")
        .execute()
        .data
    )
    coverage_by_id = {r["role_level_id"]: r for r in _compute_coverage(supabase)["roles"]}
    org_values = (
        supabase.table("value_configs")
        .select("value_name,order_type,description")
        .is_("role_level_id", "null")
        .execute()
        .data
    )

    levels_by_family: dict = {}
    for rl in role_levels:
        if rl.get("role_family_id"):
            levels_by_family.setdefault(rl["role_family_id"], []).append(rl)

    shortlist = _shortlist_families(signal, families)
    shortlisted_level_ids = [
        rl["id"] for family in shortlist for rl in levels_by_family.get(family["id"], [])
    ]
    configs_by_level: dict = {}
    if shortlisted_level_ids:
        for kind, (table, _) in _CONFIG_TABLES.items():
            rows = supabase.table(table).select("*").in_("role_level_id", shortlisted_level_ids).execute().data
            for row in rows:
                configs_by_level.setdefault(
                    row["role_level_id"], {"metrics": [], "skills": [], "values": []}
                )[kind].append(row)

    prompt = _build_import_prompt(
        jd_text=jd_text,
        ladders_block=_build_ladders_block(families, role_levels, coverage_by_id),
        calibration_block=_build_calibration_block(shortlist, levels_by_family, configs_by_level),
        org_values_block=_build_org_values_block(org_values),
    )

    # --- the one AI call -------------------------------------------------
    if pdf_bytes is not None:
        raw = generate_text_from_document(
            prompt,
            base64.b64encode(pdf_bytes).decode("ascii"),
            media_type="application/pdf",
            model=AI_DEFAULT_MODEL_HEAVY,
            max_tokens=4000,
        )
    else:
        raw = generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=4000)

    parsed = _parse_json_object(raw)

    if parsed.get("is_job_description") is False:
        reason = parsed.get("reason")
        return RoleImportDraft(
            is_job_description=False,
            reason=reason.strip()
            if isinstance(reason, str) and reason.strip()
            else "That doesn't look like a job description.",
        )

    role = _validate_role(parsed.get("role") or {})
    if role is None:
        # No usable title came back — treat it as the same honest refusal
        # rather than opening a review screen with an empty role card.
        return RoleImportDraft(
            is_job_description=False,
            reason="Couldn't find a job title in that — check it's the full job description.",
        )

    note = parsed.get("other_roles_note")
    return RoleImportDraft(
        is_job_description=True,
        other_roles_note=note.strip() if isinstance(note, str) and note.strip() else None,
        role=role,
        match=_validate_match(parsed.get("match") or {}, families, role_levels, role.job_level),
        expectations=parse_draft_items(parsed.get("expectations") or {}),
    )
