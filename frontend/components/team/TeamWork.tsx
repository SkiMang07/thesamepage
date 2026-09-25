"use client";

// ---------------------------------------------------------------------------
// Shared work and Commitments on /app/team.
//
// Shared work is exception-first, not exception-only: goals and projects
// explicitly marked at risk lead; everything else in scope is one disclosure
// away. Each row expands to its latest check-in and to EXPLICIT connections
// only — a project's goal_id, a commitment's source_type/source_id. A shared
// owner is never treated as a link, and a standalone project is described as
// standalone, not as a problem. Progress appears only from a recorded
// check-in: no check-in is "no progress recorded", never 0%.
//
// Commitments are ordered by due date with explicit overdue / due-soon /
// undated text, three rows first, and filters whose counts are computed from
// the same list the rows come from.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Project,
  TeamCommitment,
  TeamGoal,
  TeamMeeting,
  TeamMember,
  createTeamCommitment,
  updateCommitment,
} from "@/lib/api";
import NoteField from "@/components/NoteField";
import PersonAvatar from "@/components/team/PersonAvatar";
import { commitmentSource } from "@/components/team/meeting-prep";
import { TeamScope, inheritedFrom } from "@/components/team/scope";
import { dueLabel, dueState, instantDate, localDateStr, shortDate } from "@/components/team/dates";
import { BTN_PRIMARY_SM, ERROR_TEXT, INPUT, LABEL, SELECT, STATUS_GLYPH, Status } from "@/lib/tokens";

const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  on_track: "On track",
  at_risk: "At risk",
  completed: "Completed",
  cancelled: "Cancelled",
};

const LEVEL_LABEL: Record<string, string> = {
  company: "Company goal",
  department: "Department goal",
  team: "Team goal",
  individual: "Individual goal",
};

type WorkRow =
  | { kind: "goal"; id: string; goal: TeamGoal }
  | { kind: "project"; id: string; project: Project };

function otherLabel(rest: WorkRow[]): string {
  const goals = rest.filter((r) => r.kind === "goal").length;
  const projects = rest.length - goals;
  const parts = [
    goals ? `${goals} other goal${goals === 1 ? "" : "s"}` : null,
    projects ? `${projects} ${goals ? "" : "other "}project${projects === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.join(" & ");
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Shared work
// ---------------------------------------------------------------------------

export function SharedWork({
  goals,
  projects,
  commitments,
  scope,
  unitName,
}: {
  goals: TeamGoal[];
  projects: Project[];
  commitments: TeamCommitment[];
  scope: TeamScope;
  unitName: (id: string | null) => string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setExpanded(null);
    setShowAll(false);
  }, [scope.teamId]);

  const levelOrder: Record<string, number> = { company: 0, department: 1, team: 2 };
  const rows: WorkRow[] = [
    ...[...goals]
      .sort((a, b) => (levelOrder[a.level] ?? 3) - (levelOrder[b.level] ?? 3))
      .map((g) => ({ kind: "goal" as const, id: `goal-${g.id}`, goal: g })),
    ...[...projects]
      .sort((a, b) => (a.due_date ?? "9999") < (b.due_date ?? "9999") ? -1 : 1)
      .map((p) => ({ kind: "project" as const, id: `project-${p.id}`, project: p })),
  ];
  const statusOf = (r: WorkRow) => (r.kind === "goal" ? r.goal.status : r.project.status);
  const attention = rows.filter((r) => statusOf(r) === "at_risk");
  const rest = rows.filter((r) => statusOf(r) !== "at_risk");
  const visible = showAll ? [...attention, ...rest] : attention;

  return (
    <section id="team-work" aria-labelledby="team-work-heading" className="scroll-mt-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="team-work-heading" className="font-serif text-[1.6rem] font-normal leading-tight tracking-[-0.01em] text-ink">
          Shared work
        </h2>
        <span className="flex gap-4 text-sm">
          <Link href="/app/goals" className="text-brand hover:text-brand-hover">Goals →</Link>
          <Link href="/app/projects" className="text-brand hover:text-brand-hover">Projects →</Link>
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-sm text-ink-muted">
          No active goals or projects in this scope. <Link href="/app/goals" className="text-brand hover:text-brand-hover">Set a goal →</Link>
        </p>
      ) : (
        <>
          {attention.length === 0 && !showAll && (
            <p className="pb-3 text-sm text-ink-muted">No goals or projects are marked at risk.</p>
          )}
          <div className="space-y-2.5">
            {visible.map((row) => (
              <WorkRowView
                key={row.id}
                row={row}
                open={expanded === row.id}
                onToggle={() => setExpanded((cur) => (cur === row.id ? null : row.id))}
                goals={goals}
                projects={projects}
                commitments={commitments}
                scope={scope}
                unitName={unitName}
              />
            ))}
          </div>
          {rest.length > 0 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="mt-3 text-sm text-brand hover:text-brand-hover">
              {showAll ? "Show only work marked at risk" : `Show ${otherLabel(rest)} →`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function WorkRowView({
  row,
  open,
  onToggle,
  goals,
  projects,
  commitments,
  scope,
  unitName,
}: {
  row: WorkRow;
  open: boolean;
  onToggle: () => void;
  goals: TeamGoal[];
  projects: Project[];
  commitments: TeamCommitment[];
  scope: TeamScope;
  unitName: (id: string | null) => string;
}) {
  const isGoal = row.kind === "goal";
  const record = isGoal ? row.goal : row.project;
  const status = record.status as Status;
  const orgUnitId = record.org_unit_id;
  const inherited = !(isGoal && row.goal.level === "company") && inheritedFrom(scope, orgUnitId);
  const inheritedName = isGoal ? row.goal.org_unit_name : row.project.org_unit_name;

  // Explicit links only.
  const linkedProjects = isGoal ? projects.filter((p) => p.goal_id === row.goal.id) : [];
  const linkedGoal = !isGoal && row.project.goal_id ? goals.find((g) => g.id === row.project.goal_id) ?? null : null;
  const linkedCommitments = commitments.filter(
    (c) =>
      c.status === "open" &&
      c.source_id === record.id &&
      c.source_type === (isGoal ? "goal" : "project")
  );

  const eyebrow = isGoal ? LEVEL_LABEL[row.goal.level] ?? "Goal" : "Project";
  const meta = isGoal
    ? [
        linkedProjects.length > 0
          ? linkedProjects.length === 1
            ? linkedProjects[0].title
            : `${linkedProjects.length} linked projects`
          : null,
        record.due_date ? `Due ${shortDate(record.due_date)}` : null,
      ]
    : [
        row.project.direct_report_name ?? "You",
        linkedGoal ? `Supports ${linkedGoal.title}` : row.project.goal_title ? `Supports ${row.project.goal_title}` : null,
        record.due_date ? `Due ${shortDate(record.due_date)}` : null,
      ];
  const metaText = meta.filter(Boolean).join(" · ");
  const panelId = `work-${row.id}`;

  return (
    <article className="overflow-hidden rounded-lg bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-4 text-left hover:bg-sunken/60 sm:px-5 ${open ? "bg-sunken/60" : ""}`}
      >
        <span className="min-w-0">
          <span className="block text-2xs uppercase tracking-[0.14em] text-ink-muted">
            {eyebrow}
            {inherited && inheritedName ? ` · From ${inheritedName}` : ""}
          </span>
          <span className="mt-1.5 block text-[15px] text-ink">{record.title}</span>
          {metaText && <span className="mt-1 block truncate text-xs text-ink-muted">{metaText}</span>}
        </span>
        <span
          className={`flex shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 text-2xs ${
            status === "at_risk" ? "border-amber-500/50 text-amber-700" : "border-hairline text-ink-muted"
          }`}
        >
          <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
          {STATUS_LABEL[status]}
          <span aria-hidden="true" className="ml-1 text-ink-muted">{open ? "−" : "+"}</span>
        </span>
      </button>

      {open && (
        <div id={panelId} className="px-4 pb-5 pt-1 sm:px-5">
          <CheckInLine record={record} />

          {isGoal ? (
            linkedProjects.length === 0 && linkedCommitments.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">No projects or commitments are linked to this goal.</p>
            ) : (
              <Connections>
                {linkedProjects.map((p) => (
                  <Node key={p.id} label="Linked project">
                    <Link href="/app/projects" className="text-sm text-brand hover:text-brand-hover">{p.title} →</Link>
                    <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                      <PersonAvatar id={p.direct_report_id} name={p.direct_report_name ?? "You"} size="xs" />
                      {p.direct_report_name ?? "You"} · {STATUS_LABEL[p.status as Status]}
                      {p.progress != null ? ` · ${p.progress}%` : ""}
                    </span>
                  </Node>
                ))}
                {linkedCommitments.map((c) => (
                  <CommitmentNode key={c.id} c={c} />
                ))}
              </Connections>
            )
          ) : (
            <>
              {!linkedGoal && !row.project.goal_id && (
                <p className="mt-3 text-sm text-ink-muted">Standalone project — it isn&apos;t linked to a goal.</p>
              )}
              {(linkedGoal || row.project.goal_id || linkedCommitments.length > 0) && (
                <Connections>
                  {(linkedGoal || row.project.goal_title) && (
                    <Node label="Supports goal">
                      <Link href="/app/goals" className="text-sm text-brand hover:text-brand-hover">
                        {linkedGoal?.title ?? row.project.goal_title} →
                      </Link>
                      {!linkedGoal && <span className="mt-1 block text-xs text-ink-muted">Not in this team&apos;s view</span>}
                    </Node>
                  )}
                  {linkedCommitments.map((c) => (
                    <CommitmentNode key={c.id} c={c} />
                  ))}
                </Connections>
              )}
            </>
          )}

          <p className="mt-4 text-xs text-ink-muted">
            {inherited && inheritedName ? `Belongs to ${inheritedName}, shown here because it sits above this team. ` : ""}
            {!inherited && orgUnitId ? `${unitName(orgUnitId)} · ` : ""}
            <Link href={isGoal ? "/app/goals" : "/app/projects"} className="text-brand hover:text-brand-hover">
              Open in {isGoal ? "Goals" : "Projects"} →
            </Link>
          </p>
        </div>
      )}
    </article>
  );
}

function CheckInLine({ record }: { record: TeamGoal | Project }) {
  if (!record.last_check_in_at) {
    return <p className="text-sm text-ink-muted">No check-in recorded yet, so no progress is shown.</p>;
  }
  const age = daysSince(record.last_check_in_at);
  const stale = age > 14;
  return (
    <div className="text-sm">
      <p className="text-ink-secondary">
        Latest check-in <span className={stale ? "text-amber-700" : undefined}>{instantDate(record.last_check_in_at)}{stale ? ` · ${age} days ago` : ""}</span>
        {" · "}
        {record.progress != null ? `${record.progress}% recorded` : "No percentage recorded"}
      </p>
      {record.last_check_in_note && <p className="mt-1 text-ink-muted">“{record.last_check_in_note}”</p>}
    </div>
  );
}

function Connections({ children }: { children: React.ReactNode }) {
  return (
    <div className="ml-2 mt-4 border-l border-control pl-5" aria-label="Linked records">
      {children}
    </div>
  );
}

function Node({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative pb-4 last:pb-0">
      <span className="absolute -left-[24px] top-1.5 h-[7px] w-[7px] rounded-full bg-brand" aria-hidden="true" />
      <p className="text-2xs uppercase tracking-[0.14em] text-ink-muted">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function CommitmentNode({ c }: { c: TeamCommitment }) {
  return (
    <Node label="Linked commitment">
      <a href="#team-commitments" className="text-sm text-ink-body hover:text-ink">{c.description}</a>
      <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
        <PersonAvatar id={c.direct_report_id ?? null} name={c.direct_report_name ?? "You"} size="xs" />
        {c.direct_report_name ?? "You"} · {dueLabel(c.due_date)}
      </span>
    </Node>
  );
}

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

type Filter = "all" | "overdue" | "mine";
const INITIAL_ROWS = 3;

export function TeamCommitments({
  commitments,
  setCommitments,
  members,
  selectedTeamId,
  meetings,
  goals,
  projects,
  twoColumn,
}: {
  /** Commitments in the selected scope (any status). */
  commitments: TeamCommitment[];
  setCommitments: React.Dispatch<React.SetStateAction<TeamCommitment[]>>;
  members: TeamMember[];
  selectedTeamId: string | null;
  meetings: TeamMeeting[];
  goals: TeamGoal[];
  projects: Project[];
  twoColumn: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [person, setPerson] = useState<string>("");
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // A different scope has different people and records: clear anything that
  // could now point at someone who isn't here.
  useEffect(() => {
    setFilter("all");
    setPerson("");
    setShowAll(false);
    setExpanded(null);
    setAdding(false);
  }, [selectedTeamId]);
  useEffect(() => {
    if (person && person !== "you" && !members.some((m) => m.id === person)) setPerson("");
  }, [members, person]);

  const today = localDateStr();
  const open = useMemo(
    () =>
      commitments
        .filter((c) => c.status === "open")
        .sort((a, b) => {
          if (!a.due_date && !b.due_date) return a.created_at < b.created_at ? -1 : 1;
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return a.due_date.localeCompare(b.due_date);
        }),
    [commitments]
  );

  const byPerson = person === "" ? open : open.filter((c) => (person === "you" ? !c.direct_report_id : c.direct_report_id === person));
  const counts = {
    all: byPerson.length,
    overdue: byPerson.filter((c) => dueState(c.due_date, today) === "overdue").length,
    mine: open.filter((c) => !c.direct_report_id).length,
  };
  const shown = (filter === "mine"
    ? open.filter((c) => !c.direct_report_id)
    : byPerson.filter((c) => filter === "all" || dueState(c.due_date, today) === filter));
  const rows = showAll ? shown : shown.slice(0, INITIAL_ROWS);

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All open", count: counts.all },
    { key: "overdue", label: "Overdue", count: counts.overdue },
    { key: "mine", label: "Mine", count: counts.mine },
  ];

  return (
    <section id="team-commitments" aria-labelledby="team-commitments-heading" className="scroll-mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="team-commitments-heading" className="font-serif text-[1.6rem] font-normal leading-tight tracking-[-0.01em] text-ink">
          Commitments
        </h2>
        <button type="button" onClick={() => setAdding((v) => !v)} aria-expanded={adding} className="text-sm text-brand hover:text-brand-hover">
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>

      {adding && (
        <AddCommitment
          members={members}
          selectedTeamId={selectedTeamId}
          onCreated={(c) => {
            setCommitments((rows) => [c, ...rows]);
            setAdding(false);
          }}
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label="Filter commitments">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => {
              setFilter(f.key);
              setShowAll(false);
              if (f.key === "mine") setPerson("");
            }}
            className={`rounded-md px-2.5 py-1 text-xs ${
              filter === f.key ? "bg-brand-tint text-brand" : "text-ink-secondary hover:bg-sunken hover:text-ink"
            }`}
          >
            {f.label} · <span className="font-sans tabular-nums">{f.count}</span>
          </button>
        ))}
      </div>
      {members.length > 0 && filter !== "mine" && (
        <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
          Owner
          <select
            value={person}
            onChange={(e) => {
              setPerson(e.target.value);
              setShowAll(false);
            }}
            className="h-7 min-w-0 max-w-52 flex-1 rounded-md border border-control bg-sunken px-2 text-xs text-ink-body"
          >
            <option value="">Everyone</option>
            <option value="you">You</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
      )}

      {rows.length === 0 ? (
        <p className="py-5 text-sm text-ink-muted">
          {open.length === 0 ? "No open team commitments." : "No open commitments match this filter."}
        </p>
      ) : (
        <ul className={twoColumn ? "grid grid-cols-2 gap-x-6" : ""}>
          {rows.map((c) => (
            <CommitmentRow
              key={c.id}
              c={c}
              open={expanded === c.id}
              onToggle={() => setExpanded((cur) => (cur === c.id ? null : c.id))}
              meetings={meetings}
              goals={goals}
              projects={projects}
              onUpdated={(updated) =>
                setCommitments((all) =>
                  all.map((row) => (row.id === updated.id ? { ...row, ...updated, direct_report_name: row.direct_report_name } : row))
                )
              }
            />
          ))}
        </ul>
      )}
      {shown.length > INITIAL_ROWS && (
        <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="mt-3 text-sm text-brand hover:text-brand-hover">
          {showAll ? "Show fewer" : `View all ${shown.length} commitments →`}
        </button>
      )}
    </section>
  );
}

function CommitmentRow({
  c,
  open,
  onToggle,
  meetings,
  goals,
  projects,
  onUpdated,
}: {
  c: TeamCommitment;
  open: boolean;
  onToggle: () => void;
  meetings: TeamMeeting[];
  goals: TeamGoal[];
  projects: Project[];
  onUpdated: (c: TeamCommitment) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = dueState(c.due_date);
  const owner = c.direct_report_name ?? "You";
  const source = commitmentSource(c, meetings, { goals, projects });

  async function markDone() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      onUpdated(await updateCommitment(c.id, "done"));
    } catch {
      setError("Couldn't mark it done. Try again.");
      setSaving(false);
    }
  }

  return (
    <li className={`border-b border-hairline py-3.5 ${state === "overdue" ? "border-l-2 border-l-amber-500 pl-3" : ""}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="block w-full rounded text-left text-sm leading-6 text-ink hover:text-ink-body"
      >
        {c.description}
      </button>
      <div className="mt-2 flex items-center gap-2">
        <PersonAvatar id={c.direct_report_id ?? null} name={owner} size="xs" />
        <span className="min-w-0 truncate text-xs text-ink-muted">{owner}</span>
        <span className={`ml-auto shrink-0 text-2xs ${state === "overdue" ? "text-amber-700" : state === "soon" ? "text-ink-body" : "text-ink-muted"}`}>
          {dueLabel(c.due_date)}
        </span>
      </div>
      {open && (
        <div className="mt-3 rounded-md bg-sunken px-3 py-2.5 text-xs">
          <p className="text-ink-muted">
            {source.href ? (
              <Link href={source.href} className="text-brand hover:text-brand-hover">{source.label} →</Link>
            ) : (
              source.label
            )}
            {" · "}added {instantDate(c.created_at)}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={markDone}
              disabled={saving}
              className="rounded-md border border-control px-2.5 py-1 text-xs font-medium text-ink-body hover:bg-surface disabled:opacity-50"
            >
              {saving ? "Saving…" : "Mark done"}
            </button>
            {c.direct_report_id && (
              <Link href={`/app/reports/${c.direct_report_id}`} className="text-brand hover:text-brand-hover">
                {owner}&apos;s Relationship Desk →
              </Link>
            )}
          </div>
          {error && <p className="mt-1.5 text-amber-700" role="alert">{error}</p>}
        </div>
      )}
    </li>
  );
}

function AddCommitment({
  members,
  selectedTeamId,
  onCreated,
}: {
  members: TeamMember[];
  selectedTeamId: string | null;
  onCreated: (c: TeamCommitment) => void;
}) {
  const [reportId, setReportId] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!description.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      onCreated(
        await createTeamCommitment({
          directReportId: reportId || null,
          description: description.trim(),
          dueDate: dueDate || null,
          orgUnitId: selectedTeamId,
        })
      );
    } catch {
      setError("Couldn't add the commitment. Your text is still here — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg bg-surface px-4 py-4">
      <label className={LABEL} htmlFor="commitment-text">Commitment</label>
      <NoteField id="commitment-text" value={description} onChange={setDescription} rows={2} className="w-full text-sm" />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL} htmlFor="commitment-owner">Owner</label>
          <select id="commitment-owner" value={reportId} onChange={(e) => setReportId(e.target.value)} className={SELECT}>
            {/* "You" is a real owner, not a missing one. */}
            <option value="">You</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="commitment-due">Due (optional)</label>
          <input id="commitment-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={INPUT} />
        </div>
      </div>
      {error && <p className={`${ERROR_TEXT} mt-2`}>{error}</p>}
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={submit} disabled={saving || !description.trim()} className={BTN_PRIMARY_SM}>
          {saving ? "Saving…" : "Add commitment"}
        </button>
      </div>
    </div>
  );
}
