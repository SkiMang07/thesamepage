"use client";

// Organization overview — one hierarchy for browsing and one inspector for
// understanding a selected unit. Structure editing is a secondary mode rather
// than a competing top-level tab; role-scoped rollups appear where the manager
// is already looking instead of in a disconnected summary view.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import PageShell from "@/components/PageShell";
import {
  GoalsRollupItem,
  OrgMember,
  OrgUnit,
  OrgUnitType,
  PeopleRollupItem,
  ProjectsRollupItem,
  createOrgUnit,
  deleteOrgUnit,
  getGoalsRollup,
  getLedOrgUnits,
  getOrgMembers,
  getOrgUnits,
  getPeopleRollup,
  getProfile,
  getProjectsRollup,
  updateOrgUnit,
} from "@/lib/api";
import {
  BADGE,
  BTN_DANGER,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  INPUT,
  LABEL,
} from "@/lib/tokens";

const TYPE_LABEL: Record<OrgUnitType, string> = { department: "Department", team: "Team" };

type OrgNode = OrgUnit & { children: OrgNode[] };
type ScopeMode = "led" | "all";
type PageMode = "overview" | "manage";

type UnitInput = {
  name: string;
  unit_type: OrgUnitType;
  parent_unit_id: string | null;
  leader_user_id: string | null;
};

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

function hierarchyWouldCycle(unitId: string, parentId: string, parentById: Map<string, string | null>) {
  const seen = new Set<string>();
  let current: string | null | undefined = parentId;
  while (current) {
    if (current === unitId || seen.has(current)) return true;
    seen.add(current);
    current = parentById.get(current);
  }
  return false;
}

function buildNodeMap(units: OrgUnit[]): Map<string, OrgNode> {
  const nodes = new Map<string, OrgNode>();
  const parentById = new Map(units.map((unit) => [unit.id, unit.parent_unit_id]));
  units.forEach((unit) => nodes.set(unit.id, { ...unit, children: [] }));
  nodes.forEach((node) => {
    if (!node.parent_unit_id || hierarchyWouldCycle(node.id, node.parent_unit_id, parentById)) return;
    nodes.get(node.parent_unit_id)?.children.push(node);
  });
  return nodes;
}

function buildTree(units: OrgUnit[]): OrgNode[] {
  const nodes = buildNodeMap(units);
  const attachedIds = new Set<string>();
  nodes.forEach((node) => node.children.forEach((child) => attachedIds.add(child.id)));
  const roots = Array.from(nodes.values()).filter((node) => !attachedIds.has(node.id));
  const sortNodes = (list: OrgNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}

function collectDescendantIds(node: OrgNode, into = new Set<string>()) {
  into.add(node.id);
  node.children.forEach((child) => collectDescendantIds(child, into));
  return into;
}

function memberName(id: string | null, members: OrgMember[]): string | null {
  if (!id) return null;
  const member = members.find((candidate) => candidate.id === id);
  return member ? member.full_name || member.email : null;
}

function subtreeRollup(
  node: OrgNode,
  peopleByUnit: Map<string, PeopleRollupItem>,
  goalsByUnit: Map<string, GoalsRollupItem[]>,
  projectsByUnit: Map<string, ProjectsRollupItem[]>
): SubtreeTotals {
  const totals = emptyTotals();
  const ownPeople = peopleByUnit.get(node.id);
  if (ownPeople) {
    totals.people += ownPeople.direct_report_count;
    ownPeople.role_breakdown.forEach((role) => {
      totals.roleBreakdown.set(role.job_role, (totals.roleBreakdown.get(role.job_role) ?? 0) + role.count);
    });
  }
  (goalsByUnit.get(node.id) ?? []).forEach((goal) => {
    totals.goals += goal.goal_count;
    if (goal.status === "at_risk") totals.goalsAtRisk += goal.goal_count;
  });
  (projectsByUnit.get(node.id) ?? []).forEach((project) => {
    totals.projects += project.project_count;
    if (project.status === "at_risk") totals.projectsAtRisk += project.project_count;
  });
  node.children.forEach((child) => {
    const childTotals = subtreeRollup(child, peopleByUnit, goalsByUnit, projectsByUnit);
    totals.people += childTotals.people;
    totals.goals += childTotals.goals;
    totals.goalsAtRisk += childTotals.goalsAtRisk;
    totals.projects += childTotals.projects;
    totals.projectsAtRisk += childTotals.projectsAtRisk;
    childTotals.roleBreakdown.forEach((count, role) => {
      totals.roleBreakdown.set(role, (totals.roleBreakdown.get(role) ?? 0) + count);
    });
  });
  return totals;
}

export default function OrgPage() {
  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [ledUnits, setLedUnits] = useState<OrgUnit[]>([]);
  const [peopleRollup, setPeopleRollup] = useState<PeopleRollupItem[]>([]);
  const [goalsRollup, setGoalsRollup] = useState<GoalsRollupItem[]>([]);
  const [projectsRollup, setProjectsRollup] = useState<ProjectsRollupItem[]>([]);
  const [companyName, setCompanyName] = useState("Your company");
  const [loading, setLoading] = useState(true);
  const [rollupLoading, setRollupLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rollupError, setRollupError] = useState<string | null>(null);
  const [mode, setMode] = useState<PageMode>("overview");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("led");
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [addParentId, setAddParentId] = useState<string | "root" | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const refreshLedUnits = useCallback(async () => {
    const led = await getLedOrgUnits();
    setLedUnits(led);
    if (led.length === 0) setScopeMode("all");
  }, []);

  const loadRollups = useCallback(async () => {
    setRollupLoading(true);
    setRollupError(null);
    try {
      const [people, goals, projects] = await Promise.all([getPeopleRollup(), getGoalsRollup(), getProjectsRollup()]);
      setPeopleRollup(people);
      setGoalsRollup(goals);
      setProjectsRollup(projects);
    } catch (caught) {
      setRollupError(caught instanceof Error ? caught.message : "Some organization summaries are unavailable");
    } finally {
      setRollupLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([getOrgUnits(), getProfile(), getOrgMembers(), getLedOrgUnits()])
      .then(([orgUnits, profile, orgMembers, led]) => {
        setUnits(orgUnits);
        setCompanyName(profile.company_name || "Your company");
        setMembers(orgMembers);
        setLedUnits(led);
        if (led.length === 0) setScopeMode("all");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Failed to load the organization"))
      .finally(() => setLoading(false));
    void loadRollups();
  }, [loadRollups]);

  const tree = useMemo(() => buildTree(units), [units]);
  const nodeMap = useMemo(() => buildNodeMap(units), [units]);
  const peopleByUnit = useMemo(() => new Map(peopleRollup.map((item) => [item.org_unit_id, item])), [peopleRollup]);
  const goalsByUnit = useMemo(() => {
    const map = new Map<string, GoalsRollupItem[]>();
    goalsRollup.forEach((item) => map.set(item.org_unit_id, [...(map.get(item.org_unit_id) ?? []), item]));
    return map;
  }, [goalsRollup]);
  const projectsByUnit = useMemo(() => {
    const map = new Map<string, ProjectsRollupItem[]>();
    projectsRollup.forEach((item) => map.set(item.org_unit_id, [...(map.get(item.org_unit_id) ?? []), item]));
    return map;
  }, [projectsRollup]);
  const ledScopeIds = useMemo(() => {
    const ids = new Set<string>();
    ledUnits.forEach((unit) => {
      const node = nodeMap.get(unit.id);
      if (node) collectDescendantIds(node, ids);
    });
    return ids;
  }, [ledUnits, nodeMap]);

  const selectedUnit = selectedUnitId ? nodeMap.get(selectedUnitId) ?? null : null;
  const selectedInScope = !!selectedUnit && ledScopeIds.has(selectedUnit.id);
  const selectedTotals = useMemo(
    () => (selectedUnit ? subtreeRollup(selectedUnit, peopleByUnit, goalsByUnit, projectsByUnit) : emptyTotals()),
    [selectedUnit, peopleByUnit, goalsByUnit, projectsByUnit]
  );

  useEffect(() => {
    if (loading) return;
    if (units.length === 0) {
      setSelectedUnitId(null);
      return;
    }
    if (selectedUnitId && nodeMap.has(selectedUnitId)) return;
    setSelectedUnitId(ledUnits.find((unit) => nodeMap.has(unit.id))?.id ?? tree[0]?.id ?? units[0].id);
  }, [loading, units, ledUnits, nodeMap, tree, selectedUnitId]);

  function chooseScope(next: ScopeMode) {
    setScopeMode(next);
    if (next === "led" && ledUnits.length > 0) setSelectedUnitId(ledUnits[0].id);
  }

  async function addUnit(input: UnitInput) {
    try {
      const created = await createOrgUnit(input);
      setUnits((current) => [...current, created]);
      setSelectedUnitId(created.id);
      setAddParentId(null);
      setError(null);
      await Promise.all([loadRollups(), refreshLedUnits()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to add the unit");
      throw caught;
    }
  }

  async function saveUnit(id: string, input: UnitInput) {
    try {
      const updated = await updateOrgUnit(id, input);
      setUnits((current) => current.map((unit) => (unit.id === id ? updated : unit)));
      setError(null);
      await Promise.all([loadRollups(), refreshLedUnits()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save the unit");
      throw caught;
    }
  }

  async function removeSelectedUnit() {
    if (!selectedUnit) return;
    try {
      const nextSelection = selectedUnit.parent_unit_id;
      await deleteOrgUnit(selectedUnit.id);
      const freshUnits = await getOrgUnits();
      setUnits(freshUnits);
      setSelectedUnitId(nextSelection && freshUnits.some((unit) => unit.id === nextSelection) ? nextSelection : freshUnits[0]?.id ?? null);
      setDeleteArmed(false);
      setError(null);
      await Promise.all([loadRollups(), refreshLedUnits()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to remove the unit");
    }
  }

  function openManage() {
    setMode("manage");
    setAddParentId(null);
    setDeleteArmed(false);
  }

  return (
    <PageShell maxWidth="8xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Organization</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            See how teams connect and where your leadership attention is needed.
          </p>
        </div>
        {mode === "overview" ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="org-scope">Organization scope</label>
            <select
              id="org-scope"
              value={scopeMode}
              onChange={(event) => chooseScope(event.target.value as ScopeMode)}
              className="rounded-md border border-control bg-sunken px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-blue-600/40"
            >
              <option value="led" disabled={ledUnits.length === 0}>Units I lead</option>
              <option value="all">Entire organization</option>
            </select>
            <button type="button" onClick={openManage} className={BTN_SECONDARY}>Manage structure</button>
          </div>
        ) : (
          <button type="button" onClick={() => setMode("overview")} className={BTN_SECONDARY}>← Back to overview</button>
        )}
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}

      {loading ? (
        <div className="mt-5 rounded-xl border border-hairline bg-surface p-6 text-sm text-ink-secondary">Loading organization…</div>
      ) : mode === "manage" ? (
        <ManageStructure
          tree={tree}
          units={units}
          members={members}
          companyName={companyName}
          selectedUnit={selectedUnit}
          selectedUnitId={selectedUnitId}
          addParentId={addParentId}
          deleteArmed={deleteArmed}
          onSelect={(id) => {
            setSelectedUnitId(id);
            setAddParentId(null);
            setDeleteArmed(false);
          }}
          onStartAdd={() => {
            setAddParentId(selectedUnit?.id ?? "root");
            setDeleteArmed(false);
          }}
          onCancelAdd={() => setAddParentId(null)}
          onAdd={addUnit}
          onSave={saveUnit}
          onArmDelete={() => setDeleteArmed(true)}
          onCancelDelete={() => setDeleteArmed(false)}
          onDelete={removeSelectedUnit}
        />
      ) : units.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-control bg-surface p-8 text-center">
          <p className="text-sm font-medium text-ink">Start with the team or department you manage.</p>
          <p className="mt-1 text-sm text-ink-muted">You can add the wider organization later without blocking your own team setup.</p>
          <button
            type="button"
            onClick={() => {
              openManage();
              setAddParentId("root");
            }}
            className={`${BTN_PRIMARY} mt-4`}
          >
            Add the first team or department
          </button>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,.7fr)]">
          <HierarchyOverview
            tree={tree}
            companyName={companyName}
            members={members}
            selectedUnitId={selectedUnitId}
            ledScopeIds={ledScopeIds}
            scopeMode={scopeMode}
            peopleByUnit={peopleByUnit}
            goalsByUnit={goalsByUnit}
            projectsByUnit={projectsByUnit}
            rollupLoading={rollupLoading}
            rollupError={!!rollupError}
            onSelect={setSelectedUnitId}
          />
          <UnitInspector
            unit={selectedUnit}
            members={members}
            totals={selectedTotals}
            inScope={selectedInScope}
            directlyLed={!!selectedUnit && ledUnits.some((unit) => unit.id === selectedUnit.id)}
            rollupLoading={rollupLoading}
            rollupError={rollupError}
          />
        </div>
      )}
    </PageShell>
  );
}

function HierarchyOverview({
  tree,
  companyName,
  members,
  selectedUnitId,
  ledScopeIds,
  scopeMode,
  peopleByUnit,
  goalsByUnit,
  projectsByUnit,
  rollupLoading,
  rollupError,
  onSelect,
}: {
  tree: OrgNode[];
  companyName: string;
  members: OrgMember[];
  selectedUnitId: string | null;
  ledScopeIds: Set<string>;
  scopeMode: ScopeMode;
  peopleByUnit: Map<string, PeopleRollupItem>;
  goalsByUnit: Map<string, GoalsRollupItem[]>;
  projectsByUnit: Map<string, ProjectsRollupItem[]>;
  rollupLoading: boolean;
  rollupError: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-4 sm:p-5" aria-label="Organization hierarchy">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{companyName}</p>
        {ledScopeIds.size > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" /> Your leadership scope
          </span>
        )}
      </div>
      <div className="mt-4 rounded-lg border-l-2 border-brand bg-elevated px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink">{companyName}</span>
          <span className={`${BADGE} bg-sunken text-ink-muted`}>Company</span>
        </div>
      </div>
      <div className="mt-3 space-y-3 border-l border-divider pl-3 sm:pl-5">
        {tree.map((node) => (
          <HierarchyNode
            key={node.id}
            node={node}
            depth={0}
            members={members}
            selectedUnitId={selectedUnitId}
            ledScopeIds={ledScopeIds}
            scopeMode={scopeMode}
            peopleByUnit={peopleByUnit}
            goalsByUnit={goalsByUnit}
            projectsByUnit={projectsByUnit}
            rollupLoading={rollupLoading}
            rollupError={rollupError}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function HierarchyNode({
  node,
  depth,
  members,
  selectedUnitId,
  ledScopeIds,
  scopeMode,
  peopleByUnit,
  goalsByUnit,
  projectsByUnit,
  rollupLoading,
  rollupError,
  onSelect,
}: {
  node: OrgNode;
  depth: number;
  members: OrgMember[];
  selectedUnitId: string | null;
  ledScopeIds: Set<string>;
  scopeMode: ScopeMode;
  peopleByUnit: Map<string, PeopleRollupItem>;
  goalsByUnit: Map<string, GoalsRollupItem[]>;
  projectsByUnit: Map<string, ProjectsRollupItem[]>;
  rollupLoading: boolean;
  rollupError: boolean;
  onSelect: (id: string) => void;
}) {
  const inScope = ledScopeIds.has(node.id);
  const leader = memberName(node.leader_user_id, members);
  const totals = subtreeRollup(node, peopleByUnit, goalsByUnit, projectsByUnit);
  const attentionCount = totals.goalsAtRisk + totals.projectsAtRisk;
  let stateLabel = "Outside your scope";
  let stateClass = "text-ink-muted";
  if (!leader) {
    stateLabel = "Leader needed";
    stateClass = "text-amber-700";
  } else if (inScope && rollupLoading) {
    stateLabel = "Loading summary";
  } else if (inScope && rollupError) {
    stateLabel = "Summary unavailable";
    stateClass = "text-amber-700";
  } else if (inScope && attentionCount > 0) {
    stateLabel = `${attentionCount} need${attentionCount === 1 ? "s" : ""} attention`;
    stateClass = "text-amber-700";
  } else if (inScope) {
    stateLabel = "In your scope";
    stateClass = "text-brand";
  }
  const dimmed = scopeMode === "led" && !inScope;

  return (
    <div className={dimmed ? "opacity-60" : "opacity-100"}>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        aria-pressed={selectedUnitId === node.id}
        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
          selectedUnitId === node.id
            ? "border-brand bg-brand-tint"
            : "border-hairline bg-sunken hover:border-control hover:bg-elevated"
        }`}
      >
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium text-ink">{node.name}</span>
            <span className={`${BADGE} bg-elevated text-ink-muted`}>{TYPE_LABEL[node.unit_type]}</span>
          </span>
          <span className="mt-1 block truncate text-xs text-ink-muted">{leader ? `Led by ${leader}` : "No leader assigned"}</span>
        </span>
        <span className={`text-right text-xs ${stateClass}`}>{stateLabel}</span>
      </button>
      {node.children.length > 0 && (
        <div className={`mt-2 space-y-2 border-l border-divider pl-3 ${depth === 0 ? "sm:ml-4 sm:grid sm:grid-cols-2 sm:gap-2 sm:space-y-0" : "ml-4"}`}>
          {node.children.map((child) => (
            <HierarchyNode
              key={child.id}
              node={child}
              depth={depth + 1}
              members={members}
              selectedUnitId={selectedUnitId}
              ledScopeIds={ledScopeIds}
              scopeMode={scopeMode}
              peopleByUnit={peopleByUnit}
              goalsByUnit={goalsByUnit}
              projectsByUnit={projectsByUnit}
              rollupLoading={rollupLoading}
              rollupError={rollupError}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UnitInspector({
  unit,
  members,
  totals,
  inScope,
  directlyLed,
  rollupLoading,
  rollupError,
}: {
  unit: OrgNode | null;
  members: OrgMember[];
  totals: SubtreeTotals;
  inScope: boolean;
  directlyLed: boolean;
  rollupLoading: boolean;
  rollupError: string | null;
}) {
  if (!unit) {
    return <aside className="rounded-xl border border-hairline bg-surface p-5 text-sm text-ink-muted">Select a team or department to see its context.</aside>;
  }
  const leader = memberName(unit.leader_user_id, members);
  const roles = Array.from(totals.roleBreakdown.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const peopleHref = `/app/settings?section=people&unit=${unit.id}`;

  return (
    <aside className="self-start rounded-xl border border-hairline bg-surface p-5" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{TYPE_LABEL[unit.unit_type]}</p>
          <h2 className="mt-1 truncate text-lg font-semibold text-ink">{unit.name}</h2>
          <p className="mt-1 text-xs text-ink-muted">{leader ? `Led by ${leader}` : "No leader assigned"}</p>
        </div>
        <span className={`${BADGE} shrink-0 ${inScope ? "bg-teal-50 text-teal-700" : "bg-sunken text-ink-muted"}`}>
          {directlyLed ? "Your scope" : inScope ? "In your scope" : "Structure only"}
        </span>
      </div>

      {!inScope ? (
        <div className="mt-5 rounded-lg bg-sunken p-4 text-sm text-ink-muted">
          Detailed people and performance data is outside your current leadership scope. The structure remains visible without implying that this unit has zero people.
        </div>
      ) : rollupLoading ? (
        <div className="mt-5 rounded-lg bg-sunken p-4 text-sm text-ink-muted">Loading this unit’s summary…</div>
      ) : rollupError ? (
        <div className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-700">
          Some summary sources did not load. No all-clear is being shown until the data is complete.
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <InspectorStat value={totals.people} label="people" />
            <InspectorStat value={totals.goals} label="goals" />
            <InspectorStat value={totals.projects} label="projects" />
          </div>

          <section className="mt-5 border-t border-divider pt-4">
            <h3 className="text-sm font-medium text-ink">Needs attention</h3>
            {totals.goalsAtRisk === 0 && totals.projectsAtRisk === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No goals or projects are currently marked at risk.</p>
            ) : (
              <div className="mt-2 divide-y divide-divider">
                {totals.goalsAtRisk > 0 && (
                  <AttentionRow
                    label={`${totals.goalsAtRisk} goal${totals.goalsAtRisk === 1 ? "" : "s"} at risk`}
                    detail="Status is marked at risk"
                    href="/app/goals"
                    action="View goals"
                  />
                )}
                {totals.projectsAtRisk > 0 && (
                  <AttentionRow
                    label={`${totals.projectsAtRisk} project${totals.projectsAtRisk === 1 ? "" : "s"} at risk`}
                    detail="Manager intervention may be needed"
                    href="/app/projects"
                    action="View projects"
                  />
                )}
              </div>
            )}
          </section>

          <section className="mt-5 border-t border-divider pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-ink">Team makeup</h3>
              <Link href={peopleHref} className="text-xs text-brand hover:underline">View people</Link>
            </div>
            {roles.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No assigned roles in this scope yet.</p>
            ) : (
              <dl className="mt-2 divide-y divide-divider">
                {roles.map(([role, count]) => (
                  <div key={role} className="flex items-center justify-between gap-3 py-2 text-xs">
                    <dt className="text-ink-secondary">{role}</dt>
                    <dd className="font-medium text-ink">{count}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-divider pt-4 text-xs">
            <Link href="/app/team" className="text-brand hover:underline">Open Team workspace →</Link>
            <Link href="/app/capacity" className="text-ink-muted hover:text-ink hover:underline">View capacity</Link>
          </section>
        </>
      )}
    </aside>
  );
}

function InspectorStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg bg-sunken px-3 py-3">
      <p className="text-xl font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{label}</p>
    </div>
  );
}

function AttentionRow({ label, detail, href, action }: { label: string; detail: string; href: string; action: string }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 py-3">
      <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink-muted">{detail}</span>
      </span>
      <Link href={href} className="text-xs text-brand hover:underline">{action}</Link>
    </div>
  );
}

function ManageStructure({
  tree,
  units,
  members,
  companyName,
  selectedUnit,
  selectedUnitId,
  addParentId,
  deleteArmed,
  onSelect,
  onStartAdd,
  onCancelAdd,
  onAdd,
  onSave,
  onArmDelete,
  onCancelDelete,
  onDelete,
}: {
  tree: OrgNode[];
  units: OrgUnit[];
  members: OrgMember[];
  companyName: string;
  selectedUnit: OrgNode | null;
  selectedUnitId: string | null;
  addParentId: string | "root" | null;
  deleteArmed: boolean;
  onSelect: (id: string) => void;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onAdd: (input: UnitInput) => Promise<void>;
  onSave: (id: string, input: UnitInput) => Promise<void>;
  onArmDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => Promise<void>;
}) {
  const descendantIds = selectedUnit ? collectDescendantIds(selectedUnit) : new Set<string>();
  const parentCandidates = units.filter((unit) => !descendantIds.has(unit.id));
  const adding = addParentId !== null;
  const addParent = addParentId === "root" ? null : addParentId;

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(280px,.8fr)_minmax(360px,1.2fr)]">
      <section className="self-start rounded-xl border border-hairline bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Structure</p>
          <button type="button" onClick={onStartAdd} className={BTN_PRIMARY}>+ Add unit</button>
        </div>
        <div className="mt-4 rounded-lg bg-sunken px-3 py-2.5 text-sm font-medium text-ink">{companyName}</div>
        {tree.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">No teams or departments yet.</p>
        ) : (
          <div className="mt-2 space-y-1">
            {tree.map((node) => (
              <ManageTreeNode key={node.id} node={node} depth={0} selectedUnitId={selectedUnitId} members={members} onSelect={onSelect} />
            ))}
          </div>
        )}
      </section>

      <section className="self-start rounded-xl border border-hairline bg-surface p-5">
        {adding ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Add to structure</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">
              {addParent ? `Inside ${units.find((unit) => unit.id === addParent)?.name ?? companyName}` : `Inside ${companyName}`}
            </h2>
            <div className="mt-4">
              <UnitForm
                units={units}
                members={members}
                companyName={companyName}
                defaultParentId={addParent}
                onCancel={onCancelAdd}
                onSubmit={onAdd}
                submitLabel="Add to organization"
              />
            </div>
          </>
        ) : selectedUnit ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Edit {TYPE_LABEL[selectedUnit.unit_type].toLowerCase()}</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">{selectedUnit.name}</h2>
            <div className="mt-4">
              <UnitForm
                key={selectedUnit.id}
                units={parentCandidates}
                members={members}
                companyName={companyName}
                initial={selectedUnit}
                onCancel={() => undefined}
                onSubmit={(input) => onSave(selectedUnit.id, input)}
                submitLabel="Save changes"
                hideCancel
              />
            </div>
            <div className="mt-5 border-t border-divider pt-4">
              {!deleteArmed ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-ink-muted">
                    {selectedUnit.children.length > 0
                      ? `${selectedUnit.children.length} child unit${selectedUnit.children.length === 1 ? "" : "s"} must be moved or removed first.`
                      : "Removal may clear or delete records linked to this unit."}
                  </p>
                  <button type="button" onClick={onArmDelete} className={BTN_GHOST}>Review removal</button>
                </div>
              ) : (
                <div className="rounded-lg bg-red-50 p-4">
                  <p className="text-sm font-medium text-red-700">Remove {selectedUnit.name}?</p>
                  <p className="mt-1 text-xs text-red-700">
                    {selectedUnit.children.length > 0
                      ? "This unit still contains child units. Move or remove them before deleting it."
                      : "This cannot be undone. Records that depend on this unit may be unassigned or removed."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void onDelete()} disabled={selectedUnit.children.length > 0} className={BTN_DANGER}>Remove unit</button>
                    <button type="button" onClick={onCancelDelete} className={BTN_SECONDARY}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-muted">Select a team or department to edit it, or add the first one.</p>
        )}
      </section>
    </div>
  );
}

function ManageTreeNode({
  node,
  depth,
  selectedUnitId,
  members,
  onSelect,
}: {
  node: OrgNode;
  depth: number;
  selectedUnitId: string | null;
  members: OrgMember[];
  onSelect: (id: string) => void;
}) {
  const leader = memberName(node.leader_user_id, members);
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        aria-pressed={selectedUnitId === node.id}
        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-2 text-left ${
          selectedUnitId === node.id ? "bg-brand-tint text-ink" : "text-ink-secondary hover:bg-sunken hover:text-ink"
        }`}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
      >
        <span className="min-w-0 truncate text-sm">{node.children.length > 0 ? "⌄ " : ""}{node.name}</span>
        <span className="text-xs text-ink-muted">{leader ? TYPE_LABEL[node.unit_type] : "Leader needed"}</span>
      </button>
      {node.children.map((child) => (
        <ManageTreeNode key={child.id} node={child} depth={depth + 1} selectedUnitId={selectedUnitId} members={members} onSelect={onSelect} />
      ))}
    </div>
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
  submitLabel,
  hideCancel = false,
}: {
  units: OrgUnit[];
  members: OrgMember[];
  companyName: string;
  initial?: OrgUnit;
  defaultParentId?: string | null;
  onCancel: () => void;
  onSubmit: (input: UnitInput) => Promise<void>;
  submitLabel: string;
  hideCancel?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [unitType, setUnitType] = useState<OrgUnitType>(initial?.unit_type ?? "team");
  const [parentId, setParentId] = useState(initial?.parent_unit_id ?? defaultParentId ?? "");
  const [leaderId, setLeaderId] = useState(initial?.leader_user_id ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        unit_type: unitType,
        parent_unit_id: parentId || null,
        leader_user_id: leaderId || null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={LABEL} htmlFor={`unit-name-${initial?.id ?? "new"}`}>Name</label>
        <input
          id={`unit-name-${initial?.id ?? "new"}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={INPUT}
          placeholder="e.g. Customer Success"
          required
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor={`unit-type-${initial?.id ?? "new"}`}>Type</label>
          <select id={`unit-type-${initial?.id ?? "new"}`} value={unitType} onChange={(event) => setUnitType(event.target.value as OrgUnitType)} className={INPUT}>
            <option value="department">Department</option>
            <option value="team">Team</option>
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor={`unit-parent-${initial?.id ?? "new"}`}>Reports into</label>
          <select id={`unit-parent-${initial?.id ?? "new"}`} value={parentId} onChange={(event) => setParentId(event.target.value)} className={INPUT}>
            <option value="">{companyName} (top-level)</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.name} · {TYPE_LABEL[unit.unit_type]}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={LABEL} htmlFor={`unit-leader-${initial?.id ?? "new"}`}>Team leader</label>
        <select id={`unit-leader-${initial?.id ?? "new"}`} value={leaderId} onChange={(event) => setLeaderId(event.target.value)} className={INPUT}>
          <option value="">No leader assigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>{member.full_name || member.email}</option>
          ))}
        </select>
      </div>
      <p className="text-xs leading-relaxed text-ink-muted">
        The assigned leader receives aggregate visibility across this unit and its descendants. Capacity remains in the Capacity workspace.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={saving || !name.trim()} className={BTN_PRIMARY}>{saving ? "Saving…" : submitLabel}</button>
        {!hideCancel && <button type="button" onClick={onCancel} className={BTN_SECONDARY}>Cancel</button>}
      </div>
    </form>
  );
}
