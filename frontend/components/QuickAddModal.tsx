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

import { useState } from "react";
import {
  DirectReport,
  GoalLevel,
  createDirectReport,
  createGoal,
  createProject,
} from "@/lib/api";

type QuickAddType = "report" | "goal" | "project";

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
  const [roleTitle, setRoleTitle] = useState("");
  const [level, setLevel] = useState<GoalLevel>("team");
  const [dueDate, setDueDate] = useState("");
  const [directReportId, setDirectReportId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setTitle("");
    setRoleTitle("");
    setLevel("team");
    setDueDate("");
    setDirectReportId("");
    setError(null);
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
        await createDirectReport({ name: title.trim(), role_title: roleTitle.trim() || undefined });
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

          {type === "report" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Role (optional)</label>
              <input
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                placeholder="e.g. Account Executive"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
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
