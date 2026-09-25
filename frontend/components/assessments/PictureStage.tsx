"use client";

// Stage 1 — Check the picture. A short, source-cited account of the period
// comes first; the manager's only job here is to say what is missing (or
// that nothing is). Confirming context approves the inputs to drafting,
// never a rating. Source detail and coverage are one click away, not a
// mandatory audit.

import { useEffect, useState } from "react";
import NoteField from "@/components/NoteField";
import type { EvidenceItem, PeriodAssessment } from "@/lib/api";
import { formatDay, formatSpan, periodStillOpen } from "@/lib/assessment-periods";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/lib/tokens";
import { CoverageTable, EYEBROW_AI, EvidenceList, PANEL, SourceChips } from "./shared";

export default function PictureStage({
  review,
  busy,
  onSaveContext,
  onDraft,
  onManual,
  onRetryPicture,
  onToggleExclude,
  onTogglePrivate,
  onRegather,
}: {
  review: PeriodAssessment;
  busy: string | null;
  onSaveContext: (text: string) => Promise<unknown>;
  onDraft: (text: string | null) => void;
  onManual: () => void;
  onRetryPicture: () => void;
  onToggleExclude: (id: string) => void;
  onTogglePrivate: (on: boolean) => void;
  onRegather: () => void;
}) {
  const [context, setContext] = useState(review.manager_context || "");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  useEffect(() => setContext(review.manager_context || ""), [review.manager_context]);

  const evidence = review.evidence?.items || [];
  const byId = new Map<string, EvidenceItem>(evidence.map((i) => [i.id, i]));
  const excluded = review.excluded_evidence || [];
  const usable = evidence.filter((i) => !excluded.includes(i.id));
  const inPeriod = usable.filter((i) => i.timing === "in_period").length;
  const pic = review.picture;
  const failedSources = (review.evidence?.coverage || []).filter((c) => c.status === "failed");
  const loadingPicture = busy === "picture" || (!pic && review.mode === "ai" && busy !== null);
  const openPeriod = periodStillOpen(review.period_end, new Date());
  const gaps = pic?.gaps || [];
  const dirtyContext = context.trim() !== (review.manager_context || "").trim();

  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
      {/* The picture */}
      <section aria-labelledby="picture-title" className={PANEL}>
        <p className={EYEBROW_AI}>AI summary · check the picture before ratings</p>

        {review.flags.picture_stale && !loadingPicture && (
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
            The records changed since this summary was written.
            <button type="button" onClick={onRetryPicture} className="font-medium underline">
              Refresh summary
            </button>
          </p>
        )}

        {loadingPicture ? (
          <div className="mt-4 space-y-3" aria-live="polite">
            <p className="text-sm text-ink-secondary">
              Reading {usable.length} record{usable.length === 1 ? "" : "s"} from {formatSpan(review.period_start, review.period_end)}…
            </p>
            <div className="h-7 w-2/3 animate-pulse rounded bg-sunken" />
            <div className="h-4 w-full animate-pulse rounded bg-sunken" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-sunken" />
          </div>
        ) : pic?.error ? (
          <div className="mt-4" role="alert">
            <h2 id="picture-title" className="font-serif text-2xl text-ink">The summary couldn’t be written.</h2>
            <p className="mt-2 text-sm text-ink-secondary">{pic.error}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onRetryPicture} className={BTN_SECONDARY}>
                Try again
              </button>
            </div>
          </div>
        ) : pic?.sparse || (!pic && inPeriod === 0) ? (
          <div className="mt-4">
            <h2 id="picture-title" className="font-serif text-[1.7rem] leading-tight text-ink">
              Little is on record for this period.
            </h2>
            <p className="mt-2 text-ink-body">
              There are no reviewed 1:1s, commitments, goal or project updates, or metric readings dated in this period
              {usable.length ? `, only ${usable.length} earlier or context record${usable.length === 1 ? "" : "s"}` : ""}. That says nothing
              about their performance — only about what was written down.
            </p>
            <p className="mt-2 text-sm text-ink-secondary">
              Add what you know on the right and draft from that, or assess manually.
            </p>
          </div>
        ) : !pic ? (
          <div className="mt-4">
            <h2 id="picture-title" className="font-serif text-[1.7rem] leading-tight text-ink">
              {inPeriod} record{inPeriod === 1 ? "" : "s"} from this period
            </h2>
            <p className="mt-2 text-ink-body">They’re listed under Sources &amp; gaps below. AI can summarize them before you draft.</p>
            <button type="button" onClick={onRetryPicture} className={`${BTN_SECONDARY} mt-3`}>
              Summarize the records
            </button>
          </div>
        ) : pic ? (
          <div className="mt-3">
            <h2 id="picture-title" className="font-serif text-[1.9rem] font-normal leading-tight text-ink">
              {pic.headline || "What the records show"}
            </h2>
            {pic.summary && <p className="mt-2 text-[1.05rem] leading-relaxed text-ink-body">{pic.summary}</p>}
            {pic.contributions && pic.contributions.length > 0 && (
              <ul className="mt-4 space-y-3">
                {pic.contributions.map((c, i) => (
                  <li key={i} className="border-l-2 border-brand/50 pl-3">
                    <p className="text-ink-body">{c.text}</p>
                    <SourceChips ids={c.sources} lookup={(id) => byId.get(id)} />
                  </li>
                ))}
              </ul>
            )}
            {pic.impact && (
              <div className="mt-5 border-t border-divider pt-4">
                <h3 className="font-semibold text-ink">{pic.impact.title || "Impact is less clear than activity"}</h3>
                <p className="mt-1 text-ink-body">{pic.impact.text}</p>
              </div>
            )}
            {pic.questions && pic.questions.length > 0 && (
              <div className="mt-5 border-t border-divider pt-4">
                <h3 className="font-semibold text-ink">
                  {pic.questions.length === 1 ? "One thing you may be able to clarify" : "Things you may be able to clarify"}
                </h3>
                <ul className="mt-1 space-y-1 text-ink-body">
                  {pic.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}

        {/* Sources & gaps — discoverable, never mandatory */}
        <div className="mt-6 border-t border-divider pt-4">
          <button
            type="button"
            onClick={() => setSourcesOpen(!sourcesOpen)}
            aria-expanded={sourcesOpen}
            className="text-left text-sm text-amber-700 hover:underline"
          >
            Sources &amp; gaps →{" "}
            <span className="text-ink-secondary">
              {inPeriod} in-period record{inPeriod === 1 ? "" : "s"}
              {gaps.length ? ` · ${gaps.join("; ")}` : ""}
              {failedSources.length ? ` · ${failedSources.length} source${failedSources.length === 1 ? "" : "s"} couldn’t be read` : ""}
            </span>
          </button>
          {openPeriod && (
            <p className="mt-1 text-xs text-ink-muted">
              This period ends {formatDay(review.period_end)} — anything after today isn’t on record yet.
            </p>
          )}
          {sourcesOpen && (
            <div className="mt-4 space-y-5">
              <CoverageTable rows={review.evidence?.coverage || []} />
              <label className="flex items-start gap-2 text-sm text-ink-body">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={review.include_private}
                  disabled={!!busy}
                  onChange={(e) => onTogglePrivate(e.target.checked)}
                />
                <span>
                  Include my private notes for this assessment
                  <span className="block text-xs text-ink-muted">
                    Private 1:1 notes, captured notes and secondhand notes from meetings beyond the team. Off unless you turn it on; labelled private wherever used.
                  </span>
                </span>
              </label>
              <EvidenceList items={evidence} excluded={excluded} onToggle={onToggleExclude} disabled={!!busy} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onRegather} disabled={!!busy} className={BTN_SECONDARY}>
                  Read the records again
                </button>
                {excluded.length > 0 && <p className="self-center text-xs text-ink-muted">{excluded.length} left out of this assessment only — the records themselves are unchanged.</p>}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* What's missing */}
      <section aria-labelledby="context-title" className={`${PANEL} flex flex-col`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">You know the part the records do not</p>
        <h2 id="context-title" className="mt-3 font-serif text-[1.7rem] font-normal leading-tight text-ink">
          What’s missing or needs context?
        </h2>
        <p className="mt-3 text-ink-body">Add a contribution, explain a constraint, or correct this picture.</p>
        <NoteField
          value={context}
          onChange={setContext}
          onBlur={() => {
            if (dirtyContext) void onSaveContext(context);
          }}
          rows={6}
          placeholder="e.g. Support ownership was resolved Sep 22 — she coordinated it herself."
          className="mt-4"
          aria-label="What’s missing or needs context"
          disabled={!!busy && busy !== "picture"}
        />
        <p className="mt-3 text-sm text-ink-secondary">Your context stays attributed to you.</p>
        <div className="mt-4 flex flex-col items-start gap-3">
          <button
            type="button"
            onClick={() => onDraft(context)}
            disabled={!context.trim() || (!!busy && busy !== "picture")}
            className={BTN_PRIMARY}
          >
            {busy === "draft" ? "Drafting…" : "Use this context & draft"}
          </button>
          <button
            type="button"
            onClick={() => onDraft(context.trim() ? context : null)}
            disabled={!!busy && busy !== "picture"}
            className="text-sm text-brand hover:underline disabled:opacity-50"
          >
            {context.trim() ? "Draft without more changes →" : "Nothing to add? Draft from this picture →"}
          </button>
          <button type="button" onClick={onManual} disabled={!!busy && busy !== "picture"} className="text-sm text-ink-secondary hover:text-ink disabled:opacity-50">
            Or assess manually
          </button>
        </div>
        <p className="mt-auto pt-6 text-xs text-ink-muted">
          Drafting uses these records and your context. It doesn’t approve any rating — you review every judgment before anything is recorded.
        </p>
      </section>
    </div>
  );
}
