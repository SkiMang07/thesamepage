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
// Keyboard: ⌘J summons the drawer with the composer focused; Esc closes.

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { DrawerProvider, useDrawer } from "@/lib/drawer-context";
import ScribeDrawer from "@/components/ScribeDrawer";
import AppNav from "@/components/AppNav";

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

  return (
    <div className="flex min-h-screen">
      {/* Main content — flex-1 so it gives up space to the drawer */}
      <div className="flex-1 min-w-0 overflow-x-hidden">
        {showNav && <AppNav />}
        {children}
      </div>

      {/* Scribe drawer — sticky so it stays in view as the page scrolls */}
      {showNav && isOpen && (
        <aside
          className="sticky top-0 flex h-screen w-[clamp(400px,30vw,640px)] shrink-0 flex-col border-l border-gray-200 bg-white shadow-sm"
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
      <AppShell>{children}</AppShell>
    </DrawerProvider>
  );
}
