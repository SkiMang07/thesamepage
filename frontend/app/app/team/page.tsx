"use client";

// Team View (Session 21, 2026-08-08) — the "team space" surface Andrew
// floated 2026-08-03 (see docs/SESSION_HISTORY.md and the
// team_space_brainstorm project memory note). Distinct from role-scoped
// views (who can see what as the org grows past one manager) — this is a
// single home for "my team" as a unit: who's on it, what they're working on
// (active projects + individual priorities), and a place to log an update
// per report. Team data was scattered across direct_reports/projects/goals
// with no page tying them together; this assembles it.
//
// Scope locked with Andrew before building:
//   - Own direct reports only for v1, not an org_unit rollup like
//     role-scoped views — matches Mission Control's scope today.
//   - Roster + projects + priorities, assembled server-side from data that
//     already exists (GET /api/team).
//   - Messaging is free-text, STORE-ONLY — no delivery mechanism. IC login
//     isn't built yet (direct_reports.user_id is still just a future hook —
//     see database/schema.sql), so there's no surface for a report to read
//     this today. Andrew's explicit call over building email delivery this
//     session. A manager sees their own logged updates here; nothing more.

import { useEffect, useState } from "react";
import Link from "next/link";
import { TeamMember, TeamMessage, getTeam, getTeamMessages, sendTeamMessage } from "@/lib/api";

// Same status vocabulary as Goals/Projects — Team View only ever receives
// the active/on_track/at_risk subset (filtered server-side in team.py), but
// the styles/labels still need all five keys since TypeScript can't narrow
// the union from the fetch alone.
const STATUS_STYLES: Record<string, string> = {
  active: "bg-gray-100 text-gray-600",
  on_track: "bg-green-50 text-green-600",
  at_risk: "bg-amber-50 text-amber-600",
  completed: "bg-blue-50 text-blue-600",
  cancelled: "bg-gray-100 text-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  on_track: "On track",
  at_risk: "At risk",
  completed: "Completed",
  cancelled: "Cancelled",
};

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, TeamMessage[]>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    getTeam()
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function toggleExpand(member: TeamMember) {
    if (expandedId === member.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(member.id);
    setDraft("");
    if (!history[member.id]) {
      try {
        const msgs = await getTeamMessages(member.id);
        setHistory((h) => ({ ...h, [member.id]: msgs }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load update history");
      }
    }
  }

  async function submitMessage(reportId: string) {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const created = await sendTeamMessage(reportId, draft.trim());
      setHistory((h) => ({ ...h, [reportId]: [created, ...(h[reportId] ?? [])] }));
      setMembers((ms) => ms.map((m) => (m.id === reportId ? { ...m, latest_message: created } : m)));
      setDraft("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save update");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Team</h1>
        <Link href="/app/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
          &larr; Back to your team
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Who&apos;s on your team, what they&apos;re working on, and a place to log an update for each person.
      </p>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="mt-8 text-gray-500">Loading...</p>
      ) : members.length === 0 ? (
        <p className="mt-8 text-gray-500">
          No direct reports yet.{" "}
          <Link href="/app/dashboard" className="underline hover:text-gray-700">
            Add your first one
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {members.map((m) => (
            <li key={m.id} className="rounded-xl border border-gray-200 bg-white">
              <div className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link href={`/app/reports/${m.id}`} className="font-medium text-gray-900 hover:underline">
                      {m.name}
                    </Link>
                    {m.role_title && <p className="text-sm text-gray-500">{m.role_title}</p>}
                  </div>
                  <button
                    onClick={() => toggleExpand(m)}
                    className="shrink-0 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    {expandedId === m.id ? "Close" : "Log update"}
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      Priorities{m.priorities.length > 0 && ` (${m.priorities.length})`}
                    </p>
                    {m.priorities.length === 0 ? (
                      <p className="mt-1.5 text-sm text-gray-400">No individual priorities set.</p>
                    ) : (
                      <ul className="mt-1.5 space-y-1.5">
                        {m.priorities.map((g) => (
                          <li key={g.id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate text-gray-700">{g.title}</span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[g.status]}`}>
                              {STATUS_LABELS[g.status]}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      Projects{m.projects.length > 0 && ` (${m.projects.length})`}
                    </p>
                    {m.projects.length === 0 ? (
                      <p className="mt-1.5 text-sm text-gray-400">No active projects.</p>
                    ) : (
                      <ul className="mt-1.5 space-y-1.5">
                        {m.projects.map((p) => (
                          <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate text-gray-700">{p.title}</span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[p.status]}`}>
                              {STATUS_LABELS[p.status]}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {m.latest_message && (
                  <p className="mt-4 text-xs text-gray-400">
                    Last update logged {timeAgo(m.latest_message.created_at)}: &ldquo;{m.latest_message.message}&rdquo;
                  </p>
                )}
              </div>

              {expandedId === m.id && (
                <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4">
                  <label className="mb-1 block text-xs font-medium text-gray-500">Update for {m.name}</label>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Share a status update, priority, or note. Not sent anywhere yet — just kept on record here until reports can log in."
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={() => submitMessage(m.id)}
                      disabled={sending || !draft.trim()}
                      className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                    >
                      {sending ? "Saving..." : "Save update"}
                    </button>
                  </div>

                  {history[m.id] && history[m.id].length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">History</p>
                      <ul className="mt-2 space-y-2">
                        {history[m.id].map((msg) => (
                          <li key={msg.id} className="text-sm text-gray-600">
                            <span className="text-xs text-gray-400">{timeAgo(msg.created_at)}</span> — {msg.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
