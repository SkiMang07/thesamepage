# Assessments (`/app/assessments`)

Scoring a direct report against their role's configured expectations — the
ratings layer PRODUCT_VISION.md treats as load-bearing for Mission Control.

Backend: `routes/assessments.py`. Surfaces: `/app/assessments` (team list) and
`/app/assessments/[reportId]` (scorecard).

## Shape

**Rolling assessment, not periodic review.** `performance_reviews` stays dormant.
All three expectation types are scored together, plus an overall snapshot:

| Table | What |
|---|---|
| `assessments` | overall `level_ordinal` per report, scored against `assessment_levels` |
| `assessment_levels` | org-scoped 1–5 scale + label, auto-seeded with 5 defaults on first use |
| `metric_entries` | time-series metric value + period, scored against that `metric_config`'s own scale |
| `skill_assessments` | per-skill score, scored against that `skill_config`'s `evaluation_scale_min/max` |
| `value_assessments` | same shape, per value |

## Endpoints (`/api/assessments`)

`GET`/`PUT /levels` (auto-seeds the 5 defaults per org on first use, same
on-demand-bootstrap idea as `ensure_org()`), `GET ""` (team list with latest
overall rating), `GET /{direct_report_id}` (the full scorecard — role expectations
plus latest score per item, via `_fetch_scorecard()`), `POST
/{direct_report_id}/draft` (pure AI call, nothing saved), `POST
/{direct_report_id}` (writes the reviewed result).

`/levels` is declared before `/{direct_report_id}`.

## Draft restraint

The prompt instructs the model to score an item **only** when recent 1:1
summaries, commitments, or goals actually support a judgment — never to force
coverage of every configured item — and to return a null overall if there isn't
enough evidence. A fabricated complete draft erodes trust in the assessment record
faster than an honest partial one.

Drafted `config_id`s are filtered against the report's real configured items
server-side, so a hallucinated id can't reach the save step.

## Inputs start empty

The scorecard starts every input **empty**, not pre-filled with the latest
recorded score; that score displays alongside as read-only context instead.

Pre-filling would make an untouched Save silently re-log every unchanged score as
a new timestamped row. Empty-by-default means only what the manager (or an
accepted draft) actually set this pass gets written.

Skill and value scores render as a row of scale-point buttons labeled with each
point's configured qualitative/quantitative output, rather than a number input or
dropdown — the scale definitions already carry meaning per point, so the buttons
surface it instead of making the manager cross-reference a legend.

## Placement

Its own top-level page rather than folded into the person page — scoring happens
regularly, not once. The person page gets a read-only summary plus a link, the
same "summary here, edit there" pattern as goals, projects, and capacity.
