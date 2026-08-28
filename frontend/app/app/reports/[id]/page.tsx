"use client";

// ---------------------------------------------------------------------------
// Person Page "Relationship Desk" — the relationship and its next conversation
// lead; work records support them instead of competing as dashboard tiles.
//
// Layout, top to bottom:
//   1. Identity and relationship rhythm, with the normal Review/Start flow and
//      a secondary Log a 1:1 path for meetings that happened without prep.
//   2. Next conversation beside live follow-through, both always visible.
//   3. Four explicit context modes: Work, Growth (including assessment and
//      expectations), History, and Private notes.
//
// Capture notes are temporary inputs to the next preparation. Private notes are
// persistent, manager-only records and never flow into prep automatically.
// Completed summaries and resolved commitments live in History.
// ---------------------------------------------------------------------------

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

const TIME_OFF_LABELS: Record<TimeOffType, string> = {
  pto: "PTO",
  sick: "Sick",
  holiday: "Holiday",
  other: "Other",
};

// Projects reuses Goals' status enum/styles — same shape (active/on_track/
// at_risk/completed/cancelled).
const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  active: "Active",
  on_track: "On track",
  at_risk: "At risk",
  completed: "Completed",
  cancelled: "Cancelled",
};

const GOAL_STATUS_STYLES: Record<GoalStatus, string> = {
  active: "bg-sunken text-ink-secondary",
  on_track: "bg-teal-50 text-teal-700",
  at_risk: "bg-amber-50 text-amber-700",
  completed: "bg-brand text-on-brand",
  cancelled: "bg-sunken text-ink-muted",
};

// Left-border accent per status — same vocabulary as /app/team's Session 24
// treatment (STATUS_BORDER there).
const STATUS_BORDER: Record<GoalStatus, string> = {
  active: "border-control",
  on_track: "border-brand",
  at_risk: "border-amber-500",
  completed: "border-blue-300",
  cancelled: "border-hairline",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function timeAgo(iso: string) {
  const d = daysSince(iso);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

// Local (not UTC) YYYY-MM-DD + N days — same helpers as /app/team, used here
// only to bound "this week" for the capacity KPI tile.
function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysStr(dateStr: string, days: number) {
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

function isOverdue(dueDate: string | null) {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate + "T00:00:00") < today;
}

function ExpectationChips({ label, items }: { label: string; items: Expectation[] }) {
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

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { setPageContext } = useDrawer();
  const [report, setReport] = useState<DirectReport | null>(null);
  const [history, setHistory] = useState<OneOnOne[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Settings drawer (Session 50) — admin inputs (cadence, capacity, time
  // off) moved off the main page per the person_page_redesign scoping call.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Capacity (Session 14) — per-person override of the org baseline, plus
  // this person's time off log. Read surface + edit both live in the
  // settings drawer now; there's no separate "manage capacity" page for a
  // single person the way Goals/Projects have one.
  const [capacitySettings, setCapacitySettings] = useState<CapacitySettings | null>(null);
  const [contractedHours, setContractedHours] = useState<string>("");
  const [utilizationPct, setUtilizationPct] = useState<string>("");
  const [offDaysPerYear, setOffDaysPerYear] = useState<string>("");
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [capacitySaved, setCapacitySaved] = useState(false);
  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([]);
  const [addingTimeOff, setAddingTimeOff] = useState(false);
  const [toStart, setToStart] = useState("");
  const [toEnd, setToEnd] = useState("");
  const [toType, setToType] = useState<TimeOffType>("pto");
  // This week's resolved capacity (Session 50 KPI tile) — one query against
  // the same overview endpoint /app/capacity uses, filtered to this report.
  const [capacityOverview, setCapacityOverview] = useState<CapacityOverviewItem[]>([]);

  // Assessments (Session 16) — read-only summary here; scoring happens on
  // the dedicated scorecard page, same "summary here, edit there" pattern
  // as Goals/Projects.
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);

  // Development (Session 47) — full inline CRUD here, same depth as
  // Capacity above, since this feature has no dedicated page of its own
  // (Andrew's scoping call: DR-detail-section-only placement). Session 50
  // splits its render across the Private notes and Growth context modes.
  const [devBundle, setDevBundle] = useState<DevelopmentBundle | null>(null);

  // 1:1 cadence override (nav rework pass 2, Session 38) — same "blank
  // means inherit the org default" pattern as the Capacity fields above.
  const [orgCadenceDays, setOrgCadenceDays] = useState<number>(21);
  const [cadenceDays, setCadenceDays] = useState<string>("");
  const [savingCadence, setSavingCadence] = useState(false);
  const [cadenceSaved, setCadenceSaved] = useState(false);

  // Inline "assign a role" picker (Session 42, Plan S4+S5) — the
  // Expectations block always renders now, even before a role is assigned,
  // so a manager can wire this person up without leaving the page.
  const [roleLevels, setRoleLevels] = useState<RoleLevel[]>([]);
  const [roleFamilies, setRoleFamilies] = useState<RoleFamily[]>([]);
  const [assigningRole, setAssigningRole] = useState(false);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);

  // Capture notes — one source in the next-meeting workspace. /prep prefills
  // from and clears this list after successful agenda generation; carry-forward
  // topics live on the unfinished one_on_ones occurrence instead.
  const [captures, setCaptures] = useState<CaptureNote[]>([]);
  const [newCapture, setNewCapture] = useState("");
  const [savingCapture, setSavingCapture] = useState(false);
  const [deletingCaptureId, setDeletingCaptureId] = useState<string | null>(null);
  const [activeContext, setActiveContext] = useState<"work" | "growth" | "history" | "private">("history");

  // Clear page context when leaving this page so it doesn't bleed into
  // other pages that don't know which report was being viewed.
  useEffect(() => {
    return () => setPageContext(null);
  }, [setPageContext]);

  useEffect(() => {
    const today = localDateStr();
    const weekEnd = addDaysStr(today, 6);
    Promise.all([
      getDirectReport(id),
      getOneOnOneHistory(id),
      getCommitments({ directReportId: id }),
      getGoals({ directReportId: id }),
      getProjects({ directReportId: id }),
      getCapacityProfile(id),
      getCapacitySettings(),
      getCapacityOverview(today, weekEnd),
      getTimeOff(id),
      getScorecard(id),
      getProfile(),
      getRoleLevels(),
      getRoleFamilies(),
      getOrgUnits(),
      getDevelopmentPlan(id),
      getCaptureNotes(id),
    ])
      .then(([dr, h, c, g, p, cp, cs, cov, to, sc, prof, rls, rfs, ous, dev, caps]) => {
        setReport(dr);
        setPageContext(`${dr.name}'s direct report page`);
        setHistory(h);
        setCommitments(c);
        setGoals(g);
        setProjects(p);
        setContractedHours(cp.contracted_hours_per_week?.toString() ?? "");
        setUtilizationPct(cp.target_utilization_pct?.toString() ?? "");
        setOffDaysPerYear(cp.off_days_per_year?.toString() ?? "");
        setCapacitySettings(cs);
        setCapacityOverview(cov);
        setTimeOff(to);
        setScorecard(sc);
        setOrgCadenceDays(prof.one_on_one_cadence_days);
        setCadenceDays(dr.one_on_one_cadence_days != null ? String(dr.one_on_one_cadence_days) : "");
        setRoleLevels(rls);
        setRoleFamilies(rfs);
        setOrgUnits(ous);
        setDevBundle(dev);
        setCaptures(caps);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Every Development mutation refetches the bundle rather than hand-
  // patching local state — same "re-fetch after write" posture as
  // assignRole below.
  async function refreshDevBundle() {
    const fresh = await getDevelopmentPlan(id);
    setDevBundle(fresh);
    return fresh;
  }

  // Assigns a role right from this page (Session 42, Plan S4+S5) — preserves
  // org_unit_id/cadence via assignReportRole, same invariant PeopleSection's
  // picker relies on.
  async function assignRole(roleLevelId: string) {
    if (!report || assigningRole) return;
    setAssigningRole(true);
    try {
      await assignReportRole(report.id, report, roleLevelId || null);
      const fresh = await getDirectReport(report.id);
      setReport(fresh);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to assign role");
    } finally {
      setAssigningRole(false);
    }
  }

  async function saveCadence(e: React.FormEvent) {
    e.preventDefault();
    if (!report) return;
    setSavingCadence(true);
    setCadenceSaved(false);
    try {
      const parsed = cadenceDays.trim() ? parseInt(cadenceDays, 10) : null;
      const updated = await assignReportCadence(id, report, parsed);
      setReport(updated);
      setCadenceDays(updated.one_on_one_cadence_days != null ? String(updated.one_on_one_cadence_days) : "");
      setCadenceSaved(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save 1:1 cadence");
    } finally {
      setSavingCadence(false);
    }
  }

  async function saveCapacityProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingCapacity(true);
    setCapacitySaved(false);
    try {
      await setCapacityProfile(id, {
        contracted_hours_per_week: contractedHours.trim() ? parseFloat(contractedHours) : null,
        target_utilization_pct: utilizationPct.trim() ? parseFloat(utilizationPct) : null,
        off_days_per_year: offDaysPerYear.trim() ? parseFloat(offDaysPerYear) : null,
      });
      setCapacitySaved(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save capacity");
    } finally {
      setSavingCapacity(false);
    }
  }

  async function addTimeOff(e: React.FormEvent) {
    e.preventDefault();
    if (!toStart || !toEnd || addingTimeOff) return;
    setAddingTimeOff(true);
    try {
      const created = await createTimeOff({ direct_report_id: id, start_date: toStart, end_date: toEnd, type: toType });
      setTimeOff((ts) => [created, ...ts]);
      setToStart("");
      setToEnd("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add time off");
    } finally {
      setAddingTimeOff(false);
    }
  }

  async function removeTimeOff(entryId: string) {
    try {
      await deleteTimeOff(entryId);
      setTimeOff((ts) => ts.filter((t) => t.id !== entryId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove time off");
    }
  }

  async function setStatus(commitmentId: string, status: Commitment["status"]) {
    setUpdatingId(commitmentId);
    try {
      const updated = await updateCommitment(commitmentId, status);
      setCommitments((cs) => cs.map((c) => (c.id === commitmentId ? { ...c, ...updated } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update commitment");
    } finally {
      setUpdatingId(null);
    }
  }

  async function saveCapture() {
    const content = newCapture.trim();
    if (!content || savingCapture) return;
    setSavingCapture(true);
    try {
      const created = await createCaptureNote(id, content);
      setCaptures((cs) => [created, ...cs]);
      setNewCapture("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save capture");
    } finally {
      setSavingCapture(false);
    }
  }

  async function removeCapture(captureId: string) {
    setDeletingCaptureId(captureId);
    try {
      await deleteCaptureNote(captureId);
      setCaptures((cs) => cs.filter((c) => c.id !== captureId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove capture");
    } finally {
      setDeletingCaptureId(null);
    }
  }

  if (loading) return <p className="p-8 text-ink-secondary">Loading...</p>;
  if (error && !report) return <p className="p-8 text-red-700">{error}</p>;
  if (!report) return null;

  const open = commitments.filter((c) => c.status === "open");
  const resolved = commitments.filter((c) => c.status !== "open");
  // Most-recent unfinished occurrence — scheduled or already prepped.
  const plannedSession = history.find((h) => h.status !== "completed");
  const lastCompleted = history.find((h) => h.status === "completed");
  // This is historical evidence, not a second home for the next workspace.
  // Status is derived server-side from summary being set, so completed is the
  // canonical definition of a meeting that actually happened and was logged.
  const completedHistory = history.filter((session) => session.status === "completed");

  const roleLevel = roleLevels.find((r) => r.id === report.role_level_id);
  const orgUnit = orgUnits.find((u) => u.id === report.org_unit_id);
  const ratingLabel = scorecard?.overall
    ? scorecard.levels.find((l) => l.ordinal === scorecard.overall!.level_ordinal)?.label
    : null;

  // KPI tile 1 — last 1:1 + days to next, resolved cadence same as the old
  // 1:1 cadence section's honesty convention (custom override, else org
  // default).
  const resolvedCadence = cadenceDays.trim() ? parseInt(cadenceDays, 10) : orgCadenceDays;
  // The meeting date, never row creation: this header used to disagree with
  // the History list a few hundred lines below about the same conversation.
  const daysSinceLast = lastCompleted?.meeting_date ? daysSince(lastCompleted.meeting_date) : null;
  const daysUntilNext = daysSinceLast != null ? resolvedCadence - daysSinceLast : null;

  const capacityItem = capacityOverview.find((c) => c.direct_report_id === id);

  const activeProjects = projects.filter((p) => p.status === "active" || p.status === "on_track" || p.status === "at_risk");

  const worthRaising = deriveOneOnOneSuggestions({
    goals,
    planText: devBundle?.development_plan.plan_text,
  });

  return (
    <PageShell maxWidth="7xl">
      {/* Relationship header — identity, current rhythm, and the two legitimate
          ways to record a 1:1. The gradient remains the page's one feature
          surface; the dashboard-style KPI strip is deliberately gone. */}
      <div className={`${FEATURE_SURFACE} px-6 py-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-tint text-lg font-semibold text-brand">
              {initials(report.name)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-ink">{report.name}</h1>
                {ratingLabel && (
                  <span className="rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-ink-body">{ratingLabel}</span>
                )}
              </div>
              {(roleLevel || orgUnit || report.role_title) && (
                <p className="mt-1 text-sm text-ink-secondary">
                  {roleLevel ? roleLabel(roleLevel) : report.role_title ?? "No role assigned"}
                  {orgUnit && ` · ${orgUnitLabel(orgUnit)}`}
                </p>
              )}
              {report.notes && <p className="mt-1 text-sm text-ink-muted">{report.notes}</p>}
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                <span>Last met <strong className="font-medium text-ink-body">{lastCompleted?.meeting_date ? timeAgo(lastCompleted.meeting_date) : "not yet"}</strong></span>
                <span>
                  Next {plannedSession?.scheduled_at ? (
                    <strong className="font-medium text-ink-body">{formatDate(plannedSession.scheduled_at)}</strong>
                  ) : daysUntilNext != null ? (
                    <strong className={daysUntilNext < 0 ? "font-medium text-amber-700" : "font-medium text-ink-body"}>
                      {daysUntilNext > 0 ? `due in ${daysUntilNext}d` : daysUntilNext === 0 ? "due today" : `${Math.abs(daysUntilNext)}d overdue`}
                    </strong>
                  ) : (
                    <strong className="font-medium text-ink-body">not scheduled</strong>
                  )}
                </span>
                <span><strong className="font-medium text-ink-body">{open.length}</strong> open commitment{open.length === 1 ? "" : "s"}</span>
                <span><strong className="font-medium text-ink-body">{capacityItem ? `${Math.round(capacityItem.available_hours)}h` : "—"}</strong> available this week</span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Cadence, capacity & time off"
              className={BTN_GHOST}
            >
              Settings
            </button>
            <Link
              href={`/app/reports/${id}/log`}
              className={`${BTN_SECONDARY} px-4 py-2`}
            >
              Log a 1:1
            </Link>
            <Link
              href={
                plannedSession?.status === "planned"
                  ? `/app/reports/${id}/prep?resume=${plannedSession.id}`
                  : `/app/reports/${id}/prep`
              }
              className={`${BTN_PRIMARY} whitespace-nowrap`}
            >
              {plannedSession?.status === "planned"
                ? "Start 1:1 →"
                : "Review & prepare →"}
            </Link>
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      {/* Relationship desk: next conversation + follow-through stay visible;
          the lower context modes separate work, growth, history and private notes. */}
      <div className={`${SECTION_GAP} grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,.85fr)]`}>
        <div className="contents">
          <section className="order-1 rounded-xl border border-hairline bg-surface px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Next conversation</p>
                <h2 className="mt-1 text-xl font-semibold text-ink">
                  {plannedSession?.status === "planned"
                    ? `Ready for ${plannedSession.scheduled_at ? formatDate(plannedSession.scheduled_at) : "the next 1:1"}`
                    : `What is gathering for ${plannedSession?.scheduled_at ? formatDate(plannedSession.scheduled_at) : "the next 1:1"}`}
                </h2>
              </div>
              <Link
                href={
                  plannedSession?.status === "planned"
                    ? `/app/reports/${id}/prep?resume=${plannedSession.id}&edit=1`
                    : `/app/reports/${id}/prep`
                }
                className="text-xs font-medium text-brand hover:text-brand-hover"
              >
                {plannedSession?.status === "planned"
                  ? "Edit prep →"
                  : "Review sources →"}
              </Link>
            </div>
            {plannedSession?.scheduled_at && (
              <p className="mt-1 text-sm font-medium text-ink-body">
                {formatDate(plannedSession.scheduled_at)}
                {plannedSession.recurrence_weeks &&
                  ` · every ${plannedSession.recurrence_weeks} week${plannedSession.recurrence_weeks === 1 ? "" : "s"}`}
              </p>
            )}
            <p className="mt-1 text-xs text-ink-muted">
              Context gathers here automatically. Review it before the agenda is built.
            </p>
            <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-[11px] font-medium" aria-label="1:1 workflow">
              <li className={`flex items-center gap-1.5 ${plannedSession?.status === "planned" ? "text-ink-muted" : "text-brand"}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${plannedSession?.status === "planned" ? "border-control bg-sunken" : "border-brand bg-brand-tint"}`}>1</span>
                Review & prepare
              </li>
              <li aria-hidden="true" className="text-ink-faint">→</li>
              <li className={`flex items-center gap-1.5 ${plannedSession?.status === "planned" ? "text-brand" : "text-ink-muted"}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${plannedSession?.status === "planned" ? "border-brand bg-brand-tint" : "border-control bg-sunken"}`}>2</span>
                Start 1:1
              </li>
              <li aria-hidden="true" className="text-ink-faint">→</li>
              <li className="flex items-center gap-1.5 text-ink-muted">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-control bg-sunken">3</span>
                Wrap up & log
              </li>
            </ol>

            {(plannedSession?.carry_forward_items.length ?? 0) > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Carried forward</p>
                <ul className="mt-2 space-y-1.5">
                  {plannedSession!.carry_forward_items.map((item, index) => (
                    <li key={index} className="flex gap-2 text-sm text-ink-body">
                      <span className="text-ink-faint">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {worthRaising.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Suggested topics</p>
                <ul className="mt-2 space-y-2">
                  {worthRaising.map((item) => (
                    <li key={item.key} className="rounded-lg border border-divider bg-canvas/60 px-3 py-2 text-sm text-ink-body">
                      {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {captures.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Notes you captured</p>
                <ul className="mt-2 space-y-1.5">
                  {captures.map((capture) => (
                    <li key={capture.id} className="flex items-start justify-between gap-2 text-xs text-ink-secondary">
                      <span className="min-w-0">
                        <span className="text-ink-muted">{timeAgo(capture.created_at)} — </span>
                        {capture.content}
                      </span>
                      <button
                        onClick={() => removeCapture(capture.id)}
                        disabled={deletingCaptureId === capture.id}
                        className="shrink-0 text-ink-faint hover:text-red-700"
                        aria-label="Remove captured note"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {worthRaising.length === 0 && captures.length === 0 && (plannedSession?.carry_forward_items.length ?? 0) === 0 && (
              <p className="mt-3 text-sm text-ink-muted">Nothing gathered yet.</p>
            )}

            <div className="mt-4 border-t border-divider pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Keep for next time</p>
              <textarea
                value={newCapture}
                onChange={(e) => setNewCapture(e.target.value)}
                rows={2}
                placeholder="Anything worth remembering for the next 1:1..."
                className="mt-2 w-full rounded-md border border-control bg-sunken px-3 py-2 text-sm text-ink placeholder-ink-faint"
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={saveCapture}
                  disabled={savingCapture || !newCapture.trim()}
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-on-brand disabled:opacity-50"
                >
                  {savingCapture ? "Saving..." : "Keep note"}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-ink-muted">
                Saved notes are included automatically when you review the next 1:1.
              </p>
            </div>
          </section>

          {devBundle && (
            <div className={activeContext === "private" ? "order-5 lg:col-span-2" : "hidden"} role="tabpanel" id="context-private">
              <DevelopmentSection
                section="notes"
                directReportId={id}
                reportName={report.name}
                bundle={devBundle}
                onRefresh={refreshDevBundle}
              />
            </div>
          )}
        </div>

        <div className="contents">
          <section className={activeContext === "work" ? "order-5 rounded-xl border border-hairline bg-surface px-4 py-4" : "hidden"} role="tabpanel" id="context-work">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Goals{goals.length > 0 && ` (${goals.length})`}
              </p>
              <Link href="/app/goals" className="text-xs text-ink-muted hover:text-ink-secondary">
                Manage →
              </Link>
            </div>
            {goals.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">
                No goals set yet.{" "}
                <Link href="/app/goals" className="underline hover:text-ink-secondary">
                  Add one
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {goals.map((g) => (
                  <li key={g.id} className={`border-l-4 py-1 pl-3 ${STATUS_BORDER[g.status]}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-ink-body">{g.title}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${GOAL_STATUS_STYLES[g.status]}`}>
                        {GOAL_STATUS_LABELS[g.status]}
                      </span>
                    </div>
                    {g.due_date && <p className="text-xs text-ink-muted">Due {formatDate(g.due_date + "T00:00:00")}</p>}
                    {g.progress != null && (
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                          <div
                            className={`h-full rounded-full ${g.status === "at_risk" ? "bg-amber-500" : g.status === "completed" ? "bg-teal-800" : "bg-brand"}`}
                            style={{ width: `${g.progress}%` }}
                          />
                        </div>
                        <span className="shrink-0 text-xs text-ink-secondary">{g.progress}%</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={activeContext === "work" ? "order-6 rounded-xl border border-hairline bg-surface px-4 py-4" : "hidden"}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Initiatives{projects.length > 0 && ` (${projects.length})`}
              </p>
              <Link href="/app/projects" className="text-xs text-ink-muted hover:text-ink-secondary">
                Manage →
              </Link>
            </div>
            {projects.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">
                No projects assigned yet.{" "}
                <Link href="/app/projects" className="underline hover:text-ink-secondary">
                  Add one
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {[...projects]
                  .sort((a, b) => (activeProjects.includes(a) === activeProjects.includes(b) ? 0 : activeProjects.includes(a) ? -1 : 1))
                  .map((p) => (
                    <li key={p.id} className={`border-l-4 py-1 pl-3 ${STATUS_BORDER[p.status]}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-ink-body">{p.title}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${GOAL_STATUS_STYLES[p.status]}`}>
                          {GOAL_STATUS_LABELS[p.status]}
                        </span>
                      </div>
                      <p className="text-xs text-ink-muted">
                        {p.goal_title && `Supports: ${p.goal_title}`}
                        {p.goal_title && p.due_date && " · "}
                        {p.due_date && `Due ${formatDate(p.due_date + "T00:00:00")}`}
                      </p>
                    </li>
                  ))}
              </ul>
            )}
          </section>

          <section className={activeContext === "history" ? "order-5 rounded-xl border border-hairline bg-surface px-5 py-5 lg:col-span-2" : "hidden"} role="tabpanel" id="context-history">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">History</p><h2 className="mt-1 text-lg font-semibold text-ink">Past conversations</h2></div>
              <p className="text-xs text-ink-muted">{completedHistory.length} completed 1:1{completedHistory.length === 1 ? "" : "s"} · {resolved.length} resolved commitment{resolved.length === 1 ? "" : "s"}</p>
            </div>
            {completedHistory.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">
                No completed 1:1s yet. Once you log one with {report.name.split(" ")[0]}, it will show up here.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-divider">
                {completedHistory.map((session) => (
                  <li key={session.id} className="py-3">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-ink-muted">
                        {session.meeting_date ? formatDate(session.meeting_date) : "Undated"}
                      </p>
                      <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-secondary">
                        Completed
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-body">{session.display_summary}</p>
                  </li>
                ))}
              </ul>
            )}
            {resolved.length > 0 && (
              <details className="mt-4 border-t border-divider pt-4">
                <summary className="cursor-pointer text-sm font-medium text-ink-secondary">Resolved commitments ({resolved.length})</summary>
                <ul className="mt-3 space-y-2">
                  {resolved.map((commitment) => (
                    <li key={commitment.id} className="flex items-start justify-between gap-3 text-sm text-ink-secondary">
                      <span>{commitment.status === "done" ? "✓" : "—"} {commitment.description}</span>
                      <button onClick={() => setStatus(commitment.id, "open")} disabled={updatingId === commitment.id} className="shrink-0 text-xs text-ink-muted hover:text-ink-body">Reopen</button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </div>

        <div className="contents">
          <section className="order-2 rounded-xl border border-hairline bg-surface px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">What matters now</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">
              Follow through{open.length > 0 && ` (${open.length})`}
            </h2>
            {open.length > 0 && (
              <p className="mt-1 text-[11px] text-ink-muted">
                Tracked until done or dropped and included in the next 1:1 automatically.
              </p>
            )}
            {open.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">Nothing outstanding. Commitments you make in 1:1s show up here.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {open.map((c) => (
                  <li key={c.id} className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={false}
                      disabled={updatingId === c.id}
                      onChange={() => setStatus(c.id, "done")}
                      aria-label={`Mark done: ${c.description}`}
                      className="mt-1 h-4 w-4 cursor-pointer rounded border-control"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink-body">
                        {c.description}
                        {c.committed_by === "direct_report" && (
                          <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-secondary">
                            {report.name.split(" ")[0]}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {c.due_date ? (
                          <span className={isOverdue(c.due_date) ? "font-medium text-red-700" : ""}>
                            Due {formatDate(c.due_date + "T00:00:00")}
                            {isOverdue(c.due_date) && " — overdue"}
                          </span>
                        ) : (
                          <>Added {formatDate(c.created_at)}</>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => setStatus(c.id, "dropped")}
                      disabled={updatingId === c.id}
                      className="shrink-0 text-xs text-ink-muted hover:text-ink-secondary"
                      title="No longer relevant"
                    >
                      Drop
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 border-t border-divider pt-3">
              <p className="text-xs font-medium text-ink-secondary">Work</p>
              <p className="mt-1 text-xs text-ink-muted">
                {goals.length + activeProjects.length === 0
                  ? "No goals or initiatives need attention."
                  : `${goals.length} goal${goals.length === 1 ? "" : "s"} · ${activeProjects.length} active initiative${activeProjects.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <div className="mt-3 border-t border-divider pt-3">
              <p className="text-xs font-medium text-ink-secondary">Growth direction</p>
              <p className="mt-1 text-xs text-ink-muted">
                {devBundle?.development_plan.plan_text?.trim() ? "A development plan is in progress." : "No plan or aspiration has been added yet."}
              </p>
            </div>
          </section>

          <section className={activeContext === "growth" ? "order-5 grid gap-5 lg:col-span-2 lg:grid-cols-2" : "hidden"} role="tabpanel" id="context-growth">
            <AssessmentCard scorecard={scorecard} reportId={id} hasExpectations={!!report.expectations} />

            {devBundle && (
              <DevelopmentSection
                section="growth"
                directReportId={id}
                reportName={report.name}
                bundle={devBundle}
                onRefresh={refreshDevBundle}
              />
            )}

            <div className="rounded-xl border border-hairline bg-surface px-4 py-4 lg:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Expectations</p>
              {report.expectations ? (
                <>
                  <p className="mt-1.5 text-xs text-ink-secondary">
                    {report.expectations.role_level.job_role} · Level {report.expectations.role_level.job_level}
                  </p>
                  {report.expectations.metrics.length + report.expectations.skills.length + report.expectations.values.length === 0 ? (
                    <p className="mt-3 text-sm text-ink-muted">
                      No expectations configured for this role yet.{" "}
                      <Link href="/app/settings?section=roles" className="underline hover:text-ink-secondary">
                        Add them in Settings
                      </Link>
                      .
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2.5">
                      <ExpectationChips label="Metrics" items={report.expectations.metrics} />
                      <ExpectationChips label="Skills" items={report.expectations.skills} />
                      <ExpectationChips label="Values" items={report.expectations.values} />
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-2">
                  <p className="text-sm text-amber-700">No role assigned.</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <GroupedRoleSelect
                      roleLevels={roleLevels}
                      roleFamilies={roleFamilies}
                      value=""
                      onChange={assignRole}
                      className="w-56 rounded-md border border-control px-2.5 py-1.5 text-xs disabled:opacity-50"
                      placeholder={assigningRole ? "Assigning..." : "Assign a role…"}
                    />
                    {report.role_title && (
                      <span className="text-xs text-ink-muted">was: &quot;{report.role_title}&quot;</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <nav className="order-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-hairline pt-3 lg:col-span-2" role="tablist" aria-label="Person context">
          {([
            ["work", "Work"],
            ["growth", "Growth"],
            ["history", "History"],
            ["private", "Private notes"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={activeContext === value}
              aria-controls={`context-${value}`}
              onClick={() => setActiveContext(value)}
              className={`border-b-2 px-0.5 pb-2 text-sm font-medium transition-colors ${activeContext === value ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink-body"}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {settingsOpen && (
        <SettingsDrawer
          onClose={() => setSettingsOpen(false)}
          orgCadenceDays={orgCadenceDays}
          cadenceDays={cadenceDays}
          setCadenceDays={setCadenceDays}
          savingCadence={savingCadence}
          cadenceSaved={cadenceSaved}
          saveCadence={saveCadence}
          capacitySettings={capacitySettings}
          contractedHours={contractedHours}
          setContractedHours={setContractedHours}
          utilizationPct={utilizationPct}
          setUtilizationPct={setUtilizationPct}
          offDaysPerYear={offDaysPerYear}
          setOffDaysPerYear={setOffDaysPerYear}
          savingCapacity={savingCapacity}
          capacitySaved={capacitySaved}
          saveCapacityProfile={saveCapacityProfile}
          timeOff={timeOff}
          toStart={toStart}
          setToStart={setToStart}
          toEnd={toEnd}
          setToEnd={setToEnd}
          toType={toType}
          setToType={setToType}
          addingTimeOff={addingTimeOff}
          addTimeOff={addTimeOff}
          removeTimeOff={removeTimeOff}
        />
      )}
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Assessment card — a small radial ring showing the current rating's
// position within the configured level scale, same inline-SVG technique
// /app/team's GoalsCard ring uses (no new charting dependency).
// ---------------------------------------------------------------------------

function AssessmentCard({
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

function SettingsDrawer({
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

function DevelopmentSection({
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
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            rows={2}
            placeholder="Write a private note..."
            className="w-full rounded-md border border-control bg-sunken px-3 py-2 text-sm text-ink placeholder-ink-faint"
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
        <textarea
          value={planText}
          onChange={(e) => setPlanText(e.target.value)}
          rows={3}
          placeholder={`Write ${reportName.split(" ")[0]}'s development plan — growth focus, what's next, whatever's useful...`}
          className="w-full rounded-md border border-control px-3 py-2 text-sm"
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
            <textarea
              value={aspirationNotes}
              onChange={(e) => setAspirationNotes(e.target.value)}
              rows={2}
              placeholder="Notes"
              className="w-full rounded-md border border-control px-3 py-2 text-sm"
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
