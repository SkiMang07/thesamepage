"use client";

// Stage 3 — Review & complete. Everything that will be recorded is on the
// page at once: the summary, every included judgment with its reason and
// support, what stays unassessed, and the acknowledged gaps. One explicit
// confirmation records the whole displayed set; opening this page or
// generating a summary never counts as review.

import { useEffect, useState } from "react";
import NoteField from "@/components/NoteField";
import type { CatalogItem, EvidenceItem, PeriodAssessment } from "@/lib/api";
import { firstName, formatDay } from "@/lib/assessment-periods";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, INPUT } from "@/lib/tokens";
import { describeJudgment, EYEBROW_DRAFT, OriginBadge, PANEL, SourceChips } from "./shared";

export default function ReviewStage({
  review,
  busy,
  problems,
  onWriteSummary,
  onEditSummary,
  onBack,
  onComplete,
}: {
  review: PeriodAssessment;
  busy: string | null;
  problems: string[] | null;
  onWriteSummary: () => void;
  onEditSummary: (body: { headline?: string; overview?: string; discussion?: string; gaps?: string[] }) => Promise<unknown>;
  onBack: (key?: string) => void;
  onComplete: () => void;
}) {
  const evidence = review.evidence?.items || [];
  const byId = new Map<string, EvidenceItem>(evidence.map((i) => [i.id, i]));
  const lookup = (id: string) => byId.get(id);
  const name = review.person?.name || "They";
  const first = firstName(name);
  const summary = review.draft.summary;
  const included = review.catalog.filter((c) => c.state.decision.state === "include");
  const unassessed = review.catalog.filter((c) => c.state.decision.state !== "include");
  const pendingRevisions = review.catalog.filter((c) => c.state.revision);
  const [confirmed, setConfirmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [headline, setHeadline] = useState(summary?.headline || "");
  const [overview, setOverview] = useState(summary?.overview || "");
  const [discussion, setDiscussion] = useState(summary?.discussion || "");
  const [gaps, setGaps] = useState((summary?.gaps || []).join("\n"));
  useEffect(() => {
    setHeadline(summary?.headline || "");
    setOverview(summary?.overview || "");
    setDiscussion(summary?.discussion || "");
    setGaps((summary?.gaps || []).join("\n"));
  }, [summary?.headline, summary?.overview, summary?.discussion, summary?.gaps]);
  // Any change to what's displayed un-ticks the confirmation.
  useEffect(() => setConfirmed(false), [review.version]);

  const blockers = [
    ...(review.flags.summary_stale ? ["The summary was written before your latest changes — refresh it or edit it."] : []),
    ...(review.flags.context_changed ? ["Your context or sources changed after the draft — redraft, or keep the draft as it is (Draft & discuss)."] : []),
    ...pendingRevisions.map((c) => `${c.name}: a revised judgment is waiting — apply it or keep the current one.`),
  ];
  const shownProblems = problems && problems.length ? problems : blockers;
  const overall = included.find((c) => c.kind === "overall");

  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
      <div className="min-w-0 space-y-5">
        <section aria-labelledby="summary-title" className={PANEL}>
          <p className={EYEBROW_DRAFT}>Review · nothing is recorded until you complete</p>
          {busy === "summary" ? (
            <div className="mt-4 space-y-3" aria-live="polite">
              <p className="text-sm text-ink-secondary">Writing the summary from the judgments you’re confirming…</p>
              <div className="h-7 w-2/3 animate-pulse rounded bg-sunken" />
              <div className="h-4 w-full animate-pulse rounded bg-sunken" />
            </div>
          ) : editing || (summary && summary.origin === "manager" && !summary.overview && !summary.headline) ? (
            <div className="mt-3 space-y-3">
              <label className="block text-xs font-medium text-ink-secondary">
                Headline
                <input value={headline} onChange={(e) => setHeadline(e.target.value)} className={`${INPUT} mt-1`} />
              </label>
              <label className="block text-xs font-medium text-ink-secondary">
                Overview
                <NoteField value={overview} onChange={setOverview} rows={4} className="mt-1 text-sm" />
              </label>
              <label className="block text-xs font-medium text-ink-secondary">
                Conversation opener (optional)
                <NoteField value={discussion} onChange={setDiscussion} rows={2} className="mt-1 text-sm" />
              </label>
              <label className="block text-xs font-medium text-ink-secondary">
                Limits to keep visible — one per line
                <NoteField value={gaps} onChange={setGaps} rows={3} className="mt-1 text-sm" />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!!busy}
                  className={BTN_SECONDARY}
                  onClick={async () => {
                    await onEditSummary({ headline, overview, discussion, gaps: gaps.split("\n") });
                    setEditing(false);
                  }}
                >
                  Save summary
                </button>
                <button type="button" className="text-sm text-ink-secondary hover:text-ink" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : summary ? (
            <>
              <h2 id="summary-title" className="mt-3 font-serif text-[1.9rem] font-normal leading-tight text-ink">
                {summary.headline || `${first} · ${review.review_period.split(" · ")[0]}`}
              </h2>
              {overall && <p className="mt-2 font-semibold text-ink">Overall: {describeJudgment(overall, overall.state.decision).replace(/^\d+ — /, "")}</p>}
              {summary.overview && <p className="mt-2 text-[1.05rem] leading-relaxed text-ink-body">{summary.overview}</p>}
              {review.flags.summary_stale && (
                <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  Written before your latest changes. <button type="button" onClick={onWriteSummary} className="font-medium underline">Refresh it</button> or edit it.
                </p>
              )}
              <SummaryList title="Contributions to recognize" rows={(summary.contributions || []).map((c) => ({ text: c.text, sources: c.sources }))} lookup={lookup} managerContext={review.manager_context} />
              <SummaryList title="Supported strengths" rows={(summary.strengths || []).map((c) => ({ text: c.text }))} />
              <SummaryList title="Where more observation would help" rows={(summary.attention || []).map((c) => ({ text: c.text }))} />
              {summary.discussion && (
                <div className="mt-5 border-t border-divider pt-4">
                  <h3 className="font-serif text-lg text-ink">A useful starting point</h3>
                  <p className="mt-1 text-ink-body">“{summary.discussion}”</p>
                  <p className="mt-1 text-xs text-ink-muted">Reviewed with the assessment. No agenda is created.</p>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                <button type="button" onClick={() => setEditing(true)} className="text-brand hover:underline">
                  Edit summary
                </button>
                <button type="button" onClick={onWriteSummary} disabled={!!busy} className="text-ink-secondary hover:text-ink disabled:opacity-50">
                  Rewrite with AI
                </button>
                {summary.origin === "manager" && <span className="text-xs text-ink-muted self-center">Your wording</span>}
              </div>
            </>
          ) : (
            <>
              <h2 id="summary-title" className="mt-3 font-serif text-[1.7rem] font-normal leading-tight text-ink">No written summary yet</h2>
              <p className="mt-2 text-ink-body">
                A summary helps you explain your view and open the conversation. It’s optional — the judgments below are the assessment.
              </p>
              {review.draft.summary_error && <p className="mt-2 text-sm text-amber-700">{review.draft.summary_error}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={onWriteSummary} disabled={!!busy} className={BTN_SECONDARY}>
                  Write it with AI
                </button>
                <button type="button" onClick={() => setEditing(true)} className={BTN_SECONDARY}>
                  Write my own
                </button>
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="confirming-title" className={PANEL}>
          <h2 id="confirming-title" className="font-serif text-[1.5rem] font-normal text-ink">
            Judgments you are confirming ({included.length})
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">Each on its own scale. The overall judgment is yours alone, not an average.</p>
          <ul className="mt-4 divide-y divide-divider">
            {included.map((c) => (
              <ConfirmRow key={c.key} item={c} lookup={lookup} managerContext={review.manager_context} onEdit={() => onBack(c.key)} />
            ))}
          </ul>
        </section>

        {unassessed.length > 0 && (
          <section aria-labelledby="unassessed-title" className={PANEL}>
            <h2 id="unassessed-title" className="font-serif text-[1.3rem] font-normal text-ink">
              Left unassessed ({unassessed.length})
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">Nothing is recorded for these. A prior judgment stays as history and is not re-logged.</p>
            <ul className="mt-3 space-y-2 text-sm">
              {unassessed.map((c) => (
                <li key={c.key} className="flex flex-wrap justify-between gap-2">
                  <span className="text-ink-body">
                    {c.name}
                    {c.state.unassessed_reason && <span className="text-ink-secondary"> — {c.state.unassessed_reason}</span>}
                  </span>
                  <span className="text-ink-muted">
                    {c.prior ? `${c.kind === "metric" ? "Latest reading" : "Prior"}: ${describeJudgment(c, c.prior)} (${formatDay(c.prior.date)}) · not reassessed` : "No prior judgment"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside aria-labelledby="complete-title" className={`${PANEL} h-fit lg:sticky lg:top-6`}>
        <p className={EYEBROW}>Complete</p>
        <h2 id="complete-title" className="mt-2 font-serif text-[1.5rem] font-normal leading-tight text-ink">
          Record {first}’s assessment
        </h2>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-ink-secondary">Period</dt><dd className="text-right text-ink-body">{review.review_period}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink-secondary">Judgments recorded</dt><dd className="text-ink-body">{included.length}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink-secondary">Left unassessed</dt><dd className="text-ink-body">{unassessed.length}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink-secondary">Summary</dt><dd className="text-ink-body">{summary ? (summary.origin === "manager" ? "Your wording" : "AI-written, reviewed here") : "None"}</dd></div>
        </dl>
        {shownProblems.length > 0 && (
          <ul role="alert" className="mt-4 space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {shownProblems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        <label className="mt-4 flex items-start gap-2 text-sm text-ink-body">
          <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={!!busy} />
          <span>
            I’ve reviewed these {included.length} judgment{included.length === 1 ? "" : "s"}
            {summary ? ", the summary" : ""} and the gaps, and this is my assessment of {first} for this period.
          </span>
        </label>
        <button
          type="button"
          onClick={onComplete}
          disabled={!confirmed || !!busy || blockers.length > 0 || included.length === 0}
          className={`${BTN_PRIMARY} mt-4 w-full`}
        >
          {busy === "complete" ? "Completing…" : "Complete assessment"}
        </button>
        <p className="mt-3 text-xs text-ink-muted">
          Completing records these judgments. Nothing is shared with {first}, and no agenda, development plan or other record is created.
        </p>
        <button type="button" onClick={() => onBack()} className="mt-4 text-sm text-ink-secondary hover:text-ink">
          ← Back to draft &amp; discuss
        </button>
      </aside>
    </div>
  );
}

function SummaryList({
  title,
  rows,
  lookup,
  managerContext,
}: {
  title: string;
  rows: { text: string; sources?: string[] }[];
  lookup?: (id: string) => EvidenceItem | undefined;
  managerContext?: string | null;
}) {
  if (!rows.length) return null;
  return (
    <div className="mt-5 border-t border-divider pt-4">
      <h3 className="font-serif text-lg text-ink">{title}</h3>
      <ul className="mt-1 space-y-2 text-ink-body">
        {rows.map((r, i) => (
          <li key={i}>
            {r.text}
            {lookup && r.sources && <SourceChips ids={r.sources} lookup={lookup} managerContext={managerContext} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfirmRow({
  item,
  lookup,
  managerContext,
  onEdit,
}: {
  item: CatalogItem;
  lookup: (id: string) => EvidenceItem | undefined;
  managerContext: string | null;
  onEdit: () => void;
}) {
  const d = item.state.decision;
  return (
    <li className="py-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{item.name}</p>
          {item.expectation && <p className="text-sm text-ink-secondary">{item.expectation}</p>}
        </div>
        <div className="sm:shrink-0 sm:text-right">
          <p className="font-semibold text-ink">{describeJudgment(item, d)}</p>
          <OriginBadge origin={d.origin} />
        </div>
      </div>
      <p className={`mt-1 text-sm ${d.reason ? "text-ink-body" : "text-ink-muted"}`}>{d.reason || "No reason written."}</p>
      {item.prior && (
        <p className="mt-1 text-xs text-ink-muted">
          {item.kind === "metric" ? "Latest reading on record" : "Prior"}: {describeJudgment(item, item.prior)} ({formatDay(item.prior.date)}){d.origin === "reaffirmed" ? " — reaffirmed for this period" : ""}
        </p>
      )}
      <SourceChips ids={d.sources} lookup={lookup} managerContext={managerContext} label="Support:" />
      <button type="button" onClick={onEdit} className="mt-1 text-xs text-ink-muted hover:text-ink">
        Change
      </button>
    </li>
  );
}
