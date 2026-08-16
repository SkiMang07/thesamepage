# `/app/1-1s` — build spec (nav rework, pass 2)

Written 2026-08-16, after pass 1 (the hub-and-orbit nav) landed. Pass 1's spec was
`mockups/nav/nav-option-c-v2.html`; this doc is the equivalent for pass 2.

---

## 1. Why this page exists

The 1:1 is the job the product is built around, and it is the only core object with
no front door — today a 1:1 exists only inside `/app/reports/[id]`. Pass 1 added a
nav item for it that currently points nowhere.

The page answers one question: **who do I owe a conversation, and what's already in flight?**

---

## 2. Decisions (locked — do not relitigate)

| # | Decision | Rationale |
|---|---|---|
| 1 | `/app/1-1s` **owns the 1:1 loop**: due now, prepped-not-yet-run, recently wrapped, and cross-person history | One owner per question. "Who's due" is currently computed in three files; after pass 1's zone map it is *displayed* in three places on one screen |
| 2 | Mission Control's Individual Performance column **shrinks to exception-first** — only people who need attention, healthy ones behind "Show N on track", with a link to `/app/1-1s` | Same treatment the Goals and Key Initiatives cards already got in Session 26; resolves the duplication pass 1 introduced between the zone map's "2 due" and the column below it |
| 3 | Cadence becomes **org default + per-person override**, replacing the hardcoded 21 | Matches the established pattern (capacity hours, target utilization, off-days). Weekly for a new hire and monthly for a senior IC is how managers actually work; one global number is wrong for half the team |
| 4 | Page actions are **triage + start/resume prep only** — no new write paths | Reuses the prep and resume flows built in Sessions 8–9. Logging an off-platform 1:1 was considered and deferred; it would be a second wrap-up surface to keep consistent |
| 5 | The four data-trust bugs from the 2026-08-12 review are **fixed in this session** | Pass 1 put counts on the landing page, so a wrong number is now the first thing a new user sees |

Deliberately **out of scope**: logging a 1:1 that happened off-platform; bulk actions;
search across history; scheduling/calendar integration; any IC-facing view.

---

## 3. Data model

One migration, `database/migrations/2026-08-16_one_on_one_cadence.sql`:

```sql
alter table organizations
  add column if not exists one_on_one_cadence_days int not null default 21;

alter table direct_reports
  add column if not exists one_on_one_cadence_days int;  -- null = inherit org default
```

**Precedence:** `direct_reports.one_on_one_cadence_days` → `organizations.one_on_one_cadence_days` → `21`.

Note this puts a scalar on `organizations` rather than creating a settings table.
`capacity_settings` exists as a table because it holds a *cluster* of related defaults;
one integer does not earn the same treatment. If you disagree, say so before building —
do not silently invent a third pattern.

Apply the same honesty convention Capacity uses for logged-vs-assumed hours: where the
cadence is shown, say which source won — "every 14 days (custom)" vs "every 21 days (org default)".

**Migration discipline:** several past migrations in this repo were written but never run
live, and the app broke when the code shipped ahead of the schema. Run this one against
the live database, confirm it, and record that it ran.

---

## 4. Consolidate the cadence constant

The number 21 is currently hardcoded in three places:

- `backend/routes/dashboard.py` — `_CADENCE_DAYS = 21`
- `backend/routes/one_on_ones.py` — line ~175, inside the prep prompt's staleness logic
- `frontend/app/app/dashboard/page.tsx` — `CADENCE_DAYS = 21`

Replace all three with one resolver in `backend/utils.py`:

```python
def resolve_cadence_days(report: dict, org: dict | None) -> int: ...
```

The frontend should not compute staleness at all — the API returns `days_since_last`,
`cadence_days`, and a derived `is_due`. Adding a fourth copy of this constant is the
specific failure this session exists to prevent.

---

## 5. Backend

New endpoint on the existing router (`backend/routes/one_on_ones.py`):

```
GET /api/one-on-ones/overview
```

Returns every direct report for the caller, each with:

- `direct_report_id`, `name`, `role_title`, `org_unit`
- `last_one_on_one_at`, `days_since_last` (null if never)
- `cadence_days` (resolved), `cadence_source` (`"custom"` | `"org"` | `"default"`)
- `is_due` (bool), `planned_session` (the `one_on_ones` row if one is prepped but not run, else null)
- `last_completed` (id, date, commitment count)

`one_on_ones` has **no status column** — status is derived, and the existing rule is
documented in `frontend/lib/api.ts` (~line 75): *planned* = `prep_guide` set and `summary`
null; *completed* = `summary` set. Encode that rule in the query; do not add a status column.

Existing endpoints (`/prep`, `/wrapup`, `POST ""`, `/{direct_report_id}/history`,
`/session/{id}`) stay unchanged.

---

## 6. Frontend

New route `frontend/app/app/1-1s/page.tsx`, three sections:

1. **Due now** — people past their cadence, worst first (longest gap at top), each with a
   `Prep →` action into the existing prep flow. Amber for due, rose for badly overdue
   (past 2× cadence), matching the app's existing convention.
2. **Prepped, not yet run** — planned sessions, each resuming the saved prep sheet via
   `prep/page.tsx?resume={id}`.
3. **Recently wrapped** — last ~5, with date and commitment count, linking to the session.

Empty state matters: a manager with no reports should see a route to adding one, not three
empty headings. A manager who is fully caught up should see something that says so rather
than a blank "Due now".

Wire the existing nav item in `frontend/components/AppNav.tsx` to `/app/1-1s` and remove
whatever placeholder state pass 1 left on it. The zone map's `1:1s` count in
`ZoneMap.tsx` should read from the new endpoint rather than any local calculation.

---

## 7. Dashboard change (decision 2)

In `frontend/app/app/dashboard/page.tsx`, the Individual Performance card:

- show only reports where `is_due` is true, sorted worst-first
- collapse the rest behind "Show N on track", matching the Goals and Key Initiatives cards
- add a `1:1s →` link in the card header, same pattern as the existing `Goals →` / `All →` links
- if nobody is due, the card collapses to a single reassuring line rather than disappearing

Do not remove the card.

---

## 8. Data-trust fixes (decision 5)

From the 2026-08-12 live review, all four now amplified by pass 1's landing-page counts:

1. Goals defaults to an empty **Individual** tab — should land on a level that has content
2. Team KPI tile renders **green at 0/5 on track** — zero is not success
3. Goal progress ring shows **0%** while the dashboard shows 25%/10% for the same goal — one of the two calculations is wrong; find which and make them share a function
4. The AI insight banner is **silently absent** when the endpoint returns null — should degrade visibly or occupy no space by design, not look broken

---

## 9. Verification

There is no test suite — this has been a standing weakness since Session 19, so verification
is manual and mandatory:

- `npx tsc --noEmit` and `next build` must both pass
- run the migration against a real Postgres instance and confirm RLS on any new column path
- exercise the endpoint with a manager who has: zero reports, one never-met report, one
  overdue report, one with a planned session — the four states most likely to break
- confirm the zone map's `1:1s` count matches what `/app/1-1s` actually lists

---

## 10. Session close

`SESSION_HISTORY.md` and `DESIGN.md` were not updated for pass 1 — Andrew is holding docs
and the git push for one sweep at the end. When pass 2 finishes, run the `tsp-push` skill
once to cover **both** passes, then push.
