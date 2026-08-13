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
} from "@/lib/api";

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
    ])
      .then(([dr, h, c, g, p, cp, cs, to, sc]) => {
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
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

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
          <Link href="/app/dashboard" className="text-sm text-gray-500 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{report.name}</h1>
          {report.role_title && (
            <p className="mt-1 text-gray-500">{report.role_title}</p>
          )}
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

      {/* Role expectations — only when a role is assigned in Settings */}
      {report.expectations && (
        <div className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-400">
            Expectations
          </h2>
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
              <Link href="/app/settings" className="underline hover:text-gray-700">
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
        </div>
      )}

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
              Score them against their role&apos;s expectations
            </Link>
            , or let AI draft a first pass from recent 1:1 notes.
          </p>
        )}
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
