# Context Engine

The org's shared document memory: managers upload real artifacts (strategy decks,
values docs, customer research, pricing), the Librarian extracts and classifies
them, a manager confirms, and confirmed docs then ground AI answers elsewhere in
the app. Three internal names — the Space (upload + review UI), the Librarian
(extraction/classification), the Brain (coverage map). None of them reach the
customer: the page is "Knowledge" in the nav and title, the coverage section is
"What it knows", and Librarian-voice lines render with no speaker label.

Framework doc: `docs/archive/scoping/CONTEXT_ENGINE.md`.
Surface: `/app/context`. Backend: `routes/documents.py` + `context_engine.py`.

## Data model

Four tables plus a private Supabase Storage bucket (`context-engine-docs`).

- `document_series` — groups recurring docs (monthly town halls) + cadence.
- `documents` — one per upload. `status`: `processing` → `pending_review` →
  `confirmed`, or `failed`. `confirmed_at` stays null until a human accepts the
  confirm card. `category`, `freshness_class`, `effective_date`, `summary_card`,
  `novelty_score` are Librarian-assigned. `confirmed_as_is` + `correction_log`
  record how much the manager changed.
- `document_scopes` — which org_unit(s) a doc applies to. `org_unit_id = null`
  means company-wide (`org_units` has no "company" row).
- `document_citations` — usage ledger, one row per AI answer that cited a doc.

**Org-scoped, not owner-scoped** — a deliberate departure from
goals/projects/direct_reports. Docs are shared org context, so any manager in the
org can read and write them, same trust level as `org_units` / `role_levels`.

**Scope is application-layer, not an RLS boundary.** `document_scopes` drives
retrieval relevance, not security. Real per-org-unit RLS on raw document text
would be new ground — every existing cross-manager read in this app solves that
by returning aggregates only. Revisit when there's a second manager to test
against.

**Storage path convention:** `{org_id}/{document_id}/{original_filename}`.
`storage.objects` policies check `(storage.foldername(name))[1] =
current_org_id()::text`.

`document_scopes` uses two partial unique indexes rather than one
`UNIQUE(document_id, org_unit_id)` — see ENGINEERING.md on NULL and uniqueness.

## Upload pipeline

`POST /api/documents/upload` runs synchronously: raw file to the bucket →
`documents` row at `status='processing'` → text → **one** structured Librarian
call (category / freshness_class / effective_date / summary_card /
novelty_score / series together, per document — not one call per category
question) → row set to `pending_review`. Any failure sets `status='failed'`.

**We read the text; the model only files it.** `extracted_text` is the
document's own text: the file itself for `.md`/`.txt`, and for PDF and PPTX
(PPTX→PDF via headless LibreOffice first) the PDF's text layer read locally
with `pypdf`. The Librarian gets that text (first 120,000 characters) and
returns only the small filing fields — `max_tokens` 1500, 120s timeout. It is
never asked to copy the document back: a reply that long runs past the token
cap and the HTTP timeout, the JSON comes back cut off, and the upload fails.
That is what failed the first real upload, a ~21KB principles doc.

Only a PDF with no usable text layer (under 200 characters — a scan, or slides
that are all pictures) is sent to the model as a document to read and
transcribe (`generate_text_from_document`, `max_tokens` 4000). A long scan can
still be cut off there; it fails cleanly and the manager can delete it.

`document_scopes` is deliberately **not** written here. Scope is a
user-confirmed field. A doc with no scope row is invisible to retrieval until a
human sets one.

Railway needs the `libreoffice` package, added explicitly in
`backend/nixpacks.toml`, or the PPTX path 502s in production. That package is
large and lengthens build time noticeably — an accepted tradeoff.

`utils.py` propagates the user JWT to `client.options.headers` as well as
`client.postgrest`, because `client.storage` builds its session from the former.
Without it, Storage requests authenticate as the anon key and every upload is
silently rejected by RLS.

## Confirm card

`PUT /api/documents/{id}/confirm` validates category/freshness, dedupes
`org_unit_ids` (at most one null), **requires at least one scope** (422
otherwise), rejects org units outside the caller's org, diffs the submission
against the Librarian's proposal to set `confirmed_as_is` / `correction_log`, and
replaces `document_scopes` delete-then-insert.

`DELETE /api/documents/{id}` works at any status and is best-effort on Storage
cleanup — a practical escape hatch, not in the original spec.

The scope picker defaults to **nothing selected**, not "Company-wide" — scope is
something a human asserts.

## Retrieval

`context_engine.py`'s `get_relevant_context(supabase, org_id, org_unit_id, today,
max_docs=4)`.

`_scope_cascade()` walks `org_units.parent_unit_id` **up** from the target unit
(team → department) and appends the implicit company-wide tier, most-specific
first. This is the same tree `led_org_unit_ids()` walks down: "does this doc apply
here?" is the inverse question of "what can this person see?".

Candidates come from `document_scopes` joined against that cascade,
`status='confirmed'` only. Ranking is `(scope specificity, −decayed_score,
has_date, date_rank)` — decay-weighted, so a stale high-novelty doc can lose to a
fresher lower-novelty one at the same scope tier. Only the top `max_docs` (4, a
cost/prompt-size judgment call) get a second query for full `extracted_text`;
tier one never touches that column.

`format_context_block()` renders an embeddable prompt section, `""` when nothing
was retrieved. Each document's text is capped at 24,000 characters (~6,000
tokens, with a "not included" marker) so a long PDF can't put a whole book
into every prep; a principles-sized doc goes in whole. `record_citations()` writes one `document_citations` row per doc
actually embedded.

**No AI call inside retrieval.** Ranking is plain Python over already-fetched
metadata. Revisit only if the heuristic proves insufficient against real usage.

**Call sites: 1:1 prep.** `assemble_prep_inputs()` retrieves for the report's
org unit and splices the block into `_build_prep_prompt()` after role
expectations, before the manager's raw notes; it is shared by
`POST /api/one-on-ones/prep` and the parked overnight prep. The sheet's "Drew
on" line names each embedded document as "<title> (Knowledge)". The Scribe
searches confirmed docs separately (`search_confirmed_documents()`). Wrap-up,
assessments, and the dashboard insight are not wired to it.

## Decay

`_decay_multiplier(freshness_class, effective_date, today)` is canonical — shared
by retrieval ranking and Brain fill. Linear and freshness-class-aware:

| Class | Curve |
|---|---|
| `evergreen` | 1.0 always |
| `dated` | full weight through 120 days, floors at 0.5 by 540 |
| `stream_instance` | full weight through 30 days, floors at 0.35 by 180 |
| missing/unparseable | flat 0.85 |

## The Brain

`GET /api/documents/coverage` → `{"categories": [...], "conflicts": [...]}`.
Org-wide, not org_unit-scoped — one coverage map per org, not a per-team lens.

`compute_category_coverage()` returns all five categories always, in fixed order:

- `fill_score` — the **MAX** decayed novelty score in that category, not an
  average. Ten junk uploads move nothing; one current strategy doc lights a
  region.
- `doc_count`, `citations_this_week` (rolling 7-day rollup).
- `gap_question` — a static hand-written Librarian-voice string per category. No
  AI call.
- `staleness_prompt` — fires only when the category's fill-driving doc has decayed
  below 0.7. Evergreen docs, fresh docs, and empty categories never trigger it.
- Up to 20 confirmed docs for the click-through, sorted by decayed score.

`find_scope_conflicts()` flags two confirmed docs in the same category whose
scopes overlap (either company-wide, or one's unit is a self-or-ancestor of the
other's) **and** whose `effective_date`s differ. It reuses `_scope_cascade()`'s
ancestor walk rather than new tree logic. `specificity_disagrees_with_recency` is
set when the more-specific doc is also the older one — the "your team charter
predates the pivot" case. **Conflicts are surfaced, never auto-resolved.**

Frontend renders a 5-category grid of inline-SVG radial rings (no charting
dependency; the filled arc's opacity scales with `fill_score`), an amber "Aging"
pill driven by `staleness_prompt`, and a `ConflictBanner` per conflict. The Brain
is fetched separately from the page's main `Promise.all` so a Brain failure can't
block the upload flow.

## Not verified live

A `.md` upload has run end to end in production: stored in Storage, filed,
confirmed with scopes. Still unexercised live: a PDF or PPTX upload (and so
the PPTX→PDF conversion on Railway), a prep sheet that cites a document, and a
real conflicting-document scenario created through the actual UI.
`backend/tests/test_knowledge_to_prep.py` covers upload → confirm → prep
("Drew on") locally for all three file types with fictional fixtures.
