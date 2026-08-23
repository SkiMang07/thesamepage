/** @type {import('tailwindcss').Config} */

// ---------------------------------------------------------------------------
// CURRENT & CARBON — the locked brand system.
//
// Locked anchors (docs/branding/colors/README.md, direction #11) reproduce
// EXACTLY at these steps and must not be hand-edited:
//     teal-600  #087E78   primary
//     blue-600  #2878D0   accent  (Scribe / focus / informational only)
//     amber-500 #B67118   warning
//     carbon-900 #222B32  carbon
//     brand.tint #EEF5F4  light surface
// Ramps around them were generated in OKLCH with chroma tapering toward both
// ends, so every step is perceptually even. Regenerate with the script
// recorded in the brand_system project memory rather than nudging hexes here.
//
// WHY THE STOCK TAILWIND FAMILIES ARE OVERRIDDEN BELOW:
// gray / green / emerald / indigo / violet / purple / rose / pink / sky / cyan
// are all remapped onto brand ramps. Before this system there were 12 hue
// families live across the app (Team alone used ten). Remapping them means a
// missed `text-rose-500` in some corner renders as on-brand critical red
// instead of an off-palette pink — the palette becomes closed by construction,
// not by everyone remembering the rule. Semantic tokens (ink/surface/brand/...)
// are the names to REACH FOR; the family overrides are the safety net.
// ---------------------------------------------------------------------------

const carbon = {
  50: "#F5F8FA", 100: "#ECEFF2", 200: "#DDE0E3", 300: "#C9CDD0", 400: "#A7ACB0",
  500: "#878D92", 600: "#686E74", 700: "#4F575D", 800: "#394148", 900: "#222B32",
  950: "#131B22",
};
const teal = {
  50: "#E8FCFA", 100: "#DDF4F2", 200: "#CAE7E4", 300: "#B1D5D1", 400: "#85B7B2",
  500: "#579A95", 600: "#087E78", 700: "#00635F", 800: "#004B47", 900: "#00312F",
  950: "#00201E",
};
const blue = {
  50: "#F2F8FF", 100: "#E4F0FF", 200: "#CBE2FF", 300: "#AED0F9", 400: "#81AFE7",
  500: "#528FD7", 600: "#2878D0", 700: "#0755A0", 800: "#003F7D", 900: "#002955",
  950: "#00193A",
};
const amber = {
  50: "#FFF6ED", 100: "#FFEBD8", 200: "#F6DBC1", 300: "#E8C5A4", 400: "#D1A171",
  500: "#B67118", 600: "#9B5D00", 700: "#7B4800", 800: "#5D3600", 900: "#3E2200",
  950: "#291500",
};
const red = {
  50: "#FFF5F3", 100: "#FFE9E6", 200: "#FFD4CF", 300: "#F7BCB5", 400: "#E2938B",
  500: "#CE6B63", 600: "#BD3D39", 700: "#982524", 800: "#7A0E13", 900: "#550006",
  950: "#390003",
};

module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    // components/ was missing here — every class used ONLY inside a
    // components/*.tsx file (never duplicated verbatim in app/ or lib/)
    // was silently dropped from the production CSS. Plain utility classes
    // (text-gray-400, rounded-md, etc.) happened to still work because
    // some page under app/ also used the same class string; ZoneMap.tsx's
    // and AppNav.tsx's one-off arbitrary values (h-[15px], bg-[#eef1ff],
    // text-[13px], ...) never appeared anywhere else, so they never
    // generated any CSS at all — the zone map rendered with huge unstyled
    // icons and no card/row styling in production while `next build`
    // still succeeded, because this is a content-purging gap, not a
    // compile error. Found live on thesamepage-blush.vercel.app after the
    // Session 37/38 push; see docs/SESSION_HISTORY.md.
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        carbon,
        // --- semantic surface tokens ---
        canvas: "#F5F8FA",   // page ground
        surface: "#FFFFFF",  // cards sitting on the canvas
        sunken: "#ECEFF2",   // recessed sub-panels, quoted AI text, table heads
        hairline: "#DDE0E3", // card outer edge
        divider: "#ECEFF2",  // rule between rows INSIDE a card
        control: "#C9CDD0",  // input / secondary-button border

        // --- ink scale ---
        // Replaces the gray-400-vs-gray-500 muddle. Tailwind's gray-400
        // (#9CA3AF) was the app's most-used text colour at 232 usages and
        // fails WCAG AA on white at 2.54:1; `ink-muted` is the corrected
        // floor for real text at 5.16:1. `ink-faint` is 3.36:1 and is for
        // disabled glyphs and decoration ONLY — never small body copy.
        ink: {
          DEFAULT: "#222B32",   // 14.39:1 — headings, high emphasis
          body: "#394148",      // 10.38:1 — body copy
          secondary: "#4F575D", //  7.36:1 — labels, prose, empty states
          muted: "#686E74",     //  5.16:1 — metadata, eyebrows, icons
          faint: "#878D92",     //  3.36:1 — disabled / decorative only
        },

        // --- brand ---
        brand: {
          DEFAULT: "#087E78",   // teal-600, locked
          hover: "#00635F",     // teal-700
          tint: "#EEF5F4",      // locked "light surface" — selection ground
          ...teal,
        },

        teal, blue, amber, red,

        // --- safety net: stock families remapped onto brand ramps ---
        gray: carbon,
        green: teal,
        emerald: teal,
        indigo: teal,
        violet: teal,
        purple: teal,
        rose: red,
        pink: red,
        sky: blue,
        cyan: blue,
        slate: carbon,
        zinc: carbon,
        neutral: carbon,
        stone: carbon,
      },
      // TYPEFACE. Undecided as a design question (docs/DESIGN.md), but wired as
      // a token so it is a one-line change when it is decided: swap the stack
      // below, or load a webfont with next/font in app/layout.tsx and put its
      // CSS variable first here (e.g. "var(--font-sans)", ...SYSTEM_SANS).
      fontFamily: {
        sans: [
          "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto",
          "Helvetica Neue", "Arial", "sans-serif",
        ],
      },
      ringColor: { DEFAULT: "#2878D0" },
    },
  },
  plugins: [],
};
