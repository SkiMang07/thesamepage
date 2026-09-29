# Setup mode, chunk B: notes dump on-ramp (plan)

Written 2026-09-29. Status: PLAN, not built. Read `SETUP_MODE_BRIEF.md` first. Open questions are at the bottom; the build starts once Andrew answers them.

## What chunk B is

One entry point, "Add what you already have". The manager talks, types, pastes or attaches anything from past conversations and information. One button-triggered AI call turns it into drafts. The manager reviews a ranked, capped list and saves only what they keep. Anything not found stays a remaining setup step. Never required; "nothing to add" is a valid answer.

## What is reused (nothing new to invent)

- **Input:** `NoteField` (dictation built in) for talk / type / paste. File attach follows `JdInput`'s pattern (drop zone, same accept list).
- **File to text:** `_extract_docx_text` (roles_import) and `_extract_pdf_text` (role_expectations); .txt/.md read directly. A scanned PDF with no text layer is refused with a plain message in v1 (paste it instead).
- **AI call:** one `ai_core.generate_text()` call, JSON out, same parse-and-validate pattern as `roles_import.draft_role_import`. `AI_DEFAULT_MODEL_HEAVY`.
- **Saves:** existing tables and routes' validation. No new tables, so **no migration** (`knowledge_skipped_at` stays unused).
  - org structure -> `org_units` (same validation as `POST /api/org-units`)
  - role / team for a person -> `direct_reports.role_level_id / org_unit_id / role_title`
  - goals -> `goals` (same validation as goals routes; level, owner, due date, success metrics)
  - per-person history -> `dr_capture_notes` (already read by prep, nightly prep, Scribe and assessment evidence, so a saved note reaches the next sheet with no other wiring)

## Flow

1. **Entry.** A button on the setup card, and a line on the person page's empty state. Opens one modal (rule 3: entry). Copy states what is stored before anything is sent: "We read this once to draft suggestions. We keep only what you save. Files and raw text are not stored."
2. **Input step (same modal).** Big text box with mic, "Attach files" (up to 5, PDF / Word / text, about 60,000 characters total, extra is cut off and the manager is told), and "Nothing to add" (closes, records the choice in analytics only). One button: "Read this".
3. **Parse.** `POST /api/onboarding/notes-dump/parse` (multipart). Builds the prompt with the manager's existing org units, active reports (id, name, role, team), role levels and existing goals, so the model matches instead of duplicating. Returns drafts only. Nothing is written.
4. **Review step (same modal, rule 3: parse-and-review).** Grouped: Team structure, Roles, Goals, About each person. Each row: the draft, a short source excerpt from the manager's own text, keep / edit / drop. Nothing pre-checked that the model was unsure about.
5. **Apply.** `POST /api/onboarding/notes-dump/apply` takes only the kept, possibly edited items, re-validates each, writes them, returns what saved and what was refused. Then the setup card recomputes (`GET /api/onboarding/status`); anything the dump did not fill stays as the manager's remaining steps, exactly as chunk A already computes them. No separate gap logic.

## Parse output shape (all fields optional; the model leaves things out rather than guess)

```
{
  org_units: [{name, unit_type: department|team, parent_name|null, excerpt}],
  role_assignments: [{report_id, role_level_id|null, role_title|null, org_unit_name|null, excerpt}],
  goals: [{level: company|department|team, title, success_metrics|null, org_unit_name|null,
           due_date|null, period_note|null, excerpt}],
  person_notes: [{report_id, text, occurred_on|null, excerpt}],
  unmatched_people: [{name, excerpt}],      // named in the text, not on the roster: shown, not saved
  not_found: []                              // NOT model-written; computed from /status after apply
}
```

Rules in the prompt: only what the text supports; no invented metrics, dates, owners or roles; a person is matched only by an exact-enough name to a rostered report; `role_level_id` only from the supplied list, otherwise `role_title` text and the row is marked "no matching role yet"; no ratings or judgments about a person, ever (AI line: notes are the manager's words condensed, not conclusions).

## Rank and cap

Server-side, not the model's call. Order: (1) items that close a setup step (org units, roles, org goal, team goal), (2) person notes for the person whose next 1:1 is soonest, (3) the rest, breaking ties by excerpt present and the model's own confidence flag. Cap 12 rows shown, at most 5 per group. The overflow count is shown ("6 more found, not shown. Run it again with a shorter text to see them.") so the cap is never silent. Person notes are condensed by the model to at most 3 sentences each.

## What is stored, stated in the modal and in `voice-rules` register

Raw text and files: not stored (held in memory for the one request, not logged). Saved: only the rows the manager keeps, as normal records they can edit or delete anywhere in the app. Employer-confidential material: one plain line on the input step ("Leave out anything you're not allowed to share outside your company"). No AI training claim beyond what the privacy page already says (I will check that page before writing the copy).

## Analytics (catalog rows go into `docs/systems/product-analytics.md` first, counts and enums only)

- `notes_dump_parsed` (server): `input_chars_bucket`, `files` (int), `proposed_org_units / roles / goals / person_notes` (ints), `unmatched_people` (int), `truncated` (bool).
- `notes_dump_applied` (server): `kept_org_units / roles / goals / person_notes` (ints), `dropped` (int), `edited` (int), `seconds_to_confirm`.
- `notes_dump_skipped` (via `/api/telemetry`): "Nothing to add" chosen.
- `ai_draft_resolved` gets a new server surface `notes_dump`: accepted (any kept) / discarded (none kept), `edit_bucket` from the share of kept rows edited. Added to the surfaces table and the vocabulary in `analytics.py`.

## Tests and verification (in proportion)

- pytest: prompt builder, JSON validation (bad/missing fields dropped, wrong ids refused, cross-org ids refused), rank-and-cap ordering, apply validation and idempotence, extra="forbid" on telemetry, no raw text in any event. AI call stubbed.
- One live-shaped fixture run with a fictional "messy notes" text and the real model if `ANTHROPIC_API_KEY` is available (Hard Rule 6 test: nothing is written by parse).
- `tsc --noEmit` on a clean checkout of HEAD; component render check of the modal states.
- No migration. Andrew's release step is only `git push` (check `origin/main..` first; chunk A already looks pushed since `git log origin/main..` printed nothing).

## Not in chunk B

Role-expectation on-ramps and org-goal fetch UX (C); prompt fading, dismissals, completion receipt, the standalone entry-modal polish (D). In B the entry is a button plus one modal; the invitation copy and timing ladder are D.

## Open questions for Andrew

1. Attached files: read once and discarded (recommended, simplest, matches "state plainly what is stored"), or also offered for filing into Knowledge (each file gets its own Librarian confirm card afterwards)?
2. People named in the text who are not on the roster: show them as a hint only (recommended), or let one click add them to the roster from the review step?
3. Per-person history lands as private capture notes the next prep sheet already reads. Is that the right home, or does it need to become logged past 1:1s (heavier, would also count toward "onboarded")?
4. Model: the heavy model for one call per dump (recommended; quality matters, cost is one call), or the light model?

## Decisions (Andrew, 2026-09-29)

1. Attached files: read once, discarded.
2. People not on the roster: shown as a hint only, nothing saved.
3. Per-person history: private capture notes (`dr_capture_notes`).
4. Model: heavy, one call per dump.
