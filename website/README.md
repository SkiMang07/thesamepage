# Marketing website

The public site for The Same Page, hosted on HubSpot Content Hub Starter.

## Read first

- **`docs/security.md`** — before running any `hs` command. The CLI holds a
  long-lived credential and this repo is pushed to GitHub.
- **`docs/build-process.md`** — architecture, setup, the edit loop, conventions.

## The one-line version

The site is code in this repo. The HubSpot CLI watches `theme/` and uploads
changes in about a second. Nothing is ever authored in HubSpot's Design Manager.

## Layout

```
docs/         how this is built and how to work in it
prototype/    standalone HTML design drafts — no HubSpot, no HubL, not shipped
theme/        the HubSpot theme — the thing that actually ships
```

## Daily loop

```
cd website
npx hs watch theme tsp-theme
```

Leave it running. Edit files. Refresh the HubSpot preview.

## Status

Plumbing set up and documented. Theme not yet written. Design and copy not
started — that comes next, in `prototype/`, before any HubSpot syntax is involved.
