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

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  OrgUnit,
  OrgUnitType,
  createOrgUnit,
  deleteOrgUnit,
  getOrgUnits,
  getProfile,
  updateOrgUnit,
} from "@/lib/api";

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-medium text-gray-500";
const primaryBtnCls = "rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50";

const TYPE_LABEL: Record<OrgUnitType, string> = { department: "Department", team: "Team" };

type OrgNode = OrgUnit & { children: OrgNode[] };

function buildTree(units: OrgUnit[]): OrgNode[] {
  const nodes = new Map<string, OrgNode>();
  units.forEach((u) => nodes.set(u.id, { ...u, children: [] }));
  const roots: OrgNode[] = [];
  nodes.forEach((node) => {
    const parent = node.parent_unit_id ? nodes.get(node.parent_unit_id) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortNodes = (list: OrgNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

type UnitInput = { name: string; unit_type: OrgUnitType; parent_unit_id: string | null };

export default function OrgPage() {
  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [companyName, setCompanyName] = useState("Your company");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"build" | "chart">("build");
  // "root" = the add-form pinned under the company node; a unit id = the
  // add-child form nested under that node; null = no add-form open.
  const [addParentId, setAddParentId] = useState<string | "root" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getOrgUnits(), getProfile()])
      .then(([u, p]) => {
        setUnits(u);
        setCompanyName(p.company_name || "Your company");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const tree = useMemo(() => buildTree(units), [units]);

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
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Org</h1>
        <Link href="/app/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
          &larr; Back to your team
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Departments and teams, and how they connect under {companyName}.
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
        <OrgChart tree={tree} companyName={companyName} />
      ) : (
        <div className="mt-6">
          {addParentId === "root" && (
            <UnitForm
              units={units}
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

  return (
    <li style={{ marginLeft: depth * 24 }}>
      {isEditing ? (
        <UnitForm
          units={units.filter((u) => u.id !== node.id)}
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
          <UnitForm units={units} companyName={companyName} defaultParentId={node.id} onCancel={onCancelAdd} onSubmit={onAdd} />
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
  const [saving, setSaving] = useState(false);

  const isEdit = !!initial;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), unit_type: unitType, parent_unit_id: parentId || null });
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
      <div>
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
function OrgChart({ tree, companyName }: { tree: OrgNode[]; companyName: string }) {
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
                <ChartNode key={node.id} node={node} />
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

function ChartNode({ node }: { node: OrgNode }) {
  return (
    <li>
      <div className="inline-block rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-900 shadow-sm">
        {node.name}
        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
          {TYPE_LABEL[node.unit_type]}
        </span>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <ChartNode key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}
