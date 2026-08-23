"use client";

// Check-in panel (Session 26, 2026-08-11) — the shared progress strip + quick
// check-in form + history used by both goal cards (/app/goals) and project
// cards (/app/projects). One component because the two parents share the same
// status enum and check-in shape (see backend/routes/check_ins.py).
//
// Renders three things:
//   1. A summary strip: progress bar + %, trend arrow (latest two non-null
//      %s), and a freshness label — amber once a check-in is older than
//      STALE_DAYS, because a stale green is more dangerous than an honest
//      yellow.
//   2. A "Check in" toggle opening an inline form: status (defaults to the
//      parent's current), progress % (defaults to the last asserted value),
//      one-line note. Submitting write-throughs status to the parent server-
//      side; onCheckedIn lets the parent page update its own list state.
//   3. A lazy-loaded history (fetched on first expand, newest first).

import { useState } from "react";
import { CheckIn, CheckInIn, CheckInTrend, GoalStatus } from "@/lib/api";

// Past this many days without a check-in, the freshness label turns amber.
// Matches the weekly-ish cadence a check-in is designed for (two missed
// weeks = worth a nudge), deliberately shorter than the dashboard's 21-day
// 1:1 cadence — goals drift faster than relationships.
export const STALE_CHECK_IN_DAYS = 14;

const STATUS_OPTIONS: { id: GoalStatus; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "on_track", label: "On track" },
  { id: "at_risk", label: "At risk" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

const DOT_STYLES: Record<GoalStatus, string> = {
  active: "bg-ink-muted",
  on_track: "bg-brand",
  at_risk: "bg-amber-500",
  completed: "bg-blue-500",
  cancelled: "bg-carbon-300",
};

export function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

export function freshnessLabel(iso: string | null | undefined) {
  if (!iso) return "No check-ins yet";
  const d = daysSince(iso);
  if (d === 0) return "Checked in today";
  if (d === 1) return "Checked in yesterday";
  return `Checked in ${d} days ago`;
}

export function isStale(iso: string | null | undefined) {
  return !iso || daysSince(iso) > STALE_CHECK_IN_DAYS;
}

export function TrendArrow({ trend }: { trend: CheckInTrend | null | undefined }) {
  if (!trend) return null;
  if (trend === "up") return <span className="text-teal-700" title="Progress up since last check-in">↑</span>;
  if (trend === "down") return <span className="text-red-700" title="Progress down since last check-in">↓</span>;
  return <span className="text-ink-muted" title="Progress flat since last check-in">→</span>;
}

// Average of the latest asserted progress % across a set of goals/projects
// — shared by any surface that needs an aggregate progress figure. Fixes
// the 2026-08-12 data-trust bug where /app/team's goal-progress ring
// computed "% of goals with status on_track" (a status count) while
// Mission Control showed each goal's own check-in progress % — two
// different numbers with the same "progress" label. Both surfaces now read
// from this one function over the same underlying `progress` field.
//
// Items with no check-in progress logged yet are excluded from the average
// rather than counted as 0 — an un-checked-in goal isn't "0% done," it's
// "no data," and averaging it in would understate real progress.
export function averageProgress(items: { progress?: number | null }[]): number | null {
  const withProgress = items.map((i) => i.progress).filter((p): p is number => p != null);
  if (withProgress.length === 0) return null;
  return Math.round(withProgress.reduce((sum, p) => sum + p, 0) / withProgress.length);
}

export function ProgressBar({ progress, status }: { progress: number | null | undefined; status: GoalStatus }) {
  if (progress == null) return null;
  const barColor =
    status === "at_risk" ? "bg-amber-500" : status === "completed" ? "bg-blue-500" : "bg-brand";
  return (
    <div className="flex flex-1 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${progress}%` }} />
      </div>
      <span className="shrink-0 text-xs font-medium text-ink-secondary">{progress}%</span>
    </div>
  );
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function CheckInPanel({
  status,
  progress,
  trend,
  lastCheckInAt,
  fetchHistory,
  submitCheckIn,
  onCheckedIn,
}: {
  status: GoalStatus;
  progress: number | null | undefined;
  trend: CheckInTrend | null | undefined;
  lastCheckInAt: string | null | undefined;
  fetchHistory: () => Promise<CheckIn[]>;
  submitCheckIn: (body: CheckInIn) => Promise<CheckIn>;
  onCheckedIn: (checkIn: CheckIn) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<CheckIn[] | null>(null);
  const [formStatus, setFormStatus] = useState<GoalStatus>(status);
  const [formProgress, setFormProgress] = useState<string>(progress != null ? String(progress) : "");
  const [formNote, setFormNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stale = isStale(lastCheckInAt);

  async function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history === null) {
      try {
        setHistory(await fetchHistory());
      } catch {
        setHistory([]);
      }
    }
  }

  function openForm() {
    // Re-seed defaults from the current values each time the form opens, so
    // a check-in logged moments ago is reflected the next time.
    setFormStatus(status);
    setFormProgress(progress != null ? String(progress) : "");
    setFormNote("");
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const parsed = formProgress.trim() === "" ? null : Number(formProgress);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 100)) {
      setError("Progress must be a whole number from 0 to 100");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await submitCheckIn({
        status: formStatus,
        progress: parsed,
        note: formNote.trim() || null,
      });
      setHistory((h) => (h === null ? h : [created, ...h]));
      onCheckedIn(created);
      setFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log check-in");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 border-t border-divider pt-2">
      {/* Summary strip */}
      <div className="flex items-center gap-3">
        <ProgressBar progress={progress} status={status} />
        <TrendArrow trend={trend} />
        <span className={`text-xs ${stale ? "font-medium text-amber-700" : "text-ink-muted"}`}>
          {freshnessLabel(lastCheckInAt)}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {lastCheckInAt && (
            <button onClick={toggleHistory} className="text-xs text-ink-muted hover:text-ink-body">
              {historyOpen ? "Hide history" : "History"}
            </button>
          )}
          {!formOpen && (
            <button
              onClick={openForm}
              className="rounded-md border border-control px-2.5 py-1 text-xs font-medium text-ink-body hover:bg-canvas"
            >
              Check in
            </button>
          )}
        </div>
      </div>

      {/* Quick check-in form */}
      {formOpen && (
        <form onSubmit={handleSubmit} className="mt-2 rounded-lg border border-dashed border-control p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Status</label>
              <select
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as GoalStatus)}
                className="rounded-md border border-control px-2 py-1.5 text-sm"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Progress %</label>
              <input
                type="number"
                min={0}
                max={100}
                value={formProgress}
                onChange={(e) => setFormProgress(e.target.value)}
                className="w-full rounded-md border border-control px-2 py-1.5 text-sm"
                placeholder="—"
              />
            </div>
            <div className="min-w-40 flex-1">
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Note (optional)</label>
              <input
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                className="w-full rounded-md border border-control px-2 py-1.5 text-sm"
                placeholder="One line on where this stands"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {saving ? "Logging..." : "Log check-in"}
              </button>
              <button type="button" onClick={() => setFormOpen(false)} className="text-xs text-ink-secondary hover:text-ink">
                Cancel
              </button>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
        </form>
      )}

      {/* History */}
      {historyOpen && (
        <ul className="mt-2 space-y-1.5">
          {history === null ? (
            <li className="text-xs text-ink-muted">Loading...</li>
          ) : history.length === 0 ? (
            <li className="text-xs text-ink-muted">No check-ins yet.</li>
          ) : (
            history.map((ci) => (
              <li key={ci.id} className="flex items-baseline gap-2 text-xs text-ink-secondary">
                <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 self-center rounded-full ${DOT_STYLES[ci.status]}`} />
                <span className="shrink-0 text-ink-muted">{formatDateTime(ci.created_at)}</span>
                <span className="shrink-0 font-medium text-ink-secondary">
                  {STATUS_OPTIONS.find((s) => s.id === ci.status)?.label}
                  {ci.progress != null && ` · ${ci.progress}%`}
                </span>
                {ci.note && <span className="min-w-0 truncate">{ci.note}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
