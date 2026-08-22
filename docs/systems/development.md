# Development plans

Individual growth plans plus a lightweight team training focus. Activated from
schema that was dormant in the original scaffold.

Backend: `routes/development.py`. Placement: a section on the person page — no
dedicated top-level page.

## Data model

| Table | Notes |
|---|---|
| `development_plans` | one per direct report, bootstrapped on first access. `plan_text` is the primary always-writable plan narrative, upserted in place |
| `dev_plan_aspirations` | desired role/path + timeline; one row per plan (`dev_plan_aspirations_plan_uq`), upserted as a unit |
| `dev_plan_opportunities` | skills + knowledge. `source_kind` / `source_config_id` optionally trace an opportunity back to the skill or value assessment item that prompted it |
| `dev_plan_training` | training needed + projected cost |
| `dev_plan_manager_notes` | private to the manager, append-only — no edit or delete |
| `team_dev_focus` | the team-level counterpart, mirroring `team_callouts`' upsert/uniqueness mechanics exactly rather than inventing a new pattern. `GET`/`PUT /api/team/dev-focus` |

**`plan_text` and `dev_plan_manager_notes` are genuinely separate concepts and
stay on separate fields and surfaces.** Manager notes had been accidentally
absorbing the AI assist meant for the plan itself; don't merge them back.

## Two AI operations, deliberately different shapes

Both ground themselves in the shared `_fetch_evidence()` / `_role_label()` helpers.

- **`POST /{id}/draft`** — evidence-gated. Can honestly return nothing when the
  evidence is thin. Drafts opportunities plus a synthesis suggestion
  (`DevelopmentDraft.plan_note`) targeting `plan_text`.
- **`POST /{id}/notes/revise`** — always answerable. Takes the manager's own
  already-written text as the primary input; evidence is only for grounding, so
  thin evidence never blocks it. Reused unchanged for both manager notes and the
  plan narrative — revising manager-written text is the same operation regardless
  of which field it lands in.

These are not one prompt behind a flag.

**Aspirations and training are never AI-drafted.** Only opportunities and the
synthesis note, where evidence-grounding actually applies.

`PUT /{id}/plan` writes `plan_text`.

## Manual entry is the default everywhere

Every surface here is manually writable, with AI as an optional assist ("Draft
with AI" for a first pass, "Revise with AI" for existing text). Nothing in this
flow is AI-gated.
