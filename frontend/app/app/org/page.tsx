"use client";

// Org — team/department entities with parent/child relationships, plus a
// visual builder (Session 11 scoping conversation with Andrew, 2026-08-02;
// see docs/SESSION_HISTORY.md and the org_hierarchy_scoping project memory
// note). Own top-level page, not folded into Settings — org structure gets
// built once and occasionally adjusted, but it's a distinct object worth
// its own surface, same reasoning as Goals in Session 10.
//
// Hybrid interaction model, per Andrew's call: a nested tree to add/edit/
// delete units and set parent relationships (no new frontend dependency —
// styled-jsx ships with Next.js by default), plus a read-only visual chart
// rendered from the same data. "Company" is not a stored org_unit — it's
// Settings' organization name, shown as the chart's root; a department with
// no parent sits directly under it.
//
// Role-scoped views (Session 15, 2026-08-03 — see docs/SESSION_HISTORY.md
// and the role_scoped_views project memory note): a third "Rollup" tab
// shows, for each unit the signed-in user leads, an aggregate-only summary
// (headcount + role breakdown, goal/project status counts) across that
// unit's whole subtree — never a named individual outside your own team,
// same precedent as Capacity's rollup (Session 14). Build/Chart also gained
// a leader picker per unit (any org member; same permissiveness org_units
// CRUD already had).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DirectReport,
  GoalsRollupItem,
  OrgMember,
  OrgUnit,
  OrgUnitType,
  PeopleRollupItem,
  ProjectsRollupItem,
  createOrgUnit,
  deleteOrgUnit,
  getDirectReports,
  getGoalsRollup,
  getLedOrgUnits,
  getOrgMembers,
  getOrgUnits,
  getPeopleRollup,
  getProfile,
  getProjectsRollup,
  updateOrgUnit,
} from "@/lib/api";

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-medium text-gray-500";
const primaryBtnCls = "rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50";

const TYPE_LABEL: Record<OrgUnitType, string> = { department: "Department", team: "Team" };

type OrgNode = OrgUnit & { children: OrgNode[] };

function buildNodeMap(units: OrgUnit[]): Map<string, OrgNode> {
  const nodes = new Map<string, OrgNode>();
  units.forEach((u) => nodes.set(u.id, { ...u, children: [] }));
  nodes.forEach((node) => {
    if (node.parent_unit_id) {
      const parent = nodes.get(node.parent_unit_id);
      if (parent) parent.children.push(node);
    }
  });
  return nodes;
}

function buildTree(units: OrgUnit[]): OrgNode[] {
  const nodes = buildNodeMap(units);
  const roots: OrgNode[] = [];
  nodes.forEach((node) => {
    if (!node.parent_unit_id || !nodes.has(node.parent_unit_id)) roots.push(node);
  });
  const sortNodes = (list: OrgNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

function memberName(id: string | null, members: OrgMember[]): string | null {
  if (!id) return null;
  const m = members.find((m) => m.id === id);
  return m ? m.full_name || m.email : null;
}

type UnitInput = {
  name: string;
  unit_type: OrgUnitType;
  parent_unit_id: string | null;
  leader_user_id: string | null;
};

export default function OrgPage() {
  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [companyName, setCompanyName] = useState("Your company");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"build" | "chart" | "rollup">("build");
  // "root" = the add-form pinned under the company node; a unit id = the
  // add-child form nested under that node; null = no add-form open.
  const [addParentId, setAddParentId] = useState<string | "root" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Member counts per unit (Session 42, Plan S4+S5) — a cheap client-side
  // join against direct_reports.org_unit_id rather than a new backend
  // endpoint, since getDirectReports() already carries it (manager-scoped,
  // same source People/the direct-report page use).
  const [directReports, setDirectReports] = useState<DirectReport[]>([]);

  useEffect(() => {
    Promise.all([getOrgUnits(), getProfile(), getOrgMembers(), getDirectReports()])
      .then(([u, p, m, drs]) => {
        setUnits(u);
        setCompanyName(p.company_name || "Your company");
        setMembers(m);
        setDirectReports(drs);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const tree = useMemo(() => buildTree(units), [units]);
  const memberCountByUnit = useMemo(() => {
    const counts = new Map<string, number>();
    for (const dr of directReports) {
      if (dr.org_unit_id) counts.set(dr.org_unit_id, (counts.get(dr.org_unit_id) ?? 0) + 1);
    }
    return counts;
  }, [directReports]);

  async function addUnit(input: UnitInput) {
    try {
      const created = await createOrgUnit(input);
      setUnits((us) => [...us, created]);
      setAddParentId(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    }
  }

  async function saveEdit(id: string, input: UnitInput) {
    try {
      const updated = await updateOrgUnit(id, input);
      setUnits((us) => us.map((u) => (u.id === id ? updated : u)));
      setEditingId(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function removeUnit(id: string) {
    try {
      await deleteOrgUnit(id);
      // Server-side ON DELETE SET NULL reparents any children to null, so
      // refetch rather than filtering client-side to keep the tree correct.
      const fresh = await getOrgUnits();
      setUnits(fresh);
      setEditingId((cur) => (cur === id ? null : cur));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Org</h1>
      <p className="mt-1 text-sm text-gray-500">
        Your teams and departments — the structure everything rolls up through.
      </p>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      <div className="mt-8 flex items-center justify-between gap-4">
        <div className="flex rounded-md border border-gray-200 p-0.5">
          <button
            onClick={() => setView("build")}
            className={`rounded px-3 py-1.5 text-sm ${view === "build" ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900"}`}
          >
            Build
          </button>
          <button
            onClick={() => setView("chart")}
            className={`rounded px-3 py-1.5 text-sm ${view === "chart" ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900"}`}
          >
            Chart
          </button>
          <button
            onClick={() => setView("rollup")}
            className={`rounded px-3 py-1.5 text-sm ${view === "rollup" ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900"}`}
          >
            Rollup
          </button>
        </div>
        {view === "build" && (
          <button
            onClick={() => {
              setEditingId(null);
              setAddParentId((p) => (p === "root" ? null : "root"));
            }}
            className={primaryBtnCls}
          >
            {addParentId === "root" ? "Cancel" : "+ Add department or team"}
          </button>
        )}
      </div>

      {loading ? (
        <p className="mt-8 text-gray-500">Loading...</p>
      ) : view === "chart" ? (
        <OrgChart tree={tree} companyName={companyName} members={members} />
      ) : view === "rollup" ? (
        <RollupView units={units} />
      ) : (
        <div className="mt-6">
          {addParentId === "root" && (
            <UnitForm
              units={units}
              members={members}
              companyName={companyName}
              defaultParentId={null}
              onCancel={() => setAddParentId(null)}
              onSubmit={addUnit}
            />
          )}
          {tree.length === 0 && addParentId !== "root" ? (
            <p className="mt-2 text-gray-500">
              No departments or teams yet. Add the first one above — {companyName} is the root everything else hangs off.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {tree.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  units={units}
                  members={members}
                  memberCountByUnit={memberCountByUnit}
                  companyName={companyName}
                  editingId={editingId}
                  addParentId={addParentId}
                  onStartAddChild={(id) => {
                    setEditingId(null);
                    setAddParentId((p) => (p === id ? null : id));
                  }}
                  onStartEdit={(id) => {
                    setAddParentId(null);
                    setEditingId((cur) => (cur === id ? null : id));
                  }}
                  onCancelEdit={() => setEditingId(null)}
                  onCancelAdd={() => setAddParentId(null)}
                  onAdd={addUnit}
                  onSaveEdit={saveEdit}
                  onDelete={removeUnit}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}

function TreeNode({
  node,
  depth,
  units,
  members,
  memberCountByUnit,
  companyName,
  editingId,
  addParentId,
  onStartAddChild,
  onStartEdit,
  onCancelEdit,
  onCancelAdd,
  onAdd,
  onSaveEdit,
  onDelete,
}: {
  node: OrgNode;
  depth: number;
  units: OrgUnit[];
  members: OrgMember[];
  memberCountByUnit: Map<string, number>;
  companyName: string;
  editingId: string | null;
  addParentId: string | "root" | null;
  onStartAddChild: (id: string) => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onCancelAdd: () => void;
  onAdd: (input: UnitInput) => Promise<void>;
  onSaveEdit: (id: string, input: UnitInput) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const isEditing = editingId === node.id;
  const isAddingChild = addParentId === node.id;
  const leader = memberName(node.leader_user_id, members);
  // Member count (Session 42, Plan S4+S5) — click through to People,
  // pre-filtered to this unit, rather than a plain count with no next step.
  const memberCount = memberCountByUnit.get(node.id) ?? 0;

  return (
    <li style={{ marginLeft: depth * 24 }}>
      {isEditing ? (
        <UnitForm
          units={units.filter((u) => u.id !== node.id)}
          members={members}
          companyName={companyName}
          initial={node}
          onCancel={onCancelEdit}
          onSubmit={(input) => onSaveEdit(node.id, input)}
          submitLabel="Save changes"
        />
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-2.5">
          <p className="min-w-0 text-sm font-medium text-gray-900">
            {node.name}
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
              {TYPE_LABEL[node.unit_type]}
            </span>
            {leader && <span className="ml-2 text-xs font-normal text-gray-400">Led by {leader}</span>}
            {memberCount > 0 && (
              <Link
                href={`/app/settings?section=people&unit=${node.id}`}
                className="ml-2 text-xs font-normal text-gray-400 hover:text-gray-700 hover:underline"
              >
                {memberCount} {memberCount === 1 ? "person" : "people"}
              </Link>
            )}
          </p>
          <div className="flex shrink-0 items-center gap-3">
            <button onClick={() => onStartAddChild(node.id)} className="text-xs text-gray-400 hover:text-gray-700">
              + Add child
            </button>
            <button onClick={() => onStartEdit(node.id)} className="text-xs text-gray-400 hover:text-gray-700">
              Edit
            </button>
            <button onClick={() => onDelete(node.id)} className="text-xs text-gray-400 hover:text-red-500">
              Delete
            </button>
          </div>
        </div>
      )}

      {isAddingChild && (
        <div className="mt-2" style={{ marginLeft: 24 }}>
          <UnitForm
            units={units}
            members={members}
            companyName={companyName}
            defaultParentId={node.id}
            onCancel={onCancelAdd}
            onSubmit={onAdd}
          />
        </div>
      )}

      {node.children.length > 0 && (
        <ul className="mt-2 space-y-2">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              units={units}
              members={members}
              memberCountByUnit={memberCountByUnit}
              companyName={companyName}
              editingId={editingId}
              addParentId={addParentId}
              onStartAddChild={onStartAddChild}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onCancelAdd={onCancelAdd}
              onAdd={onAdd}
              onSaveEdit={onSaveEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function UnitForm({
  units,
  members,
  companyName,
  initial,
  defaultParentId,
  onCancel,
  onSubmit,
  submitLabel = "Add",
}: {
  // Candidates for the parent dropdown — callers already exclude the unit
  // being edited so it can't become its own parent.
  units: OrgUnit[];
  members: OrgMember[];
  companyName: string;
  initial?: OrgUnit;
  defaultParentId?: string | null;
  onCancel: () => void;
  onSubmit: (input: UnitInput) => Promise<void>;
  submitLabel?: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [unitType, setUnitType] = useState<OrgUnitType>(initial?.unit_type ?? "department");
  const [parentId, setParentId] = useState(initial?.parent_unit_id ?? defaultParentId ?? "");
  const [leaderId, setLeaderId] = useState(initial?.leader_user_id ?? "");
  const [saving, setSaving] = useState(false);

  const isEdit = !!initial;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        unit_type: unitType,
        parent_unit_id: parentId || null,
        leader_user_id: leaderId || null,
      });
      if (!isEdit) {
        setName("");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-dashed border-gray-300 p-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelCls}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Customer Success" />
        </div>
        <div className="w-36">
          <label className={labelCls}>Type</label>
          <select value={unitType} onChange={(e) => setUnitType(e.target.value as OrgUnitType)} className={inputCls}>
            <option value="department">Department</option>
            <option value="team">Team</option>
          </select>
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelCls}>Parent</label>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputCls}>
            <option value="">{companyName} (top-level)</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                [{TYPE_LABEL[u.unit_type]}] {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className={labelCls}>Leader</label>
          <select value={leaderId} onChange={(e) => setLeaderId(e.target.value)} className={inputCls}>
            <option value="">No leader assigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name || m.email}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-gray-400">
        The leader sees an aggregate rollup (people, goals, projects, capacity) across this unit and everything
        under it — never a named individual outside their own team. See the Rollup tab.
      </p>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={primaryBtnCls}>
          {saving ? "Saving..." : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-900">
          Cancel
        </button>
      </div>
    </form>
  );
}

// Read-only visual chart, rendered from the same org_units data as Build.
// Pure-CSS nested-list org chart (no charting/diagramming dependency) —
// styled-jsx ships with Next.js, so this adds nothing new to package.json.
function OrgChart({ tree, companyName, members }: { tree: OrgNode[]; companyName: string; members: OrgMember[] }) {
  return (
    <div className="org-chart mt-8 overflow-x-auto pb-6">
      <ul className="flex justify-center">
        <li>
          <div className="inline-block rounded-lg border border-gray-900 bg-gray-900 px-4 py-2 text-sm font-medium text-white">
            {companyName}
          </div>
          {tree.length > 0 && (
            <ul>
              {tree.map((node) => (
                <ChartNode key={node.id} node={node} members={members} />
              ))}
            </ul>
          )}
        </li>
      </ul>
      {tree.length === 0 && (
        <p className="mt-4 text-center text-sm text-gray-400">No departments or teams yet — add some in Build.</p>
      )}
      <style jsx>{`
        .org-chart ul {
          padding-top: 20px;
          position: relative;
          display: flex;
          justify-content: center;
        }
        .org-chart li {
          list-style: none;
          text-align: center;
          position: relative;
          padding: 20px 10px 0 10px;
        }
        .org-chart li::before,
        .org-chart li::after {
          content: "";
          position: absolute;
          top: 0;
          border-top: 1px solid #d1d5db;
          width: 50%;
          height: 20px;
        }
        .org-chart li::before {
          left: 0;
          border-right: 1px solid #d1d5db;
        }
        .org-chart li::after {
          right: 0;
          border-left: 1px solid #d1d5db;
        }
        .org-chart li:only-child {
          padding-top: 0;
        }
        .org-chart li:only-child::before,
        .org-chart li:only-child::after {
          display: none;
        }
        .org-chart li:first-child::before,
        .org-chart li:last-child::after {
          border: 0 none;
        }
        .org-chart li:last-child::before {
          border-right: 1px solid #d1d5db;
          border-radius: 0 5px 0 0;
        }
        .org-chart li:first-child::after {
          border-radius: 5px 0 0 0;
        }
        .org-chart ul ul::before {
          content: "";
          position: absolute;
          top: 0;
          left: 50%;
          border-left: 1px solid #d1d5db;
          width: 0;
          height: 20px;
        }
      `}</style>
    </div>
  );
}

function ChartNode({ node, members }: { node: OrgNode; members: OrgMember[] }) {
  const leader = memberName(node.leader_user_id, members);
  return (
    <li>
      <div className="inline-block rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-900 shadow-sm">
        {node.name}
        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
          {TYPE_LABEL[node.unit_type]}
        </span>
        {leader && <div className="mt-1 text-xs text-gray-400">Led by {leader}</div>}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <ChartNode key={child.id} node={child} members={members} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Rollup — for each unit the signed-in user leads, an aggregate-only summary
// (headcount + role breakdown, goal/project status counts) across that
// unit's whole subtree. Capacity hours live on their own page (Capacity's
// "By department" section, gated the same way) rather than duplicated here.
// ---------------------------------------------------------------------------

type SubtreeTotals = {
  people: number;
  roleBreakdown: Map<string, number>;
  goals: number;
  goalsAtRisk: number;
  projects: number;
  projectsAtRisk: number;
};

function emptyTotals(): SubtreeTotals {
  return { people: 0, roleBreakdown: new Map(), goals: 0, goalsAtRisk: 0, projects: 0, projectsAtRisk: 0 };
}

function subtreeRollup(
  node: OrgNode,
  peopleByUnit: Map<string, PeopleRollupItem>,
  goalsByUnit: Map<string, GoalsRollupItem[]>,
  projectsByUnit: Map<string, ProjectsRollupItem[]>
): SubtreeTotals {
  const totals = emptyTotals();
  const own = peopleByUnit.get(node.id);
  if (own) {
    totals.people += own.direct_report_count;
    for (const r of own.role_breakdown) {
      totals.roleBreakdown.set(r.job_role, (totals.roleBreakdown.get(r.job_role) ?? 0) + r.count);
    }
  }
  for (const g of goalsByUnit.get(node.id) ?? []) {
    totals.goals += g.goal_count;
    if (g.status === "at_risk") totals.goalsAtRisk += g.goal_count;
  }
  for (const p of projectsByUnit.get(node.id) ?? []) {
    totals.projects += p.project_count;
    if (p.status === "at_risk") totals.projectsAtRisk += p.project_count;
  }
  for (const child of node.children) {
    const sub = subtreeRollup(child, peopleByUnit, goalsByUnit, projectsByUnit);
    totals.people += sub.people;
    totals.goals += sub.goals;
    totals.goalsAtRisk += sub.goalsAtRisk;
    totals.projects += sub.projects;
    totals.projectsAtRisk += sub.projectsAtRisk;
    sub.roleBreakdown.forEach((count, role) => {
      totals.roleBreakdown.set(role, (totals.roleBreakdown.get(role) ?? 0) + count);
    });
  }
  return totals;
}

function RollupNode({
  node,
  depth,
  peopleByUnit,
  goalsByUnit,
  projectsByUnit,
}: {
  node: OrgNode;
  depth: number;
  peopleByUnit: Map<string, PeopleRollupItem>;
  goalsByUnit: Map<string, GoalsRollupItem[]>;
  projectsByUnit: Map<string, ProjectsRollupItem[]>;
}) {
  const totals = subtreeRollup(node, peopleByUnit, goalsByUnit, projectsByUnit);
  const roles = Array.from(totals.roleBreakdown.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <li style={{ marginLeft: depth * 24 }}>
      <div className="rounded-lg border border-gray-200 px-4 py-3">
        <p className="text-sm font-medium text-gray-900">
          {node.name}
          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
            {TYPE_LABEL[node.unit_type]}
          </span>
        </p>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
          <span>
            {totals.people} {totals.people === 1 ? "person" : "people"}
            {roles.length > 0 && ` (${roles.map(([role, count]) => `${role} ${count}`).join(", ")})`}
          </span>
          <span>
            {totals.goals} goal{totals.goals === 1 ? "" : "s"}
            {totals.goalsAtRisk > 0 && `, ${totals.goalsAtRisk} at risk`}
          </span>
          <span>
            {totals.projects} project{totals.projects === 1 ? "" : "s"}
            {totals.projectsAtRisk > 0 && `, ${totals.projectsAtRisk} at risk`}
          </span>
        </div>
      </div>
      {node.children.length > 0 && (
        <ul className="mt-2 space-y-2">
          {node.children.map((child) => (
            <RollupNode
              key={child.id}
              node={child}
              depth={depth + 1}
              peopleByUnit={peopleByUnit}
              goalsByUnit={goalsByUnit}
              projectsByUnit={projectsByUnit}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function RollupView({ units }: { units: OrgUnit[] }) {
  const [ledUnits, setLedUnits] = useState<OrgUnit[] | null>(null);
  const [peopleByUnit, setPeopleByUnit] = useState<Map<string, PeopleRollupItem>>(new Map());
  const [goalsByUnit, setGoalsByUnit] = useState<Map<string, GoalsRollupItem[]>>(new Map());
  const [projectsByUnit, setProjectsByUnit] = useState<Map<string, ProjectsRollupItem[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getLedOrgUnits(), getPeopleRollup(), getGoalsRollup(), getProjectsRollup()])
      .then(([led, people, goals, projects]) => {
        setLedUnits(led);
        setPeopleByUnit(new Map(people.map((p) => [p.org_unit_id, p])));
        const gMap = new Map<string, GoalsRollupItem[]>();
        goals.forEach((g) => gMap.set(g.org_unit_id, [...(gMap.get(g.org_unit_id) ?? []), g]));
        setGoalsByUnit(gMap);
        const pMap = new Map<string, ProjectsRollupItem[]>();
        projects.forEach((p) => pMap.set(p.org_unit_id, [...(pMap.get(p.org_unit_id) ?? []), p]));
        setProjectsByUnit(pMap);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const nodeMap = useMemo(() => buildNodeMap(units), [units]);

  if (loading) return <p className="mt-8 text-gray-500">Loading...</p>;
  if (error) return <p className="mt-4 text-sm text-red-500">{error}</p>;

  if (!ledUnits || ledUnits.length === 0) {
    return (
      <div className="mt-8 rounded-lg border border-dashed border-gray-300 p-6 text-center">
        <p className="text-gray-500">
          You don&apos;t lead any departments or teams yet — rollups only show for units you&apos;re assigned to
          lead.
        </p>
        <p className="mt-2 text-sm text-gray-400">
          Assign yourself (or anyone) as a leader on any unit in the Build tab to see its rollup here.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <p className="text-xs text-gray-400">
        Aggregate numbers only — for units outside your own direct team, you never see a named individual, only
        counts. Capacity hours live on the{" "}
        <Link href="/app/capacity" className="underline hover:text-gray-600">
          Capacity page
        </Link>
        , gated the same way.
      </p>
      <ul className="mt-4 space-y-3">
        {ledUnits.map((led) => {
          const node = nodeMap.get(led.id);
          if (!node) return null;
          return (
            <RollupNode
              key={led.id}
              node={node}
              depth={0}
              peopleByUnit={peopleByUnit}
              goalsByUnit={goalsByUnit}
              projectsByUnit={projectsByUnit}
            />
          );
        })}
      </ul>
    </div>
  );
}
