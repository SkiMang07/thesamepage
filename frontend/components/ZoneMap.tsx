"use client";

// Nav config + zone-map data — Session 36/37 nav rework ("hub & orbit",
// Option C v2). Single source of truth for the persistent global nav
// (AppNav.tsx) and Mission Control's zone map, which replaces the old stat
// ribbon in place (see docs/DESIGN.md's 2026-08-06 "Mission Control ships
// only cards backed by real data" precedent — same rule applies here: every
// door's count is a real fetched number, never a placeholder).
//
// Ported from mockups/nav/nav-option-c-v2.html — icons, hues, and the
// group/blurb copy match that file exactly. Colors use Tailwind arbitrary
// values with the mockup's exact hex tokens rather than Tailwind's built-in
// indigo/emerald/violet shades, so the port is color-for-color faithful
// without introducing a new design-token system (still "plain Tailwind" per
// DESIGN.md's Framework & tooling section).
//
// Nav rework pass 2 (Session 38, 2026-08-16): /app/1-1s now exists — the
// 1:1s door is a live link again, and its "N due" count reads is_due
// straight from GET /api/one-on-ones/overview (see lib/api.ts's
// OneOnOneOverviewItem) instead of computing cadence staleness client-side.
// That endpoint is the single canonical "who's due" computation; this hook
// and Mission Control's Individual Performance card both just read its
// is_due field rather than each re-deriving it.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getCapacityOverview,
  getContextCoverage,
  getGoals,
  getOneOnOnesOverview,
  getOrgUnits,
  getProfile,
  getProjects,
  getSetupStatus,
  getTeamAssessments,
  GoalStatus,
  OneOnOneOverviewItem,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Icons — hand-rolled inline SVG, ported 1:1 from the mockup's ICONS map.
// Twelve of these total across the nav; DESIGN.md flags lucide-react as the
// call to make if the app ever needs more than that (Session 36 note).
// ---------------------------------------------------------------------------

const ICON_PATHS: Record<string, React.ReactNode> = {
  home: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  team: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  oneonones: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  assessments: (
    <polygon points="12 2.5 14.9 8.4 21.4 9.3 16.7 13.9 17.8 20.4 12 17.3 6.2 20.4 7.3 13.9 2.6 9.3 9.1 8.4" />
  ),
  goals: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  projects: (
    <>
      <polygon points="12 2.5 2.5 7.2 12 11.9 21.5 7.2" />
      <polyline points="2.5 16.8 12 21.5 21.5 16.8" />
      <polyline points="2.5 12 12 16.7 21.5 12" />
    </>
  ),
  capacity: (
    <>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </>
  ),
  org: (
    <>
      <circle cx="18" cy="5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="19" r="2.6" />
      <line x1="8.4" y1="13.4" x2="15.6" y2="17.6" />
      <line x1="15.6" y1="6.4" x2="8.4" y2="10.6" />
    </>
  ),
  knowledge: (
    <>
      <path d="M2.5 3.5h5.5a3.5 3.5 0 0 1 3.5 3.5v13.5a3 3 0 0 0-3-3h-6z" />
      <path d="M21.5 3.5H16a3.5 3.5 0 0 0-3.5 3.5v13.5a3 3 0 0 1 3-3h6z" />
    </>
  ),
  settings: (
    <>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1.5" y1="14" x2="6.5" y2="14" />
      <line x1="9.5" y1="8" x2="14.5" y2="8" />
      <line x1="17.5" y1="16" x2="22.5" y2="16" />
    </>
  ),
  back: (
    <>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="11 18 5 12 11 6" />
    </>
  ),
  map: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.6" />
      <rect x="14" y="3" width="7" height="7" rx="1.6" />
      <rect x="3" y="14" width="7" height="7" rx="1.6" />
      <rect x="14" y="14" width="7" height="7" rx="1.6" />
    </>
  ),
  chevron: <polyline points="6 9.5 12 15.5 18 9.5" />,
};

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ?? "h-[18px] w-[18px] shrink-0"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Nav config — the IA locked in nav_redesign_options.md: Mission Control
// (home) + three zones (Your people / The work / Foundation).
// ---------------------------------------------------------------------------

export type ZoneHue = "indigo" | "emerald" | "violet";

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  // Reserved for a future item that ships nav plumbing before its
  // destination page exists (the 1:1s item used this in pass 1). No current
  // item sets this as of pass 2.
  disabled?: boolean;
};

export type NavGroup = {
  group: string;
  hue: ZoneHue;
  blurb: string;
  items: NavItem[];
};

export const HOME_ITEM: NavItem = { id: "home", label: "Mission Control", href: "/app/dashboard", icon: "home" };

export const NAV_GROUPS: NavGroup[] = [
  {
    group: "Your people",
    hue: "indigo",
    blurb: "The rhythm you keep with humans",
    items: [
      { id: "team", label: "Team", href: "/app/team", icon: "team" },
      { id: "oneonones", label: "1:1s", href: "/app/1-1s", icon: "oneonones" },
      { id: "assessments", label: "Assessments", href: "/app/assessments", icon: "assessments" },
    ],
  },
  {
    group: "The work",
    hue: "emerald",
    blurb: "What we said we'd deliver",
    items: [
      { id: "goals", label: "Goals", href: "/app/goals", icon: "goals" },
      { id: "projects", label: "Projects", href: "/app/projects", icon: "projects" },
      { id: "capacity", label: "Capacity", href: "/app/capacity", icon: "capacity" },
    ],
  },
  {
    group: "Foundation",
    hue: "violet",
    blurb: "Set once, tuned rarely",
    items: [
      { id: "org", label: "Org", href: "/app/org", icon: "org" },
      // Renamed from "Context" (Session 36 decision) — "Context" names the
      // mechanism, "Knowledge" names what you get.
      { id: "knowledge", label: "Knowledge", href: "/app/context", icon: "knowledge" },
      { id: "settings", label: "Settings", href: "/app/settings", icon: "settings" },
    ],
  },
];

const TEAM_GROUP = NAV_GROUPS.find((g) => g.group === "Your people")!;
const TEAM_ITEM = TEAM_GROUP.items.find((i) => i.id === "team")!;
const ASSESSMENTS_ITEM = TEAM_GROUP.items.find((i) => i.id === "assessments")!;

// ---------------------------------------------------------------------------
// Route -> nav context, for the header breadcrumb + orbit strip.
// ---------------------------------------------------------------------------

export type NavContext =
  | { kind: "home" }
  | { kind: "item"; group: NavGroup; item: NavItem }
  | { kind: "person"; group: NavGroup; viaItem: NavItem; reportId: string | null }
  | { kind: "none" }; // login / IC — no persistent nav at all

export function getNavContext(pathname: string, params: Record<string, string | string[] | undefined>): NavContext {
  if (pathname === "/app/login" || pathname === "/app/ic") return { kind: "none" };
  if (pathname === "/app/dashboard") return { kind: "home" };

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.href) return { kind: "item", group, item };
    }
  }

  if (pathname.startsWith("/app/reports/")) {
    const id = typeof params.id === "string" ? params.id : null;
    return { kind: "person", group: TEAM_GROUP, viaItem: TEAM_ITEM, reportId: id };
  }
  if (pathname.startsWith("/app/assessments/")) {
    const id = typeof params.reportId === "string" ? params.reportId : null;
    return { kind: "person", group: TEAM_GROUP, viaItem: ASSESSMENTS_ITEM, reportId: id };
  }

  // Unknown /app/* route — fall back to a bare home breadcrumb rather than
  // hiding the nav entirely.
  return { kind: "home" };
}

// ---------------------------------------------------------------------------
// Hue / tone styling — exact hex tokens from the mockup's :root vars, as
// Tailwind arbitrary values (no new global CSS file, no new dependency).
// ---------------------------------------------------------------------------

export const HUE_STYLES: Record<ZoneHue, { text: string; bg: string; border: string; chipOn: string }> = {
  indigo: { text: "text-[#4f46e5]", bg: "bg-[#eef1ff]", border: "border-[#d9dcff]", chipOn: "bg-[#eef1ff] border-[#d9dcff] text-[#4f46e5]" },
  emerald: { text: "text-[#0e8f7e]", bg: "bg-[#ecfaf6]", border: "border-[#c7ece4]", chipOn: "bg-[#ecfaf6] border-[#c7ece4] text-[#0e8f7e]" },
  violet: { text: "text-[#7c4ddb]", bg: "bg-[#f5f0ff]", border: "border-[#e4d8fb]", chipOn: "bg-[#f5f0ff] border-[#e4d8fb] text-[#7c4ddb]" },
};

// Gradient tiles for Mission Control's zone map only (Session 55) — everything
// else that reads HUE_STYLES (Sidebar's active-state chips, AppNav) keeps the
// original pastel tokens above untouched. This mirrors the bold
// bg-gradient-to-br {from}/{to} + white-text KPI-tile convention already used
// on Team/Goals/Projects (see docs/DESIGN.md's Session 53/54 entries) so
// Mission Control reads as the same app instead of a second visual language.
// Reviewed against a two-option comparison canvas before building (Session
// 55) — Andrew picked the gradient option over the original pastel cards.
const HUE_GRADIENT: Record<ZoneHue, { from: string; to: string; shadow: string }> = {
  indigo: { from: "from-[#6366f1]", to: "to-[#4f46e5]", shadow: "shadow-[0_4px_14px_rgba(79,70,229,0.25)]" },
  emerald: { from: "from-[#10b981]", to: "to-[#059669]", shadow: "shadow-[0_4px_14px_rgba(5,150,105,0.25)]" },
  violet: { from: "from-[#a78bfa]", to: "to-[#7c3aed]", shadow: "shadow-[0_4px_14px_rgba(124,58,237,0.25)]" },
};

export type Tone = "warn" | "risk" | "setup";

const TONE_TEXT: Record<Tone, string> = {
  warn: "text-[#b0640c] font-semibold",
  risk: "text-[#c02a4c] font-semibold",
  setup: "text-[#a3a9b4] italic",
};

// Tone colors for text sitting directly on a gradient tile (ZoneMap's cards)
// rather than on the pastel backgrounds above — needs to stay readable across
// all three gradients, not just one hue's pastel.
const TONE_TEXT_ON_GRADIENT: Record<Tone, string> = {
  warn: "text-[#fde68a] font-semibold",
  risk: "text-[#fecaca] font-semibold",
  setup: "text-white/65 italic",
};

const AVATAR_COLORS = ["#4f46e5", "#0e8f7e", "#7c4ddb", "#b0640c", "#c02a4c"];

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const ACTIVE_PROJECT_STATUSES = new Set<GoalStatus>(["active", "on_track", "at_risk"]);

export type DoorState = { label: string; tone?: Tone };

export type RosterPerson = {
  id: string;
  name: string;
  firstName: string;
  initials: string;
  color: string;
  due: boolean;
};

export type ZoneData = {
  loading: boolean;
  doorStates: Partial<Record<string, DoorState>>;
  roster: RosterPerson[];
  // For the header avatar badge — reuses the same getProfile() call already
  // needed for the Settings door's org_ready check, no extra fetch.
  profileName: string | null;
  profileEmail: string | null;
};

// One hook, called independently by AppNav (for the orbit roster + the map
// overlay) and by Mission Control (for the inline map that replaced the
// stat ribbon). Each caller re-fetches rather than sharing a context — this
// matches how the rest of the app already duplicates overlapping fetches
// per-page (e.g. dashboard and /app/team both independently fetch
// getProjects()) rather than introducing shared global data state.
export function useZoneData(): ZoneData {
  const [data, setData] = useState<ZoneData>({
    loading: true,
    doorStates: {},
    roster: [],
    profileName: null,
    profileEmail: null,
  });

  useEffect(() => {
    let cancelled = false;
    const weekStart = startOfWeek(new Date());
    const weekEnd = addDays(weekStart, 6);

    Promise.allSettled([
      getOneOnOnesOverview(),
      getTeamAssessments(),
      getGoals(),
      getProjects(),
      getCapacityOverview(toISODate(weekStart), toISODate(weekEnd)),
      getOrgUnits(),
      getContextCoverage(),
      getProfile(),
      getSetupStatus(),
    ]).then((results) => {
      if (cancelled) return;
      const [teamR, assessR, goalsR, projectsR, capR, orgR, ctxR, profR, setupR] = results;
      const doorStates: Partial<Record<string, DoorState>> = {};
      let roster: RosterPerson[] = [];
      let profileName: string | null = null;
      let profileEmail: string | null = null;

      if (teamR.status === "fulfilled") {
        const team = teamR.value as OneOnOneOverviewItem[];
        doorStates.team = { label: `${team.length} ${team.length === 1 ? "person" : "people"}` };
        const dueCount = team.filter((r) => r.is_due).length;
        doorStates.oneonones = dueCount > 0 ? { label: `${dueCount} due`, tone: "warn" } : { label: "up to date" };
        roster = team.map((r, i) => ({
          id: r.direct_report_id,
          name: r.name,
          firstName: r.name.split(" ")[0],
          initials: initialsOf(r.name),
          color: AVATAR_COLORS[i % AVATAR_COLORS.length],
          due: r.is_due,
        }));
      }

      if (assessR.status === "fulfilled") {
        const dates = assessR.value.map((a) => a.assessed_at).filter((d): d is string => !!d);
        doorStates.assessments = dates.length
          ? { label: `last ${new Date(dates.reduce((a, b) => (a > b ? a : b))).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` }
          : { label: "no assessments yet" };
      }

      if (goalsR.status === "fulfilled") {
        const goals = goalsR.value;
        const atRisk = goals.filter((g) => g.status === "at_risk").length;
        doorStates.goals =
          atRisk > 0
            ? { label: `${atRisk} at risk`, tone: "risk" }
            : goals.length > 0
              ? { label: `${goals.length} goal${goals.length === 1 ? "" : "s"}` }
              : { label: "no goals yet" };
      }

      if (projectsR.status === "fulfilled") {
        const projects = projectsR.value;
        const active = projects.filter((p) => ACTIVE_PROJECT_STATUSES.has(p.status)).length;
        doorStates.projects =
          active > 0 ? { label: `${active} active` } : projects.length > 0 ? { label: "none active" } : { label: "no projects yet" };
      }

      if (capR.status === "fulfilled") {
        const capacity = capR.value;
        const total = capacity.reduce((s, c) => s + c.available_hours, 0);
        doorStates.capacity = capacity.length > 0 ? { label: `${Math.round(total)}h free` } : { label: "not set up" };
      }

      if (orgR.status === "fulfilled") {
        const units = orgR.value;
        doorStates.org = units.length > 0 ? { label: `${units.length} unit${units.length === 1 ? "" : "s"}` } : { label: "not set up" };
      }

      if (ctxR.status === "fulfilled") {
        const categories = ctxR.value.categories;
        if (categories.length > 0) {
          const avg = Math.round(categories.reduce((s, c) => s + c.fill_score, 0) / categories.length);
          doorStates.knowledge = { label: `${avg}% covered` };
        } else {
          doorStates.knowledge = { label: "not started" };
        }
      }

      // Settings door (Session 41, Plan S1): previously only checked
      // org_ready (does the org row exist at all — true the moment a
      // manager saves Profile & Company once). That's a much lower bar than
      // "setup is actually done," so a manager could clear this door's
      // warning without a single person, team, role, or expectation
      // configured. Now reads the real setup-status four-step model —
      // people / teams / roles-assigned / expectations-covered — the same
      // data People's progress header and roster badges read, so all three
      // surfaces agree on what "done" means.
      if (setupR.status === "fulfilled") {
        const s = setupR.value;
        const fullySetUp =
          s.people_count > 0 &&
          s.teams_count > 0 &&
          s.people_without_role_count === 0 &&
          s.roles_count > 0 &&
          s.roles_with_expectations_count === s.roles_count;
        // Only render a state when setup isn't finished — a finished
        // Settings door shows no count at all (Session 36 decision).
        if (!fullySetUp) doorStates.settings = { label: "not finished", tone: "setup" };
      } else if (profR.status === "fulfilled" && !profR.value.org_ready) {
        // Fallback if setup-status itself failed to load: org_ready is a
        // strictly weaker signal, but better than showing nothing.
        doorStates.settings = { label: "not finished", tone: "setup" };
      }

      if (profR.status === "fulfilled") {
        profileName = profR.value.full_name || null;
        profileEmail = profR.value.email || null;
      }

      setData({ loading: false, doorStates, roster, profileName, profileEmail });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}

// ---------------------------------------------------------------------------
// The zone map itself — used both inline on Mission Control (replacing the
// old stat ribbon) and inside AppNav's map overlay sheet.
// ---------------------------------------------------------------------------

export function ZoneMap({ doorStates }: { doorStates: Partial<Record<string, DoorState>> }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
      {NAV_GROUPS.map((g) => {
        const gradient = HUE_GRADIENT[g.hue];
        return (
          <div
            key={g.group}
            className={`rounded-2xl bg-gradient-to-br p-4 ${gradient.from} ${gradient.to} ${gradient.shadow}`}
          >
            <div className="text-[13px] font-bold tracking-tight text-white">{g.group}</div>
            <div className="mt-0.5 text-xs text-white/75">{g.blurb}</div>
            <div className="mt-2 space-y-1">
              {g.items.map((item) => {
                const state = doorStates[item.id];
                const inner = (
                  <>
                    <Icon name={item.icon} className="h-[15px] w-[15px] shrink-0 text-white/80" />
                    <span className="flex-1 truncate text-[13px] font-medium text-white">{item.label}</span>
                    {state && (
                      <span
                        className={`shrink-0 text-[11.5px] ${state.tone ? TONE_TEXT_ON_GRADIENT[state.tone] : "text-white/85"}`}
                      >
                        {state.label}
                      </span>
                    )}
                  </>
                );
                return item.disabled ? (
                  <div
                    key={item.id}
                    className="flex cursor-default items-center gap-2 rounded-lg bg-white/[0.14] px-2.5 py-2 opacity-70"
                    title="Coming in a later pass"
                  >
                    {inner}
                  </div>
                ) : (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex items-center gap-2 rounded-lg bg-white/[0.14] px-2.5 py-2 transition hover:translate-x-0.5 hover:bg-white/25"
                  >
                    {inner}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
