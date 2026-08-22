// Shared page container — Session 54 (2026-08-22). Every /app/* page used to
// hand-roll its own `mx-auto max-w-* px-* py-*` wrapper on its top-level
// <main>, and they'd quietly drifted apart over ~50 sessions: most pages used
// `px-6` with no `sm:` breakpoint bump, but AppNav's header (the persistent
// bar every page sits under, see components/AppNav.tsx) uses `px-6 sm:px-8`.
// Net effect, confirmed by grepping every page's <main>: on any viewport
// ≥640px, nearly every page's heading sat ~8px left of the logo/Quick add
// button directly above it — invisible before Session 51's persistent
// header+sidebar gave the app a fixed reference line to drift away from,
// glaring once it did (see the design_consistency_pass_brief / page shell
// discussion after Session 53).
//
// This component is the fix: one place that owns the horizontal recipe
// (`px-6 sm:px-8`, matching AppNav's header exactly) and a standardized
// vertical rhythm. Each page keeps its own max-width via the `maxWidth` prop
// — that dimension varies legitimately (a single-column form doesn't need
// 7xl) and isn't part of what drifted.
//
// login/page.tsx and ic/page.tsx deliberately do NOT use this — they render
// outside AppNav/Sidebar entirely (see layout.tsx's NO_NAV_PATHS), so they
// have no header to align against and keep their own centered-auth-screen
// treatment (max-w-sm py-24).
//
// Session 56 white-space audit (see the published "White Space Audit"
// comparison canvas and the session56_height_token_and_whitespace project
// memory note): two follow-on fixes, both approved by Andrew after seeing
// the before/after mockups.
//
// (1) Top/bottom padding tightened py-10 (40px) -> py-8 (32px). Paired with
// the SECTION_GAP token (components/ZoneMap.tsx) that pages now use for
// their own internal section spacing instead of ad hoc mt-6/mt-8's, this
// closed the "128px of pure margin before you reach the KPI strip" gap the
// audit measured on Goals down to 108px, with no page redesign — same
// components, same content, just a shared vertical-rhythm scale instead of
// each page/block picking its own margin.
//
// (2) New `8xl` tier (max-w-[1600px], an arbitrary value — Tailwind has no
// built-in step between 7xl/80rem and full) for pages whose job is a wide
// data grid (Dashboard, Goals, Projects, Team). The audit found max-w-7xl
// (1280px) sitting in the middle of a much wider flex-1 column next to the
// 190px sidebar on a wide monitor — 165px of dead space on each side, ~21%
// of the available width doing nothing for a page whose whole point is
// showing several columns of data side by side. Form-heavy pages (Settings
// 4xl, Capacity/Org/1:1s 3xl) deliberately keep their narrower widths —
// this tier is additive, not a replacement for the existing ones.

import { ReactNode } from "react";

const MAX_WIDTHS = {
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
  "8xl": "max-w-[1600px]",
} as const;

export type PageShellMaxWidth = keyof typeof MAX_WIDTHS;

export default function PageShell({
  maxWidth = "7xl",
  className = "",
  children,
}: {
  maxWidth?: PageShellMaxWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main className={`mx-auto ${MAX_WIDTHS[maxWidth]} px-6 py-8 sm:px-8 ${className}`.trim()}>
      {children}
    </main>
  );
}
