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
// vertical rhythm (`py-10`, tightened from the mix of py-10/12/16 pages had
// drifted to — py-10 was Dashboard's own value, the one page that happened
// to already match the header's breakpoint, so it's the value every other
// page is moving to rather than a new invention). Each page keeps its own
// max-width via the `maxWidth` prop — that dimension varies legitimately
// (a single-column form doesn't need 7xl) and isn't part of what drifted.
//
// login/page.tsx and ic/page.tsx deliberately do NOT use this — they render
// outside AppNav/Sidebar entirely (see layout.tsx's NO_NAV_PATHS), so they
// have no header to align against and keep their own centered-auth-screen
// treatment (max-w-sm py-24).

import { ReactNode } from "react";

const MAX_WIDTHS = {
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
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
    <main className={`mx-auto ${MAX_WIDTHS[maxWidth]} px-6 py-10 sm:px-8 ${className}`.trim()}>
      {children}
    </main>
  );
}
