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
// PURGE SAFETY: every string here must be a COMPLETE literal class name.
// Tailwind scans source text, so `"bg-" + shade` generates no CSS. This repo
// has already shipped that bug once (see tailwind.config.js's content note).
// lib/ is in the content globs, so literals in this file are safe.
// ---------------------------------------------------------------------------

// --- surfaces ---------------------------------------------------------------
export const CARD = "rounded-xl border border-hairline bg-surface";
export const CARD_PAD = "rounded-xl border border-hairline bg-surface px-4 py-4";
export const CARD_HEADER = "flex items-center justify-between border-b border-divider px-5 py-4";
export const CARD_FOOTER = "border-t border-divider px-5 py-3";
export const SUNKEN = "rounded-md bg-sunken px-3 py-2";

// --- typography -------------------------------------------------------------
/** Section eyebrow. One spelling, replacing the five that were in use. */
export const EYEBROW = "text-xs font-semibold uppercase tracking-wide text-ink-muted";
export const LABEL = "mb-1 block text-xs font-medium text-ink-secondary";
export const META = "text-xs text-ink-muted";

// --- controls ---------------------------------------------------------------
export const INPUT =
  "w-full rounded-md border border-control bg-surface px-3 py-2 text-sm text-ink " +
  "placeholder-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-blue-600/25";
export const TEXTAREA =
  "w-full rounded-lg border border-control bg-surface px-4 py-3 text-ink " +
  "placeholder-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-blue-600/25";

/** Primary CTA. Teal, not carbon — the locked palette gives teal the primary
 *  action and the selected state; carbon carries structure and typography. */
export const BTN_PRIMARY =
  "rounded-md bg-brand px-4 py-2 text-sm font-medium text-white " +
  "hover:bg-brand-hover disabled:opacity-50";
export const BTN_PRIMARY_SM =
  "rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white " +
  "hover:bg-brand-hover disabled:opacity-50";
export const BTN_SECONDARY =
  "rounded-md border border-control px-3 py-1.5 text-sm font-medium text-ink-body " +
  "hover:bg-sunken disabled:opacity-50";
export const BTN_DANGER =
  "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white " +
  "hover:bg-red-700 disabled:opacity-50";
export const BTN_DELETE_ICON = "text-xs text-ink-muted hover:text-red-600";

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
  completed: "bg-brand text-white",
  cancelled: "bg-sunken text-ink-faint",
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
// Tone-driven, replacing the six-hue gradient rainbow (indigo / rose / sky /
// green / amber / gray) that made adjacent pages look like different products.
export type TileTone = "brand" | "attention" | "critical" | "info" | "neutral";

export const TILE_TONE: Record<TileTone, string> = {
  brand: "from-teal-600 to-teal-700",
  attention: "from-amber-500 to-amber-600",
  critical: "from-red-600 to-red-700",
  info: "from-blue-600 to-blue-700",
  neutral: "from-carbon-500 to-carbon-600",
};

export const TILE = "rounded-xl bg-gradient-to-br px-4 py-3 text-white";
export const TILE_VALUE = "text-2xl font-semibold";
export const TILE_LABEL = "text-xs text-white/80";

// --- person identity --------------------------------------------------------
// Avatars need several distinguishable colours, but the old palettes were an
// off-system rainbow (indigo/rose/teal/amber/violet/cyan) AND were declared
// twice with different lengths, so a person's avatar and their card accent
// desynchronised past index 4. This is one list, drawn only from the brand
// families, every entry >= 4.5:1 against white text.
export const IDENTITY_HEX = [
  "#087E78", // teal-600
  "#0755A0", // blue-700
  "#4F575D", // carbon-700
  "#004B47", // teal-800
  "#2878D0", // blue-600
  "#222B32", // carbon-900
];

export const IDENTITY_BG = [
  "bg-teal-600", "bg-blue-700", "bg-carbon-700",
  "bg-teal-800", "bg-blue-600", "bg-carbon-900",
];

export const IDENTITY_BORDER = [
  "border-teal-600", "border-blue-700", "border-carbon-700",
  "border-teal-800", "border-blue-600", "border-carbon-900",
];

export function identityIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % IDENTITY_HEX.length;
}

// --- raw hex, for SVG attributes which cannot take Tailwind classes ---------
export const HEX = {
  brand: "#087E78",
  brandDeep: "#00635F",
  info: "#2878D0",
  attention: "#B67118",
  critical: "#BD3D39",
  ink: "#222B32",
  inkMuted: "#686E74",
  track: "#DDE0E3",
  control: "#C9CDD0",
  surface: "#FFFFFF",
} as const;
