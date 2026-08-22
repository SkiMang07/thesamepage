"use client";

// Persistent left rail — nav rework, Session 51 (see the
// nav_redesign_options_v2 project memory note and the "Top Nav Options"
// design canvas Andrew approved). Replaces the old orbit strip's zone-chip
// + item-switcher row: instead of a contextual "which items are in this
// zone" strip that only appeared per-page, every section is always
// reachable from a persistent rail, so the highlighted item IS the "you
// are here" signal AppNav's breadcrumb used to carry. Not rendered on
// Mission Control itself (ctx.kind === "home") — that page already is the
// map, via its own card grid + inline ZoneMap, so a persistent rail there
// would just restate what's already on screen. Also not rendered on
// /app/login or /app/ic, matching AppNav's NO_NAV_PATHS.
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
  HUE_STYLES,
  Icon,
  NAV_GROUPS,
  getNavContext,
} from "@/components/ZoneMap";
import { useSidebar } from "@/lib/sidebar-context";

export default function Sidebar() {
  const pathname = usePathname();
  const params = useParams<Record<string, string | string[] | undefined>>();
  const { collapsed, toggle } = useSidebar();

  const ctx = getNavContext(pathname ?? "", params ?? {});
  if (ctx.kind === "home" || ctx.kind === "none") return null;

  const activeItemId = ctx.kind === "item" ? ctx.item.id : ctx.kind === "person" ? ctx.viaItem.id : null;

  return (
    <div
      className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-y-auto border-r border-[#e7e5e0] bg-[#faf9f6] transition-[width] duration-150 ${
        collapsed ? "w-14" : "w-[190px]"
      }`}
    >
      <div className={`flex items-center py-3 ${collapsed ? "justify-center" : "justify-end px-2"}`}>
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-black/5 hover:text-gray-700"
        >
          <Icon name="back" className={`h-[15px] w-[15px] transition-transform ${collapsed ? "rotate-180" : ""}`} />
        </button>
      </div>

      <nav className={`flex flex-1 flex-col gap-0.5 pb-4 ${collapsed ? "items-center px-2" : "px-2"}`}>
        <Link
          href={HOME_ITEM.href}
          title={HOME_ITEM.label}
          className={`flex items-center gap-2.5 rounded-lg text-[13px] text-gray-600 hover:bg-black/5 hover:text-gray-900 ${
            collapsed ? "h-9 w-9 justify-center" : "px-2.5 py-2"
          }`}
        >
          <Icon name={HOME_ITEM.icon} className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">{HOME_ITEM.label}</span>}
        </Link>

        <div className={`my-2 h-px shrink-0 bg-[#e7e5e0] ${collapsed ? "w-6" : "mx-2.5"}`} />

        {NAV_GROUPS.map((group) =>
          group.items.map((item) => {
            const active = item.id === activeItemId;
            const hue = HUE_STYLES[group.hue];
            return (
              <Link
                key={item.id}
                href={item.href}
                title={item.label}
                className={`flex items-center gap-2.5 rounded-lg text-[13px] transition ${
                  collapsed ? "h-9 w-9 justify-center" : "px-2.5 py-2"
                } ${active ? `font-semibold ${hue.bg} ${hue.text}` : "text-gray-600 hover:bg-black/5 hover:text-gray-900"}`}
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
