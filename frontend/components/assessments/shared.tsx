"use client";

// Shared pieces of the period-assessment flow (docs/systems/assessments.md):
// stage steps, source chips that open the record they cite, the evidence and
// coverage panel, scale buttons that show each point's meaning, and the
// small vocabulary for where a judgment came from.

import { useState } from "react";
import Link from "next/link";
import type {
  CatalogItem,
  CoverageRow,
  EvidenceItem,
  ItemDecision,
  Judgment,
  ScalePoint,
  SnapshotSource,
} from "@/lib/api";
import { formatDay } from "@/lib/assessment-periods";
import { BADGE } from "@/lib/tokens";

export const EYEBROW_AI = "text-xs font-semibold uppercase tracking-wide text-blue-700";
export const EYEBROW_DRAFT = "text-xs font-semibold uppercase tracking-wide text-amber-700";
export const EYEBROW_DONE = "text-xs font-semibold uppercase tracking-wide text-brand";
export const PANEL = "rounded-xl border border-hairline bg-surface p-5 sm:p-6";

export const ORIGIN_LABEL: Record<ItemDecision["origin"], string> = {
  default: "Not assessed",
  ai: "AI draft",
  ai_confirmed: "AI draft · kept by you",
  manager: "Your judgment",
  ai_revision: "Revised in discussion",
  reaffirmed: "Reaffirmed for this period",
};

export function describeJudgment(item: Pick<CatalogItem, "kind" | "scale">, j: Judgment | null | undefined): string {
  if (!j) return "—";
  if (item.kind === "metric") {
    if (j.value === null || j.value === undefined) return "No reading";
    return `${j.value}${j.period ? ` (${j.period})` : ""}`;
  }
  if (j.point === null || j.point === undefined) return "—";
  const meaning = item.scale.find((s) => s.point === j.point)?.meaning;
  return meaning ? `${j.point} — ${meaning}` : `${j.point}`;
}

export function StageSteps({
  stage,
  onGo,
  disabled,
}: {
  stage: "picture" | "draft" | "review" | "completed";
  onGo?: (s: "picture" | "draft" | "review") => void;
  disabled?: boolean;
}) {
  const steps: { id: "picture" | "draft" | "review"; label: string }[] = [
    { id: "picture", label: "Check the picture" },
    { id: "draft", label: "Draft & discuss" },
    { id: "review", label: "Complete" },
  ];
  const order = { picture: 0, draft: 1, review: 2, completed: 3 };
  return (
    <nav aria-label="Assessment steps" className="rounded-xl border border-hairline bg-surface px-4 py-3">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
        {steps.map((s, i) => {
          const current = s.id === stage;
          const done = order[stage] > i;
          const canGo = !!onGo && !disabled && stage !== "completed" && !current;
          return (
            <li key={s.id} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className="text-ink-faint">→</span>}
              {canGo ? (
                <button type="button" onClick={() => onGo!(s.id)} className="rounded px-1 text-brand hover:underline">
                  {i + 1} {s.label}
                </button>
              ) : (
                <span
                  aria-current={current ? "step" : undefined}
                  className={`px-1 ${current ? "text-ink underline decoration-brand decoration-2 underline-offset-4" : done ? "text-brand" : "text-ink-muted"}`}
                >
                  {i + 1} {s.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

type AnySource = (EvidenceItem | SnapshotSource) & { href?: string };

/** Source chips: date + short title. Each opens the record's own text inline
 *  so the support is inspectable without leaving the page. */
export function SourceChips({
  ids,
  lookup,
  managerContext,
  label,
}: {
  ids: string[] | undefined;
  lookup: (id: string) => AnySource | undefined;
  managerContext?: string | null;
  label?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const list = (ids || []).map((id) => ({ id, src: lookup(id) }));
  if (list.length === 0) return null;
  const opened = list.find((x) => x.id === open);
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {label && <span className="text-ink-muted">{label}</span>}
        {list.map(({ id, src }) => {
          const isContext = id === "manager_context" || id.startsWith("message:");
          const text = isContext
            ? id === "manager_context" ? "Your added context" : "What you said in discussion"
            : src
              ? `${src.date ? formatDay(src.date, false) + " · " : ""}${src.title}`
              : "Source no longer in this set";
          return (
            <button
              key={id}
              type="button"
              aria-expanded={open === id}
              onClick={() => setOpen(open === id ? null : id)}
              className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${
                isContext ? "bg-sunken text-ink-secondary ring-control" : "bg-brand-tint text-brand ring-brand/30 hover:ring-brand"
              }`}
            >
              {text}
            </button>
          );
        })}
      </div>
      {opened && (
        <div className="mt-2 rounded-md bg-sunken px-3 py-2 text-sm text-ink-body">
          {opened.id === "manager_context" ? (
            <>
              <p className="text-xs text-ink-muted">Context you added — attributed to you, not independently verified</p>
              <p className="mt-1 whitespace-pre-wrap">{managerContext || "(empty)"}</p>
            </>
          ) : opened.src ? (
            <>
              <p className="text-xs text-ink-muted">
                {opened.src.date ? formatDay(opened.src.date) : "Undated"} · {opened.src.attribution}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{opened.src.detail}</p>
              {opened.src.href && (
                <Link href={opened.src.href} className="mt-1 inline-block text-xs text-brand hover:underline">
                  Open where it lives →
                </Link>
              )}
            </>
          ) : (
            <p className="text-ink-muted">This record isn’t in the current evidence set (the period or sources changed).</p>
          )}
        </div>
      )}
    </div>
  );
}

const COVERAGE_TEXT: Record<CoverageRow["status"], { label: string; cls: string }> = {
  included: { label: "Included", cls: "bg-teal-50 text-teal-700" },
  none_found: { label: "None found", cls: "bg-sunken text-ink-secondary" },
  private_off: { label: "Off — private", cls: "bg-sunken text-ink-secondary" },
  not_inspected: { label: "Not included", cls: "bg-sunken text-ink-muted" },
  failed: { label: "Couldn’t read", cls: "bg-amber-50 text-amber-700" },
};

export function CoverageTable({ rows }: { rows: CoverageRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr className="text-xs text-ink-muted">
            <th className="py-1.5 pr-3 font-medium">Source</th>
            <th className="py-1.5 pr-3 font-medium">Status</th>
            <th className="py-1.5 pr-3 font-medium">In period</th>
            <th className="py-1.5 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.source} className="border-t border-divider align-top">
              <td className="py-2 pr-3 text-ink-body">{r.label}</td>
              <td className="py-2 pr-3">
                <span className={`${BADGE} ${COVERAGE_TEXT[r.status].cls}`}>{COVERAGE_TEXT[r.status].label}</span>
              </td>
              <td className="py-2 pr-3 tabular-nums text-ink-secondary">
                {r.status === "included" ? r.in_period + (r.background ? ` (+${r.background} background)` : "") : "—"}
              </td>
              <td className="py-2 text-ink-secondary">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TIMING_LABEL = { in_period: "In period", context: "Context", background: "Background — before the period" };

/** The evidence set, grouped by timing, with an optional include/exclude
 *  toggle per record (excluding only affects this assessment). */
export function EvidenceList({
  items,
  excluded,
  onToggle,
  disabled,
}: {
  items: EvidenceItem[];
  excluded?: string[];
  onToggle?: (id: string) => void;
  disabled?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = (["in_period", "context", "background"] as const)
    .map((t) => ({ t, rows: items.filter((i) => i.timing === t) }))
    .filter((g) => g.rows.length);
  if (!items.length) return <p className="text-sm text-ink-muted">No records were found for this period.</p>;
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.t}>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{TIMING_LABEL[g.t]}</p>
          <ul className="mt-1.5 divide-y divide-divider">
            {g.rows.map((i) => {
              const out = excluded?.includes(i.id);
              return (
                <li key={i.id} className="py-2">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setOpenId(openId === i.id ? null : i.id)}
                      aria-expanded={openId === i.id}
                      className={`min-w-0 text-left text-sm ${out ? "text-ink-faint line-through" : "text-ink-body"} hover:text-ink`}
                    >
                      <span className="text-ink-muted">{i.date ? formatDay(i.date) : "Undated"} · </span>
                      {i.title}
                      {i.private && <span className={`${BADGE} ml-2 bg-sunken text-ink-secondary`}>Private</span>}
                    </button>
                    {onToggle && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onToggle(i.id)}
                        className="shrink-0 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                      >
                        {out ? "Include" : "Leave out"}
                      </button>
                    )}
                  </div>
                  {openId === i.id && (
                    <div className="mt-1.5 rounded-md bg-sunken px-3 py-2 text-sm text-ink-body">
                      <p className="text-xs text-ink-muted">{i.attribution}</p>
                      <p className="mt-1 whitespace-pre-wrap">{i.detail}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Scale points with their meaning always visible — never a bare number
 *  whose meaning hides in a tooltip. */
export function ScaleButtons({
  scale,
  selected,
  proposed,
  prior,
  onPick,
  disabled,
}: {
  scale: ScalePoint[];
  selected: number | null | undefined;
  proposed?: number | null;
  prior?: number | null;
  onPick: (p: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {scale.map((s) => {
        const on = selected === s.point;
        return (
          <button
            key={s.point}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onPick(s.point)}
            className={`min-w-[5.5rem] rounded-md px-2.5 py-1.5 text-left text-sm transition disabled:opacity-50 ${
              on ? "bg-brand text-on-brand" : "border border-control bg-surface text-ink-body hover:bg-sunken"
            }`}
          >
            <span className="font-semibold tabular-nums">{s.point}</span>
            {s.meaning && <span className={`ml-1.5 ${on ? "" : "text-ink-secondary"}`}>{s.meaning}</span>}
            {(proposed === s.point || prior === s.point) && (
              <span className={`block text-[11px] ${on ? "opacity-90" : "text-ink-muted"}`}>
                {[proposed === s.point ? "AI proposed" : null, prior === s.point ? "prior" : null].filter(Boolean).join(" · ")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function OriginBadge({ origin }: { origin: ItemDecision["origin"] }) {
  const cls =
    origin === "ai"
      ? "bg-amber-50 text-amber-700"
      : origin === "manager" || origin === "reaffirmed" || origin === "ai_confirmed"
        ? "bg-teal-50 text-teal-700"
        : origin === "ai_revision"
          ? "bg-blue-50 text-blue-700"
          : "bg-sunken text-ink-muted";
  return <span className={`${BADGE} ${cls}`}>{ORIGIN_LABEL[origin]}</span>;
}
