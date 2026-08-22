> **ARCHIVED — historical, not current intent.** Role JD import, built and shipped. Current behavior: `docs/systems/expectations.md`.

# Role JD Import — Scoping Brief

**Scoped:** 2026-08-18 (Cowork session with Andrew)
**Status:** Built 2026-08-18 (Session 44) — see docs/SESSION_HISTORY.md
**Goal:** Paste a job description (text, PDF, or DOCX) → AI extracts the role identity AND drafts aligned expectations → manager reviews → one commit creates the role + expectations. Kills the "type everything by hand" burden that left 13 roles with 0 expectations in dogfood data.

---

## 1. What exists today (audit findings, 2026-08-18)

- **Scribe is NOT ready for this and is not the vehicle.** v1 is locked to six verbs (project, goal, link, check-in, commitment, direct report), text-only drawer, no attachments, no role/expectations entity types. Do not extend Scribe for this build (a text-paste Scribe route can point at this flow later).
- **Expectations drafting exists** — `POST /api/expectations/draft` (routes/expectations_ai.py) drafts metrics/skills/values from a role's `job_responsibilities` with sibling-level calibration; `POST /api/expectations/{kind}/batch` commits. Draft-then-review contract proven live (Corporate CSM · L1 test, 2026-08-18).
- **PDF ingestion exists** — documents.py + ai_core.generate_text_from_document (Claude-native PDF), PPTX→PDF via LibreOffice (binary already on Railway per nixpacks.toml), 25MB cap. Wired only to Context Engine filing, not roles. **No .docx support anywhere yet** — JDs are usually .docx; LibreOffice converts docx→pdf with the same binary.
- **The gap is connective tissue:** nothing extracts role identity (title/level/ladder/team) from a JD, and nothing in the role flow accepts a file.

## 2. Locked decisions (AskUserQuestion, 2026-08-18 — do not relitigate)

1. **Surface: dedicated import flow**, not a Scribe extension. Modal/panel wired into the Add-role step. No Scribe changes in this build.
2. **Dedup: propose attach-vs-create.** The AI compares the JD against existing role_families + role_levels and the review screen proposes "looks like L2 of Corporate CSM — attach here?" with create-new as the alternative. This is a first-class requirement, not polish — dogfood data already showed ladder fragmentation (Session 42 §7 P3).
3. **Inputs: paste text + .pdf + .docx** (+ .txt/.md cheaply). docx→pdf via the same LibreOffice path as pptx.
4. **Default UX: AI-first.** "Add ladder" opens the import screen as the hero (paste box + drop zone); "start from scratch" is a quiet secondary link that falls back to the current RoleForm.

## 3. Design

### 3.1 Backend — one new module, no new write endpoints, no migration

`backend/routes/roles_import.py`, mounted at `/api/roles/import`.

**`POST /api/roles/import/draft`** — multipart form: `file` (optional UploadFile) OR `text` (optional form field); exactly one required. Rate limit `10/minute` (match other AI routes). 25MB cap. Pure AI-call route — **nothing is saved** (same contract as /expectations/draft).

- File handling: `.pdf` → as-is; `.docx` → LibreOffice convert to PDF (reuse/generalize documents.py's `_convert_pptx_to_pdf` into `_convert_to_pdf(bytes, kind)` — same subprocess, different input suffix); `.txt`/`.md` → decode to text. PDFs go through `generate_text_from_document`; text goes through `generate_text`. **Do NOT store the file** — no Storage bucket, no documents row. A JD is role config, not a Context Engine doc. (Later idea, out of scope: also offer to file leveling-guide-style docs into `how_people_grow_here`.)
- Prompt context supplied: (a) every role_family with its levels (name, job_level, whether each level has expectations counts — from `_compute_coverage`), (b) sibling configs for calibration IF the model matches a family (fetch configs for all families' levels is too much — instead do the match in the same call and include *all* families' level names but only include existing expectations for the top-matching family, resolved in a cheap pre-pass: reuse Session 43's `stripSeniorityPrefix`-style normalization server-side to shortlist candidate families and inline only those families' configs), (c) org-wide values list (so it doesn't duplicate them), (d) the exact METRICS/SKILLS/VALUES definitions + order_type rules from `_build_draft_prompt` — copy the definitions block verbatim so calibration stays consistent with the coverage-grid draft path.
- Response JSON (validated server-side, same clamping style as `_generate_and_parse_draft` — reuse `DraftMetricItem`/`DraftSkillItem`/`DraftValueItem` models):

```json
{
  "is_job_description": true,          // false + reason for garbage input — honest refusal, no draft
  "role": {
    "job_role": "Corporate Customer Success Manager",
    "job_level": 2,                    // inferred from seniority language; default 1
    "functional_team": null,           // only if clearly stated
    "job_responsibilities": "..."      // cleaned responsibilities text extracted from the JD — this is what gets stored and grounds future re-drafts/prep prompts
  },
  "match": {
    "suggested_action": "attach",      // "attach" | "create_new" | "exists"
    "role_family_id": "...",           // set when attach/exists
    "role_family_name": "Corporate CSM",
    "existing_role_level_id": "...",   // set only when action = "exists" (exact role+level already present)
    "confidence": "high",              // high | medium — medium renders create-new as the visually equal option
    "rationale": "one sentence shown in the review UI"
  },
  "expectations": { "metrics": [...], "skills": [...], "values": [...] }
}
```

- `"exists"` action = the exact role+level is already in the org. The review panel then becomes an *expectations backfill* for that existing role: commit = `PUT /api/settings/role-levels/{id}` (writing job_responsibilities, preserving family/team — same whole-record PUT pattern as `saveEdit`) + batch expectations. This is how the 13-roles/0-expectations backlog gets backfilled by pasting JDs.

**Commit = existing endpoints, client-orchestrated (Scribe's own architecture rule: the AI drafts, the client confirms via the same endpoints forms use):**
- create_new → `POST /api/role-families` → `POST /api/settings/role-levels` (with family id + job_responsibilities) → `POST /api/expectations/{kind}/batch` ×3 (skip empty kinds)
- attach → `POST /api/settings/role-levels` with the existing `role_family_id` → batches
- exists → `PUT /api/settings/role-levels/{id}` → batches

No new write endpoints, no migration — every column already exists (job_responsibilities, role_family_id, nullable value_configs.role_level_id).

### 3.2 Frontend — `components/RoleImportPanel.tsx` + wiring

States: **input** (textarea paste + drag/drop zone, one control; helper copy "Paste the job description or drop the PDF/Word file") → **drafting** (spinner + honest "Reading the job description…") → **review** → **committing** → done (panel closes, new/updated role visible in its ladder, coverage grid counts update).

Review screen, top to bottom:
1. **Role identity card** — editable: title (text), level (stepper), ladder (select: AI's match preselected, options = existing families + "Create new ladder: <title>"), team (optional). The match rationale renders as one gray sentence ("Looks like the next level of your Corporate CSM ladder"). If the chosen family+level collides with an existing level, inline-block with "L2 already exists — attach to it instead?" (switches to exists-mode) or bump the stepper.
2. **Expectations sections** — reuse the existing S3 draft review rows (keep/edit/discard per item) exactly as the coverage-grid panel renders them. Changing ladder/level does NOT re-run the AI in v1 (drafts are edited by hand anyway; a "Re-draft" button is v1.1 if dogfooding wants it).
3. One primary button: "Create role + N expectations" (or "Update role + add N expectations" in exists-mode).

Entry-point wiring (locked decision 4):
- **RolesSection "Add ladder"** → opens RoleImportPanel as the hero; "start from scratch" secondary link → current RoleForm unchanged.
- **"Add a level" inside a family** → keep the manual prefilled form (it's good), add a small "Import from a JD" link that opens the panel pre-scoped to that family (match section pinned).
- **People section inline role create** → "Paste a JD instead" link → same panel. *(Cut line: if the session runs long, this entry point is the one to drop.)*
- Coverage-grid "Draft with AI" stays exactly as-is — different job (role already exists, no JD file).

### 3.3 Edge cases (decide now, not mid-build)

- **Multi-role JD / job-rec batch:** v1 extracts the primary role only; the model notes "this document also describes N other roles" in `match.rationale`-adjacent field rendered as an info line. Multi-role import is v1.1.
- **Garbage input** (not a JD): `is_job_description: false` + one-line reason; input state re-renders with the message, pasted text preserved. No draft, no partial role.
- **AI failure / LibreOffice failure:** 502 with clear detail; input preserved client-side. Same failure UX as document upload.
- **Level inference wrong:** always manager-editable in the stepper; never auto-commit.
- **Values restraint carries over:** same rule as the existing draft prompt — role-specific values only, org-wide values are not duplicated per role.

## 4. Verification (build session must do)

- Backend: py_compile + import test; tsc + next build.
- Functional (live or scripted against Postgres): (1) plain-text JD → create_new path end-to-end; (2) JD resembling an existing ladder → attach proposed; (3) JD for an exact existing role → exists/backfill path; (4) .docx and .pdf uploads both draft; (5) recipe text → honest refusal; (6) empty-input 422.
- Confirm NO migration required (none should be — flag loudly if the build finds otherwise).

## 5. Out of scope (named so they don't creep in)

- Scribe verbs/attachments for roles (later: a Scribe utterance with a JD blob can route here).
- Multi-role batch import; onboarding-wizard placement (the panel is built reusable so onboarding can adopt it).
- Filing JDs into the Context Engine; storing the original file anywhere.
- Re-draft-on-ladder-change; auto-merge of ladders (nudge stays heuristic + manual).

---

## Paste-ready build prompt (one fresh Claude Code session)

```
Read docs/SESSION_HISTORY.md first, then docs/archive/scoping/ROLE_JD_IMPORT_SCOPING.md in full — it contains locked decisions; do not relitigate them.

Build the Role JD Import flow exactly as scoped:

1. backend/routes/roles_import.py — POST /api/roles/import/draft (multipart: file OR text, exactly one). Support .pdf as-is, .docx via LibreOffice→PDF (generalize documents.py's _convert_pptx_to_pdf), .txt/.md as text. One AI call (generate_text_from_document for PDFs, generate_text for text) returns the draft JSON contract in scoping §3.1: is_job_description flag, role identity (job_role/job_level/functional_team/job_responsibilities), match proposal (attach | create_new | exists, with role_family_id + rationale, shortlisted server-side via seniority-prefix-stripped name matching against role_families), and metrics/skills/values reusing expectations_ai.py's Draft* models, validation clamps, and the METRICS/SKILLS/VALUES definitions block verbatim from _build_draft_prompt. Include org-wide values in the prompt so they aren't duplicated. Rate limit 10/minute, 25MB cap, nothing saved, no Storage writes. Mount in main.py.

2. frontend/components/RoleImportPanel.tsx — input (paste textarea + drop zone) → drafting → review (editable role identity card with ladder select preselected to the AI match + collision handling per §3.2; expectations review rows reusing the existing S3 draft-review row rendering) → commit. Commit uses ONLY existing endpoints, client-orchestrated: createRoleFamily / createRoleLevel / updateRoleLevel / the three /expectations/{kind}/batch calls (skip empty kinds). Exists-mode = backfill: PUT the role_level (preserving family/team like saveEdit does) + batches.

3. Wiring: RolesSection "Add ladder" opens the panel as the hero with "start from scratch" secondary falling back to the current RoleForm; "Add a level" rows get an "Import from a JD" link pre-scoped to that family; People inline role create gets a "Paste a JD instead" link (this third entry point is the cut line if the session runs long). Coverage-grid Draft with AI unchanged.

Edge cases per scoping §3.3 (garbage-input refusal preserving pasted text, multi-role note, level collisions). No migration should be needed — stop and flag if you find otherwise.

Verify per scoping §4: py_compile, tsc, next build, plus the six functional cases. Then update docs/SESSION_HISTORY.md with a session entry. Do not git push — Andrew pushes via tsp-push from Cowork.
```
