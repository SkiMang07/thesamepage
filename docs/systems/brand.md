# Brand system — Current & Carbon

The colour and logo system for the whole app. This doc says what the tokens
mean and when to reach for each one.

Three files, three jobs:

| File | Owns |
|---|---|
| `frontend/app/globals.css` | The colour **values**. Two blocks: `:root` (light) and `.theme-dark` (dark). The only place in the app a colour is written as a literal. |
| `frontend/tailwind.config.js` | The token **names**. Every colour is `rgb(var(--c-*) / <alpha-value>)`. |
| `frontend/lib/tokens.ts` | The recurring class **strings** — a card, a badge, a button, a status. |

Source of the locked decisions: `docs/branding/colors/README.md` (palette
direction #11), `docs/branding/tsp/README.md` (logo T10-C), and
`docs/Redesign Scoping/mission-control-action-first.html` (the approved dark
mockup). The first two folders are gitignored — they exist on Andrew's disk only.

---

## Two themes, one token set

The authenticated product is dark. Marketing, `/app/login`, `/app/ic` and
`/invite` are light.

That split is enforced in exactly one place. `app/app/layout.tsx` puts
`theme-dark` on the shell that wraps every authenticated page:

```tsx
<div className={`flex min-h-screen ${showNav ? "theme-dark bg-canvas text-ink" : ""}`}>
```

`showNav` is the same condition that hides the nav (`NO_NAV_PATHS`), so login
and the IC stub stay light even though they sit under that layout.

**There are no `dark:` variants anywhere in the app, and there should never be
one.** Both scopes define the *same token names*, so `bg-surface` is "a card" in
both themes and simply resolves to a different colour. A component is written
once and is correct in both. Marketing stays light not by overriding anything
but by never rendering inside that element.

`globals.css` also mirrors the dark ground onto `<html>` via
`html:has(.theme-dark)`, so an overscroll bounce doesn't flash white. No class
on `<html>`, no JS, no hydration flash.

### Adding a colour

Add it to **both** blocks in `globals.css` and name it in `tailwind.config.js`.
A token that exists in only one block renders as nothing in the other theme.

---

## Locked anchors

These six reproduce **exactly** in the **light** theme and must never be nudged.

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
status, a zone, or a decorative accent. It is not a KPI tile colour.

Two severity levels, not three. The old code ran amber → rose → red; rose and
red were near-identical, so the escalation they were meant to express never
actually read.

---

## The ramps

Five families — `carbon`, `teal`, `blue`, `amber`, `red` — eleven steps each,
in both themes.

**The dark ramps are re-authored for a carbon ground, not inverted hex-for-hex.
What they preserve is the direction of meaning:**

- **50–200** is always *a tint you put behind something.* Pale in light, deep in
  dark.
- **700–900** is always *the readable ink you put on that tint.* Deep in light,
  pale in dark.
- **500–600** is the saturated middle — a dot, a rail, a fill — in both.

That single property is what makes the whole system work with no per-theme
code. `bg-amber-50 text-amber-700` is declared once, in `STATUS_STYLES`, and is
the at-risk badge in both themes: pale amber on deep brown-amber ink in light,
deep brown-amber on pale amber ink in dark. Every such pair measures 7–10:1.

If you add a ramp step, keep the direction. A dark `teal-50` that is *light*
breaks every badge in the app at once.

---

## Ink scale

| Token | Light | on white | Dark | on card |
|---|---|---|---|---|
| `ink` | `#222B32` | 14.4:1 | `#F2F5F6` | 13.1:1 |
| `ink-body` | `#394148` | 10.4:1 | `#D4DADD` | 10.2:1 |
| `ink-secondary` | `#4F575D` | 7.4:1 | `#B6C0C5` | 7.8:1 |
| `ink-muted` | `#686E74` | 5.2:1 | `#96A3AA` | 5.6:1 |
| `ink-faint` | `#878D92` | 3.4:1 | `#6E7B83` | 3.3:1 |

`ink-muted` is the **floor for real text** in both themes. `ink-faint` is below
the 4.5:1 line and must never carry real copy — it exists because disabled
states legitimately need to recede.

This scale replaced a genuine accessibility defect, not just an inconsistency:
Tailwind `gray-400` was the app's most-used text colour at 232 usages and sits
at **2.54:1** on white. Every one of those was metadata a manager was expected
to read.

A dark theme is not an excuse to go quieter. Low-contrast grey text on carbon
looks sophisticated in a screenshot and is unreadable in a room with a window.

---

## Surfaces

Four levels of depth. Cards are told apart from the canvas primarily by their
**fill**; the hairline is structure, not an outline drawn round everything.

| Token | Light | Dark | Use |
|---|---|---|---|
| `canvas` | `#F5F8FA` | `#182026` | Page ground, and the nav shell |
| `surface` | `#FFFFFF` | `#222B32` | A card sitting on the canvas |
| `elevated` | `#FFFFFF` | `#29333A` | A thing floating *above* a card — menu, modal, drawer |
| `sunken` | `#ECEFF2` | `#2D373E` | A panel recessed *into* a card — inputs, quoted AI text, table heads, row hover |
| `brand-tint` | `#EEF5F4` | `#173D3B` | Selected rows, selected nav, brand-tinted blocks |
| `hairline` | `#DDE0E3` | `#3D4950` | A card's outer edge |
| `divider` | `#ECEFF2` | `#333D44` | Rules between rows *inside* a card |
| `control` | `#C9CDD0` | `#77848C` | Input and secondary-button border |

The dark `control` is deliberately lighter than the hairline: it clears 3:1
against `surface`, `sunken` and `canvas` alike, which is the WCAG 1.4.11
requirement for a control boundary. Hairlines are structure and carry no such
requirement.

### Gradients are spent once

`FEATURE_SURFACE` (`lib/tokens.ts`) is a deep teal-into-carbon wash —
`#17363B → #222B32` dark, a pale teal wash light. It is for **identity bands
and hero summaries only**: the person page's header, Team's "next meeting"
banner. Never a peer card in a grid, never a KPI tile.

Three saturated gradient tiles in a row read as emphasis on a white canvas and
as glare on a dark one. The approved mockup has exactly one gradient on the
whole page.

---

## "On" colours

What text and icons become when they sit on a filled swatch.

| Token | Light | Dark | Pairs with |
|---|---|---|---|
| `on-brand` | `#FFFFFF` | `#08191B` | `bg-brand` |
| `on-critical` | `#FFFFFF` | `#2A100D` | `bg-red-600` |
| `on-attention` | `#FFFFFF` | `#2B1C07` | `bg-amber-500` |
| `on-info` | `#FFFFFF` | `#68A8EE`'s ground, `#06202F` | `bg-blue-600` |
| `on-identity` | `#FFFFFF` | `#10191D` | `bg-identity-*` |

**Never write `bg-brand text-white`.** In light mode `on-brand` *is* white, so
the token costs nothing; in dark mode the teal fill is bright (`#50B7B0`) and
white on it measures **2.40:1**. Deep carbon-teal on it measures **7.50:1**.

The approved mockup uses white here. **This is the one place the live app
deliberately departs from the mockup**, and it is an accessibility fix, not a
taste call.

---

## Status vocabulary

One map, in `lib/tokens.ts`. It was previously declared five times over, with
three mutually inconsistent progress-bar derivations bolted on.

| Status | Badge | Glyph | Left rail | Dot |
|---|---|---|---|---|
| `active` | `bg-sunken text-ink-secondary` | ○ | `border-control` | `bg-ink-faint` |
| `on_track` | `bg-teal-50 text-teal-700` | ● | `border-brand` | `bg-brand` |
| `at_risk` | `bg-amber-50 text-amber-700` | ▲ | `border-amber-500` | `bg-amber-500` |
| `completed` | `bg-brand text-on-brand` | ✓ | `border-teal-800` | `bg-teal-800` |
| `cancelled` | `bg-sunken text-ink-faint` | ✕ | `border-hairline` | `bg-carbon-300` |

`completed` reads as **solid** teal against `on_track`'s **tinted** teal —
achieved versus going well. It moved off blue because blue is reserved.

`STATUS_GLYPH` exists so status never depends on colour alone (WCAG 1.4.1).

---

## KPI tiles

A tile is a plain `surface` card. The **value** carries the tone; the tile does
not.

```tsx
<div className={TILE}>
  <p className={`${TILE_VALUE} ${TILE_TONE[tone]}`}>{value}</p>
  <p className={TILE_LABEL}>{label}</p>
</div>
```

`TILE_TONE` is `brand` / `attention` / `critical` / `info` / `neutral`, applied
to the value only. Default to `neutral`.

These were six gradient tiles in a rainbow, then five tones still on gradients.
Both are gone, for three reasons: a tile's colour was decorating a peer rather
than reporting a state (*"Active initiatives"* and *"Until next meeting"* were
blue purely so the row had four colours in it); four saturated blocks in a row
on carbon is the "gaming dashboard" look the product is not; and white tile text
on a bright dark-mode fill drops to ~2.4:1.

**A colour on a tile must mean something.** A count of upcoming work is neutral
until it is overdue. Where a tile's tone is conditional, the condition is in the
page (`atRisk > 0 ? "attention" : "neutral"`), not baked into the tile.

---

## Controls

`INPUT` / `TEXTAREA` are **recessed** (`bg-sunken`), not flush with the card.
A white field on a white card was already identifiable only by its border; on a
dark card that reads as nothing at all. A recessed fill *plus* the `control`
border means a field is identifiable by two independent cues.

Focus rings are blue and themed — `#2878D0` light, `#68A8EE` dark. A dark theme
needs a brighter ring to stay as visible. Set once in `globals.css` on
`:focus-visible`; don't add `focus:outline-none` without replacing it.

Browser autofill is overridden in `globals.css` (an inset box-shadow plus
`-webkit-text-fill-color`) — Chrome and Safari otherwise paint a near-white fill
with near-black text over any field a password manager touches, which on a dark
form is a bright bar with invisible text. There is no way to set
`background-color` on an autofilled input; the shadow is the only lever.

---

## Zones are not colour-coded

The nav used to run indigo "Your people" / emerald "The work" / violet
"Foundation". Current & Carbon offers teal, blue and carbon, and blue is
reserved — so there was no third zone colour to spend that wouldn't dilute the
brand. Zones are told apart by icon, label and position.

`ZONE_STYLE` in `ZoneMap.tsx` is a single constant, not a per-hue map, and the
Mission Control zone cards are flat `surface` cards with `sunken` item rows.

---

## Person identity

Six distinguishable fills, drawn only from the brand families, so a roster reads
as one system.

The pairing flips as a unit between themes: **light is deep fills with white
initials, dark is bright fills with carbon initials** (`text-on-identity`). A
dark fill on a dark card would disappear; white on a bright fill fails contrast.
Every combination clears 5.6:1.

`IDENTITY_BG` / `IDENTITY_BORDER` are Tailwind classes; `IDENTITY_VAR` (aliased
as `IDENTITY_HEX` for older call sites) is `rgb(var(--c-id-N))` strings for
inline styles and SVG fills, so those follow the theme too.

---

## The safety net

`tailwind.config.js` remaps the stock `gray` / `green` / `emerald` / `indigo` /
`violet` / `purple` / `rose` / `pink` / `sky` / `cyan` / `slate` / `zinc` /
`neutral` / `stone` families onto brand ramps.

Twelve hue families were live before this system (the Team page alone used
ten). The remap means a stray `text-rose-500` in some corner renders as on-brand
critical red rather than an off-palette pink — **the palette is closed by
construction, not by everyone remembering the rule** — and, now, that it is
theme-aware for free.

Semantic tokens are what you reach for. The family overrides are the net.

**No arbitrary hex in a class.** `bg-[#F5F8FA]` and friends are outside the net
entirely and were the last things to break in the dark pass — `AppNav.tsx`
carried seven and `Sidebar.tsx` three. There are none left; keep it that way.

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
