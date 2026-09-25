"use client";

// The completed assessment — the payoff, not a receipt. Rendered only from
// the frozen completion snapshot, so the wording, scale meanings and sources
// shown here are the ones the manager confirmed, even if expectations or
// records change later. The save receipt is secondary.

import { useState } from "react";
import Link from "next/link";
import type { CompletedSnapshot, PeriodAssessment, SnapshotItem, SnapshotSource } from "@/lib/api";
import { firstName, formatDay, periodNoun } from "@/lib/assessment-periods";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW } from "@/lib/tokens";
import { CoverageTable, EYEBROW_DONE, OriginBadge, PANEL, SourceChips } from "./shared";

function judgmentText(i: SnapshotItem): string {
  if (i.kind === "metric") return `${i.value}${i.period ? ` (${i.period})` : ""}`;
  return i.meaning ? `${i.point} — ${i.meaning}` : `${i.point}`;
}

export default function CompletedView({ review, justCompleted }: { review: PeriodAssessment; justCompleted: boolean }) {
  const snap = review.completed_snapshot as CompletedSnapshot | null;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  if (!snap) {
    return (
      <p className="mt-6 text-ink-secondary">
        This assessment was completed, but its details weren’t stored in this format.
      </p>
    );
  }
  const first = firstName(snap.person.name);
  const summary = snap.summary;
  const overall = snap.items.find((i) => i.kind === "overall");
  const sources = new Map<string, SnapshotSource>();
  for (const e of snap.evidence || []) sources.set(e.id, e);
  for (const it of snap.items) for (const s of it.sources || []) sources.set(s.id, s);
  const lookup = (id: string) => sources.get(id);
  const recognized = summary?.contributions || [];
  const gaps = summary?.gaps || [];
  const priorOnly = snap.unassessed.filter((u) => u.prior);
  const reportId = snap.person.id;
  const noun = periodNoun(snap.period.cadence, snap.period.start, snap.period.end);

  return (
    <>
      {justCompleted && (
        <p role="status" className="mt-5 rounded-lg border-l-2 border-brand bg-brand-tint px-4 py-2.5 text-sm text-ink-body">
          Assessment completed. {snap.items.length} judgment{snap.items.length === 1 ? "" : "s"} recorded for {snap.period.label}. Nothing was shared with {first}.
        </p>
      )}
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
        <section aria-labelledby="completed-title" className={PANEL}>
          <p className={EYEBROW_DONE}>Completed · manager-confirmed · not shared</p>
          <h2 id="completed-title" className="mt-3 font-serif text-[1.9rem] font-normal leading-tight text-ink">
            {snap.person.name} · {noun.charAt(0).toUpperCase() + noun.slice(1)} in review
          </h2>
          {overall && <p className="mt-2 text-lg font-semibold text-ink">Overall: {overall.meaning || overall.point}</p>}
          {summary?.headline && !/in review$/i.test(summary.headline.trim()) && (
            <p className="mt-1 font-serif text-lg text-ink-body">{summary.headline}</p>
          )}
          {summary?.overview ? (
            <p className="mt-2 text-[1.05rem] leading-relaxed text-ink-body">{summary.overview}</p>
          ) : (
            <p className="mt-2 text-ink-secondary">No written summary was confirmed with this assessment.</p>
          )}
          {overall?.reason && !summary?.overview && <p className="mt-2 text-ink-body">{overall.reason}</p>}

          {recognized.length > 0 && (
            <div className="mt-6 border-t border-divider pt-4">
              <h3 className="font-serif text-xl text-ink">Contributions to recognize</h3>
              <ul className="mt-2 space-y-2 text-ink-body">
                {recognized.map((c, i) => (
                  <li key={i}>
                    {c.text}
                    <SourceChips ids={c.sources} lookup={lookup} managerContext={snap.manager_context} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(summary?.strengths || []).length > 0 && (
            <div className="mt-6 border-t border-divider pt-4">
              <h3 className="font-serif text-xl text-ink">Supported strengths</h3>
              <ul className="mt-2 space-y-1 text-ink-body">
                {summary!.strengths!.map((c, i) => <li key={i}>{c.text}</li>)}
              </ul>
            </div>
          )}
          {(summary?.attention || []).length > 0 && (
            <div className="mt-6 border-t border-divider pt-4">
              <h3 className="font-serif text-xl text-ink">Where more observation would help</h3>
              <ul className="mt-2 space-y-1 text-ink-body">
                {summary!.attention!.map((c, i) => <li key={i}>{c.text}</li>)}
              </ul>
            </div>
          )}
          {!summary && snap.items.some((i) => i.kind !== "overall") && (
            <ul className="mt-6 divide-y divide-divider border-t border-divider">
              {snap.items.filter((i) => i.kind !== "overall").map((i) => (
                <li key={i.key} className="py-3">
                  <p className="font-medium text-ink">{i.name}: {judgmentText(i)}</p>
                  {i.reason && <p className="text-sm text-ink-body">{i.reason}</p>}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 border-t border-divider pt-4">
            <button
              type="button"
              onClick={() => setDetailsOpen(!detailsOpen)}
              aria-expanded={detailsOpen}
              className="text-sm font-semibold text-brand hover:underline"
            >
              Expectations, confirmed judgments &amp; supporting sources {detailsOpen ? "↑" : "→"}
            </button>
            {detailsOpen && (
              <div className="mt-4 space-y-6">
                <ul className="divide-y divide-divider">
                  {snap.items.map((i) => (
                    <li key={i.key} className="py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-ink">{i.name}</p>
                          {i.expectation && <p className="text-sm text-ink-secondary">Standard: {i.expectation}</p>}
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-ink">{judgmentText(i)}</p>
                          {i.origin && <OriginBadge origin={i.origin} />}
                        </div>
                      </div>
                      {i.reason && <p className="mt-1 text-sm text-ink-body">{i.reason}</p>}
                      {i.kind !== "metric" && i.scale.length > 0 && (
                        <p className="mt-1 text-xs text-ink-muted">
                          Scale: {i.scale.map((s) => `${s.point}${s.meaning ? ` ${s.meaning}` : ""}`).join(" · ")}
                        </p>
                      )}
                      {i.prior && (
                        <p className="mt-1 text-xs text-ink-muted">
                          Prior: {i.kind === "metric" ? `${i.prior.value}` : i.prior.point} ({formatDay(i.prior.date)})
                        </p>
                      )}
                      <SourceChips ids={(i.sources || []).map((s) => s.id)} lookup={lookup} managerContext={snap.manager_context} label="Support:" />
                    </li>
                  ))}
                </ul>
                {snap.unassessed.length > 0 && (
                  <div>
                    <p className={EYEBROW}>Not assessed this period</p>
                    <ul className="mt-2 space-y-1 text-sm text-ink-body">
                      {snap.unassessed.map((u) => (
                        <li key={u.key}>
                          {u.name}
                          {u.why ? <span className="text-ink-secondary"> — {u.why}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {snap.manager_context && (
                  <div>
                    <p className={EYEBROW}>Context you added</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-body">{snap.manager_context}</p>
                    <p className="text-xs text-ink-muted">Attributed to you; not independently verified.</p>
                  </div>
                )}
                <div>
                  <p className={EYEBROW}>What was read</p>
                  <div className="mt-2">
                    <CoverageTable rows={snap.coverage} />
                  </div>
                  {snap.excluded_count > 0 && (
                    <p className="mt-1 text-xs text-ink-muted">{snap.excluded_count} record{snap.excluded_count === 1 ? "" : "s"} left out of this assessment by you.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className={`${PANEL} h-fit`}>
          <p className={EYEBROW}>A useful starting point</p>
          {summary?.discussion ? (
            <>
              <p className="mt-3 font-serif text-[1.35rem] leading-snug text-ink">“{summary.discussion}”</p>
              <p className="mt-2 text-sm text-ink-secondary">Discussion wording reviewed with the assessment. No agenda has been created.</p>
            </>
          ) : (
            <p className="mt-3 text-sm text-ink-secondary">No conversation wording was confirmed with this assessment.</p>
          )}

          <div className="mt-5 border-t border-divider pt-4">
            <h3 className="font-semibold text-ink">Keep the limits visible</h3>
            <ul className="mt-2 space-y-1 text-sm text-ink-body">
              {gaps.map((g, i) => <li key={`g${i}`}>{g}</li>)}
              {snap.unassessed.filter((u) => !u.prior).map((u) => (
                <li key={u.key}>{u.name}: not assessed this period{u.why ? ` — ${u.why.replace(/\.$/, "")}` : ""}.</li>
              ))}
              {priorOnly.map((u) => (
                <li key={u.key}>{u.name}: prior judgment only; not reassessed.</li>
              ))}
              {!gaps.length && !snap.unassessed.length && <li className="text-ink-muted">No gaps were recorded.</li>}
            </ul>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={`/app/reports/${reportId}`} className={BTN_PRIMARY}>
              Open existing 1:1 prep
            </Link>
            <Link href={`/app/reports/${reportId}?view=growth`} className={BTN_SECONDARY}>
              Growth
            </Link>
          </div>
          <button type="button" onClick={() => setReceiptOpen(!receiptOpen)} aria-expanded={receiptOpen} className="mt-4 text-sm text-brand hover:underline">
            View completion details {receiptOpen ? "↑" : "→"}
          </button>
          {receiptOpen && (
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-ink-secondary">Completed</dt><dd className="text-ink-body">{formatDay(review.completed_at)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-secondary">Period</dt><dd className="text-right text-ink-body">{snap.period.label}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-secondary">Judgments recorded</dt><dd className="text-ink-body">{snap.items.length}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-secondary">Not assessed</dt><dd className="text-ink-body">{snap.unassessed.length}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-secondary">Records used</dt><dd className="text-ink-body">{snap.evidence.length}{snap.include_private ? " (incl. private)" : ""}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-secondary">How</dt><dd className="text-ink-body">{snap.mode === "manual" ? "Manual" : "AI-drafted, manager-decided"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-secondary">Shared with {first}</dt><dd className="text-ink-body">No</dd></div>
            </dl>
          )}
        </aside>
      </div>
    </>
  );
}
