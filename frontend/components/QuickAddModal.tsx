"use client";

// Quick add — a single small modal reachable from Mission Control's header,
// rather than a global ⌘K command palette (Session 19 scoping call: "simple
// modal" over the bigger command-palette lift — see docs/SESSION_HISTORY.md
// and the mission_control_grid project memory note). Picks a type, shows
// that type's minimal create form, and calls the SAME lib/api.ts create
// functions the full Goals/Projects pages use — no duplicated validation or
// endpoint logic.
//
// Deliberately NOT a replacement for the dedicated create forms on each
// page (no org-unit picker, no parent goal, no goal linkage for projects) —
// those stay the place for anything more than "get this typed in before I
// forget it." Quick add optimizes for speed, not completeness.

import { useEffect, useState } from "react";
import {
  DirectReport,
  GoalLevel,
  RoleFamily,
  RoleLevel,
  createDirectReport,
  createGoal,
  createProject,
  createRoleFamily,
  createRoleLevel,
  getRoleFamilies,
  getRoleLevels,
} from "@/lib/api";

type QuickAddType = "report" | "goal" | "project";

// Session 41 (Plan S1, docs/TEAM_SETUP_UX_REVIEW.md §6, F1): Quick add's
// "Role (optional)" used to be a free-text input writing direct_reports.
// role_title — a dead end disconnected from role_levels, expectations, and
// everything downstream (see the review's F1 finding). This is now the same
// grouped-by-ladder role typeahead + "create new role inline" mechanic as
// the People roster's picker in settings/page.tsx (GroupedRoleSelect there
// isn't exported — small enough to duplicate here rather than promoting a
// page-local component to a shared one for a single second caller).
const CREATE_NEW_ROLE = "__create_new_role__";

function roleLabel(rl: RoleLevel) {
  const name = rl.role_families?.name ?? rl.job_role;
  return `${name} · L${rl.job_level}`;
}

function groupRolesByFamily(
  roleLevels: RoleLevel[],
  roleFamilies: RoleFamily[]
): { family: RoleFamily | null; levels: RoleLevel[] }[] {
  const byFamily = new Map<string, RoleLevel[]>();
  const ungrouped: RoleLevel[] = [];
  for (const rl of roleLevels) {
    if (rl.role_family_id) {
      const bucket = byFamily.get(rl.role_family_id) ?? [];
      bucket.push(rl);
      byFamily.set(rl.role_family_id, bucket);
    } else {
      ungrouped.push(rl);
    }
  }
  const sortByLevel = (a: RoleLevel, b: RoleLevel) => a.job_level - b.job_level;
  const groups: { family: RoleFamily | null; levels: RoleLevel[] }[] = [...roleFamilies]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => ({ family: f, levels: (byFamily.get(f.id) ?? []).sort(sortByLevel) }))
    .filter((g) => g.levels.length > 0);
  if (ungrouped.length > 0) groups.push({ family: null, levels: ungrouped.sort(sortByLevel) });
  return groups;
}

const TYPE_LABELS: Record<QuickAddType, string> = {
  report: "Direct report",
  goal: "Goal",
  project: "Project",
};

const GOAL_LEVELS: { id: GoalLevel; label: string }[] = [
  { id: "company", label: "Organization" },
  { id: "department", label: "Department" },
  { id: "team", label: "Team" },
  { id: "individual", label: "Individual" },
];

export default function QuickAddModal({
  open,
  onClose,
  directReports,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  directReports: Pick<DirectReport, "id" | "name">[];
  // Fired after any successful create — the dashboard reloads its four
  // sections rather than this component trying to splice a partially-joined
  // row (createGoal/createProject don't come back with direct_report_name/
  // org_unit_name until a real refetch) into local state.
  onCreated: () => void;
}) {
  const [type, setType] = useState<QuickAddType>("report");
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState<GoalLevel>("team");
  const [dueDate, setDueDate] = useState("");
  const [directReportId, setDirectReportId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Role picker state (Plan S1 fix for F1 — see the module comment above).
  const [roleLevels, setRoleLevels] = useState<RoleLevel[]>([]);
  const [roleFamilies, setRoleFamilies] = useState<RoleFamily[]>([]);
  const [roleLevelId, setRoleLevelId] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [creatingRoleSaving, setCreatingRoleSaving] = useState(false);

  // Fetched once per open rather than once ever — role_levels/role_families
  // can change between opens (a role added from Settings while this modal
  // was closed), and this modal is opened rarely enough that a per-open
  // fetch is fine at this scale (same "fine at this scale" posture as every
  // other list fetch in this codebase).
  useEffect(() => {
    if (!open) return;
    getRoleLevels().then(setRoleLevels).catch(() => {});
    getRoleFamilies().then(setRoleFamilies).catch(() => {});
  }, [open]);

  if (!open) return null;

  function reset() {
    setTitle("");
    setLevel("team");
    setDueDate("");
    setDirectReportId("");
    setRoleLevelId("");
    setCreatingRole(false);
    setNewRoleName("");
    setError(null);
  }

  async function handleCreateRole() {
    if (!newRoleName.trim() || creatingRoleSaving) return;
    setCreatingRoleSaving(true);
    setError(null);
    try {
      const family = await createRoleFamily({ name: newRoleName.trim() });
      const level = await createRoleLevel({ job_role: newRoleName.trim(), job_level: 1, role_family_id: family.id });
      setRoleFamilies((fs) => [...fs, family]);
      setRoleLevels((ls) => [...ls, level]);
      setRoleLevelId(level.id);
      setCreatingRole(false);
      setNewRoleName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create role");
    } finally {
      setCreatingRoleSaving(false);
    }
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (type === "report") {
        // role_title is no longer written from here (Plan S1, F1) — the
        // picker below writes role_level_id, the real connection to
        // expectations/assessments/prep. See the module comment.
        await createDirectReport({ name: title.trim(), role_level_id: roleLevelId || undefined });
      } else if (type === "goal") {
        await createGoal({ title: title.trim(), level, due_date: dueDate || null });
      } else {
        await createProject({
          title: title.trim(),
          due_date: dueDate || null,
          direct_report_id: directReportId || null,
        });
      }
      onCreated();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-24" onClick={handleClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Quick add</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex gap-1 border-b border-gray-100 px-5 pt-3">
          {(Object.keys(TYPE_LABELS) as QuickAddType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-t-md px-3 py-2 text-sm font-medium ${
                type === t ? "border-b-2 border-gray-900 text-gray-900" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              {type === "report" ? "Name" : "Title"}
            </label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                type === "report" ? "e.g. Priya Patel" : type === "goal" ? "e.g. Reduce churn to <5%" : "e.g. Renewal automation"
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          {type === "report" && !creatingRole && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Role (optional)</label>
              <select
                value={roleLevelId}
                onChange={(e) => {
                  if (e.target.value === CREATE_NEW_ROLE) setCreatingRole(true);
                  else setRoleLevelId(e.target.value);
                }}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">No role assigned</option>
                <option value={CREATE_NEW_ROLE}>+ Create new role…</option>
                {groupRolesByFamily(roleLevels, roleFamilies).map((g) => (
                  <optgroup key={g.family?.id ?? "ungrouped"} label={g.family?.name ?? "Ungrouped"}>
                    {g.levels.map((rl) => (
                      <option key={rl.id} value={rl.id}>
                        {roleLabel(rl)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                Full setup (teams, expectations) lives in Settings → People — this just gets them started.
              </p>
            </div>
          )}

          {type === "report" && creatingRole && (
            <div className="rounded-md border border-gray-200 p-3">
              <label className="mb-1 block text-xs font-medium text-gray-500">New role name</label>
              <input
                autoFocus
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="e.g. Account Executive"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCreatingRole(false);
                    setNewRoleName("");
                  }}
                  className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateRole}
                  disabled={creatingRoleSaving || !newRoleName.trim()}
                  className="rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                >
                  {creatingRoleSaving ? "Creating..." : "Create role"}
                </button>
              </div>
            </div>
          )}

          {type === "goal" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Level</label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as GoalLevel)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {GOAL_LEVELS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {type === "project" && directReports.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Assign to (optional)</label>
              <select
                value={directReportId}
                onChange={(e) => setDirectReportId(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Your own initiative</option>
                {directReports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {type !== "report" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Due date (optional)</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={handleClose} className="rounded-md px-3 py-2 text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? "Adding..." : `Add ${TYPE_LABELS[type].toLowerCase()}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
