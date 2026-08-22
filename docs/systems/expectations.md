# Roles and expectations (Settings)

The configuration backbone: what a role at a level is expected to deliver
(metrics), know how to do (skills), and embody (values). Everything downstream —
1:1 prep grounding, assessments, development — reads from here.

Backend: `routes/settings.py` (manual CRUD), `routes/expectations_ai.py` (coverage
+ AI draft), `routes/role_families.py`, `routes/roles_import.py`.
Surface: Settings → Roles & expectations.

## Data model

`role_levels` is the central concept — it links metric/skill/value configs to a
role at a level. `role_families` groups levels into a ladder, so ~13 flat cards
become ~5 ladders with levels as rows. Family name is the primary display once a
level has one; `job_role` stays an optional per-level override title.

Each kind has a config table plus a scale-definition table
(`metric_configs` / `metric_scale_definitions`, and the same shape for skills and
values). `metric_configs.order_type` is primary/secondary/tertiary;
`value_configs` adds `value_type` (team/company/department).

## Org-wide values

`value_configs.role_level_id IS NULL` means "applies to every role." The column
was already nullable — no migration was needed, and RLS needed no change because
the policy is org-scoped, not role_level-scoped.

`fetch_role_expectations()` in `direct_reports.py` — the shared helper behind the
person page, 1:1 prep grounding, and the assessment scorecard — fetches values
with `.or_("role_level_id.eq.<id>,role_level_id.is.null")`, so all three consumers
pick up org-wide values automatically. **Add a fourth consumer through this helper,
not with its own query.**

## Coverage grid

`GET /api/expectations/coverage` — three grouped queries, one per config table,
plus role_levels, grouped in Python. Returns per-role metric/skill/value counts
plus `org_wide_values_count`.

The grid is the default view of the Expectations section: one row per role, a
count pill per kind (amber at zero), opening the detail view on click. It replaced
a blind "pick 1 of N roles from a dropdown."

`role_has_expectations` is **null** (not false) when no role is assigned —
distinguishing "nothing to check" from "checked, found nothing."

## AI draft

`POST /api/expectations/draft` — drafts metrics/skills/values from the role's
stored `job_responsibilities` JD text, calibrated against sibling levels (same
`job_role`, different `job_level`), falling back to role title + level alone when
there's no JD text. Nothing is persisted. Rate-limited.

`POST /api/expectations/{kind}/batch` commits a reviewed draft in one insert,
reusing `settings.py`'s `_CONFIG_TABLES` / `_expectation_row` / `ExpectationIn` so
the row shape can't drift from the manual CRUD path.

**Draft restraint:** the prompt explicitly steers the model to leave role-specific
VALUES empty unless the JD implies a behavioral bar beyond generic company
values — those belong in the org-wide block, not duplicated 13 times. An honest
empty array beats a fabricated complete one.

The review panel also offers "copy from another role" as the non-AI alternative
source, pulling that role's real configs to replace the draft rows.

## JD import

`routes/roles_import.py` + `components/RoleImportPanel.tsx` — paste or drop a job
description, one AI call proposes role identity plus ladder match and drafts
expectations, the manager reviews, one commit lands it. Collision resolution is
server-side first (the draft already flags `exists`); the frontend only handles
manager-created collisions. **The JD file is never stored** — this is role config,
not a Context Engine document.

Full spec: `docs/archive/scoping/ROLE_JD_IMPORT_SCOPING.md`.

## Conventions

- Inline role/team creation always creates new. No fuzzy-match merge — the Roles &
  Levels merge tool stays the one place for that.
- "+ Add a new ladder" (family + L1 together) and "+ Add L{n+1}" (pre-filled from
  the level below) are separate actions.
- Family deletion is allowed regardless of level count; the UI just steers toward
  emptying it first.
