"use client";

// Shared layout for all authenticated /app/* pages — Sessions 32–33.
// Wraps pages in DrawerProvider + the reflow shell that pushes content
// left when the Scribe drawer opens.
//
// S3 change: adds a fixed ✦ button (top-right, z-50) that opens the
// drawer from any authenticated page — visible whenever the drawer is
// closed. This makes the drawer discoverable everywhere without touching
// each page's own header.
//
// Keyboard: ⌘J summons the drawer with the composer focused; Esc closes.

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { DrawerProvider, useDrawer } from "@/lib/drawer-context";
import ScribeDrawer from "@/components/ScribeDrawer";

function AppShell({ children }: { children: React.ReactNode }) {
  const { isOpen, toggle, close } = useDrawer();
  const pathname = usePathname();
  // Dashboard has its own ✦ button in its nav bar — skip the fixed one there.
  const showFixedButton = !isOpen && pathname !== "/app/dashboard";

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape" && isOpen) {
        close();
      }
    },
    [toggle, isOpen, close],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex min-h-screen">
      {/* Main content — flex-1 so it gives up space to the drawer */}
      <div className="flex-1 min-w-0 overflow-x-hidden">{children}</div>

      {/* Fixed ✦ button — visible on all pages (except dashboard, which
          has its own ✦ in its nav bar) when the drawer is closed. */}
      {showFixedButton && (
        <button
          onClick={toggle}
          title="Open Scribe (⌘J)"
          className="fixed right-4 top-4 z-50 flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-sm text-white shadow-sm hover:bg-gray-700 focus:outline-none"
          aria-label="Open Scribe assistant"
        >
          ✦
        </button>
      )}

      {/* Scribe drawer — sticky so it stays in view as the page scrolls */}
      {isOpen && (
        <aside
          className="sticky top-0 flex h-screen w-[400px] shrink-0 flex-col border-l border-gray-200 bg-white shadow-sm"
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
