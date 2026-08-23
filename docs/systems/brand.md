# Brand system — Current & Carbon

The colour and logo system for the whole app. Values live in
`frontend/tailwind.config.js`; recurring class strings live in
`frontend/lib/tokens.ts`. This doc says what the tokens mean and when to
reach for each one.

Source of the locked decisions: `docs/branding/colors/README.md` (palette
direction #11) and `docs/branding/tsp/README.md` (logo T10-C). Those folders
are gitignored — they exist on Andrew's disk only.

---

## Locked anchors

These six reproduce **exactly** at their ramp steps and must never be nudged.

| Role | Hex | Token |
|---|---|---|
| Primary teal | `#087E78` | `brand` / `teal-600` |
| Accent blue | `#2878D0` | `blue-600` |
| Carbon | `#222B32` | `ink` / `carbon-900` |
| Light surface | `#EEF5F4` | `brand-tint` |
| Warning | `#B67118` | `amber-500` |
| Success | `#24745B` | **not used** — see below |

Everything else is an OKLCH ramp built around those anchors with chroma
tapering toward both ends, so the steps are perceptually even rather than
eyeballed.

**Why success `#24745B` is not in the app.** It measures dE2000 = 8.8 from the
brand teal — the same colour, to the eye. Keeping both would have meant one of
them was decoration pretending to be meaning. Teal absorbs "good": on-track,
saved, confirmed, achieved.

---

## The five colour roles

The whole app runs on five, and nothing else is allowed in.

| Role | Colour | Means |
|---|---|---|
| **Brand** | teal | The mark, the primary action, the selected state, anything going well |
| **Attention** | amber | At risk, stale, overdue, setup unfinished |
| **Critical** | red | Errors, destructive actions, badly overdue |
| **Info** | blue | Scribe, AI surfaces, focus rings — **nothing else** |
| **Inert** | carbon | Structure, typography, anything that needs no attention |

Blue's narrowness is the point. `docs/branding/colors/README.md` names blue
creep as the specific way this palette goes generic, so blue never becomes a
status, a zone, or a decorative accent.

Two severity levels, not three. The old code ran amber → rose → red; rose and
red were near-identical, so the escalation they were meant to express never
actually read.

---

## Ink scale

| Token | Hex | Contrast on white | Use |
|---|---|---|---|
| `ink` | `#222B32` | 14.4:1 | Headings, high emphasis |
| `ink-body` | `#394148` | 10.4:1 | Body copy |
| `ink-secondary` | `#4F575D` | 7.4:1 | Labels, prose, empty states |
| `ink-muted` | `#686E74` | 5.2:1 | Metadata, eyebrows, icons |
| `ink-faint` | `#878D92` | 3.4:1 | **Disabled and decoration only** |

`ink-faint` is below the 4.5:1 floor for small text and must never carry real
copy. It exists because disabled states legitimately need to recede.

This scale replaced a genuine accessibility defect, not just an inconsistency:
Tailwind `gray-400` was the app's most-used text colour at 232 usages and sits
at **2.54:1** on white. Every one of those was metadata a manager was expected
to read.

---

## Surfaces

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F5F8FA` | Page ground (set on `html` in `globals.css`) |
| `surface` | `#FFFFFF` | Cards sitting on the canvas |
| `sunken` | `#ECEFF2` | Recessed sub-panels, quoted AI text, table heads, row hover |
| `brand-tint` | `#EEF5F4` | Selected rows, brand-tinted blocks |
| `hairline` | `#DDE0E3` | A card's outer edge |
| `divider` | `#ECEFF2` | Rules between rows *inside* a card |
| `control` | `#C9CDD0` | Input and secondary-button borders |

The page ground matters beyond looks. Cards are white on a tinted canvas, so a
card and an input are identifiable by their own fill — which is how WCAG 1.4.11
is satisfied without darkening every border to a heavy 3:1 grey.

---

## Zones are not colour-coded

The nav used to run indigo "Your people" / emerald "The work" / violet
"Foundation". Current & Carbon offers teal, blue and carbon, and blue is
reserved — so there was no third zone colour to spend that wouldn't dilute the
brand. Zones are told apart by icon, label and position.

`ZONE_STYLE` and `ZONE_GRADIENT` in `ZoneMap.tsx` are single constants now, not
per-hue maps. The Session 55 decision to use bold gradient tiles over pastel
cards **stands** — only its per-hue colouring was superseded.

---

## Status vocabulary

One map, in `lib/tokens.ts`. It was previously declared five times over, with
three mutually inconsistent progress-bar derivations bolted on.

| Status | Badge | Left rail | Dot |
|---|---|---|---|
| `active` | `bg-sunken text-ink-secondary` | `border-control` | `bg-ink-faint` |
| `on_track` | `bg-teal-50 text-teal-700` | `border-brand` | `bg-brand` |
| `at_risk` | `bg-amber-50 text-amber-700` | `border-amber-500` | `bg-amber-500` |
| `completed` | `bg-brand text-white` | `border-teal-800` | `bg-teal-800` |
| `cancelled` | `bg-sunken text-ink-faint` | `border-hairline` | `bg-carbon-300` |

`completed` reads as **solid** teal against `on_track`'s **tinted** teal —
achieved versus going well. It moved off blue because blue is reserved.

---

## The safety net

`tailwind.config.js` remaps the stock `gray` / `green` / `emerald` / `indigo` /
`violet` / `purple` / `rose` / `pink` / `sky` / `cyan` / `slate` / `zinc` /
`neutral` / `stone` families onto brand ramps.

Twelve hue families were live before this system (the Team page alone used
ten). The remap means a stray `text-rose-500` in some corner renders as on-brand
critical red rather than an off-palette pink — **the palette is closed by
construction, not by everyone remembering the rule.**

Semantic tokens are what you reach for. The family overrides are the net.

---

## Logo

`components/Logo.tsx` inlines the T10-C mark so it inherits `currentColor`.
Standalone files live in `frontend/public/`.

| File | Use |
|---|---|
| `Logo.tsx` | In-app; colour via `text-brand`, `text-white`, etc. |
| `public/tsp-mark.svg` | Teal master |
| `public/tsp-mark-white.svg` | On carbon or teal grounds |
| `public/tsp-mark-small.svg` | **16–24px only** — widened channels |
| `public/favicon.svg` | Small cut knocked out of a teal tile |
| `public/apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | Home screen / PWA |

Vector-traced from the raster master: potrace over a 4× upsampled,
**3px-blurred** alpha channel. The blur is the optical correction — it drops
the AI-raster edge noise from 498 nodes to 136 at 0.1% pixel deviation.
Geometry is four disconnected components with no counters.

**Below ~32px the full mark's negative channels close up and it reads as a
blob** — a limitation `docs/branding/tsp/README.md` predicted for T10. Use the
small cut or the tile, never a scaled-down `Logo`.

Still open: horizontal wordmark lockups, and a clearance/similarity review
before trademark filing. The typeface pairing is undecided — the wordmark is
currently set in the app's default sans.
