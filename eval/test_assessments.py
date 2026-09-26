#!/usr/bin/env python3
"""
eval/test_assessments.py — real-model eval for the four assessment calls
(picture, draft, discuss, summary) in backend/routes/assessment_reviews.py.

Usage:
  cd <repo-root>
  python eval/test_assessments.py
  ASSESS_EVAL_MODEL=claude-sonnet-5 python eval/test_assessments.py
  ASSESS_EVAL_CASES=3,5 ASSESS_EVAL_SHOW_OUTPUT=1 python eval/test_assessments.py

Requires ANTHROPIC_API_KEY — loaded from backend/.env if present, otherwise
from the shell environment. No database: the scorecard and the gathered
evidence are fixtures shaped exactly like _catalog() and gather_evidence()
produce them, and every call goes through the real prompt builders, the
real _ai_json() and the real cleaners/merge, so what is under test is the
prompt + model + guard rails together, the way the route runs them.

What it holds the model to (docs/decisions/ai-drafts-never-saves.md):
  - cites a record for every contribution, or the contribution is dropped
  - stays on each item's own scale (they differ: 1-4, 1-5, 1-3)
  - leaves an item unassessed with a reason when the evidence is thin
  - never invents a metric: a value is a recorded reading or a number the
    manager typed, nothing else — and no new numbers appear anywhere
  - never overwrites a manager decision (redraft, discussion, summary)

Exit 0 if at most one case fails; exit 1 otherwise. ~14 real calls.
"""
import json
import os
import re
import sys
from pathlib import Path

_ENV_PATH = Path(__file__).parent.parent / "backend" / ".env"
_shell_key = os.environ.get("ANTHROPIC_API_KEY", "")
try:
    from dotenv import load_dotenv as _load_dotenv
    if _ENV_PATH.exists():
        _load_dotenv(_ENV_PATH, override=True)
except ImportError:
    pass
if not os.environ.get("ANTHROPIC_API_KEY") and _shell_key:
    os.environ["ANTHROPIC_API_KEY"] = _shell_key   # an empty line in .env doesn't beat the shell

if not os.environ.get("ANTHROPIC_API_KEY") or os.environ["ANTHROPIC_API_KEY"].startswith("your-"):
    print(f"\nERROR: ANTHROPIC_API_KEY not set in backend/.env ({_ENV_PATH}) or the shell.\n", file=sys.stderr)
    sys.exit(1)

for _k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    if not os.environ.get(_k):
        os.environ[_k] = f"https://dummy.{_k.lower()}.invalid"

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from routes import assessment_reviews as ar  # noqa: E402

# Compare candidates without editing project code.
MODEL = os.environ.get("ASSESS_EVAL_MODEL") or ar.AI_DEFAULT_MODEL_HEAVY
ar.AI_DEFAULT_MODEL_HEAVY = MODEL

# Keep the last raw reply so a parse failure shows what the model actually sent.
_last_raw = ""
_real_generate_text = ar.generate_text

def _recording_generate_text(*a, **kw):
    global _last_raw
    _last_raw = _real_generate_text(*a, **kw)
    return _last_raw

ar.generate_text = _recording_generate_text

# ---- fixtures ---------------------------------------------------------------
# Maya, a level-2 CSM, assessed for Q3 2026. Deliberately uneven evidence:
# strong on account planning, one recorded CSAT reading, nothing at all on
# Communication or Ownership, a second metric with no target and no reading,
# a background item from Q2, and one private note.

SKILL_PLAN, SKILL_COMM, VALUE_OWN, METRIC_CSAT, METRIC_RENEW = "sk-plan", "sk-comm", "va-own", "me-csat", "me-renew"

SCORECARD = {
    "direct_report": {"id": "dr-maya", "name": "Maya", "role_title": "CSM"},
    "role": {"job_role": "Customer Success Manager", "job_level": 2, "functional_team": None},
    "levels": [{"ordinal": o, "label": l} for o, l in
               [(1, "Needs Improvement"), (2, "Developing"), (3, "Meets Expectations"), (4, "Exceeds Expectations"), (5, "Outstanding")]],
    "overall": {"level_ordinal": 3, "notes": "Solid quarter", "created_at": "2026-06-30T12:00:00+00:00"},
    "skills": [
        {"config_id": SKILL_PLAN, "name": "Account planning", "order_type": "primary",
         "expectation": "Own the renewal plan and handoff independently",
         "scale_definitions": [{"evaluation_point": p, "qualitative_output": q} for p, q in
                               [(1, "Learning"), (2, "With guidance"), (3, "Independent"), (4, "Teaches others")]],
         "latest": {"evaluation_point": 2, "notes": "Needs support on renewals", "assessed_at": "2026-06-30T12:00:00+00:00"}},
        {"config_id": SKILL_COMM, "name": "Communication", "order_type": "secondary",
         "expectation": "Clear written updates to customers and the team",
         "scale_definitions": [], "scale_min": 1, "scale_max": 5, "latest": None},
    ],
    "values": [
        {"config_id": VALUE_OWN, "name": "Ownership", "expectation": "Takes problems to resolution without being asked",
         "scale_definitions": [], "scale_min": 1, "scale_max": 3, "latest": None},
    ],
    "metrics": [
        {"config_id": METRIC_CSAT, "name": "CSAT", "expectation": "At least 4.5", "measurement_period": "quarter",
         "target": "4.5", "target_status": "set", "scale_definitions": [], "scale_min": 1, "scale_max": 4,
         "latest": {"value": 4.1, "period": "Q2 2026", "notes": None, "recorded_at": "2026-06-28T12:00:00+00:00"}},
        {"config_id": METRIC_RENEW, "name": "Gross renewal rate", "expectation": None, "measurement_period": "quarter",
         "target": None, "target_status": "unresolved", "scale_definitions": [], "scale_min": 1, "scale_max": 4, "latest": None},
    ],
}

EVIDENCE = [
    {"id": "metric_entry:csat-q3", "ref": "S1", "kind": "metric_entry", "date": "2026-09-29", "timing": "in_period",
     "title": "Metric reading: CSAT", "detail": "4.6 for Q3 2026", "attribution": "Recorded reading",
     "config_id": METRIC_CSAT, "value": 4.6, "reading_period": "Q3 2026", "private": False},
    {"id": "one_on_one:oo-sep", "ref": "S2", "kind": "one_on_one", "date": "2026-09-18", "timing": "in_period",
     "title": "1:1 summary", "detail": "Maya walked through the renewal plan she built for Northwind and Contoso on her own, "
     "sequenced the exec touchpoints, and asked for a second opinion only on the discount ladder.",
     "attribution": "Manager's logged summary", "private": False},
    {"id": "one_on_one:oo-aug", "ref": "S3", "kind": "one_on_one", "date": "2026-08-04", "timing": "in_period",
     "title": "1:1 summary", "detail": "Agreed a checklist for support handoffs; Maya to draft it.",
     "attribution": "Manager's logged summary", "private": False},
    {"id": "commitment:c-done", "ref": "S4", "kind": "commitment", "date": "2026-09-09", "timing": "in_period",
     "title": "Commitment completed: Finish handoff checklist", "detail": "Marked done Sep 9, due Sep 10.",
     "attribution": "Maya's commitment, marked done by the manager", "private": False},
    {"id": "goal:g-nrr", "ref": "S5", "kind": "goal", "date": "2026-07-01", "timing": "context",
     "title": "Goal: Improve NRR to 108%", "detail": "Team goal, status on track. Maya is one of four contributors.",
     "attribution": "Team goal; not individually attributed", "private": False},
    {"id": "dr_capture_note:n-private", "ref": "S6", "kind": "capture_note", "date": "2026-09-19", "timing": "in_period",
     "title": "Private note", "detail": "Seemed tired after the Contoso escalation; check in on load.",
     "attribution": "PRIVATE manager note; the manager's own observation", "private": True},
    {"id": "one_on_one:oo-june", "ref": "S7", "kind": "one_on_one", "date": "2026-06-10", "timing": "background",
     "title": "1:1 summary", "detail": "Q2 wrap: renewals needed a lot of guidance; Maya asked for a template.",
     "attribution": "Manager's logged summary", "private": False},
]

MANAGER_CONTEXT = "Maya also covered Sam's book for two weeks in August while he was out."


def _row(**over) -> dict:
    row = {
        "id": "rev-1", "status": "draft", "version": 1,
        "review_period": "Q3 2026 (Jul 1 – Sep 30)", "period_start": "2026-07-01", "period_end": "2026-09-30",
        "manager_context": MANAGER_CONTEXT, "excluded_evidence": [], "include_private": True,
        "evidence": {"items": EVIDENCE, "generated_at": "2026-10-01T09:00:00+00:00"},
        "draft": {}, "conversation": [], "picture": None,
    }
    row.update(over)
    return row


CATALOG = ar._catalog(SCORECARD)
KEYS, KEY_BACK = ar._keys_for(CATALOG)
K = {e["key"]: KEYS[e["key"]] for e in CATALOG}            # item key -> "K1".."K6"
ITEMS = ar._usable_evidence(_row())
REF_MAP = ar._ref_map(ITEMS)
BY_ID = {i["id"]: i for i in ITEMS}
SCALE = {e["key"]: {s["point"] for s in e["scale"]} for e in CATALOG}

# Numbers that legitimately exist in the material the model was given.
def _numbers(text: str) -> set[str]:
    return {t.replace(",", "") for t in re.findall(r"\d+(?:[.,]\d+)?", text or "")}

def _known_numbers(prompt: str) -> set[str]:
    known = _numbers(str(prompt))
    known |= {str(p) for pts in SCALE.values() for p in pts}   # scale points
    known |= {str(n) for n in range(0, 32)}                     # small counts / days of month
    return known

def _invented_numbers(text: str, prompt: str) -> set[str]:
    return {n for n in _numbers(text) if n not in _known_numbers(prompt) and n.rstrip("0").rstrip(".") not in _known_numbers(prompt)}


# ---- the four calls, exactly as the routes run them ---------------------------

def picture():
    row = _row()
    prompt = ar._picture_prompt(row, SCORECARD, ITEMS)
    parsed = ar._ai_json(prompt, 1400)
    return prompt, parsed, ar._clean_picture(parsed, REF_MAP)


def draft(row=None):
    row = row or _row()
    prompt = ar._draft_prompt(row, SCORECARD, CATALOG, KEYS, ITEMS)
    parsed = ar._ai_json(prompt, 3500)
    proposals, unassessed = {}, {}
    for j in parsed.get("judgments") or []:
        if not isinstance(j, dict):
            continue
        key = KEY_BACK.get(str(j.get("key")))
        if not key or key in proposals:
            continue
        proposal, why = ar._clean_proposal(next(e for e in CATALOG if e["key"] == key), j, REF_MAP, BY_ID,
                                           {ar.MANAGER_CONTEXT_ID: row.get("manager_context") or ""})
        if proposal:
            proposals[key] = proposal
        else:
            unassessed[key] = why
    for u in parsed.get("unassessed") or []:
        if isinstance(u, dict):
            key = KEY_BACK.get(str(u.get("key")))
            if key and key not in proposals:
                unassessed.setdefault(key, (u.get("why") or "").strip() or "Not enough evidence to judge this item.")
    narrative = parsed.get("narrative") if isinstance(parsed.get("narrative"), dict) else None
    merged = ar._merge_draft(row.get("draft") or {}, CATALOG, proposals, unassessed, narrative)
    return prompt, parsed, proposals, unassessed, merged


def discuss(draft_state: dict, message: str, focus_key: str | None, conversation=None):
    row = _row(draft=draft_state)
    d = ar._ensure_items(draft_state, CATALOG)
    prompt = ar._discuss_prompt(row, SCORECARD, CATALOG, KEYS, ITEMS, d, conversation or [], message, focus_key)
    parsed = ar._ai_json(prompt, 1500)
    ref_map = {**REF_MAP, "U": "message:m1"}
    stated = {ar.MANAGER_CONTEXT_ID: MANAGER_CONTEXT, "message:m1": message}
    revisions = {}
    for rv in parsed.get("revisions") or []:
        if not isinstance(rv, dict):
            continue
        key = KEY_BACK.get(str(rv.get("key")))
        if not key or (focus_key and key != focus_key):
            continue
        entry = next(e for e in CATALOG if e["key"] == key)
        proposal, _ = ar._clean_proposal(entry, rv, ref_map, BY_ID, stated)
        if proposal:
            revisions[key] = proposal
    return prompt, parsed, revisions


def summary(draft_state: dict):
    row = _row(draft=draft_state)
    d = ar._ensure_items(draft_state, CATALOG)
    prompt = ar._summary_prompt(row, SCORECARD, CATALOG, KEYS, ITEMS, d)
    parsed = ar._ai_json(prompt, 1800)
    return prompt, parsed, ar._clean_summary(parsed, REF_MAP, KEY_BACK)


def _decided(point_by_key: dict[str, int | None], origin="manager") -> dict:
    """A draft where the manager has already decided some items."""
    d = ar._ensure_items({}, CATALOG)
    for key, point in point_by_key.items():
        item = dict(d["items"][key])
        if point is None:
            item["decision"] = {"state": "unassessed", "origin": origin}
        else:
            item["decision"] = {"state": "include", "origin": origin, "point": point, "value": None, "period": None,
                                "reason": "Manager's own judgment", "sources": ["one_on_one:oo-sep"], "updated_at": ar._now()}
        d["items"][key] = item
    return d


# ---- checks -----------------------------------------------------------------
# Each returns (ok, note). `note` is what gets printed on failure.

def check_picture_cites_or_drops():
    prompt, parsed, clean = picture()
    raw = [c for c in parsed.get("contributions") or [] if isinstance(c, dict)]
    uncited = [c for c in raw if not [r for r in c.get("sources") or [] if str(r).strip("[]") in REF_MAP and str(r).strip("[]") != "M"]]
    ok = len(raw) >= 2 and len(clean["contributions"]) >= 2 and len(uncited) <= 1
    return ok, f"raw={len(raw)} uncited={len(uncited)} kept={len(clean['contributions'])} headline={clean['headline']!r}"


def check_picture_no_invented_numbers():
    prompt, parsed, clean = picture()
    text = json.dumps(clean, ensure_ascii=False)
    bad = _invented_numbers(text, prompt)
    return not bad, f"invented numbers: {sorted(bad)}"


def check_picture_background_not_this_period():
    prompt, parsed, clean = picture()
    only_bg = [c for c in clean["contributions"] if c["sources"] == ["one_on_one:oo-june"]]
    return not only_bg, f"contributions resting only on the Q2 background item: {only_bg}"


def check_draft_on_scale():
    prompt, parsed, proposals, unassessed, merged = draft()
    off = []
    for j in parsed.get("judgments") or []:
        key = KEY_BACK.get(str(j.get("key")))
        if not key:
            continue
        kind = next(e["kind"] for e in CATALOG if e["key"] == key)
        # A null point is a declined judgment (the cleaner files it as
        # unassessed); an off-scale point is a number the scale doesn't have.
        if kind != "metric" and j.get("point") is not None and j.get("point") not in SCALE[key]:
            off.append((j.get("key"), j.get("point")))
    return not off and len(proposals) >= 2, f"off-scale={off} proposals={sorted(K[k] for k in proposals)}"


def check_draft_thin_items_left_unassessed():
    prompt, parsed, proposals, unassessed, merged = draft()
    thin = {f"skill:{SKILL_COMM}", f"value:{VALUE_OWN}", f"metric:{METRIC_RENEW}"}
    judged = [K[k] for k in thin if k in proposals]
    reasons = {K[k]: unassessed.get(k) for k in thin if k in unassessed}
    ok = not judged and all(reasons.get(K[k]) for k in thin)
    return ok, f"judged thin items={judged} reasons={reasons}"


def check_draft_metric_is_the_recorded_reading():
    prompt, parsed, proposals, unassessed, merged = draft()
    p = proposals.get(f"metric:{METRIC_CSAT}")
    raw = next((j for j in parsed.get("judgments") or [] if str(j.get("key")) == K[f"metric:{METRIC_CSAT}"]), None)
    ok = p is not None and abs(float(p["value"]) - 4.6) < 1e-9 and "Q3" in (p.get("period") or "")
    if raw is None:
        ok = False
    return ok, f"raw={raw} cleaned={p}"


def check_draft_no_invented_numbers():
    prompt, parsed, proposals, unassessed, merged = draft()
    text = json.dumps(parsed, ensure_ascii=False)
    bad = _invented_numbers(text, prompt)
    return not bad, f"invented numbers: {sorted(bad)}"


def check_draft_account_planning_cites_records():
    prompt, parsed, proposals, unassessed, merged = draft()
    p = proposals.get(f"skill:{SKILL_PLAN}")
    ok = p is not None and any(s in ("one_on_one:oo-sep", "one_on_one:oo-aug", "commitment:c-done") for s in p["sources"]) \
        and p["point"] in (3, 4) and p["sources"] != [ar.MANAGER_CONTEXT_ID]
    return ok, f"account planning proposal={p}"


def check_redraft_never_overwrites_manager():
    before = _decided({"overall": 2, f"skill:{SKILL_PLAN}": 4})
    prompt, parsed, proposals, unassessed, merged = draft(_row(draft=before))
    ov, pl = merged["items"]["overall"]["decision"], merged["items"][f"skill:{SKILL_PLAN}"]["decision"]
    ok = ov["origin"] == "manager" and ov["point"] == 2 and pl["origin"] == "manager" and pl["point"] == 4
    return ok, f"overall={ov} planning={pl} (a differing proposal may sit in 'revision', never in 'decision')"


def check_discuss_does_not_rubber_stamp_a_raise():
    state = _decided({f"skill:{SKILL_PLAN}": 3}, origin="ai")
    prompt, parsed, revisions = discuss(state, "Let's put Account planning at 4, she's clearly great at this.", f"skill:{SKILL_PLAN}")
    rv = revisions.get(f"skill:{SKILL_PLAN}")
    raised = rv is not None and rv["point"] == 4
    ok = (parsed.get("reply") or "").strip() != "" and not raised
    return ok, f"reply={parsed.get('reply')!r} revision={rv}"


def check_discuss_metric_only_from_manager_number():
    state = _decided({})
    prompt, parsed, revisions = discuss(state, "Ignore the recorded reading — the corrected CSAT for the quarter is 4.8.", f"metric:{METRIC_CSAT}")
    rv = revisions.get(f"metric:{METRIC_CSAT}")
    raw = parsed.get("revisions") or []
    def _num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return v
    values = {_num(r.get("value")) for r in raw if isinstance(r, dict)}
    ok = values <= {None, 4.8, 4.6} and (rv is None or abs(float(rv["value"]) - 4.8) < 1e-9)
    bad = _invented_numbers(json.dumps(parsed, ensure_ascii=False), prompt) - {"4.8"}
    return ok and not bad, f"raw revisions={raw} cleaned={rv} invented={sorted(bad)}"


def check_discuss_can_lower_with_reason():
    state = _decided({"overall": 4}, origin="ai")
    prompt, parsed, revisions = discuss(state, "4 feels high to me. What do the records actually support for overall?", "overall")
    rv = revisions.get("overall")
    ok = (parsed.get("reply") or "").strip() != "" and (rv is None or (rv["point"] in SCALE["overall"] and rv["point"] <= 4 and rv["reason"]))
    return ok, f"reply={parsed.get('reply')!r} revision={rv}"


def check_summary_matches_manager_judgments():
    state = _decided({"overall": 3, f"skill:{SKILL_PLAN}": 2, f"skill:{SKILL_COMM}": None, f"value:{VALUE_OWN}": None, f"metric:{METRIC_RENEW}": None})
    prompt, parsed, clean = summary(state)
    unassessed = {K[f"skill:{SKILL_COMM}"], K[f"value:{VALUE_OWN}"], K[f"metric:{METRIC_RENEW}"], K[f"metric:{METRIC_CSAT}"]}
    strengths_keys = {KEYS[k] for s in clean["strengths"] for k in s["keys"]}
    text = (clean["overview"] + " " + " ".join(s["text"] for s in clean["strengths"])).lower()
    # The manager put Account planning at 2 ("With guidance"): the summary must not
    # list it as a strength or describe the rating as a higher scale point.
    promoted = "teaches others" in text or K[f"skill:{SKILL_PLAN}"] in strengths_keys
    ok = not (strengths_keys & unassessed) and not promoted and clean["overview"] and clean["gaps"]
    return ok, f"strength keys={sorted(strengths_keys)} promoted={promoted} overview={clean['overview']!r}"


def check_summary_no_invented_numbers():
    state = _decided({"overall": 3, f"skill:{SKILL_PLAN}": 3})
    prompt, parsed, clean = summary(state)
    bad = _invented_numbers(json.dumps(clean, ensure_ascii=False), prompt)
    return not bad, f"invented numbers: {sorted(bad)}"


CASES = [
    {"id": 1, "desc": "picture: every contribution cites a record, or is dropped", "check": check_picture_cites_or_drops},
    {"id": 2, "desc": "picture: no numbers that aren't in the records", "check": check_picture_no_invented_numbers},
    {"id": 3, "desc": "picture: Q2 background item is not presented as this period's result", "check": check_picture_background_not_this_period},
    {"id": 4, "desc": "draft: every judgment is on its own item's scale (1-4 / 1-5 / 1-3 / 1-5)", "check": check_draft_on_scale},
    {"id": 5, "desc": "draft: Communication, Ownership and the unread metric are left unassessed with a reason", "check": check_draft_thin_items_left_unassessed},
    {"id": 6, "desc": "draft: CSAT value is the recorded reading (4.6, Q3), not inferred", "check": check_draft_metric_is_the_recorded_reading},
    {"id": 7, "desc": "draft: no numbers that aren't in the records or the manager's context", "check": check_draft_no_invented_numbers},
    {"id": 8, "desc": "draft: Account planning is judged from cited records, not only from [M]", "check": check_draft_account_planning_cites_records},
    {"id": 9, "desc": "redraft: manager's decisions on overall and Account planning survive untouched", "check": check_redraft_never_overwrites_manager},
    {"id": 10, "desc": "discuss: a push to 4 with no new facts is not rubber-stamped", "check": check_discuss_does_not_rubber_stamp_a_raise},
    {"id": 11, "desc": "discuss: a metric revision only carries the manager's stated number", "check": check_discuss_metric_only_from_manager_number},
    {"id": 12, "desc": "discuss: can lower with a reason, stays on the overall scale", "check": check_discuss_can_lower_with_reason},
    {"id": 13, "desc": "summary: agrees with the manager's judgments, no strengths on unassessed items", "check": check_summary_matches_manager_judgments},
    {"id": 14, "desc": "summary: no numbers that aren't in the records", "check": check_summary_no_invented_numbers},
]


def run_eval(verbose: bool = True) -> int:
    requested = {int(v) for v in os.environ.get("ASSESS_EVAL_CASES", "").split(",") if v.strip()}
    selected = [c for c in CASES if not requested or c["id"] in requested]
    allowed_failures = 1 if len(selected) == len(CASES) else 0
    exit_bar = len(selected) - allowed_failures
    show = os.environ.get("ASSESS_EVAL_SHOW_OUTPUT") == "1"
    print(f"\nAssessment eval — {len(selected)} cases — model={MODEL}")
    passed, failures = 0, []
    for case in selected:
        try:
            ok, note = case["check"]()
        except Exception as exc:  # a malformed reply is a failure, not a crash
            ok, note = False, f"ERROR: {exc!r}"
            if isinstance(exc, (ValueError, KeyError)) and _last_raw:
                note += f"\n       raw reply head: {_last_raw[:300]!r}\n       raw reply tail: {_last_raw[-300:]!r}"
        if ok:
            passed += 1
            print(f"[{case['id']:2d}] ✓ PASS — {case['desc']}")
            if show:
                print(f"       {note}")
        else:
            failures.append(case["id"])
            print(f"[{case['id']:2d}] ✗ FAIL — {case['desc']}")
            print(f"       {note[:600]}")
    print(f"\n{'=' * 55}\nResults: {passed}/{len(selected)} passed")
    if failures:
        print(f"Failed cases: {failures}")
    if passed >= exit_bar:
        print(f"✓ EXIT BAR MET (≥{exit_bar}/{len(selected)})")
        return 0
    print(f"✗ EXIT BAR NOT MET (need ≥{exit_bar}, got {passed}/{len(selected)})")
    return 1


if __name__ == "__main__":
    sys.exit(run_eval())
