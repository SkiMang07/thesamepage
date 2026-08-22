"use client";

// Persistent left rail's collapse state — nav rework (top-bar + sidebar
// combined approach, approved via the "Top Nav Options" design canvas).
// Mirrors drawer-context.tsx's shape (isOpen/toggle pattern), but the
// collapsed preference is a durable per-device choice rather than a
// per-tab one, so it's hydrated from localStorage (not sessionStorage —
// see drawer-context.tsx for that pattern) and persists across sessions.

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "tsp:sidebar-collapsed";

type SidebarContextType = {
  collapsed: boolean;
  toggle: () => void;
};

const SidebarContext = createContext<SidebarContextType | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "true") setCollapsed(true);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  return <SidebarContext.Provider value={{ collapsed, toggle }}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be inside SidebarProvider");
  return ctx;
}
