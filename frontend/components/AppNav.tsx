"use client";

// Persistent global nav — top-bar + sidebar combined approach, Session 51.
// Supersedes the "hub & orbit" header (Sessions 36/37): that design's
// breadcrumb ("here" slot) and orbit-strip zone chip both restated the same
// "where am I" context in two different idioms stacked on top of each
// other — see the nav_redesign_options_v2 project memory note and the "Top
// Nav Options" design canvas Andrew approved. Fix, approved as a combined
// approach across three mockup passes in that canvas:
//   - The top bar is now pure, invariant chrome — a global "+ Quick add"
//     (moved here from the dashboard-only button), Scribe, avatar. The logo
//     sits at the top of the Sidebar, above the nav it names.
//     It never shows a page name or breadcrumb, on any page.
//   - Section-to-section navigation ("which zone am I in") moved to a
//     persistent left rail — components/Sidebar.tsx — whose highlighted
//     item IS the "you are here" signal the breadcrumb used to carry.
//     Session 52: now renders on Mission Control too, for consistency
//     across every page (see Sidebar.tsx's header comment for why).
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
import { useSidebar } from "@/lib/sidebar-context";
import Logo from "@/components/Logo";
import { createClient } from "@/lib/supabase";
import { Icon, NAV_STRIP_HEIGHT, getNavContext, useZoneData } from "@/components/ZoneMap";
import QuickAddModal from "@/components/QuickAddModal";
import { BTN_TOPBAR_NEUTRAL, BTN_TOPBAR_SCRIBE, BTN_TOPBAR_SCRIBE_OPEN, ELEVATED } from "@/lib/tokens";

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
  const { setMobileOpen } = useSidebar();
  // Andrew flagged (2026-08-17): clicking the avatar badge did nothing — it
  // was a plain <span>, no menu ever built. Wired up here: name/email +
  // Settings + Sign out for quick access from anywhere. Settings also exposes
  // an explicit Account section so sign-out remains discoverable there.
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
      {/* Header — invariant chrome, every page. Anchored to the content
          column's edges with the same px-6 sm:px-8 as PageShell, NOT centred
          on a max width: pages use different max widths (2xl to 8xl), so a
          centred max-w-7xl bar drifted ~128px off the 8xl pages' content on
          wide screens. The logo lives at the top of the Sidebar, above the
          nav it names, so this bar carries only the global actions. */}
      <header className="sticky top-0 z-40 border-b border-hairline bg-canvas/85 backdrop-blur">
        <div className={`flex ${NAV_STRIP_HEIGHT} items-center gap-3 px-6 sm:px-8`}>
          {/* Below md the Sidebar is hidden: a menu button and the mark stand in for it. */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="-ml-1 flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary hover:bg-sunken hover:text-ink md:hidden"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
              <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
            </svg>
          </button>
          <Link href="/app/dashboard" className="md:hidden" aria-label="The Same Page — Mission Control">
            <Logo className="h-[22px] w-auto text-brand" />
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              onClick={openQuickAdd}
              className={BTN_TOPBAR_NEUTRAL}
            >
              <span aria-hidden className="text-ink-muted">+</span>
              <span className="hidden sm:inline">Quick add</span>
              <span className="sr-only sm:hidden">Quick add</span>
            </button>
            <button
              onClick={toggleDrawer}
              title={drawerOpen ? "Close Scribe (⌘J)" : "Open Scribe (⌘J)"}
              // Scribe keeps its blue identity, the one product area allowed
              // to. A tinted chip at rest (a solid blue pill was the loudest
              // thing on every page); solid only while the drawer is open.
              aria-pressed={drawerOpen}
              className={drawerOpen ? BTN_TOPBAR_SCRIBE_OPEN : BTN_TOPBAR_SCRIBE}
            >
              <span aria-hidden>✦</span>
              <span className="hidden sm:inline">Scribe</span>
              <span className="sr-only sm:hidden">Scribe</span>
              <kbd className={`hidden font-sans text-[11px] sm:inline ${drawerOpen ? "text-on-info/70" : "text-blue-700/70"}`}>⌘J</kbd>
            </button>
            <div className="relative" ref={avatarMenuRef}>
              <button
                onClick={() => setAvatarMenuOpen((v) => !v)}
                title={zone.profileName ?? undefined}
                aria-haspopup="menu"
                aria-expanded={avatarMenuOpen}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-identity-1 text-[11px] font-semibold text-on-identity transition hover:ring-2 hover:ring-brand/40"
              >
                {initialsOf(zone.profileName)}
              </button>

              {avatarMenuOpen && (
                <div
                  role="menu"
                  className={`absolute right-0 top-10 z-50 w-56 overflow-hidden ${ELEVATED}`}
                >
                  <div className="border-b border-divider px-3 py-2.5">
                    <p className="truncate text-sm font-medium text-ink">{zone.profileName || "—"}</p>
                    {zone.profileEmail && <p className="truncate text-xs text-ink-muted">{zone.profileEmail}</p>}
                  </div>
                  <Link
                    href="/app/settings"
                    role="menuitem"
                    onClick={() => setAvatarMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-ink-body hover:bg-sunken hover:text-ink"
                  >
                    <Icon name="settings" className="h-[15px] w-[15px] text-ink-muted" />
                    Settings
                  </Link>
                  <button
                    role="menuitem"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-body hover:bg-sunken hover:text-ink disabled:opacity-50"
                  >
                    <Icon name="back" className="h-[15px] w-[15px] text-ink-muted" />
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
          switches person within "Your people". top-14 matches the header's
          fixed NAV_STRIP_HEIGHT exactly (Session 55 follow-up — previously
          top-[55px], a measured approximation of the old padding-derived
          height; now an exact match since the header's height is a fixed
          token rather than something to measure). */}
      {ctx.kind === "person" && (
        <div className="sticky top-14 z-30 border-b border-hairline bg-canvas/85 backdrop-blur">
          <div className="flex items-center gap-2 overflow-x-auto px-6 py-2 sm:px-8">
            {zone.roster.map((p) => {
              const active = p.id === ctx.reportId;
              return (
                <Link
                  key={p.id}
                  href={ctx.viaItem.id === "assessments" ? `/app/assessments/${p.id}` : `/app/reports/${p.id}`}
                  className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border py-1 pl-1 pr-3 text-[13px] transition hover:-translate-y-px ${
                    active
                      ? "border-brand/40 bg-brand-tint font-medium text-brand"
                      : "border-transparent text-ink-secondary hover:border-hairline hover:bg-surface hover:text-ink"
                  }`}
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-on-identity"
                    style={{ background: p.color }}
                  >
                    {p.initials}
                  </span>
                  {p.firstName}
                  {p.due && (
                    <span
                      title="1:1 due"
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                    />
                  )}
                </Link>
              );
            })}

            <Link href="/app/team" className="ml-auto shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] text-ink-secondary hover:bg-sunken hover:text-ink">
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
