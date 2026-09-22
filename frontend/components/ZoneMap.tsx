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

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { IDENTITY_HEX } from "@/lib/tokens";
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
  getBeyondOverview,
  getTeamAssessments,
  GoalStatus,
  OneOnOneOverviewItem,
  RECORDS_CHANGED_EVENT,
  RECORDS_CHANGED_STORAGE_KEY,
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
  // Beyond the team — a door opening out of the team.
  beyond: (
    <>
      <path d="M14 3.5H5.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2H14" />
      <line x1="10" y1="12" x2="21" y2="12" />
      <polyline points="17 8 21 12 17 16" />
    </>
  ),
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
  blurb: string;
  items: NavItem[];
};

// Shared height token for the two chrome strips that sit side by side at the
// top of every page — AppNav's header row and Sidebar's own top row (Session
// 55 follow-up, flagged in Session 54's UX review). Both used to derive their
// height independently from vertical padding + whatever their tallest child
// happened to be (header: py-2.5 + the "+ Quick add" button's ~36px; sidebar:
// py-3 + the collapse button's h-7/28px) — close enough to look aligned but
// off by a few px, and liable to drift further apart the moment either row's
// content changes. Both rows now take this fixed height directly instead of
// letting it fall out of padding math, so they read as one coordinated strip
// by construction rather than by coincidence. h-14 (56px) was picked to match
// the header's actual pre-existing rendered height (see AppNav.tsx's
// top-[55px] roster-switcher offset, now top-14 to match exactly).
export const NAV_STRIP_HEIGHT = "h-14";

// Shared vertical-rhythm token — Session 56 white-space audit (see the
// published "White Space Audit" comparison canvas and the
// session56_height_token_and_whitespace project memory note). Every
// PageShell page used to pick its own margin between major sections
// (mt-4/mt-6/mt-8, chosen per block, per page) stacked on top of
// PageShell's own top padding — on Goals that added up to 128px of pure
// margin before the KPI strip even appeared, and Dashboard alone mixed
// mt-6/mt-8/mt-5 for what are structurally the same kind of gap. One
// token used everywhere a page separates "the next major block" (a KPI
// strip, a filter/tab row, the main content grid, a secondary section)
// fixes both problems at once: pages stop drifting apart from each other,
// and a page stops being internally inconsistent with itself. Not for
// tight, same-thought-group spacing (a subtitle under an h1, a label
// under a value) — those intentionally stay smaller (mt-0.5/mt-1/mt-2).
export const SECTION_GAP = "mt-5";

export const HOME_ITEM: NavItem = { id: "home", label: "Mission Control", href: "/app/dashboard", icon: "home" };

export const NAV_GROUPS: NavGroup[] = [
  {
    group: "People",
    blurb: "The rhythm you keep with humans",
    items: [
      { id: "team", label: "Team", href: "/app/team", icon: "team" },
      { id: "oneonones", label: "1:1s", href: "/app/1-1s", icon: "oneonones" },
      { id: "assessments", label: "Assessments", href: "/app/assessments", icon: "assessments" },
      // Meetings outside your own team — boss, skip-level, peers, projects.
      // A real door, but only its outputs reach the rest of the app; it has
      // no Mission Control card (docs/systems/beyond.md).
      { id: "beyond", label: "Beyond the team", href: "/app/beyond", icon: "beyond" },
    ],
  },
  {
    group: "Work",
    blurb: "What we said we'd deliver",
    items: [
      { id: "goals", label: "Goals", href: "/app/goals", icon: "goals" },
      { id: "projects", label: "Projects", href: "/app/projects", icon: "projects" },
      { id: "capacity", label: "Capacity", href: "/app/capacity", icon: "capacity" },
    ],
  },
  {
    group: "Workspace",
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

export const SETTINGS_ITEM = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.id === "settings")!;

const TEAM_GROUP = NAV_GROUPS.find((g) => g.group === "People")!;
const TEAM_ITEM = TEAM_GROUP.items.find((i) => i.id === "team")!;
const ASSESSMENTS_ITEM = TEAM_GROUP.items.find((i) => i.id === "assessments")!;
const BEYOND_ITEM = TEAM_GROUP.items.find((i) => i.id === "beyond")!;

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
  // Beyond the team's people and meetings are outside people, not reports —
  // they keep the Beyond door lit rather than the person breadcrumb.
  if (pathname.startsWith("/app/beyond/")) {
    return { kind: "item", group: TEAM_GROUP, item: BEYOND_ITEM };
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
// Zone styling — Current & Carbon.
//
// Session 58 collapsed the three per-zone hues (indigo "Your people",
// emerald "The work", violet "Foundation") into ONE brand treatment. The
// locked palette gives us teal, blue and carbon and reserves blue for Scribe
// and focus, so there was no third zone colour to spend without diluting the
// brand — the documented failure mode in docs/branding/colors/README.md.
// Zones are now told apart by icon, label and position, which is what a
// manager actually navigates by; colour is spent on the brand instead of on
// wayfinding that the labels already do.
//
// The gradient tile SHAPE from Session 55 is superseded by the dark pass. On a
// light canvas, three saturated teal blocks read as "the important row"; on a
// dark canvas they read as three glowing slabs, and the approved mockup
// (docs/Redesign Scoping/mission-control-action-first.html) has no such thing
// — its cards are all one calm surface and it spends its single gradient on
// the manager-brief panel. The rounded tile, the group title + blurb, the
// item rows and their door-state labels are all unchanged; only the ground
// they sit on is now `surface` instead of a gradient, and the door-state tone
// colours go back to the shared TONE_TEXT (amber / red / faint) that the rest
// of the app uses, so an "8 overdue" reads the same here as anywhere else.
// ---------------------------------------------------------------------------

export const ZONE_STYLE = {
  text: "text-brand",
  bg: "bg-brand-tint",
  border: "border-teal-200",
  chipOn: "bg-brand-tint border-teal-200 text-brand",
};

/** The zone card ground. One surface, no gradient. */
const ZONE_CARD = "rounded-2xl border border-hairline bg-surface";

export type Tone = "warn" | "risk" | "setup";

const TONE_TEXT: Record<Tone, string> = {
  warn: "text-amber-700 font-semibold",
  risk: "text-red-700 font-semibold",
  setup: "text-ink-faint italic",
};

// Person-identity colours. Drawn only from the brand families so a roster
// of avatars reads as one system; every entry clears 4.5:1 with white text.
const AVATAR_COLORS = IDENTITY_HEX;

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

// Zone data — one shared fetch for the whole authenticated app (N-5).
//
// ZoneDataProvider mounts once in app/app/layout.tsx, which persists across
// client-side navigation, so nothing here re-fetches when the page changes.
// Two groups, fetched separately:
//   - core: getOneOnOnesOverview + getProfile. What AppNav needs (roster,
//     avatar name/email). Fetched once on mount.
//   - doors: the other eight calls. They only feed the door labels on
//     ZoneMap, so they are fetched the first time a consumer asks for them
//     (useZoneData({ doors: true })) and cached for the session after that.
// Both refresh on lib/api.ts's records-changed signal (same event + storage
// key the dashboard already listens to, same 250 ms debounce). Core always
// refetches. Doors refetch only while a door consumer is mounted; otherwise
// they are marked stale and refetched on next use. Previous data stays on
// screen during a refresh, so there is no loading flash after a write.

type CoreResults = [
  PromiseSettledResult<Awaited<ReturnType<typeof getOneOnOnesOverview>>>,
  PromiseSettledResult<Awaited<ReturnType<typeof getProfile>>>,
];

type DoorResults = [
  PromiseSettledResult<Awaited<ReturnType<typeof getTeamAssessments>>>,
  PromiseSettledResult<Awaited<ReturnType<typeof getGoals>>>,
  PromiseSettledResult<Awaited<ReturnType<typeof getProjects>>>,
  PromiseSettledResult<Awaited<ReturnType<typeof getCapacityOverview>>>,
  PromiseSettledResult<Awaited<ReturnType<typeof getOrgUnits>>>,
  PromiseSettledResult<Awaited<ReturnType<typeof getContextCoverage>>>,
  PromiseSettledResult<Awaited<ReturnType<typeof getSetupStatus>>>,
  PromiseSettledResult<Awaited<ReturnType<typeof getBeyondOverview>>>,
];

function fetchCore(): Promise<CoreResults> {
  return Promise.allSettled([getOneOnOnesOverview(), getProfile()]) as Promise<CoreResults>;
}

function fetchDoors(): Promise<DoorResults> {
  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 6);
  return Promise.allSettled([
    getTeamAssessments(),
    getGoals(),
    getProjects(),
    getCapacityOverview(toISODate(weekStart), toISODate(weekEnd)),
    getOrgUnits(),
    getContextCoverage(),
    getSetupStatus(),
    getBeyondOverview(),
  ]) as Promise<DoorResults>;
}

// Pure derivation. Door-label logic is unchanged from the old per-caller
// hook; only door states whose inputs have loaded are filled in.
function deriveZoneData(core: CoreResults | null, doors: DoorResults | null): Omit<ZoneData, "loading"> {
  const unloaded = { status: "rejected", reason: null } as const;
  const [teamR, profR] = core ?? [unloaded, unloaded];
  const [assessR, goalsR, projectsR, capR, orgR, ctxR, setupR, beyondR] = doors ?? [
    unloaded, unloaded, unloaded, unloaded, unloaded, unloaded, unloaded, unloaded,
  ];
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

  if (beyondR.status === "fulfilled") {
    const last = beyondR.value.last_logged;
    doorStates.beyond = last
      ? { label: `last ${new Date(last).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` }
      : { label: "nothing logged yet" };
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

  // Door states that come from core results (team, 1:1s, Settings fallback)
  // only show alongside the rest of the doors, as they did before.
  return { doorStates: doors ? doorStates : {}, roster, profileName, profileEmail };
}

type ZoneContextValue = {
  core: CoreResults | null;
  doors: DoorResults | null;
  registerDoorConsumer: () => () => void;
};

const ZoneDataContext = createContext<ZoneContextValue | null>(null);

export function ZoneDataProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [core, setCore] = useState<CoreResults | null>(null);
  const [doors, setDoors] = useState<DoorResults | null>(null);
  const coreGen = useRef(0);
  const doorGen = useRef(0);
  const doorConsumers = useRef(0);
  const doorsStale = useRef(true);
  const doorsInFlight = useRef(false);

  const loadCore = useCallback(() => {
    const gen = ++coreGen.current;
    fetchCore().then((r) => {
      if (gen === coreGen.current) setCore(r);
    });
  }, []);

  const loadDoors = useCallback(() => {
    const gen = ++doorGen.current;
    doorsStale.current = false;
    doorsInFlight.current = true;
    fetchDoors().then((r) => {
      if (gen !== doorGen.current) return;
      doorsInFlight.current = false;
      setDoors(r);
    });
  }, []);

  // Load on enable. Route changes inside the app don't touch `enabled`, so
  // this runs once per session. Leaving the nav (sign-out lands on
  // /app/login) drops the cache, so a different sign-in in the same tab
  // never sees the previous account's roster.
  useEffect(() => {
    if (enabled) {
      loadCore();
      return;
    }
    coreGen.current += 1;
    doorGen.current += 1;
    doorsInFlight.current = false;
    doorsStale.current = true;
    setCore(null);
    setDoors(null);
  }, [enabled, loadCore]);

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const refreshAfterChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        loadCore();
        if (doorConsumers.current > 0) loadDoors();
        else doorsStale.current = true;
      }, 250);
    };
    const refreshFromAnotherTab = (event: StorageEvent) => {
      if (event.key === RECORDS_CHANGED_STORAGE_KEY) refreshAfterChange();
    };
    window.addEventListener(RECORDS_CHANGED_EVENT, refreshAfterChange);
    window.addEventListener("storage", refreshFromAnotherTab);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(RECORDS_CHANGED_EVENT, refreshAfterChange);
      window.removeEventListener("storage", refreshFromAnotherTab);
    };
  }, [enabled, loadCore, loadDoors]);

  // A door consumer registers on mount; the first one (or the first after a
  // write while none was mounted) triggers the door fetch.
  const registerDoorConsumer = useCallback(() => {
    doorConsumers.current += 1;
    if (doorsStale.current && !doorsInFlight.current) loadDoors();
    return () => {
      doorConsumers.current -= 1;
    };
  }, [loadDoors]);

  const value = useMemo(() => ({ core, doors, registerDoorConsumer }), [core, doors, registerDoorConsumer]);
  return <ZoneDataContext.Provider value={value}>{children}</ZoneDataContext.Provider>;
}

// Read the shared zone data. AppNav calls this bare (roster + profile only).
// Pass { doors: true } to also get door labels for ZoneMap.
export function useZoneData(options: { doors?: boolean } = {}): ZoneData {
  const ctx = useContext(ZoneDataContext);
  if (!ctx) throw new Error("useZoneData must be inside ZoneDataProvider");
  const wantDoors = !!options.doors;
  const { core, doors, registerDoorConsumer } = ctx;

  useEffect(() => {
    if (!wantDoors) return;
    return registerDoorConsumer();
  }, [wantDoors, registerDoorConsumer]);

  return useMemo(() => {
    const derived = deriveZoneData(core, wantDoors ? doors : null);
    const loading = core === null || (wantDoors && doors === null);
    return { loading, ...derived };
  }, [core, doors, wantDoors]);
}

// ---------------------------------------------------------------------------
// The zone map itself — used both inline on Mission Control (replacing the
// old stat ribbon) and inside AppNav's map overlay sheet.
// ---------------------------------------------------------------------------

export function ZoneMap({ doorStates }: { doorStates: Partial<Record<string, DoorState>> }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
      {NAV_GROUPS.map((g) => (
        <div key={g.group} className={`${ZONE_CARD} p-4`}>
          <div className="text-[13px] font-semibold tracking-tight text-ink">{g.group}</div>
          <div className="mt-0.5 text-xs text-ink-muted">{g.blurb}</div>
          <div className="mt-2.5 space-y-1">
            {g.items.map((item) => {
              const state = doorStates[item.id];
              const inner = (
                <>
                  <Icon name={item.icon} className="h-[15px] w-[15px] shrink-0 text-ink-muted" />
                  <span className="flex-1 truncate text-[13px] font-medium text-ink-body">{item.label}</span>
                  {state && (
                    <span className={`shrink-0 text-[11.5px] ${state.tone ? TONE_TEXT[state.tone] : "text-ink-muted"}`}>
                      {state.label}
                    </span>
                  )}
                </>
              );
              return item.disabled ? (
                <div
                  key={item.id}
                  className="flex cursor-default items-center gap-2 rounded-lg bg-sunken px-2.5 py-2 opacity-60"
                  title="Coming in a later pass"
                >
                  {inner}
                </div>
              ) : (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-center gap-2 rounded-lg bg-sunken px-2.5 py-2 transition hover:bg-brand-tint"
                >
                  {inner}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
