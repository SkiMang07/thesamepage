"use client";

// Team Mission Control (Session 22, 2026-08-08) — expands Team View
// (Session 21, session's roster-only /app/team) into a 3-column surface,
// reworked in place at the same route/nav item per Andrew's explicit call.
// See docs/SESSION_HISTORY.md and the team_mission_control project memory
// note for the scoping conversation.
//
// Left column: the Session 21 roster (roster + active projects/priorities +
// store-only per-report update log), now also carrying an "Invite to log
// in" action per report — the one piece of IC login built this session
// (see lib/api.ts's inviteDirectReport). Building what an IC actually sees
// once logged in is deferred to a follow-up.
//
// Middle column: company- and team-level goal progress, read-only,
// deliberately excluding department/individual (team.py's
// get_team_goals docstring has the full reasoning).
//
// Right column: a standalone team-wide meeting-notes log — free text, not
// tied to any single 1:1 (one_on_ones.summary stays exactly where it is)
// and distinct from the per-report team_messages log above.
//
// "Key updates" (a manager-authored broadcast feed) was scoped and then
// explicitly deferred to a follow-up session — nothing for it here.
//
// Session 23 (2026-08-09) follow-up, two additions:
//   - Notes column now surfaces a "next meeting's agenda" hero (the soonest
//     note dated today or later) above a card grid of past meetings; a card
//     opens a detail modal on click instead of the old flat reverse-chron
//     text list. Status is derived client-side from meeting_date, not
//     stored — see lib/api.ts's TeamNote comment.
//   - Roster column gains a "Team commitments" section below it — existing
//     commitments rows flagged is_team_commitment, assigned to one direct
//     report but tracked here at the team level too (see backend/routes/
//     team.py's list_team_commitments/create_team_commitment).

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  TeamCommitment,
  TeamGoal,
  TeamMember,
  TeamMessage,
  TeamNote,
  createTeamCommitment,
  createTeamNote,
  getTeam,
  getTeamCommitments,
  getTeamGoals,
  getTeamMessages,
  getTeamNotes,
  inviteDirectReport,
  sendTeamMessage,
  updateCommitment,
} from "@/lib/api";

// Same status vocabulary as Goals/Projects — Team View only ever receives
// the active/on_track/at_risk subset (filtered server-side), but the
// styles/labels still need all five keys since TypeScript can't narrow the
// union from the fetch alone.
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Local (not UTC) YYYY-MM-DD — meeting_date is a date-only column, and
// comparing/parsing it via new Date(dateStr) treats it as UTC midnight,
// which reads as "yesterday" in any timezone west of UTC. Everything below
// that touches meeting_date goes through these two helpers instead.
function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMeetingDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function snippet(text: string, max = 110) {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [goals, setGoals] = useState<TeamGoal[]>([]);
  const [notes, setNotes] = useState<TeamNote[]>([]);
  const [commitments, setCommitments] = useState<TeamCommitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getTeam(), getTeamGoals(), getTeamNotes(), getTeamCommitments()])
      .then(([m, g, n, c]) => {
        setMembers(m);
        setGoals(g);
        setNotes(n);
        setCommitments(c);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="mx-auto max-w-7xl px-6 py-16">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Team</h1>
        <Link href="/app/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
          &larr; Back to your team
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Who&apos;s on your team, how company and team goals are tracking, and a running log for
        anything worth remembering.
      </p>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="mt-8 text-gray-500">Loading...</p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-8">
            <RosterColumn members={members} setMembers={setMembers} />
            <TeamCommitmentsSection
              members={members}
              commitments={commitments}
              setCommitments={setCommitments}
            />
          </div>
          <GoalsColumn goals={goals} />
          <NotesColumn notes={notes} setNotes={setNotes} />
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Left column — roster
// ---------------------------------------------------------------------------

function RosterColumn({
  members,
  setMembers,
}: {
  members: TeamMember[];
  setMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, TeamMessage[]>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteResult, setInviteResult] = useState<Record<string, string>>({});
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSending, setInviteSending] = useState(false);

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
      } catch {
        // Non-fatal — the card still renders without history.
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
    } finally {
      setSending(false);
    }
  }

  function openInvite(member: TeamMember) {
    setInvitingId(member.id);
    setInviteEmail(member.email ?? "");
    setInviteError(null);
  }

  async function submitInvite(reportId: string) {
    const email = inviteEmail.trim();
    if (!email || inviteSending) return;
    setInviteSending(true);
    setInviteError(null);
    try {
      const { invite_url } = await inviteDirectReport(reportId, email);
      setInviteResult((r) => ({ ...r, [reportId]: invite_url }));
      setMembers((ms) => ms.map((m) => (m.id === reportId ? { ...m, email } : m)));
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Failed to create invite");
    } finally {
      setInviteSending(false);
    }
  }

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Your team</h2>

      {members.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">
          No direct reports yet.{" "}
          <Link href="/app/dashboard" className="underline hover:text-gray-700">
            Add your first one
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-3 space-y-4">
          {members.map((m) => (
            <li key={m.id} className="rounded-xl border border-gray-200 bg-white">
              <div className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/app/reports/${m.id}`} className="font-medium text-gray-900 hover:underline">
                      {m.name}
                    </Link>
                    {m.role_title && <p className="text-sm text-gray-500">{m.role_title}</p>}
                  </div>
                  <button
                    onClick={() => toggleExpand(m)}
                    className="shrink-0 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    {expandedId === m.id ? "Close" : "Log update"}
                  </button>
                </div>

                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      Priorities{m.priorities.length > 0 && ` (${m.priorities.length})`}
                    </p>
                    {m.priorities.length === 0 ? (
                      <p className="mt-1 text-sm text-gray-400">None set.</p>
                    ) : (
                      <ul className="mt-1 space-y-1">
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
                      <p className="mt-1 text-sm text-gray-400">None active.</p>
                    ) : (
                      <ul className="mt-1 space-y-1">
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
                  <p className="mt-3 text-xs text-gray-400">
                    Last update {timeAgo(m.latest_message.created_at)}: &ldquo;{m.latest_message.message}&rdquo;
                  </p>
                )}

                <div className="mt-3 border-t border-gray-100 pt-3">
                  {m.user_id ? (
                    <p className="text-xs text-gray-400">Account linked — they can log in.</p>
                  ) : invitingId === m.id ? (
                    <div>
                      {inviteResult[m.id] ? (
                        <div>
                          <p className="text-xs text-gray-500">Share this link with them — it expires in 7 days:</p>
                          <div className="mt-1 flex items-center gap-2">
                            <input
                              readOnly
                              value={inviteResult[m.id]}
                              onFocus={(e) => e.target.select()}
                              className="w-full truncate rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600"
                            />
                            <button
                              onClick={() => navigator.clipboard?.writeText(inviteResult[m.id])}
                              className="shrink-0 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="their@email.com"
                            className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                          />
                          <button
                            onClick={() => submitInvite(m.id)}
                            disabled={inviteSending || !inviteEmail.trim()}
                            className="shrink-0 rounded-md bg-gray-900 px-2.5 py-1 text-xs text-white disabled:opacity-50"
                          >
                            {inviteSending ? "Sending…" : "Send"}
                          </button>
                        </div>
                      )}
                      {inviteError && <p className="mt-1 text-xs text-red-500">{inviteError}</p>}
                    </div>
                  ) : (
                    <button
                      onClick={() => openInvite(m)}
                      className="text-xs font-medium text-gray-500 underline hover:text-gray-700"
                    >
                      Invite to log in
                    </button>
                  )}
                </div>
              </div>

              {expandedId === m.id && (
                <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3">
                  <label className="mb-1 block text-xs font-medium text-gray-500">Update for {m.name}</label>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Not sent anywhere yet — just kept on record here until reports can log in."
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={() => submitMessage(m.id)}
                      disabled={sending || !draft.trim()}
                      className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    >
                      {sending ? "Saving..." : "Save update"}
                    </button>
                  </div>

                  {history[m.id] && history[m.id].length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">History</p>
                      <ul className="mt-1.5 space-y-1.5">
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Middle column — company/team goal progress
// ---------------------------------------------------------------------------

function GoalsColumn({ goals }: { goals: TeamGoal[] }) {
  const company = goals.filter((g) => g.level === "company");
  const team = goals.filter((g) => g.level === "team");

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Goal progress</h2>

      <GoalGroup title="Company" goals={company} emptyLabel="No company goals yet." />
      <div className="mt-6">
        <GoalGroup title="Team" goals={team} emptyLabel="No team goals yet." showUnit />
      </div>

      <Link href="/app/goals" className="mt-6 inline-block text-xs text-gray-500 underline hover:text-gray-700">
        Manage goals
      </Link>
    </div>
  );
}

function GoalGroup({
  title,
  goals,
  emptyLabel,
  showUnit,
}: {
  title: string;
  goals: TeamGoal[];
  emptyLabel: string;
  showUnit?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {title}
        {goals.length > 0 && ` (${goals.length})`}
      </p>
      {goals.length === 0 ? (
        <p className="mt-1.5 text-sm text-gray-400">{emptyLabel}</p>
      ) : (
        <ul className="mt-1.5 space-y-2">
          {goals.map((g) => (
            <li key={g.id}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-gray-700">{g.title}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[g.status]}`}>
                  {STATUS_LABELS[g.status]}
                </span>
              </div>
              <p className="text-xs text-gray-400">
                {showUnit && g.org_unit_name ? `${g.org_unit_name} · ` : ""}
                {g.due_date ? `Due ${formatDate(g.due_date)}` : "No due date"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right column — meeting notes
// ---------------------------------------------------------------------------

function NotesColumn({
  notes,
  setNotes,
}: {
  notes: TeamNote[];
  setNotes: React.Dispatch<React.SetStateAction<TeamNote[]>>;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [agendaDraft, setAgendaDraft] = useState("");
  const [agendaDate, setAgendaDate] = useState("");
  const [agendaSaving, setAgendaSaving] = useState(false);
  const [agendaError, setAgendaError] = useState<string | null>(null);

  const [selected, setSelected] = useState<TeamNote | null>(null);

  // Derived, not stored — a note is "upcoming" if it has a meeting_date of
  // today or later. Soonest wins the hero slot; everything else (including
  // any other future-dated notes, an edge case v1 doesn't build a second UI
  // for) falls into the past-meetings grid.
  const today = localDateStr();
  const upcoming = notes
    .filter((n) => n.meeting_date && n.meeting_date >= today)
    .sort((a, b) => (a.meeting_date! < b.meeting_date! ? -1 : 1));
  const nextAgenda = upcoming[0] ?? null;
  const past = notes.filter((n) => n.id !== nextAgenda?.id);

  async function submitLog() {
    if (!draft.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createTeamNote(draft.trim());
      setNotes((n) => [created, ...n]);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  async function submitAgenda() {
    if (!agendaDraft.trim() || !agendaDate || agendaSaving) return;
    setAgendaSaving(true);
    setAgendaError(null);
    try {
      const created = await createTeamNote(agendaDraft.trim(), agendaDate);
      setNotes((n) => [created, ...n]);
      setAgendaDraft("");
      setAgendaDate("");
    } catch (e) {
      setAgendaError(e instanceof Error ? e.message : "Failed to save agenda");
    } finally {
      setAgendaSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Meeting notes</h2>
      <p className="mt-1 text-xs text-gray-400">
        A running log for staff meetings and team syncs — not tied to any single 1:1.
      </p>

      {nextAgenda ? (
        <div className="mt-3 rounded-xl border border-gray-900 bg-gray-900 px-4 py-3 text-white">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-300">
            Next meeting · {formatMeetingDate(nextAgenda.meeting_date!)}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{nextAgenda.note}</p>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400">No upcoming meeting planned.</p>
        </div>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
          Plan next meeting
        </summary>
        <div className="mt-2 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <label className="mb-1 block text-xs font-medium text-gray-500">Meeting date</label>
          <input
            type="date"
            value={agendaDate}
            onChange={(e) => setAgendaDate(e.target.value)}
            min={today}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <label className="mb-1 mt-2 block text-xs font-medium text-gray-500">Agenda</label>
          <textarea
            value={agendaDraft}
            onChange={(e) => setAgendaDraft(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="What you want to cover..."
          />
          {agendaError && <p className="mt-1 text-xs text-red-500">{agendaError}</p>}
          <div className="mt-2 flex justify-end">
            <button
              onClick={submitAgenda}
              disabled={agendaSaving || !agendaDraft.trim() || !agendaDate}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {agendaSaving ? "Saving..." : "Save agenda"}
            </button>
          </div>
        </div>
      </details>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <label className="mb-1 block text-xs font-medium text-gray-500">Log a past meeting</label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="What happened, what to remember..."
        />
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        <div className="mt-2 flex justify-end">
          <button
            onClick={submitLog}
            disabled={saving || !draft.trim()}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Log note"}
          </button>
        </div>
      </div>

      {past.length === 0 ? (
        <p className="mt-4 text-sm text-gray-400">No past meetings logged yet.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {past.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => setSelected(n)}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left hover:border-gray-300 hover:shadow-sm"
              >
                <p className="text-xs text-gray-400">
                  {n.meeting_date ? formatMeetingDate(n.meeting_date) : timeAgo(n.created_at)}
                </p>
                <p className="mt-1 text-sm text-gray-700">{snippet(n.note)}</p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setSelected(null)}
        >
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {selected.meeting_date ? formatMeetingDate(selected.meeting_date) : timeAgo(selected.created_at)}
              </p>
              <button
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-700"
              >
                &times;
              </button>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{selected.note}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team commitments (Session 23) — appended below the roster column.
// ---------------------------------------------------------------------------

function TeamCommitmentsSection({
  members,
  commitments,
  setCommitments,
}: {
  members: TeamMember[];
  commitments: TeamCommitment[];
  setCommitments: React.Dispatch<React.SetStateAction<TeamCommitment[]>>;
}) {
  const [adding, setAdding] = useState(false);
  const [reportId, setReportId] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const open = commitments.filter((c) => c.status === "open");

  async function submit() {
    if (!reportId || !description.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createTeamCommitment({
        directReportId: reportId,
        description: description.trim(),
        dueDate: dueDate || null,
      });
      setCommitments((c) => [created, ...c]);
      setDescription("");
      setDueDate("");
      setReportId("");
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add commitment");
    } finally {
      setSaving(false);
    }
  }

  async function markDone(id: string) {
    setCompletingId(id);
    try {
      const updated = await updateCommitment(id, "done");
      setCommitments((c) => c.map((item) => (item.id === id ? updated : item)));
    } finally {
      setCompletingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Team commitments{open.length > 0 && ` (${open.length})`}
        </h2>
        <button
          onClick={() => setAdding((a) => !a)}
          className="text-xs font-medium text-gray-500 underline hover:text-gray-700"
        >
          {adding ? "Cancel" : "Add"}
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-400">
        Assigned to one person, tracked here for the whole team — also shows on their own page.
      </p>

      {adding && (
        <div className="mt-2 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <label className="mb-1 block text-xs font-medium text-gray-500">Assigned to</label>
          <select
            value={reportId}
            onChange={(e) => setReportId(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">Choose a person...</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <label className="mb-1 mt-2 block text-xs font-medium text-gray-500">Commitment</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <label className="mb-1 mt-2 block text-xs font-medium text-gray-500">Due date (optional)</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
          <div className="mt-2 flex justify-end">
            <button
              onClick={submit}
              disabled={saving || !reportId || !description.trim()}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {open.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">No open team commitments.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {open.map((c) => (
            <li key={c.id} className="rounded-xl border border-gray-200 bg-white px-4 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-gray-700">{c.description}</p>
                  <p className="text-xs text-gray-400">
                    {c.direct_report_name}
                    {c.due_date ? ` · Due ${formatDate(c.due_date)}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => markDone(c.id)}
                  disabled={completingId === c.id}
                  className="shrink-0 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {completingId === c.id ? "Saving..." : "Done"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
