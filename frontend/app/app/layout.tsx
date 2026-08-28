"use client";

// Shared layout for all authenticated /app/* pages — Sessions 32–34.
// Wraps pages in DrawerProvider + the reflow shell that pushes content
// left when the Scribe drawer opens.
//
// Session 35 change: drawer width is now responsive — clamp(400px, 30vw, 640px)
// instead of a fixed 400px — so it scales toward ~25-33% of the viewport
// on larger screens while never going below the original 400px floor.
//
// Session 36/37 change: the persistent global nav ("hub & orbit", Option C
// v2 — see docs/DESIGN.md and the nav_redesign_options project memory note)
// renders here as <AppNav />, above every page's own content. The old
// per-page "← Back to your team" links and Mission Control's own NAV_LINKS
// row are gone now that this is the one place cross-page navigation lives.
//
// This also retires the fixed top-right ✦ button + the dashboard's
// nav-bar-integrated one — the Scribe toggle now lives once, inside AppNav's
// header, for every page. AppNav (and the Scribe toggle/drawer with it) is
// skipped on /app/login (unauthenticated) and /app/ic (IC stub landing —
// wrong audience for a manager-oriented nav).
//
// Session 51 change: <Sidebar /> joins AppNav as a second persistent piece
// of chrome — a left rail for section-to-section nav, replacing AppNav's
// old breadcrumb + zone-chip (see AppNav.tsx's header comment for why).
// It's a flex sibling of the main-content column, same shape as the Scribe
// drawer on the other side, so collapsing/expanding it (SidebarProvider,
// internal to Sidebar.tsx) just reflows the flex row — no coordination
// needed here. QuickAddProvider joins DrawerProvider at the same level:
// Quick Add is now a global action (AppNav's header button) instead of a
// dashboard-page-local one, so its open/close state has to outlive any one
// page the same way the drawer's does.
//
// Keyboard: ⌘J summons the drawer with the composer focused; Esc closes.
// ⌘⇧Space dictates into whatever text field is focused, on any page —
// <DictationHotkey /> mounts here for the same reason the drawer does: it
// is a global input method, not a page's feature. See components/NoteField.tsx
// for the per-field mic and docs/systems/dictation.md for the whole design.
//
// Sticky-nav fix (this pass): `overflow-x-hidden` used to live on the same
// div that wraps <AppNav />. Per the CSS overflow spec, setting overflow-x to
// anything but `visible` forces the browser to compute overflow-y as `auto`
// too when it isn't set explicitly — so that div silently became a scroll
// container. AppNav's `position: sticky` header/strip then stuck relative to
// *that div's* (never-scrolling) box instead of the real viewport, so on any
// page tall enough to scroll they just scrolled away instead of staying
// pinned. Fix: `overflow-x-hidden` now wraps only `{children}`, so AppNav
// sits in a plain-overflow ancestor and its sticky positioning resolves
// against the actual page scroll again.

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { DrawerProvider, useDrawer } from "@/lib/drawer-context";
import { SidebarProvider } from "@/lib/sidebar-context";
import { QuickAddProvider } from "@/lib/quick-add-context";
import ScribeDrawer from "@/components/ScribeDrawer";
import AppNav from "@/components/AppNav";
import Sidebar from "@/components/Sidebar";
import DictationHotkey from "@/components/DictationHotkey";

const NO_NAV_PATHS = new Set(["/app/login", "/app/ic"]);

function AppShell({ children }: { children: React.ReactNode }) {
  const { isOpen, toggle, close } = useDrawer();
  const pathname = usePathname();
  const showNav = !NO_NAV_PATHS.has(pathname ?? "");

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!showNav) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape" && isOpen) {
        close();
      }
    },
    [toggle, isOpen, close, showNav],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // THEME SCOPE. `theme-dark` is applied exactly once, here, and every colour
  // token in the tree below resolves to its dark value because of it (see
  // app/globals.css). Nothing else in the app opts in or out — which is what
  // keeps the marketing site, /app/login and /invite on the light theme
  // without a single override: they never render inside this element.
  //
  // /app/login and /app/ic sit UNDER this layout but outside the product
  // chrome (NO_NAV_PATHS), so they stay light too — same condition that hides
  // the nav. `bg-canvas` paints the ground; globals.css mirrors it onto <html>
  // via :has() so an overscroll bounce doesn't flash white.
  return (
    <div className={`flex min-h-screen ${showNav ? "theme-dark bg-canvas text-ink" : ""}`}>
      {showNav && <Sidebar />}

      {/* Main content — flex-1 so it gives up space to the sidebar/drawer.
          AppNav lives outside the overflow-x-hidden div (see note above) so
          its sticky header/strip resolve against the real page scroll. */}
      <div className="flex-1 min-w-0">
        {showNav && <AppNav />}
        <div className="overflow-x-hidden">{children}</div>
      </div>

      {showNav && <DictationHotkey />}

      {/* Scribe drawer — sticky so it stays in view as the page scrolls */}
      {showNav && isOpen && (
        <aside
          className="sticky top-0 flex h-screen w-[clamp(400px,30vw,640px)] shrink-0 flex-col border-l border-hairline bg-surface shadow-xl"
          style={{ zIndex: 40 }}
        >
          <ScribeDrawer />
        </aside>
      )}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DrawerProvider>
      <SidebarProvider>
        <QuickAddProvider>
          <AppShell>{children}</AppShell>
        </QuickAddProvider>
      </SidebarProvider>
    </DrawerProvider>
  );
}
