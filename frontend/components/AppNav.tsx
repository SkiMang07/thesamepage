"use client";

// Persistent global nav — top-bar + sidebar combined approach, Session 51.
// Supersedes the "hub & orbit" header (Sessions 36/37): that design's
// breadcrumb ("here" slot) and orbit-strip zone chip both restated the same
// "where am I" context in two different idioms stacked on top of each
// other — see the nav_redesign_options_v2 project memory note and the "Top
// Nav Options" design canvas Andrew approved. Fix, approved as a combined
// approach across three mockup passes in that canvas:
//   - The top bar is now pure, invariant chrome — logo, a global "+ Quick
//     add" (moved here from the dashboard-only button), Scribe, avatar.
//     It never shows a page name or breadcrumb, on any page.
//   - Section-to-section navigation ("which zone am I in") moved to a
//     persistent left rail — components/Sidebar.tsx — whose highlighted
//     item IS the "you are here" signal the breadcrumb used to carry.
//     Not rendered on Mission Control (that page already is the map).
//   - The only thing that stays a second contextual row under the top bar
//     is the roster switcher on person-kind pages (which direct report
//     you're looking at) — that's a within-section switch, a genuinely
//     different job from the sidebar's between-section one, so it isn't
//     redundant with it the way the old zone chip was.
// The all-areas map overlay (opened from the old zone chip) is retired
// with it — the sidebar already puts every section one click away from
// anywhere, so a separate "jump to any zone" sheet no longer earns its
// keep. Mission Control's own inline ZoneMap (the door-state grid) is
// unrelated and untouched.
//
// Not rendered on /app/login (unauthenticated) or /app/ic (IC stub landing,
// wrong audience for a manager-oriented nav) — see getNavContext's "none" case.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useParams, useRouter } from "next/navigation";
import { useDrawer } from "@/lib/drawer-context";
import { useQuickAdd } from "@/lib/quick-add-context";
import { createClient } from "@/lib/supabase";
import { Icon, getNavContext, useZoneData } from "@/components/ZoneMap";
import QuickAddModal from "@/components/QuickAddModal";

function initialsOf(name: string | null) {
  if (!name) return "—";
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function AppNav() {
  const pathname = usePathname();
  const params = useParams<Record<string, string | string[] | undefined>>();
  const router = useRouter();
  const { isOpen: drawerOpen, toggle: toggleDrawer } = useDrawer();
  const { isOpen: quickAddOpen, open: openQuickAdd, close: closeQuickAdd } = useQuickAdd();
  const zone = useZoneData();
  // Andrew flagged (2026-08-17): clicking the avatar badge did nothing — it
  // was a plain <span>, no menu ever built. Wired up here: name/email +
  // Settings + Sign out, the one place a manager can actually get out of the
  // app (there was previously no sign-out control anywhere in the UI).
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const avatarMenuRef = useRef<HTMLDivElement>(null);

  const ctx = getNavContext(pathname ?? "", params ?? {});

  // Escape + click-outside close the avatar menu.
  useEffect(() => {
    if (!avatarMenuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAvatarMenuOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(e.target as Node)) {
        setAvatarMenuOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [avatarMenuOpen]);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/app/login");
  }

  if (ctx.kind === "none") return null;

  return (
    <>
      {/* Header — invariant chrome, every page. Bar spans full width; inner
          wrapper (mx-auto max-w-7xl) aligns the actual content with the
          page's own <main> below it. */}
      <header className="sticky top-0 z-40 border-b border-[#e7e5e0] bg-[#faf9f6]/92 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-2.5 sm:px-8">
          <Link href="/app/dashboard" className="flex shrink-0 items-center gap-2 text-[14.5px] font-semibold text-gray-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-gradient-to-br from-[#4f46e5] to-[#7c4ddb] text-xs text-white">
              ●
            </span>
            The Same Page
          </Link>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              onClick={openQuickAdd}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              + Quick add
            </button>
            <button
              onClick={toggleDrawer}
              title={drawerOpen ? "Close Scribe (⌘J)" : "Open Scribe (⌘J)"}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium shadow-sm transition-all ${
                drawerOpen
                  ? "bg-gray-900 text-white"
                  : "bg-gradient-to-br from-[#4f46e5] to-[#7c4ddb] text-white hover:shadow-md hover:brightness-105"
              }`}
            >
              <span aria-hidden>✦</span>
              <span>Scribe</span>
              <span className={`text-xs ${drawerOpen ? "text-gray-400" : "text-white/70"}`}>⌘J</span>
            </button>
            <div className="relative" ref={avatarMenuRef}>
              <button
                onClick={() => setAvatarMenuOpen((v) => !v)}
                title={zone.profileName ?? undefined}
                aria-haspopup="menu"
                aria-expanded={avatarMenuOpen}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#15171c] text-[11px] font-semibold text-white transition hover:ring-2 hover:ring-[#4f46e5]/30"
              >
                {initialsOf(zone.profileName)}
              </button>

              {avatarMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-9 z-50 w-56 overflow-hidden rounded-lg border border-[#e7e5e0] bg-white shadow-lg"
                >
                  <div className="border-b border-[#f1efeb] px-3 py-2.5">
                    <p className="truncate text-sm font-medium text-gray-900">{zone.profileName || "—"}</p>
                    {zone.profileEmail && <p className="truncate text-xs text-gray-400">{zone.profileEmail}</p>}
                  </div>
                  <Link
                    href="/app/settings"
                    role="menuitem"
                    onClick={() => setAvatarMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Icon name="settings" className="h-[15px] w-[15px] text-gray-400" />
                    Settings
                  </Link>
                  <button
                    role="menuitem"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Icon name="back" className="h-[15px] w-[15px] text-gray-400" />
                    {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Roster switcher — the one contextual row that survives, only for
          person-kind pages (which direct report am I looking at). Not a
          duplicate of the sidebar: the sidebar switches section, this
          switches person within "Your people". top-[55px] matches the
          header's measured rendered height (unchanged from the previous
          nav's header — same padding/button sizes, see Session 36/37's
          note on why this isn't the naive 45px estimate). */}
      {ctx.kind === "person" && (
        <div className="sticky top-[55px] z-30 border-b border-[#f1efeb] bg-[#faf9f6]/92 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-6 py-2 sm:px-8">
            {zone.roster.map((p) => {
              const active = p.id === ctx.reportId;
              return (
                <Link
                  key={p.id}
                  href={ctx.viaItem.id === "assessments" ? `/app/assessments/${p.id}` : `/app/reports/${p.id}`}
                  className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border py-1 pl-1 pr-3 text-[13px] transition hover:-translate-y-px ${
                    active ? "border-[#e7e5e0] bg-white font-semibold shadow-sm" : "border-transparent text-gray-600 hover:border-[#e7e5e0] hover:bg-white"
                  }`}
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: p.color }}
                  >
                    {p.initials}
                  </span>
                  {p.firstName}
                  {p.due && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d99b28]" />}
                </Link>
              );
            })}

            <Link href="/app/team" className="ml-auto shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] text-gray-500 hover:bg-white hover:text-gray-900">
              All {zone.roster.length} →
            </Link>
          </div>
        </div>
      )}

      <QuickAddModal
        open={quickAddOpen}
        onClose={closeQuickAdd}
        directReports={zone.roster}
        onCreated={() => router.refresh()}
      />
    </>
  );
}
