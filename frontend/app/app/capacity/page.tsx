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
// Two sections:
//   - "Your team" — your own direct reports, full detail (this is your own
//     private data, same as everywhere else in the app).
//   - "By department" — rolled up through the org_units tree, AGGREGATE
//     ONLY (count + hours per unit, never a named individual outside your
//     own team) — see backend/routes/capacity.py's get_rollup for why
//     that's safe today with no second manager in the org yet.

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
  getOrgUnits,
  getProfile,
  getWorkUnitConfigs,
} from "@/lib/api";

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

function buildTree(units: OrgUnit[]): OrgNode[] {
  const nodes = new Map<string, OrgNode>();
  units.forEach((u) => nodes.set(u.id, { ...u, children: [] }));
  const roots: OrgNode[] = [];
  nodes.forEach((node) => {
    const parent = node.parent_unit_id ? nodes.get(node.parent_unit_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const sortNodes = (list: OrgNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
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

export default function CapacityPage() {
  const [periodKind, setPeriodKind] = useState<PeriodKind>("week");
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [overview, setOverview] = useState<CapacityOverviewItem[]>([]);
  const [rollup, setRollup] = useState<CapacityRollupItem[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
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
    Promise.all([getOrgUnits(), getWorkUnitConfigs(), getProfile()])
      .then(([ou, wu, p]) => {
        setOrgUnits(ou);
        setWorkUnits(wu);
        setCompanyName(p.company_name || "Your company");
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

  const tree = useMemo(() => buildTree(orgUnits), [orgUnits]);
  const rollupByUnit = useMemo(() => new Map(rollup.map((r) => [r.org_unit_id, r])), [rollup]);
  const workUnitByRole = useMemo(() => new Map(workUnits.map((w) => [w.role_level_id, w])), [workUnits]);

  const teamTotalHours = overview.reduce((sum, o) => sum + o.available_hours, 0);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Capacity</h1>
        <Link href="/app/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
          &larr; Back to your team
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        How much bandwidth your team has right now — not what&apos;s using it up yet.
      </p>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      {/* Period selector */}
      <div className="mt-8 flex items-center justify-between gap-4">
        <div className="flex rounded-md border border-gray-200 p-0.5">
          {(Object.keys(PERIOD_LABEL) as PeriodKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setPeriodKind(k)}
              className={`rounded px-3 py-1.5 text-sm ${periodKind === k ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900"}`}
            >
              {PERIOD_LABEL[k]}
            </button>
          ))}
        </div>
        {range && (
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <button onClick={() => setAnchor((a) => (a ? shiftAnchor(periodKind, a, -1) : a))} className="hover:text-gray-900">
              &larr;
            </button>
            <span>{formatRange(range.start, range.end)}</span>
            <button onClick={() => setAnchor((a) => (a ? shiftAnchor(periodKind, a, 1) : a))} className="hover:text-gray-900">
              &rarr;
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="mt-8 text-gray-500">Loading...</p>
      ) : (
        <>
          {/* Your team */}
          <div className="mt-8">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">Your team</h2>
              {overview.length > 0 && <span className="text-xs text-gray-400">{formatHours(teamTotalHours)} total</span>}
            </div>

            {overview.length === 0 ? (
              <p className="mt-4 text-gray-500">
                No direct reports yet.{" "}
                <Link href="/app/dashboard" className="underline hover:text-gray-700">
                  Add your first one
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {overview.map((o) => {
                  const workUnit = o.role_level_id ? workUnitByRole.get(o.role_level_id) : undefined;
                  return (
                    <li key={o.direct_report_id} className="rounded-lg border border-gray-200 px-4 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{o.name}</p>
                          {o.role_title && <p className="text-xs text-gray-500">{o.role_title}</p>}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-medium text-gray-900">{formatHours(o.available_hours)}</p>
                          {workUnit && (
                            <p className="text-xs text-gray-400">
                              &asymp; {Math.round(o.available_hours / workUnit.hours_per_unit)} {workUnit.unit_name}
                              {Math.round(o.available_hours / workUnit.hours_per_unit) === 1 ? "" : "s"}
                            </p>
                          )}
                        </div>
                      </div>
                      <p className="mt-1.5 text-xs text-gray-400">
                        {o.contracted_hours_per_week}h/wk contracted &middot; {o.target_utilization_pct}% target
                        {o.off_hours > 0 &&
                          ` · ${formatHours(o.off_hours)} ${
                            o.off_hours_source === "logged" ? "logged time off" : "assumed time off"
                          } this period`}
                      </p>
                      {o.off_hours_source === "assumed" && o.off_hours > 0 && (
                        <p className="text-xs text-gray-300">
                          No time off logged for this period — assuming a share of {o.off_days_per_year} default days/year.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-gray-400">
              Adjust someone&apos;s hours, target, or unit conversion in{" "}
              <Link href="/app/settings" className="underline hover:text-gray-600">
                Settings
              </Link>{" "}
              or on their{" "}
              <Link href="/app/dashboard" className="underline hover:text-gray-600">
                report page
              </Link>
              .
            </p>
          </div>

          {/* By department */}
          <div className="mt-10">
            <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">By department</h2>
            <p className="mt-1 text-xs text-gray-400">
              Rolled up across everyone in {companyName}&apos;s org chart, regardless of who manages them — aggregate
              numbers only.
            </p>
            {tree.length === 0 ? (
              <p className="mt-4 text-gray-500">
                No departments or teams yet.{" "}
                <Link href="/app/org" className="underline hover:text-gray-700">
                  Build your org chart
                </Link>{" "}
                to see rollups here.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {tree.map((node) => (
                  <RollupNode key={node.id} node={node} depth={0} rollupByUnit={rollupByUnit} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </main>
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
      <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-2.5">
        <p className="min-w-0 text-sm font-medium text-gray-900">
          {node.name}
          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
            {TYPE_LABEL[node.unit_type]}
          </span>
        </p>
        <div className="shrink-0 text-right">
          <p className="text-sm font-medium text-gray-900">{formatHours(totals.hours)}</p>
          <p className="text-xs text-gray-400">
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
