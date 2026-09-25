"use client";

// Portfolio at a glance: four factual counts (each a door to the records
// behind it) and a short scan of projects, exceptions first. Counts use the
// owner/search scope; the selected attention filter narrows the scan and the
// briefs but never the counts. Categories overlap and are never summed.

import type { Project } from "@/lib/api";
import type { AttentionFilter, Overview } from "@/lib/projects";
import { attentionReasons, formatMoment, ownerName } from "@/lib/projects";
import { StatusChip } from "./StatusChip";

export const SCAN_LIMIT = 5;

function Stat({
  value,
  label,
  hint,
  tone,
  pressed,
  onClick,
  door,
  compact,
}: {
  value: number | null;
  label: string;
  hint: string;
  tone: "neutral" | "attention";
  pressed?: boolean;
  onClick: () => void;
  door?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={door ? undefined : pressed}
      className={`group flex min-w-0 flex-col items-start text-left ${compact ? "px-3 py-2.5" : "px-4 py-3"} transition-colors motion-reduce:transition-none sm:px-5 ${
        pressed ? "bg-brand-tint shadow-[inset_0_-2px_0_rgb(var(--c-brand))]" : "bg-surface hover:bg-sunken"
      }`}
    >
      <span className={compact ? "flex flex-col gap-0.5" : "flex items-baseline gap-2"}>
        <span
          className={`text-[1.65rem] font-semibold leading-none tracking-tight ${
            value == null ? "text-ink-muted" : tone === "attention" && value > 0 ? "text-amber-700" : "text-ink"
          }`}
        >
          {value == null ? "—" : value}
        </span>
        <span className="text-[13px] font-medium text-ink-body">
          {label}
          {door && <span aria-hidden className="ml-1 text-ink-muted group-hover:text-ink">→</span>}
        </span>
      </span>
      {value == null ? (
        <span className="mt-1 text-xs leading-snug text-ink-muted">Couldn’t load — unknown, not zero</span>
      ) : (
        !compact && <span className="mt-1 text-xs leading-snug text-ink-muted">{hint}</span>
      )}
    </button>
  );
}

export function OverviewBand({
  counts,
  filter,
  onFilter,
  onNextMoves,
  width,
}: {
  counts: Overview;
  filter: AttentionFilter;
  onFilter: (f: AttentionFilter) => void;
  onNextMoves: () => void;
  /** Available content width, so the band reflows when Scribe opens. */
  width: number;
}) {
  const columns = width >= 900 ? "grid-cols-4" : "grid-cols-2";
  const compact = width < 520;
  return (
    <section aria-labelledby="portfolio-glance" className="mt-5">
      <h2 id="portfolio-glance" className="sr-only">
        Portfolio at a glance
      </h2>
      <div className={`grid gap-px overflow-hidden rounded-xl border border-hairline bg-divider ${columns}`}>
        <Stat value={counts.open} label="Open projects" hint="Everything not completed or cancelled" tone="neutral" compact={compact} pressed={filter === "all"} onClick={() => onFilter("all")} />
        <Stat
          value={counts.attention}
          label="At risk / past due"
          hint="Marked at risk, or past its due date"
          tone="attention"
          compact={compact}
          pressed={filter === "attention"}
          onClick={() => onFilter(filter === "attention" ? "all" : "attention")}
        />
        <Stat
          value={counts.missing}
          label="Missing a recent update"
          hint="None yet, or none in 14 days — missing context, not risk"
          tone="neutral"
          compact={compact}
          pressed={filter === "missing"}
          onClick={() => onFilter(filter === "missing" ? "all" : "missing")}
        />
        <Stat value={counts.nextMoves} label="Your open next moves" hint="Private, including on closed projects" tone="neutral" onClick={onNextMoves} door compact={compact} />
      </div>
    </section>
  );
}

export function PortfolioScan({
  rows,
  total,
  showAll,
  onShowAll,
  onGo,
  wide,
  filterLabel,
}: {
  rows: Project[];
  total: number;
  showAll: boolean;
  onShowAll: (v: boolean) => void;
  onGo: (id: string) => void;
  wide: boolean;
  filterLabel: string;
}) {
  const visible = showAll ? rows : rows.slice(0, SCAN_LIMIT);
  const grid = "grid grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)_7.5rem_minmax(0,1fr)] items-start gap-4";
  return (
    <section aria-labelledby="portfolio-scan" className="mt-4 overflow-hidden rounded-xl border border-hairline bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-divider px-4 py-2.5 sm:px-5">
        <h2 id="portfolio-scan" className="text-sm font-semibold text-ink">
          {filterLabel} <span className="font-normal text-ink-muted">· exceptions first</span>
        </h2>
        {rows.length > SCAN_LIMIT && (
          <p className="text-xs text-ink-muted">
            Showing {visible.length} of {rows.length}
            {" · "}
            <button type="button" onClick={() => onShowAll(!showAll)} aria-expanded={showAll} className="font-medium text-brand hover:text-brand-hover">
              {showAll ? "Show fewer" : "Show all"}
            </button>
          </p>
        )}
      </div>
      {wide && visible.length > 0 && (
        <div aria-hidden className={`${grid} border-b border-divider px-5 py-1.5 text-2xs font-semibold uppercase tracking-[0.1em] text-ink-muted`}>
          <span>Project · owner</span>
          <span>Latest recorded update</span>
          <span>Status</span>
          <span>Why it’s here</span>
        </div>
      )}
      {visible.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">
          {total === 0 ? "No open projects in this view." : "No open projects match this filter."}
        </p>
      ) : (
        <ul className="divide-y divide-divider">
          {visible.map((p) => {
            const reasons = attentionReasons(p);
            const latest = p.last_check_in_at ? (
              <>
                <time dateTime={p.last_check_in_at} className="text-ink-muted">
                  {formatMoment(p.last_check_in_at, false)}
                </time>
                <span className="text-ink-muted"> · </span>
                {p.last_check_in_note ?? <span className="text-ink-muted">Status recorded without a note</span>}
              </>
            ) : (
              <span className="text-ink-muted">No update recorded yet</span>
            );
            const why = reasons.length ? (
              reasons.map((r) => (
                <span key={r.text} className={`block ${r.tone === "attention" ? "font-medium text-amber-700" : "text-ink-muted"}`}>
                  {r.tone === "attention" ? "▲ " : "○ "}
                  {r.text}
                </span>
              ))
            ) : (
              <span className="text-ink-muted">Nothing flagged</span>
            );
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onGo(p.id)}
                  aria-label={`${p.title}: go to its brief`}
                  className={`w-full px-4 py-2.5 text-left transition-colors hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600/60 motion-reduce:transition-none sm:px-5 ${
                    wide ? grid : "block"
                  }`}
                >
                  {wide ? (
                    <>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{p.title}</span>
                        <span className="block truncate text-xs text-ink-muted">
                          {ownerName(p)}
                          {p.org_unit_name ? ` · ${p.org_unit_name}` : ""}
                        </span>
                      </span>
                      <span className="line-clamp-2 min-w-0 break-words text-[13px] leading-5 text-ink-body">{latest}</span>
                      <span>
                        <StatusChip status={p.status} />
                      </span>
                      <span className="min-w-0 text-xs leading-5">{why}</span>
                    </>
                  ) : (
                    <>
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink">{p.title}</span>
                          <span className="block text-xs text-ink-muted">{ownerName(p)}</span>
                        </span>
                        <StatusChip status={p.status} />
                      </span>
                      <span className="mt-1 line-clamp-2 break-words text-[13px] leading-5 text-ink-body">{latest}</span>
                      {reasons.length > 0 && <span className="mt-1 flex flex-wrap gap-x-3 text-xs">{why}</span>}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
