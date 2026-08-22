"use client";

// Quick Add's open/close state — nav rework, Session 51 (see the
// nav_redesign_options_v2 project memory note). Quick Add used to be a
// dashboard-page-local button + modal (Session 19). It's now a global
// action in the persistent top bar (AppNav.tsx), reachable from every
// page, so its open/close state needs to live above any single page.
//
// This context deliberately owns ONLY the open/close boolean, not the
// direct-reports list the modal needs for its "who is this project/goal
// for" picker — AppNav already fetches that via useZoneData()'s roster
// (one shared fetch, not a new one), and is the one place that actually
// renders <QuickAddModal>. Other pages (e.g. the dashboard's "add your
// first direct report" empty state) just call open() to trigger it.

import { createContext, useCallback, useContext, useState } from "react";

type QuickAddContextType = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const QuickAddContext = createContext<QuickAddContextType | null>(null);

export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return <QuickAddContext.Provider value={{ isOpen, open, close }}>{children}</QuickAddContext.Provider>;
}

export function useQuickAdd() {
  const ctx = useContext(QuickAddContext);
  if (!ctx) throw new Error("useQuickAdd must be inside QuickAddProvider");
  return ctx;
}
