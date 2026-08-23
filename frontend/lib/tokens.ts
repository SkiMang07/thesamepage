// ---------------------------------------------------------------------------
// Current & Carbon — semantic class tokens.
//
// The colour VALUES live in tailwind.config.js. This file holds the recurring
// class STRINGS so a card, a badge, a button or a status colour is spelled one
// way across the app. Reach for these instead of retyping the utilities; the
// audit that preceded this file found `inputCls` copy-pasted verbatim into 8
// files, the primary button in 23 files with 6 divergent variants, and the
// section eyebrow label in 11 files with 5 spellings.
//
// THEME: every class below is theme-aware for free. The colour VALUES behind
// `surface` / `ink` / `brand` / `amber-700` / ... are CSS custom properties
// (app/globals.css) that resolve differently inside the `.theme-dark` scope the
// authenticated shell puts on the page. So there is exactly ONE definition of a
// card, a badge or a button, and it is correct in both themes — no `dark:`
// variants, no per-page overrides. Add a colour decision HERE, not in a page.
//
// PURGE SAFETY: every string here must be a COMPLETE literal class name.
// Tailwind scans source text, so `"bg-" + shade` generates no CSS. This repo
// has already shipped that bug once (see tailwind.config.js's content note).
// lib/ is in the content globs, so literals in this file are safe.
// ---------------------------------------------------------------------------

// --- surfaces ---------------------------------------------------------------
// Four levels of depth, and cards are told apart from the canvas primarily by
// their FILL — the hairline is structure, not an outline drawn round everything.
//   canvas -> surface -> elevated (floats above)   /   surface -> sunken (recessed in)
export const CARD = "rounded-xl border border-hairline bg-surface";
export const CARD_PAD = "rounded-xl border border-hairline bg-surface px-4 py-4";
export const CARD_HEADER = "flex items-center justify-between border-b border-divider px-5 py-4";
export const CARD_FOOTER = "border-t border-divider px-5 py-3";
export const SUNKEN = "rounded-md bg-sunken px-3 py-2";

/** A thing floating ABOVE the page: avatar menu, popover, dialog, drawer. */
export const ELEVATED = "rounded-lg border border-hairline bg-elevated shadow-lg";
/** Modal scrim. */
export const SCRIM = "fixed inset-0 z-50 bg-black/55";

/** Row hover / selectable list row. Teal-tinted when selected — the locked
 *  palette gives teal the selected state. */
export const ROW_HOVER = "hover:bg-sunken";
export const ROW_SELECTED = "bg-brand-tint";

/** The ONE gradient the system spends: a deep teal-into-carbon feature
 *  surface. Identity bands and hero summaries only — never a peer card in a
 *  grid, and never a KPI tile. Text on it is `text-ink` / `text-ink-body`;
 *  in dark mode the gradient is dark, in light mode it is a pale teal wash,
 *  so the same ink scale reads correctly on both. */
export const FEATURE_SURFACE = "rounded-2xl border border-hairline bg-feature";

// --- typography -------------------------------------------------------------
/** Section eyebrow. One spelling, replacing the five that were in use. */
export const EYEBROW = "text-xs font-semibold uppercase tracking-wide text-ink-muted";
export const LABEL = "mb-1 block text-xs font-medium text-ink-secondary";
export const META = "text-xs text-ink-muted";

// --- controls ---------------------------------------------------------------
// Inputs are RECESSED (`bg-sunken`), not flush with the card. On a light card
// a white field on a white card was already only distinguishable by its border;
// on a dark card that reads as nothing at all. A recessed fill plus the
// `control` border (>= 3:1 against every surface in both themes, WCAG 1.4.11)
// means a field is identifiable by two independent cues.
export const INPUT =
  "w-full rounded-md border border-control bg-sunken px-3 py-2 text-sm text-ink " +
  "placeholder-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-blue-600/40 " +
  "disabled:cursor-not-allowed disabled:border-hairline disabled:bg-canvas disabled:text-ink-faint";
export const TEXTAREA =
  "w-full rounded-lg border border-control bg-sunken px-4 py-3 text-ink " +
  "placeholder-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-blue-600/40 " +
  "disabled:cursor-not-allowed disabled:border-hairline disabled:bg-canvas disabled:text-ink-faint";
export const SELECT = INPUT;

/** Primary CTA. Teal, not carbon — the locked palette gives teal the primary
 *  action and the selected state; carbon carries structure and typography. */
// `text-on-brand` rather than `text-white`. In light mode on-brand IS white; in
// dark mode the teal fill is bright (#50B7B0) and white on it measures 2.4:1,
// so on-brand is a deep carbon-teal instead (7.5:1). The approved mockup uses
// white here and is the one place it is not accessible — this is the deliberate
// difference. Same reasoning for on-critical / on-attention / on-info.
export const BTN_PRIMARY =
  "rounded-md bg-brand px-4 py-2 text-sm font-medium text-on-brand " +
  "hover:bg-brand-hover disabled:opacity-50 disabled:hover:bg-brand";
export const BTN_PRIMARY_SM =
  "rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-on-brand " +
  "hover:bg-brand-hover disabled:opacity-50 disabled:hover:bg-brand";
export const BTN_SECONDARY =
  "rounded-md border border-control bg-surface px-3 py-1.5 text-sm font-medium text-ink-body " +
  "hover:border-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-50 disabled:hover:bg-surface";
export const BTN_GHOST =
  "rounded-md px-3 py-1.5 text-sm font-medium text-ink-secondary " +
  "hover:bg-sunken hover:text-ink disabled:opacity-50";
export const BTN_DANGER =
  "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-on-critical " +
  "hover:bg-red-500 disabled:opacity-50";
export const BTN_DELETE_ICON = "text-xs text-ink-muted hover:text-red-600";

/** Scribe / AI actions — the one place blue is an identity rather than a focus
 *  ring. Distinct enough to find, quiet enough not to own the page. */
export const BTN_SCRIBE =
  "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-on-info " +
  "hover:bg-blue-500 disabled:opacity-50";

// --- feedback ---------------------------------------------------------------
export const ERROR_TEXT = "text-sm text-red-700";
export const SUCCESS_TEXT = "text-sm text-brand";

// --- status -----------------------------------------------------------------
// One vocabulary for goal / project / initiative status. Previously declared
// five times over (goals, projects, team, reports/[id], dashboard, CheckInPanel)
// with three MUTUALLY INCONSISTENT progress-bar derivations bolted on.
//
// Two deliberate changes from the old map:
//  * on_track moved off green onto brand teal. The locked palette's success
//    #24745B and brand teal #087E78 measure dE2000 = 8.8 apart — the same
//    colour to the eye — so keeping both meant one of them was decoration.
//    Teal absorbs "good".
//  * completed moved off blue, because blue is reserved for Scribe / focus /
//    informational surfaces. It reads as solid teal (achieved) against
//    on_track's tinted teal (going well), so the two stay distinguishable
//    while both belonging to the brand.
export type Status = "active" | "on_track" | "at_risk" | "completed" | "cancelled";

export const STATUS_STYLES: Record<Status, string> = {
  active: "bg-sunken text-ink-secondary",
  on_track: "bg-teal-50 text-teal-700",
  at_risk: "bg-amber-50 text-amber-700",
  completed: "bg-brand text-on-brand",
  cancelled: "bg-sunken text-ink-faint line-through decoration-ink-faint",
};

/** Status must never rely on colour alone (brief + WCAG 1.4.1). Every status
 *  chip renders this glyph next to its label, so the five states are also
 *  told apart by shape. */
export const STATUS_GLYPH: Record<Status, string> = {
  active: "\u25CB",     // ○ open
  on_track: "\u25CF",   // ● going well
  at_risk: "\u25B2",    // ▲ attention
  completed: "\u2713",  // ✓ achieved
  cancelled: "\u2715",  // ✕ dropped
};

export const STATUS_BORDER: Record<Status, string> = {
  active: "border-control",
  on_track: "border-brand",
  at_risk: "border-amber-500",
  completed: "border-teal-800",
  cancelled: "border-hairline",
};

export const STATUS_DOT: Record<Status, string> = {
  active: "bg-ink-faint",
  on_track: "bg-brand",
  at_risk: "bg-amber-500",
  completed: "bg-teal-800",
  cancelled: "bg-carbon-300",
};

/** Progress-bar fill. The single derivation — four different ones existed. */
export const STATUS_BAR: Record<Status, string> = {
  active: "bg-carbon-400",
  on_track: "bg-brand",
  at_risk: "bg-amber-500",
  completed: "bg-teal-800",
  cancelled: "bg-carbon-300",
};

export const BADGE = "rounded-full px-2 py-0.5 text-xs font-medium";
export const COUNT_CHIP =
  "ml-2 rounded-full bg-sunken px-2 py-0.5 text-xs font-normal text-ink-muted";

// --- severity ---------------------------------------------------------------
// Two levels, not three. The old code ran amber (overdue) / rose (badly
// overdue) / red (error, severe) — rose and red were near-identical, so the
// escalation they were meant to express did not actually read.
export const SEVERITY = {
  attention: { chip: "bg-amber-50 text-amber-700", text: "text-amber-700", avatar: "bg-amber-100 text-amber-800" },
  critical: { chip: "bg-red-50 text-red-700", text: "text-red-700", avatar: "bg-red-100 text-red-800" },
} as const;

// --- KPI tiles --------------------------------------------------------------
// These were six gradient tiles in a rainbow (indigo / rose / sky / green /
// amber / gray); Session 58 cut them to five tones but kept the gradient. The
// dark pass cuts the gradient too. Three reasons, all from the brief:
//
//   1. A tile's colour was decorating a peer, not reporting a state — "Active
//      initiatives" and "Until next meeting" were blue purely so the row had
//      four different colours in it. Blue is Scribe's, and a KPI is not AI.
//   2. Four saturated gradient blocks in a row on a dark canvas is the
//      "gaming dashboard" look the brief rules out.
//   3. On a bright dark-mode fill, white tile text drops to ~2.4:1.
//
// A tile is now a plain card. The VALUE carries the tone, so colour still
// means something when it appears and is simply absent when it doesn't — and
// the label always names the state in words as well.
export type TileTone = "brand" | "attention" | "critical" | "info" | "neutral";

export const TILE =
  "rounded-xl border border-hairline bg-surface px-4 py-3";
export const TILE_VALUE = "text-2xl font-semibold tracking-tight";
export const TILE_LABEL = "mt-0.5 text-xs text-ink-muted";

/** Applied to the VALUE, not the tile. */
export const TILE_TONE: Record<TileTone, string> = {
  brand: "text-brand",
  attention: "text-amber-700",
  critical: "text-red-700",
  info: "text-blue-700",
  neutral: "text-ink",
};

// --- person identity --------------------------------------------------------
// Avatars need several distinguishable colours, but the old palettes were an
// off-system rainbow (indigo/rose/teal/amber/violet/cyan) AND were declared
// twice with different lengths, so a person's avatar and their card accent
// desynchronised past index 4. This is one list, drawn only from the brand
// families.
//
// Theme-aware: on light the six are deep fills with white initials; on dark
// they are bright fills with carbon initials (`text-on-identity`). A dark fill
// on a dark card would have disappeared, and white on a bright fill fails
// contrast — so the pairing flips as a unit. Every combination clears 5.6:1.
export const IDENTITY_COUNT = 6;

/** For `style={{ background: ... }}` and SVG `fill` — resolves per theme. */
export const IDENTITY_VAR = [
  "rgb(var(--c-id-1))", "rgb(var(--c-id-2))", "rgb(var(--c-id-3))",
  "rgb(var(--c-id-4))", "rgb(var(--c-id-5))", "rgb(var(--c-id-6))",
];

/** Kept as the old name so call sites reading a colour STRING keep working. */
export const IDENTITY_HEX = IDENTITY_VAR;

export const IDENTITY_BG = [
  "bg-identity-1", "bg-identity-2", "bg-identity-3",
  "bg-identity-4", "bg-identity-5", "bg-identity-6",
];

export const IDENTITY_BORDER = [
  "border-identity-1", "border-identity-2", "border-identity-3",
  "border-identity-4", "border-identity-5", "border-identity-6",
];

/** Ink to put on an identity fill. */
export const IDENTITY_TEXT = "text-on-identity";

export function identityIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % IDENTITY_COUNT;
}

// --- raw colour, for SVG attributes and inline styles -----------------------
// These are `rgb(var(--c-*))` references, not literals, so an SVG donut or an
// inline background follows the theme like everything else. Prefer a Tailwind
// class (`stroke-brand`, `fill-ink`) where the element takes a className;
// reach for these only where it cannot.
export const HEX = {
  brand: "rgb(var(--c-brand))",
  brandDeep: "rgb(var(--c-brand-hover))",
  info: "rgb(var(--c-blue-600))",
  attention: "rgb(var(--c-amber-500))",
  critical: "rgb(var(--c-red-600))",
  ink: "rgb(var(--c-ink))",
  inkMuted: "rgb(var(--c-ink-muted))",
  track: "rgb(var(--c-carbon-200))",
  control: "rgb(var(--c-control))",
  surface: "rgb(var(--c-surface))",
} as const;

/** The one literal left in the app: <meta name="theme-color">, which the
 *  browser reads before any CSS exists. Locked brand teal. */
export const THEME_COLOR_LIGHT = "#087E78";
export const THEME_COLOR_DARK = "#182026";
