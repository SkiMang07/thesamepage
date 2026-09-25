"use client";

// Work on the Relationship Desk: the compact previews on the Relationship
// view, and the full Work view. Both show only person-scoped records and
// their recorded check-ins. Links between a project and a goal are the
// explicit goal_id link, never a shared owner. Editing and check-ins stay in
// Goals and Projects.

import Link from "next/link";
import type { CapacityOverviewItem, DevelopmentBundle, Goal, GoalStatus, Project } from "@/lib/api";
import { instantDate, shortDate } from "@/components/team/dates";
import { EYEBROW } from "@/lib/tokens";
import { excerpt, firstName } from "./desk";

const STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Active",
  on_track: "On track",
  at_risk: "At risk",
  completed: "Completed",
  cancelled: "Cancelled",
};
const STATUS_TONE: Record<GoalStatus, string> = {
  active: "text-ink-secondary",
  on_track: "text-brand",
  at_risk: "text-amber-700",
  completed: "text-ink-muted",
  cancelled: "text-ink-muted",
};

type WorkItem = { kind: "Goal" | "Project"; record: Goal | Project };

function currentWork(goals: Goal[], projects: Project[]): WorkItem | null {
  const live = (s: GoalStatus) => s !== "completed" && s !== "cancelled";
  const items: WorkItem[] = [
    ...goals.filter((g) => live(g.status)).map((g) => ({ kind: "Goal" as const, record: g })),
    ...projects.filter((p) => live(p.status)).map((p) => ({ kind: "Project" as const, record: p })),
  ];
  if (items.length === 0) return null;
  const atRisk = items.filter((i) => i.record.status === "at_risk");
  const pool = atRisk.length ? atRisk : items;
  // Most recent recorded check-in first; unchecked records keep their order.
  return [...pool].sort((a, b) => (b.record.last_check_in_at ?? "").localeCompare(a.record.last_check_in_at ?? ""))[0];
}

export function DeskPreviews({
  personName,
  goals,
  projects,
  workFailed,
  development,
  developmentFailed,
  onOpenWork,
  onOpenGrowth,
}: {
  personName: string;
  goals: Goal[];
  projects: Project[];
  workFailed: boolean;
  development: DevelopmentBundle | null;
  developmentFailed: boolean;
  onOpenWork: () => void;
  onOpenGrowth: () => void;
}) {
  const first = firstName(personName);
  const work = currentWork(goals, projects);
  const plan = development?.development_plan.plan_text?.trim() ?? "";
  const aspiration = development?.aspiration?.desired_role?.trim() ?? "";

  return (
    <div className="grid gap-8 border-t border-hairline py-8 md:grid-cols-2">
      <div>
        <button type="button" onClick={onOpenWork} className="text-2xs font-medium uppercase tracking-[0.16em] text-ink-muted hover:text-brand">
          Current work <span aria-hidden="true">↗</span>
        </button>
        {workFailed ? (
          <p className="mt-2 text-sm text-amber-700">Goals or projects couldn&apos;t load.</p>
        ) : work ? (
          <>
            <p className="mt-2 text-base text-ink">{work.record.title}</p>
            <p className="mt-1 text-xs text-ink-secondary">
              {work.record.last_check_in_at ? (
                <>
                  {work.kind} update · {instantDate(work.record.last_check_in_at)}
                  {work.record.last_check_in_note ? ` · ${excerpt(work.record.last_check_in_note, 120)}` : ""}
                </>
              ) : (
                <>
                  {work.kind} · <span className={STATUS_TONE[work.record.status]}>{STATUS_LABEL[work.record.status]}</span> · No check-in recorded
                </>
              )}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-secondary">No open goals or projects recorded for {first}.</p>
        )}
      </div>
      <div>
        <button type="button" onClick={onOpenGrowth} className="text-2xs font-medium uppercase tracking-[0.16em] text-ink-muted hover:text-brand">
          Growth direction <span aria-hidden="true">↗</span>
        </button>
        {developmentFailed ? (
          <p className="mt-2 text-sm text-amber-700">The development plan couldn&apos;t load.</p>
        ) : plan ? (
          <>
            <p className="mt-2 text-base text-ink">{excerpt(plan, 140)}</p>
            <p className="mt-1 text-xs text-ink-secondary">From {first}&apos;s saved development plan.</p>
          </>
        ) : aspiration ? (
          <>
            <p className="mt-2 text-base text-ink">{aspiration}</p>
            <p className="mt-1 text-xs text-ink-secondary">{first}&apos;s saved aspiration. No plan written yet.</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-secondary">No development plan or aspiration saved yet.</p>
        )}
      </div>
    </div>
  );
}

export function WorkView({
  personName,
  goals,
  projects,
  goalsFailed,
  projectsFailed,
  capacity,
  capacityFailed,
  onOpenSettings,
}: {
  personName: string;
  goals: Goal[];
  projects: Project[];
  goalsFailed: boolean;
  projectsFailed: boolean;
  capacity: CapacityOverviewItem | undefined;
  capacityFailed: boolean;
  onOpenSettings: () => void;
}) {
  const first = firstName(personName);
  const live = (s: GoalStatus) => s !== "completed" && s !== "cancelled";
  const orderedProjects = [...projects].sort((a, b) => Number(live(b.status)) - Number(live(a.status)));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section aria-labelledby="work-goals" className="rounded-xl border border-hairline bg-surface px-5 py-5">
        <div className="flex items-center justify-between">
          <h2 id="work-goals" className={EYEBROW}>Goals{!goalsFailed && goals.length > 0 && ` · ${goals.length}`}</h2>
          <Link href="/app/goals" className="text-xs text-brand hover:text-brand-hover">Open Goals →</Link>
        </div>
        {goalsFailed ? (
          <p className="mt-3 text-sm text-amber-700">Goals couldn&apos;t load.</p>
        ) : goals.length === 0 ? (
          <p className="mt-3 text-sm text-ink-secondary">No goals for {first} yet. <Link href="/app/goals" className="text-brand underline">Add one in Goals</Link>.</p>
        ) : (
          <ul className="mt-3 divide-y divide-divider">
            {goals.map((g) => (
              <li key={g.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-sm text-ink">{g.title}</p>
                  <span className={`shrink-0 text-xs ${STATUS_TONE[g.status]}`}>{STATUS_LABEL[g.status]}</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {[g.due_date ? `Due ${shortDate(g.due_date)}` : null, g.progress != null ? `${g.progress}% at last check-in` : null]
                    .filter(Boolean)
                    .join(" · ") || "No due date"}
                </p>
                <CheckInLine at={g.last_check_in_at} note={g.last_check_in_note} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="space-y-5">
        <section aria-labelledby="work-projects" className="rounded-xl border border-hairline bg-surface px-5 py-5">
          <div className="flex items-center justify-between">
            <h2 id="work-projects" className={EYEBROW}>Projects{!projectsFailed && projects.length > 0 && ` · ${projects.length}`}</h2>
            <Link href="/app/projects" className="text-xs text-brand hover:text-brand-hover">Open Projects →</Link>
          </div>
          {projectsFailed ? (
            <p className="mt-3 text-sm text-amber-700">Projects couldn&apos;t load.</p>
          ) : projects.length === 0 ? (
            <p className="mt-3 text-sm text-ink-secondary">No projects for {first} yet. <Link href="/app/projects" className="text-brand underline">Add one in Projects</Link>.</p>
          ) : (
            <ul className="mt-3 divide-y divide-divider">
              {orderedProjects.map((p) => (
                <li key={p.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-sm text-ink">{p.title}</p>
                    <span className={`shrink-0 text-xs ${STATUS_TONE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {[p.goal_title ? `Linked to goal: ${p.goal_title}` : "Standalone project", p.due_date ? `Due ${shortDate(p.due_date)}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <CheckInLine at={p.last_check_in_at} note={p.last_check_in_note} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="work-capacity" className="rounded-xl border border-hairline bg-surface px-5 py-5">
          <div className="flex items-center justify-between">
            <h2 id="work-capacity" className={EYEBROW}>Capacity this week</h2>
            <button type="button" onClick={onOpenSettings} className="text-xs text-brand hover:text-brand-hover">Person settings →</button>
          </div>
          {capacityFailed ? (
            <p className="mt-3 text-sm text-amber-700">This week&apos;s capacity couldn&apos;t load.</p>
          ) : capacity ? (
            <p className="mt-2 text-sm text-ink-body">
              <span className="font-sans text-xl tabular-nums text-ink">{Math.round(capacity.available_hours)}h</span>{" "}
              <span className="text-ink-secondary">available this week.</span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-ink-secondary">No capacity figure for this week.</p>
          )}
          <p className="mt-1.5 text-xs text-ink-muted">Hours, utilization and time off are set in Person settings; team totals live in Capacity.</p>
        </section>
      </div>
    </div>
  );
}

function CheckInLine({ at, note }: { at?: string | null; note?: string | null }) {
  if (!at) return <p className="mt-1 text-xs text-ink-muted">No check-in recorded.</p>;
  return (
    <p className="mt-1 text-xs text-ink-secondary">
      Check-in · {instantDate(at)}
      {note ? ` · ${note}` : ""}
    </p>
  );
}
