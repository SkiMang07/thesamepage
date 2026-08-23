/** @type {import('tailwindcss').Config} */

// ---------------------------------------------------------------------------
// CURRENT & CARBON — the locked brand system, now theme-aware.
//
// WHAT CHANGED (dark-theme pass): every colour below used to be a literal hex.
// They are now `rgb(var(--c-*) / <alpha-value>)` references, and the actual
// values live in app/globals.css as two sets of custom properties:
//
//     :root        the light theme — marketing, /app/login, /invite
//     .theme-dark  the dark theme  — every authenticated /app/* page
//
// Nothing about the SEMANTICS moved. `bg-surface` is still "a card", `text-
// ink-muted` is still "metadata you are expected to read", `text-amber-700`
// is still "attention". Each token simply resolves to a different value
// depending on which theme scope it renders inside, so a page written once
// is correct in both. `<alpha-value>` support is preserved, so `bg-canvas/60`
// and `ring-blue-600/25` keep working.
//
// THE RAMPS ARE NOT INVERTED HEX-FOR-HEX. They are re-authored for a dark
// ground, but they keep their DIRECTION OF MEANING: the low steps (50-200)
// are always "a tint you put behind something" and the high steps (700-900)
// are always "the readable ink you put on that tint". In light mode a tint is
// pale and its ink is deep; in dark mode a tint is deep and its ink is pale.
// That is what makes `bg-amber-50 text-amber-700` — the at-risk badge, written
// once in lib/tokens.ts — legible in both themes without a single `dark:`
// variant anywhere in the app.
//
// Locked anchors (docs/branding/colors/README.md, direction #11) still
// reproduce EXACTLY in the LIGHT theme and must not be hand-edited:
//     teal-600  #087E78   primary
//     blue-600  #2878D0   accent  (Scribe / focus / informational only)
//     amber-500 #B67118   warning
//     carbon-900 #222B32  carbon
//     brand.tint #EEF5F4  light surface
// The dark ramps are the same five hues re-anchored for a carbon ground, per
// the approved mockup (docs/Redesign Scoping/mission-control-action-first.html).
//
// WHY THE STOCK TAILWIND FAMILIES ARE OVERRIDDEN BELOW:
// gray / green / emerald / indigo / violet / purple / rose / pink / sky / cyan
// are all remapped onto brand ramps. Before this system there were 12 hue
// families live across the app (Team alone used ten). Remapping them means a
// missed `text-rose-500` in some corner renders as on-brand critical red
// instead of an off-palette pink — the palette becomes closed by construction,
// not by everyone remembering the rule. It now also means such a stray class
// is theme-aware for free. Semantic tokens (ink/surface/brand/...) are the
// names to REACH FOR; the family overrides are the safety net.
// ---------------------------------------------------------------------------

/** Build an 11-step ramp of `rgb(var(--c-<name>-<step>) / <alpha-value>)`. */
const ramp = (name) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [
      step,
      `rgb(var(--c-${name}-${step}) / <alpha-value>)`,
    ]),
  );

/** A single semantic token. */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

const carbon = ramp("carbon");
const teal = ramp("teal");
const blue = ramp("blue");
const amber = ramp("amber");
const red = ramp("red");

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
        // Four levels of depth, which is what gives the dark theme its
        // layered feel instead of one flat sheet of grey:
        //   canvas   the page ground
        //   surface  a card sitting on the canvas
        //   elevated a thing floating ABOVE a card (menu, modal, drawer)
        //   sunken   a panel recessed INTO a card (quoted AI text, inputs,
        //            table heads, row hover)
        canvas: v("canvas"),
        surface: v("surface"),
        elevated: v("elevated"),
        sunken: v("sunken"),
        hairline: v("hairline"), // card outer edge
        divider: v("divider"),   // rule between rows INSIDE a card
        control: v("control"),   // input / secondary-button border

        // --- ink scale ---
        // Replaces the gray-400-vs-gray-500 muddle. `ink-muted` is the FLOOR
        // for real text in both themes (5.16:1 light / 5.56:1 dark). `ink-faint`
        // (3.36:1 / 3.30:1) is for disabled glyphs and decoration ONLY — never
        // small body copy. See docs/systems/brand.md.
        ink: {
          DEFAULT: v("ink"),
          body: v("ink-body"),
          secondary: v("ink-secondary"),
          muted: v("ink-muted"),
          faint: v("ink-faint"),
        },

        // --- brand ---
        brand: {
          DEFAULT: v("brand"),
          hover: v("brand-hover"),
          tint: v("brand-tint"), // selection ground
          ...teal,
        },

        // --- "on" colours: what text/icons become when they sit ON a filled
        // swatch. In light mode every one of these is white. In dark mode the
        // fills are BRIGHT (teal #50B7B0, red #F0897F, amber #DFA44E), so white
        // on them measures 2.2-2.6:1 — the approved mockup does exactly this
        // and it is the one place the mockup is not accessible. Dark ink on the
        // bright fill measures 7.3-7.5:1 and is the standard dark-UI answer.
        // Reach for `text-on-brand` wherever you would have written
        // `bg-brand text-white`.
        "on-brand": v("on-brand"),
        "on-critical": v("on-critical"),
        "on-attention": v("on-attention"),
        "on-info": v("on-info"),
        "on-carbon": v("on-carbon"),

        // --- person identity (avatars, card accents) ---
        // Six distinguishable fills drawn only from the brand families. Text on
        // them is `text-on-identity`.
        identity: {
          1: v("id-1"), 2: v("id-2"), 3: v("id-3"),
          4: v("id-4"), 5: v("id-5"), 6: v("id-6"),
        },
        "on-identity": v("on-identity"),

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
      // The one gradient the system spends: a deep teal-into-carbon feature
      // surface, for identity bands and hero summaries only. Everything else
      // is a flat surface — see lib/tokens.ts FEATURE_SURFACE.
      backgroundImage: {
        feature: "linear-gradient(145deg, var(--c-feature-from), var(--c-feature-to))",
      },
      ringColor: { DEFAULT: v("focus") },
      ringOffsetColor: { DEFAULT: v("canvas") },
    },
  },
  plugins: [],
};
