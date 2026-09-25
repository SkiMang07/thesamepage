"use client";

// Person-page sections that keep their full behaviour inside the Relationship
// Desk's Work, Growth and Private notes views and the Person settings drawer:
// the assessment summary, development (plan, aspiration, opportunities,
// training, private notebook), expectations chips, and cadence / capacity /
// time-off settings. Extracted unchanged from page.tsx when the Relationship
// Desk was recomposed (2026-09-25); page.tsx composes them.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useDrawer } from "@/lib/drawer-context";
import {
  getDirectReport,
  getOneOnOneHistory,
  getCommitments,
  getGoals,
  getProjects,
  getCapacityProfile,
  getCapacitySettings,
  getCapacityOverview,
  getTimeOff,
  setCapacityProfile,
  createTimeOff,
  deleteTimeOff,
  updateCommitment,
  expectationName,
  getScorecard,
  getProfile,
  assignReportCadence,
  assignReportRole,
  getRoleFamilies,
  getRoleLevels,
  getOrgUnits,
  getDevelopmentPlan,
  updateDevPlanText,
  upsertAspiration,
  createOpportunity,
  deleteOpportunity,
  createTraining,
  updateTraining,
  deleteTraining,
  createDevManagerNote,
  draftDevelopment,
  reviseDevText,
  getCaptureNotes,
  createCaptureNote,
  deleteCaptureNote,
  DirectReport,
  OneOnOne,
  Commitment,
  Expectation,
  Goal,
  GoalStatus,
  Project,
  CapacitySettings,
  CapacityOverviewItem,
  TimeOffEntry,
  TimeOffType,
  Scorecard,
  RoleFamily,
  RoleLevel,
  OrgUnit,
  DevelopmentBundle,
  DevelopmentDraft,
  OpportunityType,
  CaptureNote,
} from "@/lib/api";
import PageShell from "@/components/PageShell";
import { SECTION_GAP } from "@/components/ZoneMap";
import { GroupedRoleSelect, orgUnitLabel, roleLabel } from "@/components/RolePicker";
import {
  HEX, FEATURE_SURFACE, BTN_PRIMARY, BTN_SECONDARY, BTN_GHOST,
} from "@/lib/tokens";
import { deriveOneOnOneSuggestions } from "@/lib/one-on-one-workspace";

import NoteField from "@/components/NoteField";
import { PageSkeleton } from "@/components/Skeleton";
import PartialLoadNotice from "@/components/PartialLoadNotice";
import { createSectionLoader } from "@/lib/sectionLoader";
export const TIME_OFF_LABELS: Record<TimeOffType, string> = {
  pto: "PTO",
  sick: "Sick",
  holiday: "Holiday",
  other: "Other",
};

// Projects reuses Goals' status enum/styles — same shape (active/on_track/
// at_risk/completed/cancelled).
export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  active: "Active",
  on_track: "On track",
  at_risk: "At risk",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const GOAL_STATUS_STYLES: Record<GoalStatus, string> = {
  active: "bg-sunken text-ink-secondary",
  on_track: "bg-teal-50 text-teal-700",
  at_risk: "bg-amber-50 text-amber-700",
  completed: "bg-brand text-on-brand",
  cancelled: "bg-sunken text-ink-muted",
};

// Left-border accent per status — same vocabulary as /app/team's Session 24
// treatment (STATUS_BORDER there).
export const STATUS_BORDER: Record<GoalStatus, string> = {
  active: "border-control",
  on_track: "border-brand",
  at_risk: "border-amber-500",
  completed: "border-teal-800",
  cancelled: "border-hairline",
};

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

export function timeAgo(iso: string) {
  const d = daysSince(iso);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

// Local (not UTC) YYYY-MM-DD + N days — same helpers as /app/team, used here
// only to bound "this week" for the capacity KPI tile.
export function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysStr(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return localDateStr(dt);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function isOverdue(dueDate: string | null) {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate + "T00:00:00") < today;
}

export function ExpectationChips({ label, items }: { label: string; items: Expectation[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {items.map((e) => (
          <span
            key={e.id}
            title={e.expectation || e.description || undefined}
            className="rounded-full border border-hairline bg-canvas px-2.5 py-1 text-xs text-ink-body"
          >
            {expectationName(e)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assessment card — a small radial ring showing the current rating's
// position within the configured level scale, same inline-SVG technique
// /app/team's GoalsCard ring uses (no new charting dependency).
// ---------------------------------------------------------------------------

export function AssessmentCard({
  scorecard,
  reportId,
  hasExpectations,
}: {
  scorecard: Scorecard | null;
  reportId: string;
  hasExpectations: boolean;
}) {
  const maxOrdinal = scorecard && scorecard.levels.length > 0 ? Math.max(...scorecard.levels.map((l) => l.ordinal)) : 0;
  const pct =
    scorecard?.overall && maxOrdinal > 0 ? Math.round((scorecard.overall.level_ordinal / maxOrdinal) * 100) : null;
  const dash = `${pct ?? 0}, 100`;
  const label = scorecard?.overall
    ? scorecard.levels.find((l) => l.ordinal === scorecard.overall!.level_ordinal)?.label
    : null;

  return (
    <div className="rounded-xl border border-hairline bg-surface px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Assessment</p>
        <Link href={`/app/assessments/${reportId}`} className="text-xs text-ink-muted hover:text-ink-secondary">
          {scorecard?.overall ? "Assess again →" : "Assess now →"}
        </Link>
      </div>
      {scorecard?.overall ? (
        <div className="mt-3 flex items-center gap-4">
          <svg width="52" height="52" viewBox="0 0 36 36" className="shrink-0">
            <path
              d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831 15.9155 15.9155 0 0 1 0-31.831"
              fill="none"
              stroke={HEX.track}
              strokeWidth="3"
            />
            <path
              d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831 15.9155 15.9155 0 0 1 0-31.831"
              fill="none"
              stroke={HEX.brand}
              strokeWidth="3"
              strokeDasharray={dash}
              strokeLinecap="round"
            />
            <text x="18" y="21" textAnchor="middle" fontSize="8" fill={HEX.ink} fontWeight="600">
              {pct != null ? `${pct}%` : "–"}
            </text>
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{label}</p>
            <p className="text-xs text-ink-muted">Set {formatDate(scorecard.overall.created_at)}</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">
          Not yet assessed.{" "}
          <Link href={`/app/assessments/${reportId}`} className="underline hover:text-ink-secondary">
            {hasExpectations ? "Score against role expectations" : "Assess them"}
          </Link>
          .
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings drawer (Session 50) — 1:1 cadence + Capacity (contracted hours,
// target utilization, days off, time-off log). Verbatim forms lifted from
// the pre-rework page, just relocated behind the gear button per the
// person_page_redesign scoping call ("admin inputs move behind a settings
// gear/drawer — off the main page").
// ---------------------------------------------------------------------------

export function SettingsDrawer({
  onClose,
  orgCadenceDays,
  cadenceDays,
  setCadenceDays,
  savingCadence,
  cadenceSaved,
  saveCadence,
  capacitySettings,
  contractedHours,
  setContractedHours,
  utilizationPct,
  setUtilizationPct,
  offDaysPerYear,
  setOffDaysPerYear,
  savingCapacity,
  capacitySaved,
  saveCapacityProfile,
  timeOff,
  toStart,
  setToStart,
  toEnd,
  setToEnd,
  toType,
  setToType,
  addingTimeOff,
  addTimeOff,
  removeTimeOff,
}: {
  onClose: () => void;
  orgCadenceDays: number;
  cadenceDays: string;
  setCadenceDays: (v: string) => void;
  savingCadence: boolean;
  cadenceSaved: boolean;
  saveCadence: (e: React.FormEvent) => void;
  capacitySettings: CapacitySettings | null;
  contractedHours: string;
  setContractedHours: (v: string) => void;
  utilizationPct: string;
  setUtilizationPct: (v: string) => void;
  offDaysPerYear: string;
  setOffDaysPerYear: (v: string) => void;
  savingCapacity: boolean;
  capacitySaved: boolean;
  saveCapacityProfile: (e: React.FormEvent) => void;
  timeOff: TimeOffEntry[];
  toStart: string;
  setToStart: (v: string) => void;
  toEnd: string;
  setToEnd: (v: string) => void;
  toType: TimeOffType;
  setToType: (v: TimeOffType) => void;
  addingTimeOff: boolean;
  addTimeOff: (e: React.FormEvent) => void;
  removeTimeOff: (id: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-surface px-6 py-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Settings</h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-muted hover:text-ink-body">
            &times;
          </button>
        </div>

        {/* 1:1 cadence */}
        <div className="mt-6">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-muted">1:1 cadence</h3>
          <form onSubmit={saveCadence} className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Every N days</label>
              <input
                type="number"
                min={1}
                max={365}
                step={1}
                value={cadenceDays}
                onChange={(e) => setCadenceDays(e.target.value)}
                placeholder={`${orgCadenceDays} (org default)`}
                className="w-40 rounded-md border border-control px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={savingCadence}
              className="rounded-md bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50"
            >
              {savingCadence ? "Saving..." : "Save"}
            </button>
            {cadenceSaved && <span className="text-sm text-teal-700">Saved</span>}
          </form>
          <p className="mt-1.5 text-xs text-ink-muted">
            {cadenceDays.trim()
              ? `Currently every ${cadenceDays.trim()} days (custom).`
              : `Currently every ${orgCadenceDays} days (org default). Leave blank to keep inheriting it.`}
          </p>
        </div>

        {/* Capacity */}
        <div className="mt-8">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-muted">Capacity</h3>
            <Link href="/app/capacity" className="text-xs text-ink-muted hover:text-ink-secondary">
              View capacity →
            </Link>
          </div>
          <form onSubmit={saveCapacityProfile} className="mt-3 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Contracted hours / week</label>
              <input
                type="number"
                min={1}
                max={80}
                step={0.5}
                value={contractedHours}
                onChange={(e) => setContractedHours(e.target.value)}
                placeholder={capacitySettings ? `${capacitySettings.default_hours_per_week} (default)` : ""}
                className="w-full rounded-md border border-control px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Target utilization %</label>
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={utilizationPct}
                onChange={(e) => setUtilizationPct(e.target.value)}
                placeholder={capacitySettings ? `${capacitySettings.default_target_utilization_pct} (default)` : ""}
                className="w-full rounded-md border border-control px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Days off / year</label>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={offDaysPerYear}
                onChange={(e) => setOffDaysPerYear(e.target.value)}
                placeholder={capacitySettings ? `${capacitySettings.default_off_days_per_year} (default)` : ""}
                className="w-full rounded-md border border-control px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={savingCapacity}
                className="rounded-md bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50"
              >
                {savingCapacity ? "Saving..." : "Save"}
              </button>
              {capacitySaved && <span className="text-sm text-teal-700">Saved</span>}
            </div>
          </form>
          <p className="mt-1.5 text-xs text-ink-muted">Leave blank to use your Settings &gt; Operating defaults.</p>

          <div className="mt-5">
            <h4 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Time off{timeOff.length > 0 && ` (${timeOff.length})`}
            </h4>
            {timeOff.length === 0 ? (
              <p className="mt-2 text-sm text-ink-secondary">No time off logged.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {timeOff.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2 text-sm">
                    <span className="text-ink-body">
                      {formatDate(t.start_date + "T00:00:00")}
                      {t.end_date !== t.start_date && ` – ${formatDate(t.end_date + "T00:00:00")}`}
                      <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-ink-secondary">
                        {TIME_OFF_LABELS[t.type]}
                      </span>
                    </span>
                    <button onClick={() => removeTimeOff(t.id)} className="shrink-0 text-xs text-ink-muted hover:text-red-700">
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addTimeOff} className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-secondary">Start</label>
                <input
                  type="date"
                  value={toStart}
                  onChange={(e) => setToStart(e.target.value)}
                  className="rounded-md border border-control px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-secondary">End</label>
                <input
                  type="date"
                  value={toEnd}
                  onChange={(e) => setToEnd(e.target.value)}
                  className="rounded-md border border-control px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-secondary">Type</label>
                <select
                  value={toType}
                  onChange={(e) => setToType(e.target.value as TimeOffType)}
                  className="rounded-md border border-control px-2 py-1.5 text-sm"
                >
                  {(Object.keys(TIME_OFF_LABELS) as TimeOffType[]).map((t) => (
                    <option key={t} value={t}>
                      {TIME_OFF_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={addingTimeOff}
                className="rounded-md border border-control px-3 py-1.5 text-sm font-medium text-ink-body hover:bg-canvas"
              >
                {addingTimeOff ? "Adding..." : "Add"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Development (Session 47) — career aspiration, skill/knowledge
// opportunities (some traced back to a low assessment score via
// source_kind/source_config_id), training, and a private manager-notes log.
//
// Split into two mounts via `section`: "notes" renders the Private notes mode;
// "growth" renders the plan, aspiration, opportunities, and training inside
// Growth. State and handlers stay together so bundle mutation/refetch logic
// is not duplicated.
// ---------------------------------------------------------------------------

const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, string> = {
  skill: "Skill",
  knowledge: "Knowledge",
};

export function DevelopmentSection({
  section,
  directReportId,
  reportName,
  bundle,
  onRefresh,
}: {
  section: "notes" | "growth";
  directReportId: string;
  reportName: string;
  bundle: DevelopmentBundle;
  onRefresh: () => Promise<DevelopmentBundle>;
}) {
  const [error, setError] = useState<string | null>(null);

  // Aspiration — single upserted row.
  const [editingAspiration, setEditingAspiration] = useState(false);
  const [desiredRole, setDesiredRole] = useState(bundle.aspiration?.desired_role ?? "");
  const [timeline, setTimeline] = useState(bundle.aspiration?.timeline ?? "");
  const [aspirationNotes, setAspirationNotes] = useState(bundle.aspiration?.notes ?? "");
  const [savingAspiration, setSavingAspiration] = useState(false);

  // Opportunities.
  const [newOppType, setNewOppType] = useState<OpportunityType>("skill");
  const [newOppDescription, setNewOppDescription] = useState("");
  const [addingOpp, setAddingOpp] = useState(false);
  const [removingOppId, setRemovingOppId] = useState<string | null>(null);

  // Training.
  const [newTrainingDesc, setNewTrainingDesc] = useState("");
  const [newTrainingDate, setNewTrainingDate] = useState("");
  const [newTrainingCost, setNewTrainingCost] = useState("");
  const [addingTraining, setAddingTraining] = useState(false);
  const [removingTrainingId, setRemovingTrainingId] = useState<string | null>(null);

  // Development plan — the primary, always-writable narrative (Session 49).
  const [planText, setPlanText] = useState(bundle.development_plan.plan_text ?? "");
  const [savingPlan, setSavingPlan] = useState(false);
  const [revisingPlan, setRevisingPlan] = useState(false);
  const planDirty = planText.trim() !== (bundle.development_plan.plan_text ?? "").trim();

  // Manager notes — append-only, private, not shared with the report.
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [revisingNote, setRevisingNote] = useState(false);

  // AI assist (Session 48/49 follow-ups).
  const [drafting, setDrafting] = useState(false);
  const [aiOpportunities, setAiOpportunities] = useState<DevelopmentDraft["opportunities"]>([]);
  const [aiPlanSuggestion, setAiPlanSuggestion] = useState<string | null>(null);
  const [draftHint, setDraftHint] = useState<string | null>(null);
  const [addingAiOppIndex, setAddingAiOppIndex] = useState<number | null>(null);

  const existingSourceIds = new Set(
    bundle.opportunities.map((o) => o.source_config_id).filter(Boolean) as string[]
  );

  function startEditingAspiration() {
    setDesiredRole(bundle.aspiration?.desired_role ?? "");
    setTimeline(bundle.aspiration?.timeline ?? "");
    setAspirationNotes(bundle.aspiration?.notes ?? "");
    setEditingAspiration(true);
  }

  async function saveAspiration(e: React.FormEvent) {
    e.preventDefault();
    setSavingAspiration(true);
    try {
      await upsertAspiration(directReportId, {
        desired_role: desiredRole.trim() || null,
        timeline: timeline.trim() || null,
        notes: aspirationNotes.trim() || null,
      });
      await onRefresh();
      setEditingAspiration(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save aspiration");
    } finally {
      setSavingAspiration(false);
    }
  }

  async function addOpportunity(
    description: string,
    type: OpportunityType,
    sourceKind: "skill" | "value" | null = null,
    sourceConfigId: string | null = null
  ) {
    const trimmed = description.trim();
    if (!trimmed || addingOpp) return;
    setAddingOpp(true);
    try {
      await createOpportunity(directReportId, {
        type,
        description: trimmed,
        source_kind: sourceKind,
        source_config_id: sourceConfigId,
      });
      await onRefresh();
      setNewOppDescription("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add opportunity");
    } finally {
      setAddingOpp(false);
    }
  }

  async function removeOpportunity(id: string) {
    setRemovingOppId(id);
    try {
      await deleteOpportunity(id);
      await onRefresh();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove opportunity");
    } finally {
      setRemovingOppId(null);
    }
  }

  async function addTraining(e: React.FormEvent) {
    e.preventDefault();
    const desc = newTrainingDesc.trim();
    if (!desc || addingTraining) return;
    setAddingTraining(true);
    try {
      await createTraining(directReportId, {
        description: desc,
        completion_date: newTrainingDate || null,
        projected_cost: newTrainingCost.trim() ? parseFloat(newTrainingCost) : null,
      });
      await onRefresh();
      setNewTrainingDesc("");
      setNewTrainingDate("");
      setNewTrainingCost("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add training");
    } finally {
      setAddingTraining(false);
    }
  }

  async function markTrainingComplete(trainingId: string) {
    try {
      await updateTraining(trainingId, { completion_date: new Date().toISOString().slice(0, 10) });
      await onRefresh();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update training");
    }
  }

  async function removeTraining(id: string) {
    setRemovingTrainingId(id);
    try {
      await deleteTraining(id);
      await onRefresh();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove training");
    } finally {
      setRemovingTrainingId(null);
    }
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    const content = newNote.trim();
    if (!content || addingNote) return;
    setAddingNote(true);
    try {
      await createDevManagerNote(directReportId, content);
      await onRefresh();
      setNewNote("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add note");
    } finally {
      setAddingNote(false);
    }
  }

  async function savePlanText() {
    setSavingPlan(true);
    try {
      await updateDevPlanText(directReportId, planText.trim() || null);
      await onRefresh();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save development plan");
    } finally {
      setSavingPlan(false);
    }
  }

  async function revisePlanText() {
    const text = planText.trim();
    if (!text || revisingPlan) return;
    setRevisingPlan(true);
    try {
      const result = await reviseDevText(directReportId, text);
      setPlanText(result.note);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revise with AI");
    } finally {
      setRevisingPlan(false);
    }
  }

  function usePlanSuggestion() {
    if (aiPlanSuggestion) {
      setPlanText(aiPlanSuggestion);
      setAiPlanSuggestion(null);
    }
  }

  async function runDraft() {
    setDrafting(true);
    setDraftHint(null);
    try {
      const d = await draftDevelopment(directReportId);
      const freshOpps = d.opportunities.filter(
        (o) => !(o.source_config_id && existingSourceIds.has(o.source_config_id))
      );
      setAiOpportunities(freshOpps);
      setAiPlanSuggestion(d.plan_note);
      if (freshOpps.length === 0 && !d.plan_note) {
        setDraftHint("Not enough evidence yet for a draft — write your own below, or add more 1:1 history and assessment scores first.");
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to draft with AI");
    } finally {
      setDrafting(false);
    }
  }

  async function addAiOpportunity(index: number) {
    const o = aiOpportunities[index];
    if (!o) return;
    setAddingAiOppIndex(index);
    try {
      await createOpportunity(directReportId, {
        type: o.type,
        description: o.description,
        source_kind: o.source_kind,
        source_config_id: o.source_config_id,
      });
      await onRefresh();
      setAiOpportunities((list) => list.filter((_, i) => i !== index));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add opportunity");
    } finally {
      setAddingAiOppIndex(null);
    }
  }

  async function reviseNote() {
    const text = newNote.trim();
    if (!text || revisingNote) return;
    setRevisingNote(true);
    try {
      const result = await reviseDevText(directReportId, text);
      setNewNote(result.note);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revise with AI");
    } finally {
      setRevisingNote(false);
    }
  }

  // -------------------------------------------------------------------------
  // "notes" section — persistent manager-only notes. Privacy is a context,
  // not an attention state, so this stays on the neutral surface vocabulary.
  // -------------------------------------------------------------------------
  if (section === "notes") {
    return (
      <div className="rounded-xl border border-hairline bg-surface px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Private notes{bundle.manager_notes.length > 0 && ` (${bundle.manager_notes.length})`}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-ink">Your manager notebook</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Only you can see these. They stay on {reportName.split(" ")[0]}&apos;s page and are not automatically included in the next 1:1.
        </p>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

        {bundle.manager_notes.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">No private notes yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 max-h-56 overflow-y-auto pr-1">
            {bundle.manager_notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-divider bg-sunken px-3 py-2">
                <p className="text-sm text-ink-body">{n.content}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{formatDate(n.created_at)}</p>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addNote} className="mt-3">
          <NoteField
            value={newNote}
            onChange={setNewNote}
            rows={2}
            placeholder="Write a private note..."
            className="text-sm"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={reviseNote}
              disabled={!newNote.trim() || revisingNote}
              className="rounded-md border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            >
              {revisingNote ? "Revising..." : "Revise with AI"}
            </button>
            <button
              type="submit"
              disabled={addingNote}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-on-brand hover:bg-brand-hover disabled:opacity-50"
            >
              {addingNote ? "Saving..." : "Save private note"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // "growth" section — plan text, aspiration, opportunities, and training
  // -------------------------------------------------------------------------
  return (
    <div className="rounded-xl border border-hairline bg-surface px-4 py-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Development</p>
        <button
          onClick={runDraft}
          disabled={drafting}
          className="text-xs text-ink-muted hover:text-ink-secondary disabled:opacity-50"
        >
          {drafting ? "Drafting..." : "Draft with AI →"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      {/* Development plan */}
      <div className="mt-3">
        {aiPlanSuggestion && (
          <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2">
            <p className="text-xs font-medium text-blue-600">AI suggested</p>
            <p className="mt-1 text-sm text-blue-800">{aiPlanSuggestion}</p>
            <div className="mt-2 flex gap-3">
              <button onClick={usePlanSuggestion} className="text-xs font-medium text-blue-700 hover:text-blue-900">
                Use this
              </button>
              <button onClick={() => setAiPlanSuggestion(null)} className="text-xs text-blue-400 hover:text-blue-600">
                Dismiss
              </button>
            </div>
          </div>
        )}
        <NoteField
          value={planText}
          onChange={setPlanText}
          rows={3}
          placeholder={`Write ${reportName.split(" ")[0]}'s development plan — growth focus, what's next, whatever's useful...`}
          className="text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={savePlanText}
            disabled={savingPlan || !planDirty}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-on-brand disabled:opacity-50"
          >
            {savingPlan ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={revisePlanText}
            disabled={!planText.trim() || revisingPlan}
            className="rounded-md border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            {revisingPlan ? "Revising..." : "Revise with AI"}
          </button>
          {draftHint && <span className="text-xs text-ink-muted">{draftHint}</span>}
        </div>
      </div>

      {/* Aspiration */}
      <div className="mt-4 border-t border-divider pt-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Career aspiration</p>
          {!editingAspiration && (
            <button onClick={startEditingAspiration} className="text-xs text-ink-muted hover:text-ink-secondary">
              {bundle.aspiration ? "Edit" : "Add"}
            </button>
          )}
        </div>
        {editingAspiration ? (
          <form onSubmit={saveAspiration} className="mt-2 space-y-2">
            <input
              type="text"
              value={desiredRole}
              onChange={(e) => setDesiredRole(e.target.value)}
              placeholder="Desired role"
              className="w-full rounded-md border border-control px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={timeline}
              onChange={(e) => setTimeline(e.target.value)}
              placeholder="Timeline (e.g. 12-18 months)"
              className="w-full rounded-md border border-control px-3 py-2 text-sm"
            />
            <NoteField
              value={aspirationNotes}
              onChange={setAspirationNotes}
              rows={2}
              placeholder="Notes"
              className="text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingAspiration(false)}
                className="rounded-md border border-hairline px-3 py-1.5 text-xs text-ink-secondary hover:bg-canvas"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingAspiration}
                className="rounded-md bg-brand px-3 py-1.5 text-xs text-on-brand disabled:opacity-50"
              >
                {savingAspiration ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        ) : bundle.aspiration && (bundle.aspiration.desired_role || bundle.aspiration.timeline || bundle.aspiration.notes) ? (
          <div className="mt-2 rounded-lg border border-hairline px-3 py-2">
            {bundle.aspiration.desired_role && <p className="text-sm font-medium text-ink">{bundle.aspiration.desired_role}</p>}
            {bundle.aspiration.timeline && <p className="mt-0.5 text-xs text-ink-muted">{bundle.aspiration.timeline}</p>}
            {bundle.aspiration.notes && <p className="mt-1.5 text-sm text-ink-body">{bundle.aspiration.notes}</p>}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">No aspiration on record yet.</p>
        )}
      </div>

      {/* Opportunities */}
      <div className="mt-4 border-t border-divider pt-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          Opportunities{bundle.opportunities.length > 0 && ` (${bundle.opportunities.length})`}
        </p>

        {bundle.low_scoring_items.filter((it) => !existingSourceIds.has(it.config_id)).length > 0 && (
          <div className="mt-2 space-y-1.5">
            {bundle.low_scoring_items
              .filter((it) => !existingSourceIds.has(it.config_id))
              .map((it) => (
                <div key={it.config_id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
                  <p className="text-xs text-amber-800">
                    Suggested: <span className="font-medium">{it.name}</span> scored {it.evaluation_point}/{it.scale_max}
                  </p>
                  <button
                    onClick={() =>
                      addOpportunity(
                        `Improve ${it.name.toLowerCase()} (scored ${it.evaluation_point}/${it.scale_max} on last assessment).`,
                        "skill",
                        it.kind,
                        it.config_id
                      )
                    }
                    disabled={addingOpp}
                    className="shrink-0 rounded-md border border-amber-300 bg-surface px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              ))}
          </div>
        )}

        {aiOpportunities.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {aiOpportunities.map((o, i) => (
              <div key={`${o.description}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2">
                <p className="text-xs text-blue-800">
                  <span className="mr-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-600">AI</span>
                  {o.description}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => addAiOpportunity(i)}
                    disabled={addingAiOppIndex === i}
                    className="rounded-md border border-blue-300 bg-surface px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                  >
                    {addingAiOppIndex === i ? "Adding..." : "Add"}
                  </button>
                  <button
                    onClick={() => setAiOpportunities((list) => list.filter((_, idx) => idx !== i))}
                    className="text-xs text-blue-400 hover:text-blue-600"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {bundle.opportunities.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No opportunities logged yet.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {bundle.opportunities.map((o) => (
              <li key={o.id} className="flex items-center gap-1.5 rounded-full border border-hairline bg-canvas px-2.5 py-1 text-xs text-ink-body">
                <span className="text-ink-muted">{OPPORTUNITY_TYPE_LABELS[o.type]}</span>
                {o.description}
                <button
                  onClick={() => removeOpportunity(o.id)}
                  disabled={removingOppId === o.id}
                  className="text-ink-faint hover:text-red-700"
                  aria-label="Remove opportunity"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            addOpportunity(newOppDescription, newOppType);
          }}
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          <select
            value={newOppType}
            onChange={(e) => setNewOppType(e.target.value as OpportunityType)}
            className="rounded-md border border-control px-2 py-1.5 text-xs"
          >
            <option value="skill">Skill</option>
            <option value="knowledge">Knowledge</option>
          </select>
          <input
            type="text"
            value={newOppDescription}
            onChange={(e) => setNewOppDescription(e.target.value)}
            placeholder="Describe the opportunity"
            className="min-w-[12rem] flex-1 rounded-md border border-control px-3 py-1.5 text-xs"
          />
          <button
            type="submit"
            disabled={addingOpp}
            className="rounded-md border border-control px-3 py-1.5 text-xs font-medium text-ink-body hover:bg-canvas disabled:opacity-50"
          >
            {addingOpp ? "Adding..." : "Add"}
          </button>
        </form>
      </div>

      {/* Training */}
      <div className="mt-4 border-t border-divider pt-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          Training{bundle.training.length > 0 && ` (${bundle.training.length})`}
        </p>
        {bundle.training.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No training logged yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {bundle.training.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 rounded-lg border border-hairline px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-ink-body">{t.description}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {t.completion_date ? `Completed ${formatDate(t.completion_date + "T00:00:00")}` : "Not yet completed"}
                    {t.projected_cost != null && ` · $${t.projected_cost.toLocaleString()}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {!t.completion_date && (
                    <button onClick={() => markTrainingComplete(t.id)} className="text-xs text-ink-muted hover:text-ink-secondary">
                      Mark complete
                    </button>
                  )}
                  <button
                    onClick={() => removeTraining(t.id)}
                    disabled={removingTrainingId === t.id}
                    className="text-xs text-ink-muted hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addTraining} className="mt-3 flex flex-wrap items-end gap-2">
          <input
            type="text"
            value={newTrainingDesc}
            onChange={(e) => setNewTrainingDesc(e.target.value)}
            placeholder="Training / course"
            className="min-w-[12rem] flex-1 rounded-md border border-control px-3 py-1.5 text-xs"
          />
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">Target date</label>
            <input
              type="date"
              value={newTrainingDate}
              onChange={(e) => setNewTrainingDate(e.target.value)}
              className="rounded-md border border-control px-2 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">Est. cost</label>
            <input
              type="number"
              min={0}
              step={1}
              value={newTrainingCost}
              onChange={(e) => setNewTrainingCost(e.target.value)}
              className="w-24 rounded-md border border-control px-2 py-1.5 text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={addingTraining}
            className="rounded-md border border-control px-3 py-1.5 text-xs font-medium text-ink-body hover:bg-canvas disabled:opacity-50"
          >
            {addingTraining ? "Adding..." : "Add"}
          </button>
        </form>
      </div>
    </div>
  );
}
