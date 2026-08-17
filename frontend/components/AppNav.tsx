"use client";

// Persistent global nav — "hub & orbit" (Option C v2), Session 36/37. Ported
// from mockups/nav/nav-option-c-v2.html: sticky header, sticky orbit strip
// beneath it, and a zone-map overlay opened from the strip's zone chip.
// See docs/DESIGN.md's nav decisions and the nav_redesign_options project
// memory note for the full rationale.
//
// Scope cut, this pass: the mockup's header also shows a "Jump to ⌘K"
// command palette and a global "+ Quick add" button. Neither is in the
// explicitly-enumerated port list (strip markup, zone-chip overlay,
// breadcrumb rules, hues, hover/active states, zone map) and both are new
// standalone features, not nav plumbing — deferred rather than built into
// this pass. Quick add still works from Mission Control's own header, same
// as before.
//
// Not rendered on /app/login (unauthenticated) or /app/ic (IC stub landing,
// wrong audience for a manager-oriented nav) — see getNavContext's "none" case.
//
// Alignment fix (this pass): the header/strip bars used to span edge-to-edge
// (just px-6/sm:px-8 on the bar itself), while every page's own <main> is a
// centered `mx-auto max-w-*` column — on anything wider than a laptop this
// left the nav's brand/breadcrumb/actions sitting noticeably closer to the
// true viewport edges than the page content below them, which Andrew flagged
// as the persistent nav looking "differently aligned" from everything under
// it. Fix: the bar itself (background/border) still spans full width, but its
// content now sits inside an inner `mx-auto max-w-7xl` wrapper — max-w-7xl
// matches Mission Control's and Team's own <main> (the two widest/primary
// pages), so the nav's left/right edges line up with content there. Narrower
// pages (Settings, Goals, etc. at max-w-3xl/4xl) still have extra margin of
// their own below the nav, same as they already do relative to Team/Mission
// Control — that's an existing per-page width choice, not part of this fix.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useDrawer } from "@/lib/drawer-context";
import {
  HOME_ITEM,
  HUE_STYLES,
  Icon,
  ZoneMap,
  getNavContext,
  useZoneData,
} from "@/components/ZoneMap";

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
  const { isOpen: drawerOpen, toggle: toggleDrawer } = useDrawer();
  const zone = useZoneData();
  const [mapOpen, setMapOpen] = useState(false);

  const ctx = getNavContext(pathname ?? "", params ?? {});

  // Escape closes the map overlay from anywhere.
  useEffect(() => {
    if (!mapOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMapOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mapOpen]);

  if (ctx.kind === "none") return null;

  return (
    <>
      {/* Header — bar spans full width; inner wrapper (mx-auto max-w-7xl)
          aligns the actual content with the page's own <main> below it. */}
      <header className="sticky top-0 z-40 border-b border-[#e7e5e0] bg-[#faf9f6]/92 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-2.5 sm:px-8">
          <Link href="/app/dashboard" className="flex shrink-0 items-center gap-2 text-[14.5px] font-semibold text-gray-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-gradient-to-br from-[#4f46e5] to-[#7c4ddb] text-xs text-white">
              ●
            </span>
            The Same Page
          </Link>

          {/* "here" slot — breadcrumb, rules ported from the mockup's paint() */}
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-gray-500">
            {ctx.kind === "home" && <span className="font-semibold text-gray-900">Mission Control</span>}

            {ctx.kind === "item" && (
              <>
                <Link href={HOME_ITEM.href} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-black/5 hover:text-gray-900">
                  <Icon name="back" className="h-[15px] w-[15px]" /> Mission Control
                </Link>
                <span className="min-w-0 truncate">
                  <span>{ctx.group.group}</span>
                  <span className="mx-1.5 text-[#a3a9b4]">/</span>
                  <b className="text-gray-900">{ctx.item.label}</b>
                </span>
              </>
            )}

            {ctx.kind === "person" && (
              <>
                <Link href={HOME_ITEM.href} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-black/5 hover:text-gray-900">
                  <Icon name="back" className="h-[15px] w-[15px]" /> Mission Control
                </Link>
                <span className="min-w-0 truncate">
                  <span>{ctx.group.group}</span>
                  <span className="mx-1.5 text-[#a3a9b4]">/</span>
                  <Link href={ctx.viaItem.href} className="underline decoration-[#e7e5e0] hover:text-gray-900">
                    {ctx.viaItem.label}
                  </Link>
                  <span className="mx-1.5 text-[#a3a9b4]">/</span>
                  <b className="text-gray-900">
                    {zone.roster.find((p) => p.id === ctx.reportId)?.name ?? "…"}
                  </b>
                </span>
              </>
            )}
          </div>

          {/* Global actions — Scribe toggle (moved here from the dashboard-only
              + fixed-button pattern, per DESIGN.md's 2026-08-13 note that this
              was the planned home once global nav shipped) + a static avatar
              badge. */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
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
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#15171c] text-[11px] font-semibold text-white"
              title={zone.profileName ?? undefined}
            >
              {initialsOf(zone.profileName)}
            </span>
          </div>
        </div>
      </header>

      {/* Orbit strip — sticky under the header, hidden on Mission Control
          itself (the inline zone map already gives full-map access there).
          top-[55px] replaces the old hardcoded top-[45px], which assumed a
          shorter header than the actual rendered height (the Scribe button's
          own padding makes the header ~55px tall, not 45px) — the mismatch
          let the strip stick a few pixels too high, overlapping the header's
          bottom edge on scroll. */}
      {ctx.kind !== "home" && (
        <div className="sticky top-[55px] z-30 border-b border-[#f1efeb] bg-[#faf9f6]/92 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-6 py-2 sm:px-8">
            <button
              onClick={() => setMapOpen(true)}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[12.5px] font-semibold transition hover:-translate-y-px hover:shadow-sm ${HUE_STYLES[ctx.group.hue].chipOn}`}
            >
              <Icon name="map" className="h-3 w-3" />
              {ctx.group.group}
              <Icon name="chevron" className="h-3 w-3 opacity-60" />
            </button>
            <span className="mx-1 h-5 w-px shrink-0 bg-[#e7e5e0]" />

            {ctx.kind === "item" &&
              ctx.group.items.map((item) => {
                const active = item.id === ctx.item.id;
                const hue = HUE_STYLES[ctx.group.hue];
                const content = (
                  <>
                    <Icon name={item.icon} className="h-[15px] w-[15px]" />
                    {item.label}
                  </>
                );
                return item.disabled ? (
                  <span
                    key={item.id}
                    className="flex shrink-0 cursor-default items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] text-gray-300"
                    title="Coming in a later pass"
                  >
                    {content}
                  </span>
                ) : (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] transition hover:-translate-y-px ${
                      active ? `border-[#e7e5e0] bg-white font-semibold shadow-sm ${hue.text}` : "border-transparent text-gray-500 hover:border-[#e7e5e0] hover:bg-white hover:text-gray-900"
                    }`}
                  >
                    {content}
                  </Link>
                );
              })}

            {ctx.kind === "person" &&
              zone.roster.map((p) => {
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

            {ctx.kind === "person" && (
              <Link href="/app/team" className="ml-auto shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] text-gray-500 hover:bg-white hover:text-gray-900">
                All {zone.roster.length} →
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Map overlay — the fix for cross-zone moves needing ⌘K (the one real
          weakness of the earlier option). Opens from any non-home page. */}
      {mapOpen && (
        <div
          className="fixed inset-0 z-[100] overflow-auto bg-[#15171c]/26 px-6 py-16 backdrop-blur-[2px] sm:px-8 sm:py-20"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMapOpen(false);
          }}
        >
          <div className="mx-auto max-w-[1100px] rounded-[18px] border border-[#e7e5e0] bg-white p-5 shadow-2xl">
            <div className="mb-1 flex items-baseline justify-between">
              <h3 className="text-[15px] font-semibold text-gray-900">All areas</h3>
              <span className="text-xs text-gray-400">
                press <kbd className="rounded border border-[#e7e5e0] px-1 py-0.5 text-[11px]">esc</kbd> to close
              </span>
            </div>
            <div className="mt-3">
              <ZoneMap doorStates={zone.doorStates} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
