"use client";

// One project, compact: purpose and the latest recorded situation side by
// side, the owner/team/goal/due facts on one line, and the actions that open
// in place underneath (update, the record, your next move, details/edit).

import { forwardRef, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Project } from "@/lib/api";
import { IDENTITY_BG, IDENTITY_TEXT, identityIndex } from "@/lib/tokens";
import { PROJECT_STATUS_LABEL, attentionReasons, formatDay, formatMoment, initials, ownerName } from "@/lib/projects";
import { StatusChip } from "./StatusChip";
import AskAboutButton from "@/components/AskAboutButton";

export type Panel = "update" | "record" | "follow" | "details" | "edit";

/** Clamped text with an explicit "Show more" when it actually overflows. */
function Clamp({ text, lines, className }: { text: string; lines: 2 | 3 | 4; className: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const clamp = lines === 2 ? "line-clamp-2" : lines === 3 ? "line-clamp-3" : "line-clamp-4";
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  return (
    <>
      <p ref={ref} className={`whitespace-pre-wrap break-words ${open ? "" : clamp} ${className}`}>
        {text}
      </p>
      {(overflows || open) && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 text-xs text-brand hover:text-brand-hover">
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}

type Props = {
  project: Project;
  panel: Panel | null;
  wide: boolean;
  justSaved: boolean;
  hasDraft: boolean;
  onPanel: (panel: Panel | null) => void;
  children?: ReactNode; // the open panel's content
};

const ProjectBrief = forwardRef<HTMLHeadingElement, Props>(function ProjectBrief(
  { project: p, panel, wide, justSaved, hasDraft, onPanel, children },
  headingRef,
) {
  const reasons = attentionReasons(p);
  const attention = reasons.some((r) => r.tone === "attention");
  const owner = ownerName(p);
  const latestAt = p.last_check_in_at;
  const statusDiffers = p.last_check_in_status && p.last_check_in_status !== p.status;
  const toggle = (next: Panel) => onPanel(panel === next ? null : next);
  const btn = (active: boolean, primary = false) =>
    `rounded-md px-2.5 py-1.5 text-[13px] font-medium ${
      active ? "bg-brand-tint text-brand" : primary ? "text-brand hover:bg-sunken hover:text-brand-hover" : "text-ink-secondary hover:bg-sunken hover:text-ink"
    }`;

  return (
    <article
      id={`project-${p.id}`}
      aria-labelledby={`project-${p.id}-title`}
      className={`scroll-mt-24 overflow-hidden rounded-xl border bg-surface ${
        attention ? "border-hairline border-l-amber-500 border-l-2" : "border-hairline"
      } ${justSaved ? "animate-save-glow motion-reduce:animate-none" : ""}`}
    >
      <div className="px-4 pb-3 pt-3.5 sm:px-5">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <h2
            id={`project-${p.id}-title`}
            ref={headingRef}
            tabIndex={-1}
            className="min-w-0 flex-1 break-words font-serif text-[1.3rem] font-normal leading-snug text-ink outline-none focus-visible:ring-2 focus-visible:ring-blue-600/60 sm:text-[1.45rem]"
          >
            {p.title}
          </h2>
          <StatusChip status={p.status} />
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-secondary">
          <span
            aria-hidden
            className={`inline-grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold ${
              p.direct_report_id ? `${IDENTITY_BG[identityIndex(p.direct_report_id)]} ${IDENTITY_TEXT}` : "bg-sunken text-ink-secondary"
            }`}
          >
            {p.direct_report_id ? initials(owner) : "Y"}
          </span>
          <span className="text-ink-body">{owner}</span>
          <span aria-hidden>·</span>
          <span>{p.org_unit_name ?? (p.org_unit_id ? "Team unavailable" : "No team assigned")}</span>
          <span aria-hidden>·</span>
          <span>{p.goal_id ? <>Supports <span className="text-ink-body">{p.goal_title ?? "a goal you can’t see here"}</span></> : "Standalone"}</span>
          <span aria-hidden>·</span>
          <span>{p.due_date ? `Due ${formatDay(p.due_date)}` : "No due date"}</span>
          {reasons.length > 0 && (
            <span className="flex flex-wrap gap-x-2 sm:ml-auto">
              {reasons.map((r) => (
                <span key={r.text} className={r.tone === "attention" ? "font-medium text-amber-700" : "text-ink-muted"}>
                  {r.tone === "attention" ? "▲ " : "○ "}
                  {r.text}
                </span>
              ))}
            </span>
          )}
        </p>

        <div className={`mt-3 grid gap-3 ${wide ? "grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-6" : "grid-cols-1"}`}>
          <section aria-label="Purpose" className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Purpose</p>
            {p.description ? (
              <Clamp text={p.description} lines={3} className="mt-1 text-sm leading-6 text-ink-body" />
            ) : (
              <p className="mt-1 text-sm text-ink-muted">No purpose written yet.</p>
            )}
          </section>
          <section
            aria-label="Latest recorded update"
            className={`min-w-0 ${wide ? "border-l border-divider pl-6" : "border-t border-divider pt-3"}`}
          >
            <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
              {latestAt ? (
                <>
                  Latest update · <time dateTime={latestAt}>{formatMoment(latestAt)}</time>
                  {statusDiffers ? ` · recorded ${PROJECT_STATUS_LABEL[p.last_check_in_status!].toLowerCase()}` : ""}
                </>
              ) : (
                "No update yet"
              )}
            </p>
            {latestAt ? (
              p.last_check_in_note ? (
                <Clamp text={p.last_check_in_note} lines={3} className="mt-1 text-[0.95rem] leading-6 text-ink" />
              ) : (
                <p className="mt-1 text-sm text-ink-muted">Status recorded without a note.</p>
              )
            ) : (
              <p className="mt-1 text-sm text-ink-muted">Record where things stand so the next visit starts with context.</p>
            )}
            {p.progress != null && (
              <p className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
                <span className="inline-block h-1 w-16 overflow-hidden rounded bg-hairline" aria-hidden>
                  <span className="block h-full bg-brand" style={{ width: `${p.progress}%` }} />
                </span>
                {p.progress}% completion · recorded {p.progress_at ? formatMoment(p.progress_at) : ""}
              </p>
            )}
            {p.next_move && panel !== "follow" && (
              <div className="mt-2.5 border-l-2 border-brand bg-canvas px-3 py-2">
                <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-brand">Your next move · private</p>
                <p className="mt-0.5 line-clamp-2 break-words text-sm text-ink-body">{p.next_move.body}</p>
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-t border-divider px-3 py-1.5 sm:px-4">
        <button type="button" aria-expanded={panel === "update"} onClick={() => toggle("update")} className={btn(panel === "update", true)}>
          + Record an update{hasDraft && panel !== "update" ? " · draft" : ""}
        </button>
        <button type="button" aria-expanded={panel === "record"} onClick={() => toggle("record")} className={btn(panel === "record")}>
          The record
        </button>
        <button type="button" aria-expanded={panel === "follow"} onClick={() => toggle("follow")} className={btn(panel === "follow")}>
          {p.next_move ? "Your next move" : "+ Your next move"}
        </button>
        <AskAboutButton
          label="Ask about this project"
          prompt={`How is "${p.title}" going, and what's getting in its way?`}
          context={{
            label: `Projects page — selected project: ${p.title}`,
            entity_type: "project",
            entity_id: p.id,
            subject: p.title,
          }}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-ink-secondary hover:bg-sunken hover:text-ink"
        />
        <button
          type="button"
          aria-expanded={panel === "details" || panel === "edit"}
          onClick={() => toggle("details")}
          className={`${btn(panel === "details" || panel === "edit")} sm:ml-auto`}
        >
          Details &amp; edit
        </button>
      </div>
      {panel && <div className="border-t border-divider bg-canvas/60 px-4 py-4 sm:px-5">{children}</div>}
    </article>
  );
});

export default ProjectBrief;
