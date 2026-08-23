"use client";

// Persistent left rail — nav rework, Session 51 (see the
// nav_redesign_options_v2 project memory note and the "Top Nav Options"
// design canvas Andrew approved). Replaces the old orbit strip's zone-chip
// + item-switcher row: instead of a contextual "which items are in this
// zone" strip that only appeared per-page, every section is always
// reachable from a persistent rail, so the highlighted item IS the "you
// are here" signal AppNav's breadcrumb used to carry.
//
// Session 52 change: now renders on Mission Control too. Session 51's call
// was to skip it there — "that page already is the map" — but after living
// with it, Andrew's read was simpler: every other page has the rail, Mission
// Control was the lone exception, and that read as inconsistent rather than
// as a deliberate simplification (see design_consistency_pass_brief project
// memory note). Mission Control's own inline ZoneMap grid is unchanged and
// still does its own job (the door-state overview); the rail sits alongside
// it like it does everywhere else. None of NAV_GROUPS' items is "active" on
// Mission Control, so the Home link itself takes the active treatment
// instead (see isHome below).
//
// Also not rendered on /app/login or /app/ic, matching AppNav's NO_NAV_PATHS.
//
// The roster switcher (which direct report you're looking at) stays a
// separate, second row under the top bar on person-kind pages — see
// AppNav.tsx. That's a within-section switch; this rail is a
// between-section one, and the two aren't redundant with each other the
// way the old chip + breadcrumb were.

import { usePathname, useParams } from "next/navigation";
import Link from "next/link";
import {
  HOME_ITEM,
  ZONE_STYLE,
  Icon,
  NAV_GROUPS,
  NAV_STRIP_HEIGHT,
  getNavContext,
} from "@/components/ZoneMap";
import { useSidebar } from "@/lib/sidebar-context";

export default function Sidebar() {
  const pathname = usePathname();
  const params = useParams<Record<string, string | string[] | undefined>>();
  const { collapsed, toggle } = useSidebar();

  const ctx = getNavContext(pathname ?? "", params ?? {});
  if (ctx.kind === "none") return null;

  const isHome = ctx.kind === "home";
  const activeItemId = ctx.kind === "item" ? ctx.item.id : ctx.kind === "person" ? ctx.viaItem.id : null;

  return (
    <div
      className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-y-auto border-r border-[#DDE0E3] bg-[#F5F8FA] transition-[width] duration-150 ${
        collapsed ? "w-14" : "w-[190px]"
      }`}
    >
      {/* Top row — shares AppNav's header height via NAV_STRIP_HEIGHT
          (Session 55 follow-up) so the rail and header read as one
          coordinated strip instead of two independently-padded rows that
          happened to look close. Previously py-3, whose height fell out of
          padding + the collapse button's own h-7 rather than matching the
          header on purpose. */}
      <div className={`flex ${NAV_STRIP_HEIGHT} items-center ${collapsed ? "justify-center" : "justify-end px-2"}`}>
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink-body"
        >
          <Icon name="back" className={`h-[15px] w-[15px] transition-transform ${collapsed ? "rotate-180" : ""}`} />
        </button>
      </div>

      <nav className={`flex flex-1 flex-col gap-0.5 pb-4 ${collapsed ? "items-center px-2" : "px-2"}`}>
        <Link
          href={HOME_ITEM.href}
          title={HOME_ITEM.label}
          className={`flex items-center gap-2.5 rounded-lg text-[13px] transition ${
            collapsed ? "h-9 w-9 justify-center" : "px-2.5 py-2"
          } ${isHome ? "bg-black/5 font-semibold text-ink" : "text-ink-secondary hover:bg-sunken hover:text-ink"}`}
        >
          <Icon name={HOME_ITEM.icon} className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">{HOME_ITEM.label}</span>}
        </Link>

        <div className={`my-2 h-px shrink-0 bg-[#DDE0E3] ${collapsed ? "w-6" : "mx-2.5"}`} />

        {NAV_GROUPS.map((group) =>
          group.items.map((item) => {
            const active = item.id === activeItemId;
            const hue = ZONE_STYLE;
            return (
              <Link
                key={item.id}
                href={item.href}
                title={item.label}
                className={`flex items-center gap-2.5 rounded-lg text-[13px] transition ${
                  collapsed ? "h-9 w-9 justify-center" : "px-2.5 py-2"
                } ${active ? `font-semibold ${hue.bg} ${hue.text}` : "text-ink-secondary hover:bg-sunken hover:text-ink"}`}
              >
                <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          }),
        )}
      </nav>
    </div>
  );
}
