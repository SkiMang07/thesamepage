"""
Expectations coverage + AI draft (Plan S3, Session 1 — see
docs/TEAM_SETUP_UX_REVIEW.md §6 and docs/TEAM_SETUP_BUILD_SESSIONS.md).

Split out from settings.py rather than added there: settings.py owns the
manual CRUD for metric_configs/skill_configs/value_configs (kept as-is,
unchanged in this session); this module is the read-only coverage rollup
plus the AI-assisted draft-then-review flow that sits on top of it. Same
"activate on top of existing CRUD" pattern as assessments.py sitting on top
of direct_reports.py.

Endpoints:
  GET  /api/expectations/coverage    — per-role_level counts of metrics/
                                        skills/values, for the coverage grid
                                        that replaces the blind role dropdown.
  POST /api/expectations/draft       — AI drafts metrics/skills/values from
                                        the role's job_responsibilities text
                                        (+ sibling levels' existing configs
                                        for calibration). Nothing is saved.
  POST /api/expectations/{kind}/batch — commits a reviewed draft (or a
                                        manually-assembled batch) in one
                                        insert. This is the only write path
                                        here; draft/coverage are read-only.

Org-wide values (Plan S3): value_configs.role_level_id NULL means "applies
to every role" — already-nullable column, no migration. The coverage grid
surfaces an org_wide_values_count alongside the per-role counts; the union
into a single role's expectation set for prep/assessments/person-page
consumers happens in direct_reports.py's fetch_role_expectations(), not here
(this module never reads a specific report's expectations, only role-level
config counts + drafts).
"""
import json

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from ai_core import generate_text
from config import AI_DEFAULT_MODEL_HEAVY
from routes.settings import _CONFIG_TABLES, ExpectationIn, _expectation_row, _validate_kind
from utils import ensure_org, get_authenticated_client, get_email_from_token, get_org, limiter

router = APIRouter()


# ---------------------------------------------------------------------------
# GET /coverage
# ---------------------------------------------------------------------------

def _compute_coverage(supabase) -> dict:
    """One row per role_level with metric/skill/value config counts, plus
    the org-wide (role_level_id IS NULL) value count. Three queries total
    (one per config table) + one for role_levels, grouped in Python — same
    "single grouped query, no per-role N+1" shape as
    assessments.py's list_team_assessments.

    Extracted from get_coverage() (Session 41, Plan S1) so
    routes/setup_status.py can reuse the exact same computation for its
    per-role "has expectations" check — see docs/TEAM_SETUP_UX_REVIEW.md §6,
    "setup-status feeds ... reuses S3's coverage query." Takes a bare
    supabase client (no auth dependency) so it composes into another route's
    handler without a second HTTP round-trip.
    """
    role_levels = (
        supabase.table("role_levels")
        .select("id,job_role,job_level,functional_team")
        .order("job_role")
        .order("job_level")
        .execute()
        .data
    )

    # role_level_id -> {"metrics": n, "skills": n, "values": n}
    counts_by_role: dict = {}
    org_wide_values_count = 0

    for kind, (table, _) in _CONFIG_TABLES.items():
        rows = supabase.table(table).select("id,role_level_id").execute().data
        for row in rows:
            rl_id = row.get("role_level_id")
            if rl_id is None:
                if kind == "values":
                    org_wide_values_count += 1
                continue  # org-wide rows aren't attributed to any one role's coverage cell
            bucket = counts_by_role.setdefault(rl_id, {"metrics": 0, "skills": 0, "values": 0})
            bucket[kind] += 1

    return {
        "roles": [
            {
                "role_level_id": rl["id"],
                "job_role": rl["job_role"],
                "job_level": rl["job_level"],
                "metrics_count": counts_by_role.get(rl["id"], {}).get("metrics", 0),
                "skills_count": counts_by_role.get(rl["id"], {}).get("skills", 0),
                "values_count": counts_by_role.get(rl["id"], {}).get("values", 0),
            }
            for rl in role_levels
        ],
        "org_wide_values_count": org_wide_values_count,
    }


@router.get("/coverage")
async def get_coverage(auth=Depends(get_authenticated_client)):
    _, supabase = auth
    return _compute_coverage(supabase)


# ---------------------------------------------------------------------------
# POST /draft
# ---------------------------------------------------------------------------

class DraftIn(BaseModel):
    role_level_id: str


class DraftMetricItem(BaseModel):
    name: str
    order_type: str | None = None
    expectation: str | None = None
    measurement_period: str | None = None


class DraftSkillItem(BaseModel):
    name: str
    order_type: str | None = None
    expectation: str | None = None


class DraftValueItem(BaseModel):
    name: str
    order_type: str | None = None
    description: str | None = None
    value_type: str | None = "company"


class ExpectationsDraft(BaseModel):
    """AI-drafted items for the manager to review — nothing is saved until
    POST /{kind}/batch. Same draft-then-review contract as
    assessments.py's AssessmentDraft."""
    metrics: list[DraftMetricItem] = []
    skills: list[DraftSkillItem] = []
    values: list[DraftValueItem] = []


_VALID_ORDER_TYPES = {"primary", "secondary", "tertiary"}
_VALID_PERIODS = {"month", "week", "quarter", "annual", "none"}
_VALID_VALUE_TYPES = {"team", "company", "department"}


# The METRICS/SKILLS/VALUES definitions + order_type rules, hoisted out of
# _build_draft_prompt (Session 44) so routes/roles_import.py's one-shot JD
# prompt can carry the SAME definitions verbatim — the two draft paths have
# to calibrate identically or a JD-imported role reads differently from one
# drafted in the coverage grid. Interpolated below, so the prompt this
# module builds is byte-identical to what it was before the extraction.
_EXPECTATION_DEFINITIONS = """Definitions, matching this app's schema:
- METRICS: a small number of measurable outcomes (numbers) this role is accountable for — e.g. "Net revenue retention", measured on a period (weekly/monthly/quarterly/annual/not time-based).
- SKILLS: the craft/capabilities this role needs to be good at — e.g. "Running discovery calls" — judged qualitatively, not numerically.
- VALUES: behavioral/cultural expectations — e.g. "Defaults to transparency". Prefer leaving VALUES EMPTY here unless the job description text clearly implies a role-specific behavioral bar beyond generic company values — company-wide values belong in the org-wide values list, not duplicated per role.
- order_type for every item: "primary" (the 1-3 things that matter most), "secondary", or "tertiary". Most roles should have 2-4 primary items total across metrics+skills, not more."""


def _format_existing_configs(configs: list[dict], name_col: str) -> str:
    if not configs:
        return "  (none configured yet)"
    lines = []
    for c in configs:
        line = f"  • {c.get(name_col)}"
        if c.get("order_type"):
            line += f" ({c['order_type']})"
        extra = c.get("expectation") or c.get("description")
        if extra:
            line += f" — {extra}"
        lines.append(line)
    return "\n".join(lines)


def _build_draft_prompt(
    job_role: str,
    job_level: int,
    job_responsibilities: str | None,
    sibling_levels: list[dict],
    sibling_configs: dict,
) -> str:
    siblings_block = ""
    if sibling_levels:
        parts = []
        for lvl in sibling_levels:
            label = f"{job_role} · L{lvl['job_level']}"
            parts.append(
                f"{label}:\n"
                f"  Metrics:\n{_format_existing_configs(sibling_configs.get(lvl['id'], {}).get('metrics', []), 'metric_name')}\n"
                f"  Skills:\n{_format_existing_configs(sibling_configs.get(lvl['id'], {}).get('skills', []), 'skill_name')}\n"
                f"  Values:\n{_format_existing_configs(sibling_configs.get(lvl['id'], {}).get('values', []), 'value_name')}"
            )
        siblings_block = "\n\nOther levels of this same role already have expectations configured — use them ONLY to calibrate scope and tone across levels (a higher level should read as more ownership, not just \"more\"), never copy them verbatim for this level:\n\n" + "\n\n".join(parts)

    jd_block = job_responsibilities.strip() if job_responsibilities and job_responsibilities.strip() else None
    jd_section = (
        f"JOB DESCRIPTION / RESPONSIBILITIES (as pasted by the manager):\n{jd_block}"
        if jd_block
        else "No job description text has been pasted for this role yet. Draft from the role title and level alone, using reasonable, generic expectations for that kind of job at that seniority — keep names and expectations general enough to still be true without more detail."
    )

    return f"""You are helping a first-time manager set up "what good looks like" for one role on their team, so they can measure and coach against it instead of relying on vibes. This drafts METRICS, SKILLS, and VALUES for the role below. The manager reviews, edits, and chooses what to keep before anything saves — an incomplete but honest draft beats a padded one, so do not force a fixed number of items per category.

ROLE: {job_role}, level {job_level}

{jd_section}
{siblings_block}

{_EXPECTATION_DEFINITIONS}

Return ONLY valid JSON. No commentary, no markdown, no code fences.

{{
  "metrics": [{{"name": "...", "order_type": "primary", "expectation": "what good looks like, one sentence", "measurement_period": "month"}}],
  "skills": [{{"name": "...", "order_type": "primary", "expectation": "what good looks like, one sentence"}}],
  "values": [{{"name": "...", "order_type": "secondary", "description": "what living this value looks like in this role, one sentence", "value_type": "company"}}]
}}

measurement_period must be one of: month, week, quarter, annual, none. order_type must be one of: primary, secondary, tertiary. Empty arrays are valid, honest answers when there truly isn't enough to draft — do not invent items just to fill categories."""


@router.post("/draft", response_model=ExpectationsDraft)
@limiter.limit("10/minute")
async def draft_expectations(
    request: Request,
    body: DraftIn,
    auth=Depends(get_authenticated_client),
):
    """Pure AI-call route — nothing is saved. Manager reviews the draft in
    the coverage grid's review panel, then POST /{kind}/batch writes
    whatever they keep."""
    user_id, supabase = auth

    role_rows = (
        supabase.table("role_levels")
        .select("id,job_role,job_level,job_responsibilities")
        .eq("id", body.role_level_id)
        .execute()
        .data
    )
    if not role_rows:
        raise HTTPException(status_code=404, detail="Role level not found")
    role = role_rows[0]

    # Sibling levels of the same role_family-less job_role (Plan S2's
    # role_family_id doesn't exist yet — this session groups by exact
    # job_role string match, same grain the rest of the app still uses).
    sibling_levels = (
        supabase.table("role_levels")
        .select("id,job_level")
        .eq("job_role", role["job_role"])
        .neq("id", role["id"])
        .execute()
        .data
    )
    sibling_ids = [s["id"] for s in sibling_levels]

    sibling_configs: dict = {sid: {"metrics": [], "skills": [], "values": []} for sid in sibling_ids}
    if sibling_ids:
        for kind, (table, name_col) in _CONFIG_TABLES.items():
            rows = (
                supabase.table(table)
                .select("*")
                .in_("role_level_id", sibling_ids)
                .execute()
                .data
            )
            for r in rows:
                sibling_configs.setdefault(r["role_level_id"], {"metrics": [], "skills": [], "values": []})[kind].append(r)

    prompt = _build_draft_prompt(
        job_role=role["job_role"],
        job_level=role["job_level"],
        job_responsibilities=role.get("job_responsibilities"),
        sibling_levels=sibling_levels,
        sibling_configs=sibling_configs,
    )

    return _generate_and_parse_draft(prompt)


def _generate_and_parse_draft(prompt: str) -> ExpectationsDraft:
    """Shared AI-call + parse tail for both draft_expectations (role-level,
    all three kinds) and draft_org_values (org-level, values only) —
    extracted so the org-wide values draft (Session 43, Polish Pass B, see
    docs/TEAM_SETUP_UX_REVIEW.md §7.3 item 8) doesn't duplicate the JSON
    extraction / validation logic. A prompt that only asks for values simply
    yields empty metrics/skills lists here, same "empty array is an honest
    answer" contract as the role-level draft."""
    raw = generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=2000)
    raw_clean = raw.strip()
    if raw_clean.startswith("```"):
        start = raw_clean.find("{")
        end = raw_clean.rfind("}") + 1
        raw_clean = raw_clean[start:end] if start != -1 else raw_clean

    try:
        parsed = json.loads(raw_clean)
    except json.JSONDecodeError:
        parsed = {}

    return parse_draft_items(parsed)


def parse_draft_items(parsed: dict) -> ExpectationsDraft:
    """Validate + clamp an already-parsed {"metrics": [...], "skills": [...],
    "values": [...]} object into the Draft* models. Split out of
    _generate_and_parse_draft (Session 44) so routes/roles_import.py can run
    the identical clamps on the `expectations` sub-object of its own, larger
    one-shot JSON response — it makes one AI call that returns role identity
    + match + expectations together, so it can't reuse the call-and-parse
    wrapper above, only this validation tail. Unknown order_types /
    measurement_periods / value_types are nulled or defaulted rather than
    rejected: a draft is reviewed by a human before anything saves, so a
    partially-usable draft beats a 502."""

    def _clean_order_type(v):
        return v if v in _VALID_ORDER_TYPES else None

    metrics = []
    for r in parsed.get("metrics") or []:
        name = (r.get("name") or "").strip()
        if not name:
            continue
        period = r.get("measurement_period")
        metrics.append(DraftMetricItem(
            name=name,
            order_type=_clean_order_type(r.get("order_type")),
            expectation=r.get("expectation") or None,
            measurement_period=period if period in _VALID_PERIODS else None,
        ))

    skills = []
    for r in parsed.get("skills") or []:
        name = (r.get("name") or "").strip()
        if not name:
            continue
        skills.append(DraftSkillItem(
            name=name,
            order_type=_clean_order_type(r.get("order_type")),
            expectation=r.get("expectation") or None,
        ))

    values = []
    for r in parsed.get("values") or []:
        name = (r.get("name") or "").strip()
        if not name:
            continue
        value_type = r.get("value_type")
        values.append(DraftValueItem(
            name=name,
            order_type=_clean_order_type(r.get("order_type")),
            description=r.get("description") or None,
            value_type=value_type if value_type in _VALID_VALUE_TYPES else "company",
        ))

    return ExpectationsDraft(metrics=metrics, skills=skills, values=values)


# ---------------------------------------------------------------------------
# POST /draft-org-values — org-wide values (Session 43, Polish Pass B, see
# docs/TEAM_SETUP_UX_REVIEW.md §7.3, item 8). Same draft-then-review
# contract as /draft, but drafts from the company name/context instead of a
# role's job description — org-wide values (value_configs.role_level_id
# NULL) apply to every role automatically, so there's no JD to draft from.
# Returns the same ExpectationsDraft shape (metrics/skills always empty)
# so the frontend can reuse the same draft-row rendering.
# ---------------------------------------------------------------------------

def _build_org_values_draft_prompt(company_name: str, existing_values: list[dict]) -> str:
    existing_block = (
        _format_existing_configs(existing_values, "value_name")
        if existing_values
        else "  (none configured yet)"
    )
    return f"""You are helping a first-time manager set up their company's org-wide values — behavioral/cultural expectations that apply to EVERY role automatically, not one specific job. This is for "{company_name}".

Company values already configured (do not repeat these, only suggest new ones that would round out the set):
{existing_block}

Draft 3-5 company-wide values a small, fast-moving company like this would plausibly hold — things like ownership, transparency, customer obsession, directness — generic enough to be true without more company-specific detail, since no company context beyond the name was provided. The manager will edit or discard anything that doesn't fit before saving.

Return ONLY valid JSON. No commentary, no markdown, no code fences.

{{
  "values": [{{"name": "...", "order_type": "primary", "description": "what living this value looks like day to day, one sentence", "value_type": "company"}}]
}}

order_type must be one of: primary, secondary, tertiary — most sets should have 2-3 primary values, the rest secondary. value_type should be "company" for every item here (org-wide values are company-scoped by definition). Return an empty array only if you truly have nothing plausible to suggest."""


@router.post("/draft-org-values", response_model=ExpectationsDraft)
@limiter.limit("10/minute")
async def draft_org_values(request: Request, auth=Depends(get_authenticated_client)):
    """Pure AI-call route — nothing is saved. The manager reviews in the
    Org-wide values block, then POST /values/batch with role_level_id: null
    commits whatever they keep (same batch endpoint the role-level draft
    review panel already uses)."""
    user_id, supabase = auth

    org = get_org(user_id, supabase)
    company_name = (org or {}).get("name") or "your company"

    existing_values = (
        supabase.table("value_configs")
        .select("value_name,order_type,description")
        .is_("role_level_id", "null")
        .execute()
        .data
    )

    prompt = _build_org_values_draft_prompt(company_name, existing_values)
    return _generate_and_parse_draft(prompt)


# ---------------------------------------------------------------------------
# POST /{kind}/batch — commit a reviewed draft (or any batch of items) in
# one insert. Reuses settings.py's _expectation_row/_CONFIG_TABLES so the
# row shape written here can never drift from the manual single-item CRUD.
# ---------------------------------------------------------------------------

class ExpectationBatchItem(BaseModel):
    name: str
    order_type: str | None = None
    description: str | None = None
    expectation: str | None = None
    measurement_period: str | None = None
    value_type: str | None = None


class ExpectationBatchIn(BaseModel):
    # None => org-wide (values only — see value_configs.role_level_id).
    role_level_id: str | None = None
    items: list[ExpectationBatchItem] = []


@router.post("/{kind}/batch")
async def batch_create_expectations(
    kind: str,
    body: ExpectationBatchIn,
    auth=Depends(get_authenticated_client),
    authorization: str = Header(None),
):
    _validate_kind(kind)
    if not body.items:
        return []
    user_id, supabase = auth
    org_id = ensure_org(user_id, supabase, get_email_from_token(authorization))
    table, _ = _CONFIG_TABLES[kind]

    rows = [
        {
            **_expectation_row(kind, ExpectationIn(
                name=item.name,
                role_level_id=body.role_level_id,
                order_type=item.order_type,
                description=item.description,
                expectation=item.expectation,
                measurement_period=item.measurement_period,
                value_type=item.value_type,
            )),
            "org_id": org_id,
        }
        for item in body.items
    ]
    result = supabase.table(table).insert(rows).execute()
    return result.data
