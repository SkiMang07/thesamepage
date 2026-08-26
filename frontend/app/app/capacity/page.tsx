"use client";

// Capacity — how much bandwidth each person, team, and department has
// (Session 14 scoping conversation with Andrew, 2026-08-02; see
// docs/SESSION_HISTORY.md and the capacity_scoping project memory note).
//
// v1 is supply only: this page answers "how much capacity exists" for
// whatever period is selected, not "how much of it is spoken for" — no
// allocation/demand view yet, deliberately (see api.ts's Capacity section
// comment). Own top-level page, same reasoning as Goals/Projects/Org.
//
// Session 56 white-space audit — this page's section gaps had drifted to
// mt-8/mt-8/mt-10 for what are structurally the same kind of transition;
// all now use the shared SECTION_GAP token (components/ZoneMap.tsx).
//
// Two sections:
//   - "Your team" — your own direct reports, full detail (this is your own
//     private data, same as everywhere else in the app).
//   - "By department" — rolled up through the org_units tree, AGGREGATE
//     ONLY (count + hours per unit, never a named individual outside your
//     own team).
//
// Role-scoped views (Session 15, 2026-08-03 — see docs/SESSION_HISTORY.md
// and the role_scoped_views project memory note): "By department" now only
// shows units the signed-in user leads (org_units.leader_user_id), plus
// everything under them — previously any authenticated org member could see
// the whole org's rollup, a known gap flagged in Session 14. Assign leaders
// on the Org page's Build tab.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CapacityOverviewItem,
  CapacityRollupItem,
  OrgUnit,
  OrgUnitType,
  WorkUnitConfig,
  getCapacityOverview,
  getCapacityRollup,
  getLedOrgUnits,
  getOrgUnits,
  getProfile,
  getWorkUnitConfigs,
} from "@/lib/api";
import PageShell from "@/components/PageShell";
import { SECTION_GAP } from "@/components/ZoneMap";
import { CARD, EYEBROW, FEATURE_SURFACE } from "@/lib/tokens";

type PeriodKind = "week" | "month" | "quarter";

const PERIOD_LABEL: Record<PeriodKind, string> = { week: "Week", month: "Month", quarter: "Quarter" };
const TYPE_LABEL: Record<OrgUnitType, string> = { department: "Department", team: "Team" };

function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // Monday as the start
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return monday;
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

function periodRange(kind: PeriodKind, anchor: Date): { start: Date; end: Date } {
  if (kind === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 6) };
  }
  if (kind === "month") {
    return {
      start: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
      end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0),
    };
  }
  const qStartMonth = Math.floor(anchor.getMonth() / 3) * 3;
  return {
    start: new Date(anchor.getFullYear(), qStartMonth, 1),
    end: new Date(anchor.getFullYear(), qStartMonth + 3, 0),
  };
}

function shiftAnchor(kind: PeriodKind, anchor: Date, direction: 1 | -1): Date {
  if (kind === "week") return addDays(anchor, 7 * direction);
  if (kind === "month") return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
  return new Date(anchor.getFullYear(), anchor.getMonth() + 3 * direction, 1);
}

function formatRange(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

type OrgNode = OrgUnit & { children: OrgNode[] };

// Node-by-id map, not a full rooted tree — "By department" anchors each
// subtree at a unit the caller leads (which may itself be nested deep
// under units they don't lead), so it doesn't need a single company-rooted
// tree the way the Org page's Build/Chart tabs do.
function buildNodeMap(units: OrgUnit[]): Map<string, OrgNode> {
  const nodes = new Map<string, OrgNode>();
  units.forEach((u) => nodes.set(u.id, { ...u, children: [] }));
  nodes.forEach((node) => {
    if (node.parent_unit_id) {
      const parent = nodes.get(node.parent_unit_id);
      if (parent) parent.children.push(node);
    }
  });
  nodes.forEach((node) => node.children.sort((a, b) => a.name.localeCompare(b.name)));
  return nodes;
}

// Bottom-up sum of a unit's own rollup row plus every descendant's — the
// same "walk the tree client-side" approach the Org page already uses to
// render the chart from a flat org_units list.
function subtreeTotals(
  node: OrgNode,
  rollupByUnit: Map<string, CapacityRollupItem>
): { hours: number; count: number } {
  const own = rollupByUnit.get(node.id);
  let hours = own?.available_hours ?? 0;
  let count = own?.direct_report_count ?? 0;
  for (const child of node.children) {
    const sub = subtreeTotals(child, rollupByUnit);
    hours += sub.hours;
    count += sub.count;
  }
  return { hours, count };
}

function formatHours(h: number): string {
  return `${h.toFixed(1)} hr${h.toFixed(1) === "1.0" ? "" : "s"}`;
}

function formatHoursCompact(h: number): string {
  return `${h.toFixed(1)}h`;
}

function formatWorkUnits(hours: number, config: WorkUnitConfig): string {
  const count = Math.round(hours / config.hours_per_unit);
  return `${count} ${config.unit_name}${count === 1 ? "" : "s"}`;
}

export default function CapacityPage() {
  const [periodKind, setPeriodKind] = useState<PeriodKind>("week");
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [overview, setOverview] = useState<CapacityOverviewItem[]>([]);
  const [rollup, setRollup] = useState<CapacityRollupItem[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [ledUnits, setLedUnits] = useState<OrgUnit[]>([]);
  const [workUnits, setWorkUnits] = useState<WorkUnitConfig[]>([]);
  const [companyName, setCompanyName] = useState("Your company");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Anchor to "today" once on mount — matches the rest of the app's
  // client-computed date logic (e.g. dashboard's daysSince).
  useEffect(() => {
    setAnchor(new Date());
  }, []);

  useEffect(() => {
    Promise.all([getOrgUnits(), getWorkUnitConfigs(), getProfile(), getLedOrgUnits()])
      .then(([ou, wu, p, led]) => {
        setOrgUnits(ou);
        setWorkUnits(wu);
        setCompanyName(p.company_name || "Your company");
        setLedUnits(led);
      })
      .catch((e) => setError(e.message));
  }, []);

  const range = useMemo(() => (anchor ? periodRange(periodKind, anchor) : null), [periodKind, anchor]);

  useEffect(() => {
    if (!range) return;
    setLoading(true);
    const start = toISODate(range.start);
    const end = toISODate(range.end);
    Promise.all([getCapacityOverview(start, end), getCapacityRollup(start, end)])
      .then(([o, r]) => {
        setOverview(o);
        setRollup(r);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range]);

  const nodesById = useMemo(() => buildNodeMap(orgUnits), [orgUnits]);
  const rollupByUnit = useMemo(() => new Map(rollup.map((r) => [r.org_unit_id, r])), [rollup]);
  const workUnitByRole = useMemo(() => new Map(workUnits.map((w) => [w.role_level_id, w])), [workUnits]);

  const teamTotalHours = overview.reduce((sum, o) => sum + o.available_hours, 0);
  const teamTotalOffHours = overview.reduce((sum, o) => sum + o.off_hours, 0);
  const loggedSourceCount = overview.filter((o) => o.off_hours_source === "logged").length;
  const assumedSourceCount = overview.length - loggedSourceCount;

  return (
    <PageShell maxWidth="4xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Capacity</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-secondary">
            The working time your team has available in this period, before any allocation or demand planning.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex rounded-md border border-hairline p-0.5">
            {(Object.keys(PERIOD_LABEL) as PeriodKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setPeriodKind(k)}
                aria-pressed={periodKind === k}
                className={`flex-1 rounded px-3 py-1.5 text-sm sm:flex-none ${
                  periodKind === k ? "bg-brand font-medium text-on-brand" : "text-ink-secondary hover:text-ink"
                }`}
              >
                {PERIOD_LABEL[k]}
              </button>
            ))}
          </div>
          {range && (
            <div className="flex items-center justify-between gap-2 text-sm text-ink-secondary sm:justify-start">
              <button
                onClick={() => setAnchor((a) => (a ? shiftAnchor(periodKind, a, -1) : a))}
                aria-label={`Previous ${periodKind}`}
                className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-sunken hover:text-ink"
              >
                &larr;
              </button>
              <span className="min-w-28 text-center">{formatRange(range.start, range.end)}</span>
              <button
                onClick={() => setAnchor((a) => (a ? shiftAnchor(periodKind, a, 1) : a))}
                aria-label={`Next ${periodKind}`}
                className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-sunken hover:text-ink"
              >
                &rarr;
              </button>
            </div>
          )}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className={`${SECTION_GAP} text-ink-secondary`}>Loading...</p>
      ) : (
        <>
          {overview.length > 0 && (
            <section className={`${FEATURE_SURFACE} ${SECTION_GAP} grid gap-6 p-6 md:grid-cols-[minmax(0,1.6fr)_minmax(220px,0.8fr)]`}>
              <div>
                <p className={`${EYEBROW} text-brand`}>Available working time</p>
                <p className="mt-2 text-4xl font-semibold tracking-tight text-ink">
                  {formatHoursCompact(teamTotalHours)}
                </p>
                <p className="mt-2 max-w-xl text-sm text-ink-secondary">
                  Across {overview.length} direct {overview.length === 1 ? "report" : "reports"}. This is supply only: it does not subtract projects,
                  goals, assignments, or other demand.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-divider pt-5 md:grid-cols-1 md:border-l md:border-t-0 md:pl-6 md:pt-0">
                <div>
                  <p className="text-lg font-semibold text-ink">{formatHoursCompact(teamTotalOffHours)}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">Time off deducted</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-ink">
                    {loggedSourceCount} logged <span className="text-ink-muted">&middot;</span> {assumedSourceCount} assumed
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">Source coverage</p>
                </div>
              </div>
            </section>
          )}

          {/* Your team */}
          <div className={SECTION_GAP}>
            <div className="flex items-baseline justify-between">
              <h2 className={EYEBROW}>Your team</h2>
              {overview.length > 0 && <span className="text-xs text-ink-muted">Hours are the shared currency</span>}
            </div>

            {overview.length === 0 ? (
              <p className="mt-4 text-ink-secondary">
                No direct reports yet.{" "}
                <Link href="/app/dashboard" className="underline hover:text-ink-body">
                  Add your first one
                </Link>
                .
              </p>
            ) : (
              <div className={`${CARD} mt-4 overflow-hidden`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-left">
                    <thead className="bg-sunken">
                      <tr className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                        <th className="px-4 py-3">Person</th>
                        <th className="px-4 py-3 text-right">Available</th>
                        <th className="px-4 py-3 text-right">Contracted</th>
                        <th className="px-4 py-3 text-right">Target</th>
                        <th className="px-4 py-3">Time off used</th>
                        <th className="px-4 py-3 text-right">Native unit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-divider">
                      {overview.map((o) => {
                        const workUnit = o.role_level_id ? workUnitByRole.get(o.role_level_id) : undefined;
                        return (
                          <tr key={o.direct_report_id} className="hover:bg-sunken/60">
                            <td className="px-4 py-3">
                              <Link href={`/app/reports/${o.direct_report_id}`} className="text-sm font-medium text-ink hover:text-brand">
                                {o.name}
                              </Link>
                              {o.role_title && <p className="mt-0.5 max-w-52 truncate text-xs text-ink-muted">{o.role_title}</p>}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-ink">
                              {formatHoursCompact(o.available_hours)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-ink-secondary">
                              {o.contracted_hours_per_week}h/wk
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-ink-secondary">
                              {o.target_utilization_pct}%
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-secondary">
                              {formatHoursCompact(o.off_hours)} &middot; {o.off_hours_source === "logged" ? "logged" : "assumed"}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-ink-secondary">
                              {workUnit ? formatWorkUnits(o.available_hours, workUnit) : <span className="text-ink-faint">&mdash;</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-divider bg-sunken px-4 py-3 text-xs leading-relaxed text-ink-secondary">
                  When time off is logged for a period, those dates replace the prorated annual allowance. Available hours never include demand or assigned
                  work.
                </div>
              </div>
            )}
            <p className="mt-3 text-xs text-ink-muted">
              Open a person from{" "}
              <Link href="/app/team" className="underline hover:text-ink-secondary">Team</Link>{" "}
              to adjust their hours, target, or time off. Company defaults and native work units live in{" "}
              <Link href="/app/settings" className="underline hover:text-ink-secondary">Capacity settings</Link>.
            </p>
          </div>

          {/* By department */}
          <div className={SECTION_GAP}>
            <div className="flex items-baseline justify-between gap-4">
              <h2 className={EYEBROW}>By department</h2>
              <span className="text-xs text-ink-muted">Aggregate-only beyond your direct reports</span>
            </div>
            {orgUnits.length === 0 ? (
              <p className="mt-4 text-ink-secondary">
                No departments or teams yet.{" "}
                <Link href="/app/org" className="underline hover:text-ink-body">
                  Build your org chart
                </Link>{" "}
                to see rollups here.
              </p>
            ) : ledUnits.length === 0 ? (
              <p className="mt-4 text-ink-secondary">
                You don&apos;t lead any departments or teams yet.{" "}
                <Link href="/app/org" className="underline hover:text-ink-body">
                  Assign a leader
                </Link>{" "}
                on the Build tab to see a rollup here.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {ledUnits.map((led) => {
                  const node = nodesById.get(led.id);
                  if (!node) return null;
                  return <RollupNode key={led.id} node={node} depth={0} rollupByUnit={rollupByUnit} />;
                })}
              </ul>
            )}
            <p className="mt-3 text-xs leading-relaxed text-ink-muted">
              Rolled up through {companyName}&apos;s org chart across every unit you lead, regardless of who manages them. Names appear only for people who
              report directly to you.
            </p>
          </div>
        </>
      )}
    </PageShell>
  );
}

function RollupNode({
  node,
  depth,
  rollupByUnit,
}: {
  node: OrgNode;
  depth: number;
  rollupByUnit: Map<string, CapacityRollupItem>;
}) {
  const totals = subtreeTotals(node, rollupByUnit);
  return (
    <li style={{ marginLeft: depth * 24 }}>
      <div className={`${CARD} flex items-center justify-between gap-4 px-4 py-3`}>
        <p className="min-w-0 text-sm font-medium text-ink">
          {node.name}
          <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 text-xs font-normal text-ink-secondary">
            {TYPE_LABEL[node.unit_type]}
          </span>
        </p>
        <div className="shrink-0 text-right">
          <p className="text-sm font-medium text-ink">{formatHours(totals.hours)}</p>
          <p className="text-xs text-ink-muted">
            {totals.count} {totals.count === 1 ? "person" : "people"}
          </p>
        </div>
      </div>
      {node.children.length > 0 && (
        <ul className="mt-2 space-y-2">
          {node.children.map((child) => (
            <RollupNode key={child.id} node={child} depth={depth + 1} rollupByUnit={rollupByUnit} />
          ))}
        </ul>
      )}
    </li>
  );
}
