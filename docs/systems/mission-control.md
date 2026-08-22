# Mission Control (`/app/dashboard`)

The app's landing page and PRODUCT_VISION.md's "mission control" surface. Replaced
the old team + 1:1-cadence dashboard in place rather than shipping alongside it —
one home page, not two competing for the slot.

Frontend: `frontend/app/app/dashboard/page.tsx` + `components/ZoneMap.tsx`.
Backend: `routes/dashboard.py`.

## Layout

A stat ribbon (team size, due-for-1:1 count, at-risk goal count, available hours
this week — all client-side from data already fetched), then a 3-column grid
across the top, then a full-width capacity strip.

| Column | Source |
|---|---|
| Individual Performance | `getTeamOverview()` + `getTeamAssessments()` merged by `direct_report_id` |
| Goals | `getGoals()` filtered to non-individual levels, grouped Organization / Department / Team |
| Key Initiatives | `getProjects()` filtered to `active`/`on_track`/`at_risk` |
| Capacity — this week | `getCapacityOverview()` for the current Mon–Sun week |

Capacity is a full-width strip rather than a 4th column on purpose: it's a
snapshot stat per person, not a scrollable triage list.

**Individual Performance sorts worst-first** — due-for-1:1 before everyone else,
then by open commitment count.

Every section follows the "summary here, edit there" pattern used on the person
page: a compact read view linking to the full page for editing.

## AI insight

`GET /api/dashboard/insight` — real AI-generated text (`generate_text()`,
`AI_DEFAULT_MODEL_LIGHT`), not a client-side computation. This is the page's
"magic," which is why it isn't rule-based.

- **Returns null most days by design** — the same restraint as every other AI
  path here. Nothing to say is a valid answer.
- **Fails quiet** on any AI or parse error rather than 500ing.
- **Cached in-memory, keyed by `user_id`, 20-minute TTL**, covering all four DB
  queries plus the AI call, so refreshing the page doesn't re-run any of it.
  Deliberately *not* invalidated on writes: logging a 1:1 or resolving a
  commitment can leave a stale insight for up to 20 minutes. Accepted tradeoff;
  revisit only if it causes a real complaint. The "no reports yet" and AI-failure
  paths are **not** cached, so those retry on the next load.
- Rate-limited, like every AI endpoint.

## Zone map

`components/ZoneMap.tsx` renders the "Your people / The work / Foundation" summary
cards as bold gradient tiles, matching the Team/Goals/Projects KPI strips.

Two token sets, deliberately separate:

- `HUE_GRADIENT` + `TONE_TEXT_ON_GRADIENT` — the card tiles. The tone colors
  (warn/risk/setup) are picked to stay readable across all three gradients, not
  tuned to one hue.
- `HUE_STYLES` + `TONE_TEXT` — the original pastel tokens. Still canonical for nav
  chrome; `Sidebar.tsx` reads `HUE_STYLES` for its active-state chips.

Two different surfaces, not a half-finished restyle. `doorStates` computation,
icons, and group copy are independent of styling.

## Quick add

`components/QuickAddModal.tsx` — a type picker (Direct report / Goal / Project)
with a minimal form each, reusing the existing create functions. Scoped as a
simple modal, **not** a global ⌘K command palette: the app isn't big enough for
one to earn its complexity. It's the only add path from this page.

## Not built

Department Head / Team / Individual role-scoped versions of this page (the
4-dashboard concept in PRODUCT_VISION.md — Session-15 infrastructure could support
a Dept Head toggle). Any card type with no data model yet: Team Health KPIs,
Customer Demand / Staffing / Forecasting / Budget / Compensation, Recruiting,
Employee Feedback, Improvement Plans, formal Performance Reviews. A synthesized
team-level rating rollup — each report's latest score shows as-is.
