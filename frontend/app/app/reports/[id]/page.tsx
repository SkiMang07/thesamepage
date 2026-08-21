"use client";

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
  getTimeOff,
  setCapacityProfile,
  createTimeOff,
  deleteTimeOff,
  updateCommitment,
  deleteOneOnOne,
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
  DirectReport,
  OneOnOne,
  Commitment,
  Expectation,
  Goal,
  GoalStatus,
  Project,
  CapacitySettings,
  TimeOffEntry,
  TimeOffType,
  Scorecard,
  RoleFamily,
  RoleLevel,
  OrgUnit,
  DevelopmentBundle,
  DevelopmentDraft,
  OpportunityType,
} from "@/lib/api";
import { GroupedRoleSelect, orgUnitLabel, roleLabel } from "@/components/RolePicker";

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
  active: "bg-gray-100 text-gray-600",
  on_track: "bg-green-50 text-green-600",
  at_risk: "bg-amber-50 text-amber-600",
  completed: "bg-blue-50 text-blue-600",
  cancelled: "bg-gray-100 text-gray-400",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ExpectationGroup({ label, items }: { label: string; items: Expectation[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</h3>
      <ul className="mt-2 space-y-2">
        {items.map((e) => (
          <li key={e.id} className="rounded-lg border border-gray-200 px-4 py-2.5">
            <p className="text-sm font-medium text-gray-800">{expectationName(e)}</p>
            {(e.expectation || e.description) && (
              <p className="mt-0.5 text-sm text-gray-500">{e.expectation || e.description}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function isOverdue(dueDate: string | null) {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate + "T00:00:00") < today;
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { setPageContext } = useDrawer();
  const [report, setReport] = useState<DirectReport | null>(null);
  const [history, setHistory] = useState<OneOnOne[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Capacity (Session 14) — per-person override of the org baseline, plus
  // this person's time off log. Read surface + edit both live here; there's
  // no separate "manage capacity" page for a single person the way Goals/
  // Projects have one, since this data is specific to this report.
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

  // Assessments (Session 16) — read-only summary here; scoring happens on
  // the dedicated scorecard page, same "summary here, edit there" pattern
  // as Goals/Projects.
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);

  // Development (Session 47) — full inline CRUD here, same depth as
  // Capacity above, since this feature has no dedicated page of its own
  // (Andrew's scoping call: DR-detail-section-only placement).
  const [devBundle, setDevBundle] = useState<DevelopmentBundle | null>(null);

  // 1:1 cadence override (nav rework pass 2, Session 38) — same "blank
  // means inherit the org default" pattern as the Capacity fields above.
  const [orgCadenceDays, setOrgCadenceDays] = useState<number>(21);
  const [cadenceDays, setCadenceDays] = useState<string>("");
  const [savingCadence, setSavingCadence] = useState(false);
  const [cadenceSaved, setCadenceSaved] = useState(false);

  // Inline "assign a role" picker (Session 42, Plan S4+S5) — the
  // Expectations block below always renders now, even before a role is
  // assigned, so a manager can wire this person up without leaving the
  // page. See docs/TEAM_SETUP_UX_REVIEW.md §6.
  const [roleLevels, setRoleLevels] = useState<RoleLevel[]>([]);
  const [roleFamilies, setRoleFamilies] = useState<RoleFamily[]>([]);
  const [assigningRole, setAssigningRole] = useState(false);
  // Role · team subtitle under the H1 (Session 43, Polish Pass A, finding
  // P5 — "the person page H1 still shows only the name"). orgUnits fetched
  // alongside roleLevels/roleFamilies purely for this label; PeopleSection
  // and the roster cards already load the same list for the same reason.
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);

  // Clear page context when leaving this page so it doesn't bleed into
  // other pages that don't know which report was being viewed.
  useEffect(() => {
    return () => setPageContext(null);
  }, [setPageContext]);

  useEffect(() => {
    Promise.all([
      getDirectReport(id),
      getOneOnOneHistory(id),
      getCommitments({ directReportId: id }),
      getGoals({ directReportId: id }),
      getProjects({ directReportId: id }),
      getCapacityProfile(id),
      getCapacitySettings(),
      getTimeOff(id),
      getScorecard(id),
      getProfile(),
      getRoleLevels(),
      getRoleFamilies(),
      getOrgUnits(),
      getDevelopmentPlan(id),
    ])
      .then(([dr, h, c, g, p, cp, cs, to, sc, prof, rls, rfs, ous, dev]) => {
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
        setTimeOff(to);
        setScorecard(sc);
        setOrgCadenceDays(prof.one_on_one_cadence_days);
        setCadenceDays(dr.one_on_one_cadence_days != null ? String(dr.one_on_one_cadence_days) : "");
        setRoleLevels(rls);
        setRoleFamilies(rfs);
        setOrgUnits(ous);
        setDevBundle(dev);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Every Development mutation refetches the bundle rather than hand-
  // patching local state — same "re-fetch after write" posture as
  // assignRole above, and simplest to keep correct given how many pieces
  // (aspiration/opportunities/training/notes/low_scoring_items) can shift
  // together (e.g. adding an opportunity sourced from a low-scoring item
  // doesn't remove it from low_scoring_items — the manager may want more
  // than one opportunity from the same score).
  async function refreshDevBundle() {
    const fresh = await getDevelopmentPlan(id);
    setDevBundle(fresh);
    return fresh;
  }

  // Assigns a role right from this page (Session 42, Plan S4+S5) — preserves
  // org_unit_id/cadence via assignReportRole, same invariant PeopleSection's
  // picker relies on. The PUT response doesn't carry `expectations` (only
  // GET /direct-reports/{id} attaches it — see backend/routes/
  // direct_reports.py), so re-fetch the full report afterward instead of
  // hand-assembling the expectations block from roleLevels alone.
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

  async function dismissSession(sessionId: string) {
    setDismissingId(sessionId);
    try {
      await deleteOneOnOne(sessionId);
      setHistory((hs) => hs.filter((h) => h.id !== sessionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to dismiss session");
    } finally {
      setDismissingId(null);
    }
  }

  if (loading) return <p className="p-8 text-gray-500">Loading...</p>;
  if (error) return <p className="p-8 text-red-500">{error}</p>;
  if (!report) return null;

  const open = commitments.filter((c) => c.status === "open");
  const resolved = commitments.filter((c) => c.status !== "open");
  // Most-recent planned session, if any — lets the header CTA jump straight
  // back into an existing prep sheet instead of regenerating one.
  const plannedSession = history.find((h) => h.status === "planned");

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {/* "← Dashboard" removed — the persistent global nav's orbit
              strip now carries the roster on this page (Session 36/37). */}
          <h1 className="text-2xl font-semibold">{report.name}</h1>
          {(() => {
            // Role · team subtitle (Session 43, Polish Pass A, finding P5) —
            // the real assigned role_level + org_unit, once set; falls back
            // to the legacy free-text role_title only when neither is
            // assigned yet, same "was: ..." hint PeopleSection shows.
            const rl = roleLevels.find((r) => r.id === report.role_level_id);
            const ou = orgUnits.find((u) => u.id === report.org_unit_id);
            if (rl || ou) {
              return (
                <p className="mt-1 text-gray-500">
                  {rl ? roleLabel(rl) : "No role assigned"}
                  {ou && ` · ${orgUnitLabel(ou)}`}
                </p>
              );
            }
            if (report.role_title) {
              return <p className="mt-1 text-gray-500">{report.role_title}</p>;
            }
            return null;
          })()}
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href={`/app/reports/${id}/log`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Log a 1:1
          </Link>
          <Link
            href={
              plannedSession
                ? `/app/reports/${id}/prep?resume=${plannedSession.id}`
                : `/app/reports/${id}/prep`
            }
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            {plannedSession ? "Resume prep sheet →" : "Start 1:1 prep →"}
          </Link>
        </div>
      </div>

      {/* Notes */}
      {report.notes && (
        <div className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">About</h2>
          <p className="mt-2 text-gray-700">{report.notes}</p>
        </div>
      )}

      {/* Expectations — always renders now (Session 42, Plan S4+S5), even
          before a role is assigned, so half-set-up state is visible right
          here instead of the section just being absent. See
          docs/TEAM_SETUP_UX_REVIEW.md §6, F6. */}
      <div className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
          Expectations
        </h2>
        {report.expectations ? (
          <>
            <p className="mt-2 text-gray-700">
              {report.expectations.role_level.job_role} · Level {report.expectations.role_level.job_level}
              {report.expectations.role_level.functional_team &&
                ` · ${report.expectations.role_level.functional_team}`}
            </p>
            {report.expectations.metrics.length +
              report.expectations.skills.length +
              report.expectations.values.length ===
            0 ? (
              <p className="mt-3 text-gray-500">
                No expectations configured for this role yet.{" "}
                <Link href="/app/settings?section=roles" className="underline hover:text-gray-700">
                  Add them in Settings
                </Link>
                .
              </p>
            ) : (
              <>
                <ExpectationGroup label="Metrics" items={report.expectations.metrics} />
                <ExpectationGroup label="Skills" items={report.expectations.skills} />
                <ExpectationGroup label="Values" items={report.expectations.values} />
              </>
            )}
          </>
        ) : (
          <div className="mt-3">
            <p className="text-amber-700">No role assigned.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <GroupedRoleSelect
                roleLevels={roleLevels}
                roleFamilies={roleFamilies}
                value=""
                onChange={assignRole}
                className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
                placeholder={assigningRole ? "Assigning..." : "Assign a role…"}
              />
              {report.role_title && (
                <span className="text-xs text-gray-400">was: &quot;{report.role_title}&quot;</span>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Expectations follow the role automatically once assigned. Manage roles and their expectations in{" "}
              <Link href="/app/settings?section=roles" className="underline hover:text-gray-700">
                Settings
              </Link>
              .
            </p>
          </div>
        )}
      </div>

      {/* Assessment — read-only summary; scoring happens on the dedicated
          scorecard page (Session 16). Always shown, same pattern as
          Goals/Projects/Capacity below. */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">Assessment</h2>
          <Link href={`/app/assessments/${id}`} className="text-xs text-gray-400 hover:text-gray-600">
            {scorecard?.overall ? "Assess again →" : "Assess now →"}
          </Link>
        </div>
        {scorecard?.overall ? (
          <p className="mt-3 text-gray-700">
            Currently rated{" "}
            <span className="font-medium">
              {scorecard.levels.find((l) => l.ordinal === scorecard.overall!.level_ordinal)?.label}
            </span>{" "}
            <span className="text-sm text-gray-400">
              (set {formatDate(scorecard.overall.created_at)})
            </span>
          </p>
        ) : (
          <p className="mt-3 text-gray-500">
            Not yet assessed.{" "}
            <Link href={`/app/assessments/${id}`} className="underline hover:text-gray-700">
              {report.expectations ? "Score them against their role's expectations" : "Assess them"}
            </Link>
            , or let AI draft a first pass from recent 1:1 notes.
          </p>
        )}
      </div>

      {/* Development (Session 47) — career aspiration, skill/knowledge
          opportunities (optionally traced back to a low assessment score),
          training, and private manager notes. Full inline CRUD here, no
          dedicated page. */}
      {devBundle && (
        <DevelopmentSection
          directReportId={id}
          reportName={report.name}
          bundle={devBundle}
          onRefresh={refreshDevBundle}
        />
      )}

      {/* 1:1 cadence (nav rework pass 2, Session 38) — per-person override
          of the org default set in Settings > Profile & Company. Blank =
          inherit; same "which source won" honesty convention Capacity uses
          for logged-vs-assumed hours. */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">1:1 cadence</h2>
          <Link href="/app/1-1s" className="text-xs text-gray-400 hover:text-gray-600">
            View 1:1s →
          </Link>
        </div>
        <form onSubmit={saveCadence} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Every N days</label>
            <input
              type="number"
              min={1}
              max={365}
              step={1}
              value={cadenceDays}
              onChange={(e) => setCadenceDays(e.target.value)}
              placeholder={`${orgCadenceDays} (org default)`}
              className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={savingCadence}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {savingCadence ? "Saving..." : "Save"}
          </button>
          {cadenceSaved && <span className="text-sm text-green-600">Saved</span>}
        </form>
        <p className="mt-1.5 text-xs text-gray-400">
          {cadenceDays.trim()
            ? `Currently every ${cadenceDays.trim()} days (custom).`
            : `Currently every ${orgCadenceDays} days (org default). Leave blank to keep inheriting it.`}
        </p>
      </div>

      {/* Capacity — always shown, same pattern as Goals/Projects. Baseline
          hours/utilization override + this person's time off log. The
          resolved week-by-week number lives on the Capacity page; this is
          where you set the inputs that feed it. */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">Capacity</h2>
          <Link href="/app/capacity" className="text-xs text-gray-400 hover:text-gray-600">
            View capacity →
          </Link>
        </div>

        <form onSubmit={saveCapacityProfile} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Contracted hours / week</label>
            <input
              type="number"
              min={1}
              max={80}
              step={0.5}
              value={contractedHours}
              onChange={(e) => setContractedHours(e.target.value)}
              placeholder={capacitySettings ? `${capacitySettings.default_hours_per_week} (default)` : ""}
              className="w-44 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Target utilization %</label>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={utilizationPct}
              onChange={(e) => setUtilizationPct(e.target.value)}
              placeholder={capacitySettings ? `${capacitySettings.default_target_utilization_pct} (default)` : ""}
              className="w-44 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Days off / year</label>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={offDaysPerYear}
              onChange={(e) => setOffDaysPerYear(e.target.value)}
              placeholder={capacitySettings ? `${capacitySettings.default_off_days_per_year} (default)` : ""}
              className="w-44 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={savingCapacity}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {savingCapacity ? "Saving..." : "Save"}
          </button>
          {capacitySaved && <span className="text-sm text-green-600">Saved</span>}
        </form>
        <p className="mt-1.5 text-xs text-gray-400">Leave blank to use your Settings &gt; Capacity defaults.</p>

        <div className="mt-6">
          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Time off{timeOff.length > 0 && ` (${timeOff.length})`}
          </h3>
          {timeOff.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No time off logged.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {timeOff.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <span className="text-gray-700">
                    {formatDate(t.start_date + "T00:00:00")}
                    {t.end_date !== t.start_date && ` – ${formatDate(t.end_date + "T00:00:00")}`}
                    <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      {TIME_OFF_LABELS[t.type]}
                    </span>
                  </span>
                  <button onClick={() => removeTimeOff(t.id)} className="shrink-0 text-xs text-gray-400 hover:text-red-500">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={addTimeOff} className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Start</label>
              <input
                type="date"
                value={toStart}
                onChange={(e) => setToStart(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">End</label>
              <input
                type="date"
                value={toEnd}
                onChange={(e) => setToEnd(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Type</label>
              <select
                value={toType}
                onChange={(e) => setToType(e.target.value as TimeOffType)}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
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
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {addingTimeOff ? "Adding..." : "Add"}
            </button>
          </form>
        </div>
      </div>

      {/* Goals — always shown (unlike Expectations, not gated behind a
          Settings prerequisite). Summary/read surface only: creating and
          editing goals happens on the dedicated Goals page. */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
            Goals{goals.length > 0 && ` (${goals.length})`}
          </h2>
          <Link href="/app/goals" className="text-xs text-gray-400 hover:text-gray-600">
            Manage goals →
          </Link>
        </div>

        {goals.length === 0 ? (
          <p className="mt-4 text-gray-500">
            No goals set yet.{" "}
            <Link href="/app/goals" className="underline hover:text-gray-700">
              Add one from the Goals page
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {goals.map((g) => (
              <li key={g.id} className="rounded-lg border border-gray-200 px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{g.title}</p>
                    {g.due_date && (
                      <p className="mt-0.5 text-xs text-gray-400">Due {formatDate(g.due_date + "T00:00:00")}</p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${GOAL_STATUS_STYLES[g.status]}`}>
                    {GOAL_STATUS_LABELS[g.status]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Projects — same always-visible pattern as Goals (Session 13; also
          settles Goals' previously-unconfirmed hidden-vs-visible question
          the same direction). Summary/read surface only: creating and
          editing projects happens on the dedicated Projects page. */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
            Projects{projects.length > 0 && ` (${projects.length})`}
          </h2>
          <Link href="/app/projects" className="text-xs text-gray-400 hover:text-gray-600">
            Manage projects →
          </Link>
        </div>

        {projects.length === 0 ? (
          <p className="mt-4 text-gray-500">
            No projects assigned yet.{" "}
            <Link href="/app/projects" className="underline hover:text-gray-700">
              Add one from the Projects page
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {projects.map((p) => (
              <li key={p.id} className="rounded-lg border border-gray-200 px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{p.title}</p>
                    {p.goal_title && (
                      <p className="mt-0.5 text-xs text-gray-400">Supports goal: {p.goal_title}</p>
                    )}
                    {p.due_date && (
                      <p className="mt-0.5 text-xs text-gray-400">Due {formatDate(p.due_date + "T00:00:00")}</p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${GOAL_STATUS_STYLES[p.status]}`}>
                    {GOAL_STATUS_LABELS[p.status]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Open commitments */}
      <div className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
          Open commitments{open.length > 0 && ` (${open.length})`}
        </h2>

        {open.length === 0 ? (
          <p className="mt-4 text-gray-500">
            Nothing outstanding. Commitments you make in 1:1s show up here.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {open.map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-3 rounded-lg border border-gray-200 px-4 py-3"
              >
                <input
                  type="checkbox"
                  checked={false}
                  disabled={updatingId === c.id}
                  onChange={() => setStatus(c.id, "done")}
                  aria-label={`Mark done: ${c.description}`}
                  className="mt-1 h-4 w-4 cursor-pointer rounded border-gray-300"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-gray-800">
                    {c.description}
                    {c.committed_by === "direct_report" && (
                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                        {report.name.split(" ")[0]}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {c.due_date ? (
                      <span className={isOverdue(c.due_date) ? "font-medium text-red-500" : ""}>
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
                  className="text-xs text-gray-400 hover:text-gray-600"
                  title="No longer relevant"
                >
                  Drop
                </button>
              </li>
            ))}
          </ul>
        )}

        {resolved.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowResolved((s) => !s)}
              className="text-sm text-gray-500 hover:underline"
            >
              {showResolved ? "Hide" : "Show"} resolved ({resolved.length})
            </button>
            {showResolved && (
              <ul className="mt-3 space-y-2">
                {resolved.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-4 py-1 text-sm">
                    <span className="mt-0.5 text-gray-400">
                      {c.status === "done" ? "✓" : "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-500 line-through decoration-gray-300">
                        {c.description}
                      </p>
                      <p className="text-xs text-gray-400">
                        {c.status === "done"
                          ? `Done${c.completed_at ? ` ${formatDate(c.completed_at)}` : ""}`
                          : "Dropped"}
                      </p>
                    </div>
                    <button
                      onClick={() => setStatus(c.id, "open")}
                      disabled={updatingId === c.id}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Reopen
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 1:1 Sessions — past (completed) + upcoming (planned/prepped) */}
      <div className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">1:1 Sessions</h2>

        {history.length === 0 ? (
          <p className="mt-4 text-gray-500">
            No 1:1s yet. Prepping or logging one with {report.name.split(" ")[0]} will show up here.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-200">
            {history.map((h) => {
              const isPlanned = h.status === "planned";
              const body = (
                <>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-400">{formatDate(h.created_at)}</p>
                    <span
                      className={
                        isPlanned
                          ? "rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-500"
                          : "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500"
                      }
                    >
                      {isPlanned ? "Planned" : "Completed"}
                    </span>
                  </div>
                  <p className="mt-1 text-gray-700">
                    {h.display_summary || (isPlanned ? "Prep sheet generated — no summary yet." : "")}
                  </p>
                </>
              );

              return (
                <li key={h.id} className="py-4">
                  {isPlanned ? (
                    <div className="flex items-start justify-between gap-4">
                      <Link
                        href={`/app/reports/${id}/prep?resume=${h.id}`}
                        className="min-w-0 flex-1 hover:opacity-70"
                      >
                        {body}
                      </Link>
                      <button
                        onClick={() => dismissSession(h.id)}
                        disabled={dismissingId === h.id}
                        className="shrink-0 text-xs text-gray-400 hover:text-gray-600"
                        title="This 1:1 isn't happening — remove the planned session"
                      >
                        {dismissingId === h.id ? "Removing…" : "Not happening"}
                      </button>
                    </div>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Development (Session 47) — career aspiration, skill/knowledge
// opportunities (some traced back to a low assessment score via
// source_kind/source_config_id), training, and a private manager-notes log.
// Self-contained subcomponent (same "props in, refresh callback out"
// pattern as team/page.tsx's CalloutsPanel/MeetingsPanel) rather than
// inlining another dozen pieces of state into ReportDetailPage, which is
// already the densest page in the app.
// ---------------------------------------------------------------------------

const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, string> = {
  skill: "Skill",
  knowledge: "Knowledge",
};

function DevelopmentSection({
  directReportId,
  reportName,
  bundle,
  onRefresh,
}: {
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
  // A single field on the plan row, upserted in place (unlike manager notes
  // below, which is an append-only log). This is what "Draft with AI"
  // suggests into and "Revise with AI" improves — not manager notes, which
  // Andrew explicitly wants kept as a separate, private, unrelated concept.
  const [planText, setPlanText] = useState(bundle.development_plan.plan_text ?? "");
  const [savingPlan, setSavingPlan] = useState(false);
  const [revisingPlan, setRevisingPlan] = useState(false);
  const planDirty = planText.trim() !== (bundle.development_plan.plan_text ?? "").trim();

  // Manager notes — append-only, private, not shared with the report. The
  // textarea is always manually writable (createDevManagerNote never
  // depended on AI); Revise with AI is an optional assist here too, but
  // this box has nothing to do with the plan-text box above.
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [revisingNote, setRevisingNote] = useState(false);

  // AI assist (Session 48/49 follow-ups — see development.py's docstring).
  // "Draft with AI" surfaces non-blocking suggestions: AI-suggested
  // opportunities render alongside the assessment-based suggestions below
  // (same "Add" action), and an AI-suggested plan note (if any) offers a
  // "Use this" that fills the plan-text box above rather than replacing it
  // silently. "Revise with AI" (on both the plan box and manager notes)
  // works on whatever's already typed and never depends on evidence.
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

  // Non-blocking: on a report with no evidence yet this just comes back
  // with nothing to suggest (draftHint explains why) — it never prevents
  // writing an opportunity or plan text by hand, those forms are always
  // usable.
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

  // Always answerable, unlike runDraft above — it revises text the manager
  // already wrote rather than inferring from nothing, so a thin-evidence
  // report doesn't block it. Same generic revise call the plan-text box
  // above uses (revisePlanText) — see development.py's /notes/revise.
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

  return (
    <div className="mt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">Development</h2>
        <button
          onClick={runDraft}
          disabled={drafting}
          className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
        >
          {drafting ? "Drafting..." : "Draft with AI →"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      {/* Development plan — the primary, always-writable narrative
          (Session 49). "Draft with AI" above offers a suggestion via the
          callout below; "Revise with AI" improves whatever's already
          typed. Neither is required — this box works with zero AI
          involvement, which is the whole point of this follow-up. */}
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
          rows={4}
          placeholder={`Write ${reportName.split(" ")[0]}'s development plan — growth focus, what's next, whatever's useful...`}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={savePlanText}
            disabled={savingPlan || !planDirty}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {savingPlan ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={revisePlanText}
            disabled={!planText.trim() || revisingPlan}
            className="rounded-md border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            {revisingPlan ? "Revising..." : "Revise with AI"}
          </button>
          {draftHint && <span className="text-sm text-gray-400">{draftHint}</span>}
        </div>
      </div>

      {/* Aspiration */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">Career aspiration</h3>
          {!editingAspiration && (
            <button onClick={startEditingAspiration} className="text-xs text-gray-400 hover:text-gray-600">
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
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={timeline}
              onChange={(e) => setTimeline(e.target.value)}
              placeholder="Timeline (e.g. 12-18 months)"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <textarea
              value={aspirationNotes}
              onChange={(e) => setAspirationNotes(e.target.value)}
              rows={2}
              placeholder="Notes"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingAspiration(false)}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingAspiration}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {savingAspiration ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        ) : bundle.aspiration && (bundle.aspiration.desired_role || bundle.aspiration.timeline || bundle.aspiration.notes) ? (
          <div className="mt-2 rounded-lg border border-gray-200 px-4 py-3">
            {bundle.aspiration.desired_role && (
              <p className="text-sm font-medium text-gray-900">{bundle.aspiration.desired_role}</p>
            )}
            {bundle.aspiration.timeline && <p className="mt-0.5 text-xs text-gray-400">{bundle.aspiration.timeline}</p>}
            {bundle.aspiration.notes && <p className="mt-1.5 text-sm text-gray-700">{bundle.aspiration.notes}</p>}
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-500">
            No aspiration on record yet for {reportName.split(" ")[0]}.
          </p>
        )}
      </div>

      {/* Opportunities — suggested-from-assessment prompts first, then the
          list, then a manual add form. */}
      <div className="mt-6">
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
          Opportunities{bundle.opportunities.length > 0 && ` (${bundle.opportunities.length})`}
        </h3>

        {bundle.low_scoring_items.filter((it) => !existingSourceIds.has(it.config_id)).length > 0 && (
          <div className="mt-2 space-y-1.5">
            {bundle.low_scoring_items
              .filter((it) => !existingSourceIds.has(it.config_id))
              .map((it) => (
                <div
                  key={it.config_id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2"
                >
                  <p className="text-sm text-amber-800">
                    Suggested from assessment: <span className="font-medium">{it.name}</span> scored{" "}
                    {it.evaluation_point}/{it.scale_max}
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
                    className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    Add as opportunity
                  </button>
                </div>
              ))}
          </div>
        )}

        {/* AI-suggested opportunities from "Draft with AI" — non-blocking,
            dismissible one at a time via Add (which removes it from this list
            and adds it to the real list below). */}
        {aiOpportunities.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {aiOpportunities.map((o, i) => (
              <div
                key={`${o.description}-${i}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2"
              >
                <p className="text-sm text-blue-800">
                  <span className="mr-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-600">
                    AI suggested
                  </span>
                  {o.description}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => addAiOpportunity(i)}
                    disabled={addingAiOppIndex === i}
                    className="rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
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
          <p className="mt-2 text-sm text-gray-500">No opportunities logged yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {bundle.opportunities.map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2">
                <span className="text-sm text-gray-700">
                  <span className="mr-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                    {OPPORTUNITY_TYPE_LABELS[o.type]}
                  </span>
                  {o.description}
                </span>
                <button
                  onClick={() => removeOpportunity(o.id)}
                  disabled={removingOppId === o.id}
                  className="shrink-0 text-xs text-gray-400 hover:text-red-500"
                >
                  Remove
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
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <select
            value={newOppType}
            onChange={(e) => setNewOppType(e.target.value as OpportunityType)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="skill">Skill</option>
            <option value="knowledge">Knowledge</option>
          </select>
          <input
            type="text"
            value={newOppDescription}
            onChange={(e) => setNewOppDescription(e.target.value)}
            placeholder="Describe the opportunity"
            className="min-w-[16rem] flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={addingOpp}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {addingOpp ? "Adding..." : "Add"}
          </button>
        </form>
      </div>

      {/* Training */}
      <div className="mt-6">
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
          Training{bundle.training.length > 0 && ` (${bundle.training.length})`}
        </h3>
        {bundle.training.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No training logged yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {bundle.training.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-gray-700">{t.description}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {t.completion_date ? `Completed ${formatDate(t.completion_date + "T00:00:00")}` : "Not yet completed"}
                    {t.projected_cost != null && ` · $${t.projected_cost.toLocaleString()}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {!t.completion_date && (
                    <button onClick={() => markTrainingComplete(t.id)} className="text-xs text-gray-400 hover:text-gray-600">
                      Mark complete
                    </button>
                  )}
                  <button
                    onClick={() => removeTraining(t.id)}
                    disabled={removingTrainingId === t.id}
                    className="text-xs text-gray-400 hover:text-red-500"
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
            className="min-w-[14rem] flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Target date</label>
            <input
              type="date"
              value={newTrainingDate}
              onChange={(e) => setNewTrainingDate(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Est. cost</label>
            <input
              type="number"
              min={0}
              step={1}
              value={newTrainingCost}
              onChange={(e) => setNewTrainingCost(e.target.value)}
              className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={addingTraining}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {addingTraining ? "Adding..." : "Add"}
          </button>
        </form>
      </div>

      {/* Manager notes — private, append-only, same posture as team meeting
          notes (no edit/delete in v1). */}
      <div className="mt-6">
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
          Manager notes{bundle.manager_notes.length > 0 && ` (${bundle.manager_notes.length})`}
          <span className="ml-1.5 normal-case text-gray-400">— private, not shared with {reportName.split(" ")[0]}</span>
        </h3>
        {bundle.manager_notes.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No notes yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {bundle.manager_notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-gray-200 px-3 py-2">
                <p className="text-sm text-gray-700">{n.content}</p>
                <p className="mt-0.5 text-xs text-gray-400">{formatDate(n.created_at)}</p>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addNote} className="mt-3 flex items-start gap-2">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            rows={2}
            placeholder="Add a private note about this person's growth..."
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={reviseNote}
            disabled={!newNote.trim() || revisingNote}
            className="shrink-0 rounded-md border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            {revisingNote ? "Revising..." : "Revise with AI"}
          </button>
          <button
            type="submit"
            disabled={addingNote}
            className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {addingNote ? "Adding..." : "Add"}
          </button>
        </form>
      </div>
    </div>
  );
}
