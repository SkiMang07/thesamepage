"""
Context Engine — shared plumbing for the retrieval + agent-integration layer
(build-plan Session IV), the Brain visualization's data source (build-plan
Session V), and staleness/precedence surfacing (build-plan Session VI). Not a
route — routes/documents.py and routes/one_on_ones.py call into this module.
See docs/CONTEXT_ENGINE_BUILD_PLAN.md's "Session IV", "Session V", and
"Session VI" sections for the specs this implements, and docs/CONTEXT_ENGINE.md
for the framework (the "metadata spine", "scope cascades", "two-tier
retrieval", "freshness, decay, and precedence", and "the Brain" sections).

=== Session IV: two-tier retrieval ===

Call get_relevant_context() from any existing generate_text() call site
(COO/domain agents) that wants org context as an additional input, then
record_citations() after the call if the retrieved documents were actually
embedded in the prompt that was sent. Session IV pilots exactly one call
site (routes/one_on_ones.py's /prep) — wiring the other generate_text() call
sites (wrapup, assessments, dashboard insights) is future work.

Two-tier retrieval, per the framework doc:
  Tier one (cheap):  search confirmed documents' summary_card, scoped by the
                      org_unit cascade (a team's own docs + its department's
                      + the company's — more-specific wins on conflict).
  Tier two (costly):  pull full extracted_text ONLY for the top-ranked
                      matches from tier one. Full decks never get bulk-
                      loaded into a prompt — this is the whole point of the
                      two-tier design.

Ranking heuristic (as of Session VI): scope specificity first (the framework
doc's precedence rule), then decay-weighted novelty (_decay_multiplier() —
see below), then recency of effective_date as a final tiebreak. Session
IV shipped this without decay; Session VI wired decay in, per the build
plan's "decay weight ... read by both retrieval ranking (Session IV) and
Brain fill (Session V)".

=== Session V: the Brain's coverage data ===

compute_category_coverage() is what routes/documents.py's GET /coverage
calls. Per category: a fill score (decay-weighted novelty of the BEST
confirmed doc, never count-weighted — the framework doc's own example is
"ten junk uploads move nothing; one current strategy doc lights a region"),
the confirmed docs behind it for the click-through view, a static
first-person gap question (Librarian voice) for what's missing, how many
times a doc in that category was cited in the last 7 days (credit
flow-back), and (as of Session VI) an optional proactive staleness prompt —
see below.

=== Session VI: staleness + precedence surfacing ===

Three pieces, all "flag, don't auto-resolve" per the framework doc's
precedence section:

1. Decay is now canonical. _decay_multiplier() (below) is the ONE confidence
   curve both get_relevant_context()'s ranking and compute_category_coverage()'s
   fill score read — no more separate per-session versions. Same curve
   Session V shipped; what changed is that Session IV's ranking now uses it
   too, per the build plan's explicit ask.
2. find_scope_conflicts() — two confirmed docs, same category, overlapping
   scope (via the same ancestor-chain logic _scope_cascade() already walks
   for retrieval), and disagreeing effective_dates, get flagged as a
   potential conflict with a Librarian-voice message — never silently
   resolved, matching the framework doc's "your strategy doc predates the
   pivot announced in March — is it still current?" example.
3. compute_category_coverage() also flags a `staleness_prompt` on a category
   when its fill-driving ("load-bearing") document has decayed past
   _STALENESS_MULTIPLIER_THRESHOLD — the first Mode-B (proactive, not
   user-requested — see docs/SESSION_HISTORY.md Session 25's Mode A/Mode B
   distinction) behavior for this feature. It's proactive in the sense that
   it surfaces without the manager asking a question, but it's computed
   synchronously on GET /coverage, not from an actual background job —
   there's no scheduler/worker in this codebase yet, so "proactive" here
   means "shown unprompted when the manager visits the page," a scoped-down
   reading of Mode B appropriate to "scoped small" per the build plan.

Only status='confirmed' documents are eligible for retrieval, the Brain, or
conflict/staleness detection — pending_review/processing/failed rows are
excluded everywhere in this module.

No embeddings / vector store — this codebase has no precedent for one, org
document counts are small in v1, and scope + novelty + recency/decay is a
simple, explainable, cheap-to-verify heuristic. Revisit only if usage shows
it's missing genuinely relevant docs a semantic search would catch.
"""
from datetime import date, timedelta

# Bounds how many documents get FULL extracted_text pulled into a prompt
# (tier two). Judgment call, not discussed with Andrew: decks can run long,
# and this is a $20/mo product — 4 keeps a single retrieval call's added
# prompt size bounded even if an org's context library grows. Revisit if
# real usage shows 4 is too few to answer well.
_MAX_RETRIEVED_DOCS_DEFAULT = 4

# Guards a malformed/cyclic org_units.parent_unit_id chain — the schema has
# no DB-level cycle prevention on that self-reference. Org hierarchies in
# this product are two levels (department/team) plus the implicit company
# root, so 10 is generous headroom, not a tuned limit.
_MAX_SCOPE_WALK_STEPS = 10

_CATEGORY_LABELS = {
    "where_we_are_going": "Where we're going",
    "who_we_are_and_how_we_operate": "Who we are & how we operate",
    "who_we_serve": "Who we serve",
    "what_we_offer": "What we offer",
    "how_people_grow_here": "How people grow here",
}

# Static, first-person Librarian copy per category (build-plan Session V:
# "static first-person gap-question copy per category ... a lighter-weight
# stand-in for the deferred per-category-question novelty scoring"). Shown
# on every category's click-through regardless of current fill — per the
# framework doc, every region shows both what's known AND what's missing,
# since there's always room to teach the Librarian more.
_GAP_QUESTIONS = {
    "where_we_are_going": (
        "I don't know where your team is heading yet. A strategy doc, roadmap, or OKR narrative "
        "would help me answer ‘what is this team trying to achieve, and why?’"
    ),
    "who_we_are_and_how_we_operate": (
        "I don't know what your team believes or how it runs day to day. Values, operating norms, "
        "or a team charter would help me answer ‘how does this team operate?’"
    ),
    "who_we_serve": (
        "I don't know who this work is for yet. Customer personas, segment notes, or key-account "
        "context would help me answer ‘who do we serve, and what do they need?’"
    ),
    "what_we_offer": (
        "I don't know what your team actually offers. Pricing, a product overview, or a service "
        "catalog would help me answer ‘what do we sell or deliver, and on what terms?’"
    ),
    "how_people_grow_here": (
        "I don't know what growth looks like on this team yet. A career framework, leveling guide, "
        "or promotion criteria would help me answer ‘what does progress look like here?’"
    ),
}

# Bounds how many confirmed docs the Brain's click-through returns per
# category. This is a browse view (unlike get_relevant_context()'s
# prompt-bound tier two), so it can afford to be more generous — 20 is a
# judgment call, not discussed with Andrew, sized to "comfortably more than
# any org will have confirmed in one category for a while," not a tuned
# limit.
_MAX_COVERAGE_DOCS = 20

# A document with no computable age (evergreen, or effective_date unknown)
# still needs *some* decay behavior for stream/dated docs whose date the
# Librarian couldn't infer — 0.85 is a mild, not punitive, default: it's an
# unknown-age doc, not a known-old one.
_DECAY_UNKNOWN_DATE_MULTIPLIER = 0.85

# Below this decay multiplier, a category's load-bearing (fill-driving) doc
# earns a proactive staleness prompt (Session VI). 0.7 is a judgment call,
# not discussed with Andrew: it's past the "full weight" plateau of both
# curves (dated docs start decaying at 120 days, stream docs at 30) but well
# short of the floor, so the prompt fires while the doc is still usable but
# visibly aging — not only once it's nearly worthless. Evergreen docs never
# cross this (their multiplier is always 1.0), which is correct: a values
# doc isn't "aging" on a clock.
_STALENESS_MULTIPLIER_THRESHOLD = 0.7


# ---------------------------------------------------------------------------
# Scope cascade
# ---------------------------------------------------------------------------

def _scope_cascade(supabase, org_unit_id: str | None) -> list[dict]:
    """Walk org_units.parent_unit_id UP from org_unit_id (team -> department)
    and append the implicit company-wide tier. Returns an ordered list, MOST
    SPECIFIC FIRST — list index doubles as the specificity rank used both to
    select candidate documents and, per the framework doc's "more-specific
    wins on stated conflicts" rule, to order them in the formatted context
    block. Each entry: {"id": org_unit_id | None, "label": str}.

    org_unit_id=None (a direct report with no team assigned yet) returns
    just the company-wide tier — company docs still apply to everyone.
    """
    cascade: list[dict] = []
    current_id = org_unit_id
    seen: set[str] = set()
    for _ in range(_MAX_SCOPE_WALK_STEPS):
        if current_id is None or current_id in seen:
            break
        seen.add(current_id)
        rows = (
            supabase.table("org_units")
            .select("id,name,unit_type,parent_unit_id")
            .eq("id", current_id)
            .execute()
            .data
        )
        if not rows:
            break  # dangling/foreign id — stop walking rather than guess
        unit = rows[0]
        cascade.append({"id": unit["id"], "label": f"{unit['name']} ({unit['unit_type']})"})
        current_id = unit.get("parent_unit_id")
    cascade.append({"id": None, "label": "company-wide"})
    return cascade


def _fetch_scope_rows(supabase, non_null_ids: list[str], include_company_wide: bool) -> list[dict]:
    """document_scopes rows touching any tier in the cascade. Two separate
    queries (not a single .in_()) because Postgres/PostgREST's `in` filter
    does not match NULL — org_unit_id IS NULL (company-wide) has to be asked
    for with .is_() instead, same pattern already used elsewhere in this
    codebase (see one_on_ones.py's _find_planned_session)."""
    rows: list[dict] = []
    if non_null_ids:
        rows += (
            supabase.table("document_scopes")
            .select("document_id,org_unit_id")
            .in_("org_unit_id", non_null_ids)
            .execute()
            .data
        )
    if include_company_wide:
        rows += (
            supabase.table("document_scopes")
            .select("document_id,org_unit_id")
            .is_("org_unit_id", "null")
            .execute()
            .data
        )
    return rows


# ---------------------------------------------------------------------------
# Ranking
# ---------------------------------------------------------------------------

def _sort_key(doc: dict, specificity_by_doc: dict[str, int], fallback_rank: int, today: date) -> tuple:
    """Specificity first (the framework doc's precedence rule), then
    decay-weighted novelty (Session VI: the same _decay_multiplier() curve
    the Brain uses — a doc's raw novelty_score alone no longer decides
    ranking, an aging doc now ranks behind a fresher, slightly-less-novel
    one), then raw recency as a final tiebreak for docs that land at the
    same decayed score."""
    specificity = specificity_by_doc.get(doc["id"], fallback_rank)
    novelty = doc.get("novelty_score")
    novelty = novelty if isinstance(novelty, int) else 50  # shouldn't be null on a confirmed doc; neutral default if it is
    multiplier = _decay_multiplier(doc.get("freshness_class"), doc.get("effective_date"), today)
    decayed_score = novelty * multiplier
    effective_date = doc.get("effective_date")
    has_date = 0 if effective_date else 1  # known dates sort before unknown ones
    date_rank = 0
    if effective_date:
        try:
            date_rank = -date.fromisoformat(effective_date).toordinal()  # negate: later date -> smaller (sorts first)
        except ValueError:
            has_date = 1
    return (specificity, -decayed_score, has_date, date_rank)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_relevant_context(
    supabase,
    org_id: str,
    org_unit_id: str | None,
    today: date,
    max_docs: int = _MAX_RETRIEVED_DOCS_DEFAULT,
) -> list[dict]:
    """Tier-one search + tier-two fetch, in one call. Returns the top
    `max_docs` confirmed documents relevant to `org_unit_id`'s scope
    cascade, each with full `extracted_text` populated (None if the
    document somehow has none) and a `scope_label` for prompt transparency.
    Empty list if nothing is scoped to this cascade yet — every call site
    must handle that (an empty/new org's Context Engine has nothing to add).

    `today` (Session VI) drives the decay weighting in ranking — passed in
    rather than computed here so callers and tests control the clock
    explicitly, same convention compute_category_coverage() already uses.

    Relies on the caller's RLS-scoped client for org isolation on
    document_scopes/org_units (both are org-wide-readable policies, same
    trust level as the rest of the Context Engine — see schema.sql); the
    `documents` query below additionally filters org_id explicitly as
    defense in depth, since it's the table actually carrying document
    content.
    """
    cascade = _scope_cascade(supabase, org_unit_id)
    scope_rank = {tier["id"]: rank for rank, tier in enumerate(cascade)}
    scope_label = {tier["id"]: tier["label"] for tier in cascade}
    fallback_rank = len(cascade)

    non_null_ids = [tier["id"] for tier in cascade if tier["id"] is not None]
    include_company_wide = any(tier["id"] is None for tier in cascade)
    scope_rows = _fetch_scope_rows(supabase, non_null_ids, include_company_wide)
    if not scope_rows:
        return []

    # A document can carry multiple scopes (e.g. team AND department) — keep
    # its most specific (lowest-rank) match.
    specificity_by_doc: dict[str, int] = {}
    for row in scope_rows:
        rank = scope_rank.get(row["org_unit_id"])
        if rank is None:
            continue  # defensive only — the two queries above shouldn't surface anything outside the cascade
        doc_id = row["document_id"]
        if doc_id not in specificity_by_doc or rank < specificity_by_doc[doc_id]:
            specificity_by_doc[doc_id] = rank

    candidate_ids = list(specificity_by_doc.keys())
    if not candidate_ids:
        return []

    # Tier one: summary_card only, confirmed docs only.
    documents = (
        supabase.table("documents")
        .select("id,title,category,freshness_class,effective_date,summary_card,novelty_score")
        .eq("org_id", org_id)
        .eq("status", "confirmed")
        .in_("id", candidate_ids)
        .execute()
        .data
    )
    if not documents:
        return []

    documents.sort(key=lambda d: _sort_key(d, specificity_by_doc, fallback_rank, today))
    top_documents = documents[:max_docs]

    # Tier two: extracted_text, only for the docs that made the cut.
    top_ids = [d["id"] for d in top_documents]
    extracted_rows = (
        supabase.table("documents").select("id,extracted_text").in_("id", top_ids).execute().data
    )
    extracted_by_id = {r["id"]: r.get("extracted_text") for r in extracted_rows}

    results = []
    for doc in top_documents:
        rank = specificity_by_doc.get(doc["id"], fallback_rank)
        results.append({
            **doc,
            "extracted_text": extracted_by_id.get(doc["id"]),
            "scope_label": scope_label.get(cascade[rank]["id"] if rank < len(cascade) else None, "company-wide"),
        })
    return results


def format_context_block(retrieved_docs: list[dict]) -> str:
    """Render get_relevant_context()'s output as a ready-to-embed prompt
    section. Returns "" (not a section with nothing in it) when there is
    nothing to add, so callers can splice this straight into an f-string
    the same way _format_expectations_block() in one_on_ones.py already
    does for role expectations."""
    if not retrieved_docs:
        return ""

    lines = []
    for doc in retrieved_docs:
        category_label = _CATEGORY_LABELS.get(doc.get("category"), doc.get("category") or "uncategorized")
        effective = doc.get("effective_date") or "date unknown"
        body = doc.get("extracted_text") or doc.get("summary_card") or "(no content extracted)"
        lines.append(
            f'  • "{doc["title"]}" [{category_label} — {doc.get("scope_label", "")} — as of {effective}]\n'
            f"    {body}"
        )
    body_block = "\n".join(lines)
    return f"""
CONTEXT ENGINE — documents this org has taught the system, most-specific scope first (a team-level
document refines/overrides a company-wide one where they genuinely conflict):
{body_block}
Use these only where they are actually relevant to the notes below — do not force a connection just
because a document exists. If two documents disagree, prefer the more specific one, but say so if the
tension seems worth surfacing to the manager.
"""


def record_citations(supabase, user_id: str, document_ids: list[str], context: str | None = None) -> None:
    """Write one document_citations row per document actually embedded in an
    agent's prompt — the only new write path this session (build-plan
    Session IV spec: "write to document_citations whenever a doc is
    actually used in an answer"). Call this AFTER the generate_text() call
    that used format_context_block()'s output succeeds, passing the ids of
    the documents get_relevant_context() returned (not a superset of
    candidates that were considered and dropped in ranking — only what was
    actually sent to the model).

    No-ops on an empty list so call sites don't need to special-case "no
    context was retrieved" themselves.
    """
    if not document_ids:
        return
    rows = [{"document_id": doc_id, "cited_by": user_id, "context": context} for doc_id in document_ids]
    supabase.table("document_citations").insert(rows).execute()


# ---------------------------------------------------------------------------
# Session V — the Brain's coverage data
# ---------------------------------------------------------------------------

def _decay_multiplier(freshness_class: str | None, effective_date: str | None, today: date) -> float:
    """0.0-1.0 confidence weight for how much an aging document should still
    count. THE canonical decay curve as of Session VI — the one function both
    get_relevant_context()'s ranking and compute_category_coverage()'s fill
    score read, per the build plan's "decay weight ... read by both retrieval
    ranking (Session IV) and Brain fill (Session V)". Session V introduced
    this same curve as a per-session placeholder; Session VI's actual change
    was wiring it into retrieval too, not changing the math.

    evergreen:        no decay — values/charters aren't perishable on a clock.
    dated:             true as of a point but not perishable (an annual plan)
                       — full weight through 120 days, floors at 0.5 by 540.
    stream_instance:   perishable (a town hall deck, a monthly update) — full
                       weight only through 30 days, floors at 0.35 by 180.
    Anything else (missing/unrecognized freshness_class) falls back to the
    'dated' curve — the safer of the two non-evergreen options, since
    treating an unknown doc as perishable-fast would be the more aggressive
    (and more likely wrong) assumption.
    """
    if freshness_class == "evergreen":
        return 1.0
    if not effective_date:
        return _DECAY_UNKNOWN_DATE_MULTIPLIER
    try:
        age_days = (today - date.fromisoformat(effective_date)).days
    except ValueError:
        return _DECAY_UNKNOWN_DATE_MULTIPLIER
    if age_days <= 0:
        return 1.0  # a future-dated effective_date (e.g. an announced-but-not-yet-live plan) — full weight

    if freshness_class == "stream_instance":
        floor, full_through, floor_by = 0.35, 30, 180
    else:
        floor, full_through, floor_by = 0.5, 120, 540

    if age_days <= full_through:
        return 1.0
    if age_days >= floor_by:
        return floor
    return 1.0 - (1.0 - floor) * (age_days - full_through) / (floor_by - full_through)


def _format_staleness_prompt(category_label: str, doc: dict) -> str:
    effective = doc.get("effective_date") or "an unknown date"
    return (
        f'My best source for "{category_label}" is "{doc["title"]}" — as of {effective}, and it\'s '
        f"getting old. Is it still current, or is there something newer I should read?"
    )


def compute_category_coverage(supabase, org_id: str, today: date) -> list[dict]:
    """The Brain's data source (build-plan Session V; Session VI added
    staleness_prompt). One entry per of the five categories, always in the
    same fixed order (_CATEGORY_LABELS' order) so the frontend's grid
    position is stable across loads:

      category, label, fill_score (0-100, decay-weighted, quality- not
      count-weighted), doc_count, citations_this_week (credit flow-back,
      rolling 7 days), gap_question (static Librarian copy),
      staleness_prompt (Session VI — None unless the fill-driving doc has
      decayed past _STALENESS_MULTIPLIER_THRESHOLD), documents (up to
      _MAX_COVERAGE_DOCS, most-current first, for the click-through).

    fill_score is the MAX decayed score among a category's confirmed docs,
    not an average — matching the framework doc's own example ("ten junk
    uploads move nothing; one current strategy doc lights a region"). An
    average would let a pile of weak docs drag down a category that already
    has one excellent, current source — the opposite of what "quality-
    weighted, never count-weighted" is asking for.

    `today` is passed in (not computed via date.today() here) so callers —
    and tests — control the clock explicitly.
    """
    documents = (
        supabase.table("documents")
        .select("id,title,category,freshness_class,effective_date,summary_card,novelty_score")
        .eq("org_id", org_id)
        .eq("status", "confirmed")
        .execute()
        .data
    )

    by_category: dict[str, list[dict]] = {cat: [] for cat in _CATEGORY_LABELS}
    for doc in documents:
        cat = doc.get("category")
        if cat not in by_category:
            continue  # confirm_document() requires a valid category to reach status='confirmed' — defensive only
        novelty = doc.get("novelty_score")
        novelty = novelty if isinstance(novelty, int) else 0
        multiplier = _decay_multiplier(doc.get("freshness_class"), doc.get("effective_date"), today)
        by_category[cat].append({**doc, "decayed_score": round(novelty * multiplier), "decay_multiplier": multiplier})

    # Citations in the last 7 days, across every confirmed doc in one query,
    # then rolled up per category below. A rolling 7 days, not a calendar
    # week — the Brain has no Monday-anchored week boundary the way
    # Capacity's overview does.
    week_ago = (today - timedelta(days=7)).isoformat()
    all_doc_ids = [d["id"] for d in documents]
    recent_citations = (
        supabase.table("document_citations")
        .select("document_id")
        .in_("document_id", all_doc_ids)
        .gte("created_at", week_ago)
        .execute()
        .data
        if all_doc_ids
        else []
    )
    citations_by_doc: dict[str, int] = {}
    for row in recent_citations:
        citations_by_doc[row["document_id"]] = citations_by_doc.get(row["document_id"], 0) + 1

    results = []
    for cat, label in _CATEGORY_LABELS.items():
        cat_docs = by_category[cat]
        ranked = sorted(cat_docs, key=lambda d: -d["decayed_score"])[:_MAX_COVERAGE_DOCS]
        fill_score = max((d["decayed_score"] for d in cat_docs), default=0)
        citations_this_week = sum(citations_by_doc.get(d["id"], 0) for d in cat_docs)

        # Staleness prompt (Session VI) — the "load-bearing" doc is whichever
        # one is currently driving fill_score (the max). Only ever one
        # candidate: ties on decayed_score would mean two docs are equally
        # load-bearing, but flagging just the first is fine here since this
        # is a nudge, not an audit — the manager sees the actual doc list in
        # the click-through regardless.
        staleness_prompt = None
        load_bearing = max(cat_docs, key=lambda d: d["decayed_score"], default=None)
        if load_bearing is not None and load_bearing["decay_multiplier"] < _STALENESS_MULTIPLIER_THRESHOLD:
            staleness_prompt = _format_staleness_prompt(label, load_bearing)

        results.append({
            "category": cat,
            "label": label,
            "fill_score": fill_score,
            "doc_count": len(cat_docs),
            "citations_this_week": citations_this_week,
            "gap_question": _GAP_QUESTIONS[cat],
            "staleness_prompt": staleness_prompt,
            "documents": [
                {
                    "id": d["id"],
                    "title": d["title"],
                    "freshness_class": d.get("freshness_class"),
                    "effective_date": d.get("effective_date"),
                    "summary_card": d.get("summary_card"),
                    "novelty_score": d.get("novelty_score"),
                    "decayed_score": d["decayed_score"],
                    "citations_this_week": citations_by_doc.get(d["id"], 0),
                }
                for d in ranked
            ],
        })
    return results


# ---------------------------------------------------------------------------
# Session VI — conflict detection
# ---------------------------------------------------------------------------

def _build_unit_ancestor_chains(supabase, unit_ids: set) -> dict:
    """For each org_unit_id in unit_ids, the set of ids reachable by walking
    UP its ancestor chain (itself + parents + the implicit company-wide
    None tier) — reuses _scope_cascade(), the same walk retrieval already
    does, so "does scope A reach unit B" becomes one set-membership check
    instead of a fresh tree walk per comparison."""
    return {uid: {tier["id"] for tier in _scope_cascade(supabase, uid)} for uid in unit_ids}


def _scopes_overlap(ids_a: set, ids_b: set, chains: dict) -> bool:
    """Two scope sets overlap if either applies everywhere (company-wide,
    None in the set) or one side's unit is a self-or-ancestor of the
    other's — i.e. one document's scope cascades down to reach the other's
    audience. Two unrelated units (different departments, or teams under
    different departments) do NOT overlap even though both eventually roll
    up to the same org — "company" isn't a stored org_unit, so there's no
    shared ancestor row to (incorrectly) match on."""
    if None in ids_a or None in ids_b:
        return True
    for a in ids_a:
        chain_a = chains.get(a, {a, None})
        if any(b in chain_a for b in ids_b):
            return True
    for b in ids_b:
        chain_b = chains.get(b, {b, None})
        if any(a in chain_b for a in ids_a):
            return True
    return False


def _more_specific(ids_a: set, ids_b: set, chains: dict) -> bool | None:
    """True if scope-set A is more specific than B, False if B is more
    specific than A, None if they're peers (same tier — both company-wide,
    the same unit(s), or an ambiguous multi-scope mix this simplified
    single-hop check can't order). Only meaningful when the pair already
    overlaps per _scopes_overlap().

    Docs in this codebase almost always carry exactly one scope — the
    multi-scope case (a doc covering two regions' teams) is real per the
    framework doc but rare; this function still handles it, just
    conservatively (returns None — "can't tell" — rather than guessing —
    whenever the two scope sets don't cleanly nest one inside the other).
    """
    a_has_none = None in ids_a
    b_has_none = None in ids_b
    if a_has_none and b_has_none:
        return None
    if a_has_none:
        return False  # A is company-wide (broadest possible) -> B is more specific
    if b_has_none:
        return True

    # Both non-null: A is more specific if every element of A descends from
    # (or equals-but-then-the-other-direction-also-holds, handled by the
    # symmetric check below) some element of B. "b in chains[a]" reads as
    # "b is an ancestor-or-self of a" — so if some b != a satisfies that, a
    # is strictly more specific than b.
    a_more_specific = any(b in chains.get(a, {a}) and b != a for a in ids_a for b in ids_b)
    b_more_specific = any(a in chains.get(b, {b}) and a != b for a in ids_a for b in ids_b)
    if a_more_specific and not b_more_specific:
        return True
    if b_more_specific and not a_more_specific:
        return False
    return None  # peers, or an ambiguous multi-scope mix — no clear winner


def _format_conflict_message(more_recent: dict, less_recent: dict, more_specific_doc: dict | None) -> str:
    """more_recent/less_recent: the doc dicts (id, title, effective_date) —
    the newer and older of a conflicting pair. more_specific_doc: whichever
    doc is scoped more specifically, or None if they're peers."""
    if more_specific_doc is not None and more_specific_doc["id"] == less_recent["id"]:
        # The more-specific doc is the OLDER one — precisely the framework
        # doc's own "your strategy doc predates the pivot announced in
        # March" tension: specificity says one thing, recency says another.
        return (
            f'"{less_recent["title"]}" is more specific to this scope, but it\'s from '
            f'{less_recent["effective_date"]} — "{more_recent["title"]}" is more recent, from '
            f'{more_recent["effective_date"]}. Worth checking these still agree.'
        )
    return (
        f'"{more_recent["title"]}" ({more_recent["effective_date"]}) and "{less_recent["title"]}" '
        f'({less_recent["effective_date"]}) overlap and disagree on date — worth checking they still agree.'
    )


def find_scope_conflicts(supabase, org_id: str) -> list[dict]:
    """Session VI: two confirmed docs, same category, overlapping scope, and
    disagreeing effective_date get flagged — never auto-resolved, per the
    framework doc's "the conflict is surfaced to the manager, not silently
    resolved." Docs with no effective_date (most evergreen docs) can't be
    compared this way and are skipped — there's no date to disagree about.

    Returns one entry per conflicting PAIR, not deduplicated into per-doc
    groups — with v1 doc counts this reads as a few short, specific flags
    rather than one confusing merged one; revisit if a real org's doc count
    ever makes pairwise flagging noisy.
    """
    documents = (
        supabase.table("documents")
        .select("id,title,category,effective_date")
        .eq("org_id", org_id)
        .eq("status", "confirmed")
        .execute()
        .data
    )
    datable = [d for d in documents if d.get("effective_date")]
    if len(datable) < 2:
        return []

    doc_ids = [d["id"] for d in datable]
    scope_rows = (
        supabase.table("document_scopes").select("document_id,org_unit_id").in_("document_id", doc_ids).execute().data
    )
    scopes_by_doc: dict[str, set] = {}
    for row in scope_rows:
        scopes_by_doc.setdefault(row["document_id"], set()).add(row["org_unit_id"])

    unit_ids = {uid for uids in scopes_by_doc.values() for uid in uids if uid is not None}
    chains = _build_unit_ancestor_chains(supabase, unit_ids)

    by_category: dict[str, list[dict]] = {}
    for doc in datable:
        by_category.setdefault(doc["category"], []).append(doc)

    conflicts = []
    for cat, docs in by_category.items():
        for i in range(len(docs)):
            for j in range(i + 1, len(docs)):
                a, b = docs[i], docs[j]
                if a["effective_date"] == b["effective_date"]:
                    continue  # nothing to disagree about
                ids_a = scopes_by_doc.get(a["id"], set())
                ids_b = scopes_by_doc.get(b["id"], set())
                if not ids_a or not ids_b:
                    continue  # confirm_document() requires >=1 scope on any confirmed doc — defensive only
                if not _scopes_overlap(ids_a, ids_b, chains):
                    continue

                more_recent = a if a["effective_date"] > b["effective_date"] else b
                less_recent = b if more_recent is a else a
                more_specific_flag = _more_specific(ids_a, ids_b, chains)
                more_specific_doc = {True: a, False: b}.get(more_specific_flag)

                conflicts.append({
                    "category": cat,
                    "category_label": _CATEGORY_LABELS[cat],
                    "doc_a": {"id": a["id"], "title": a["title"], "effective_date": a["effective_date"]},
                    "doc_b": {"id": b["id"], "title": b["title"], "effective_date": b["effective_date"]},
                    "more_recent_id": more_recent["id"],
                    "more_specific_id": more_specific_doc["id"] if more_specific_doc else None,
                    "specificity_disagrees_with_recency": (
                        more_specific_doc is not None and more_specific_doc["id"] == less_recent["id"]
                    ),
                    "message": _format_conflict_message(more_recent, less_recent, more_specific_doc),
                })
    return conflicts
