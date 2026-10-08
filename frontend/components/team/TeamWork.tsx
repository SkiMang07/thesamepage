"use client";

// ---------------------------------------------------------------------------
// Shared work on /app/team, and the form that adds a team commitment.
//
// Shared work shows everything in scope: goals and projects explicitly marked
// at risk lead and carry a subtle amber edge; nothing healthy is hidden behind
// a disclosure (same rule as /app/goals). Each row expands to its latest check-in and to EXPLICIT connections
// only — a project's goal_id, a commitment's source_type/source_id. A shared
// owner is never treated as a link, and a standalone project is described as
// standalone, not as a problem. Progress appears only from a recorded
// check-in: no check-in is "no progress recorded", never 0%.
//
// The page's Commitments list is the shared commitments table
// (components/commitments/CommitmentsTable.tsx); AddCommitment below is its
// "+ Add" form.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Project,
  TeamCommitment,
  TeamGoal,
  TeamMember,
  createTeamCommitment,
} from "@/lib/api";
import NoteField from "@/components/NoteField";
import PersonAvatar from "@/components/team/PersonAvatar";
import { TeamScope, inheritedFrom } from "@/components/team/scope";
import { dueLabel, instantDate, shortDate } from "@/components/team/dates";
import { goalsHref } from "@/lib/goals";
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

  useEffect(() => {
    setExpanded(null);
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
  const visible = [...attention, ...rest];

  return (
    <section id="team-work" aria-labelledby="team-work-heading" className="scroll-mt-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="team-work-heading" className="font-serif text-[1.6rem] font-normal leading-tight tracking-[-0.01em] text-ink">
          Shared work
        </h2>
        <span className="flex gap-4 text-sm">
          <Link href={goalsHref({ level: "team", scope: scope.teamId })} className="text-brand hover:text-brand-hover">Goals →</Link>
          <Link href="/app/projects" className="text-brand hover:text-brand-hover">Projects →</Link>
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-sm text-ink-muted">
          No active goals or projects in this scope. <Link href={goalsHref({ level: "team", scope: scope.teamId, create: true })} className="text-brand hover:text-brand-hover">Set a team goal →</Link>
        </p>
      ) : (
        <>
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
    <article className={`overflow-hidden rounded-lg border bg-surface ${status === "at_risk" ? "border-amber-500/45" : "border-transparent"}`}>
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
                      <Link href={row.project.goal_id ? `/app/goals?goal=${row.project.goal_id}` : "/app/goals"} className="text-sm text-brand hover:text-brand-hover">
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
            <Link href={isGoal ? `/app/goals?goal=${record.id}` : "/app/projects"} className="text-brand hover:text-brand-hover">
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
// Adding a team commitment (the Commitments table on /app/team holds the list:
// components/commitments/CommitmentsTable.tsx)
// ---------------------------------------------------------------------------

export function AddCommitment({
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
