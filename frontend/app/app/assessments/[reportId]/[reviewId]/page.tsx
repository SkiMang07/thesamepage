"use client";

// One period assessment, from check-the-picture to the completed result
// (docs/systems/assessments.md). The draft lives on the server
// (performance_reviews), so leaving, reloading or coming back later resumes
// exactly here. Every manager write carries the draft version it saw; a
// conflict reloads instead of overwriting.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import PageShell from "@/components/PageShell";
import { PageSkeleton } from "@/components/Skeleton";
import {
  ApiError,
  PeriodAssessment,
  ReviewCadence,
  buildReviewPicture,
  completeReview,
  completionProblems,
  discardReview,
  discussReview,
  draftReview,
  editReviewSummary,
  getReview,
  regatherReview,
  reviewItemAction,
  updateReview,
  writeReviewSummary,
} from "@/lib/api";
import { CADENCE_LABEL, firstName, formatSpan, periodNoun, possessive } from "@/lib/assessment-periods";
import { BTN_SECONDARY, INPUT } from "@/lib/tokens";
import { StageSteps } from "@/components/assessments/shared";
import PictureStage from "@/components/assessments/PictureStage";
import DraftStage from "@/components/assessments/DraftStage";
import ReviewStage from "@/components/assessments/ReviewStage";
import CompletedView from "@/components/assessments/CompletedView";

type Busy = "picture" | "draft" | "discuss" | "summary" | "complete" | "save" | null;

function requestIdFor(reviewId: string): string {
  const key = `tsp:assessment-complete:${reviewId}`;
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export default function AssessmentFlowPage() {
  const { reportId, reviewId } = useParams<{ reportId: string; reviewId: string }>();
  const router = useRouter();
  const [review, setReview] = useState<PeriodAssessment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const versionRef = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const autoPicture = useRef(false);

  const apply = useCallback((r: PeriodAssessment) => {
    versionRef.current = r.version;
    setReview(r);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await getReview(reviewId);
      if (r.direct_report_id !== reportId) {
        router.replace(`/app/assessments/${r.direct_report_id}/${r.id}`);
      }
      apply(r);
      setLoadError(null);
      return r;
    } catch (e) {
      setLoadError(e instanceof ApiError && e.status === 404 ? "This assessment doesn’t exist or isn’t yours." : "The assessment couldn’t be loaded. Nothing was changed.");
      return null;
    }
  }, [reviewId, reportId, router, apply]);

  /** Serialize writes so each one carries the version the previous returned. */
  const run = useCallback(
    (label: Busy, fn: (version: number) => Promise<PeriodAssessment>): Promise<PeriodAssessment | null> => {
      const p = queue.current.then(async () => {
        setBusy(label);
        setError(null);
        try {
          const r = await fn(versionRef.current);
          apply(r);
          return r;
        } catch (e) {
          const probs = completionProblems(e);
          if (probs) {
            setProblems(probs);
          } else if (e instanceof ApiError && e.status === 409) {
            await load();
            setError(`${e.detail || "This assessment changed elsewhere."} The latest version is shown.`);
          } else {
            setError(e instanceof ApiError && e.status < 500 ? e.detail : "That didn’t go through. Nothing you entered was lost — try again.");
          }
          return null;
        } finally {
          setBusy(null);
        }
      });
      queue.current = p.catch(() => undefined);
      return p;
    },
    [apply, load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A fresh AI assessment writes its picture as soon as the records are in.
  useEffect(() => {
    if (!review || autoPicture.current) return;
    if (review.status === "draft" && review.stage === "picture" && review.mode === "ai" && !review.picture) {
      autoPicture.current = true;
      void run("picture", () => buildReviewPicture(review.id));
    }
  }, [review, run]);

  if (loadError && !review) {
    return (
      <PageShell maxWidth="8xl">
        <div className="mx-auto max-w-[1400px] rounded-xl bg-surface p-6" role="alert">
          <h1 className="font-serif text-2xl text-ink">{loadError}</h1>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => void load()} className={BTN_SECONDARY}>
              Try again
            </button>
            <Link href={`/app/assessments/${reportId}`} className={BTN_SECONDARY}>
              Back
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }
  if (!review) return <PageSkeleton label="Loading assessment" variant="cards" maxWidth="8xl" />;

  const name = review.person?.name || review.completed_snapshot?.person.name || "";
  const first = firstName(name);
  const noun = periodNoun(review.cadence, review.period_start, review.period_end);
  const completed = review.status === "completed";
  const stage = completed ? "completed" : review.stage;
  const manual = review.mode === "manual";

  const heading = completed
    ? "An assessment you can stand behind"
    : stage === "picture"
      ? `${possessive(first)} ${noun}, brought together`
      : stage === "draft"
        ? manual && !review.draft.generated_at
          ? "Set the judgments you can stand behind"
          : "Focus on the judgments that need you"
        : "Review the whole assessment";
  const sub = completed
    ? "Useful for the conversation — not just a record that ratings were saved."
    : stage === "picture"
      ? "Start with what matters. Add what the records missed. Then let AI draft."
      : stage === "draft"
        ? manual && !review.draft.generated_at
          ? "Same expectations and review as the AI path — without a draft."
          : "A readable assessment first. Work through uncertainty without approving a wall of rows."
        : "Everything that will be recorded, in one place. Complete it when it says what you mean.";

  const goStage = (s: "picture" | "draft" | "review") => {
    if (s === "review") return toReview();
    void run("save", (v) => updateReview(review.id, { version: v, stage: s }));
  };

  const toReview = () => {
    const summary = review.draft.summary;
    const needsSummary = !manual && (!summary || review.flags.summary_stale);
    setProblems(null);
    if (needsSummary) {
      void run("summary", (v) => writeReviewSummary(review.id, v));
    } else {
      void run("save", (v) => updateReview(review.id, { version: v, stage: "review" }));
    }
  };

  const draftWith = async (context: string | null) => {
    if (context !== null && context.trim() !== (review.manager_context || "").trim()) {
      const saved = await run("save", (v) => updateReview(review.id, { version: v, manager_context: context }));
      if (!saved) return;
    }
    await run("draft", (v) => draftReview(review.id, v));
  };

  const periodLine = `${review.cadence ? CADENCE_LABEL[review.cadence as ReviewCadence] : "Assessment"} assessment · ${formatSpan(review.period_start, review.period_end)}`;

  return (
    <PageShell maxWidth="8xl">
      <div className="mx-auto max-w-[1400px]">
        <nav aria-label="Breadcrumb" className="text-xs font-semibold uppercase tracking-wide text-brand">
          <Link href="/app/assessments" className="hover:underline">Assessments</Link>
          <span className="mx-1 text-ink-faint">/</span>
          <Link href={`/app/assessments/${review.direct_report_id}`} className="hover:underline">{name}</Link>
        </nav>
        <h1 className="mt-3 font-serif text-[2.2rem] font-normal leading-tight tracking-[-0.02em] text-ink sm:text-[2.5rem]">{heading}</h1>
        <p className="mt-1 text-ink-secondary">{sub}</p>

        <div className="mt-5">
          <StageSteps stage={stage} onGo={goStage} disabled={!!busy} />
        </div>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {[name, review.role_label || review.person?.role_title || review.completed_snapshot?.person.role].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-1 text-lg text-ink">{periodLine}</p>
            <p className="text-sm text-ink-muted">
              Period is manager-selected{manual ? " · manual assessment" : ""}.
              {!completed && !editingPeriod && (
                <button type="button" onClick={() => setEditingPeriod(true)} className="ml-2 text-brand hover:underline" disabled={!!busy}>
                  Change period
                </button>
              )}
            </p>
          </div>
          {!completed && (
            <div className="text-sm">
              {confirmDiscard ? (
                <span className="flex items-center gap-2">
                  <span className="text-ink-secondary">Discard this draft? Nothing was recorded.</span>
                  <button
                    type="button"
                    className="font-medium text-red-700 hover:underline"
                    onClick={async () => {
                      try {
                        await discardReview(review.id);
                        router.push(`/app/assessments/${review.direct_report_id}`);
                      } catch {
                        setError("The draft couldn’t be discarded. Try again.");
                      }
                    }}
                  >
                    Discard
                  </button>
                  <button type="button" className="text-ink-secondary hover:text-ink" onClick={() => setConfirmDiscard(false)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="text-ink-muted hover:text-ink" onClick={() => setConfirmDiscard(true)}>
                  Discard draft
                </button>
              )}
            </div>
          )}
        </div>

        {editingPeriod && !completed && (
          <PeriodEditor
            review={review}
            busy={!!busy}
            onCancel={() => setEditingPeriod(false)}
            onSave={async (cadence, start, end) => {
              const r = await run("save", (v) => updateReview(review.id, { version: v, cadence, period_start: start, period_end: end }));
              if (r) setEditingPeriod(false);
            }}
          />
        )}

        {error && (
          <p role="alert" className="mt-4 flex flex-wrap items-baseline gap-3 text-sm text-red-700">
            {error}
            <button type="button" onClick={() => setError(null)} className="text-xs text-ink-muted underline">
              Dismiss
            </button>
          </p>
        )}

        {completed ? (
          <CompletedView review={review} justCompleted={justCompleted} />
        ) : stage === "picture" ? (
          <PictureStage
            review={review}
            busy={busy}
            onSaveContext={(text) => run("save", (v) => updateReview(review.id, { version: v, manager_context: text }))}
            onDraft={(text) => void draftWith(text)}
            onManual={() => void run("save", (v) => updateReview(review.id, { version: v, mode: "manual", stage: "draft" }))}
            onRetryPicture={() => void run("picture", () => buildReviewPicture(review.id))}
            onToggleExclude={(id) => {
              const ex = review.excluded_evidence || [];
              const next = ex.includes(id) ? ex.filter((x) => x !== id) : [...ex, id];
              void run("save", (v) => updateReview(review.id, { version: v, excluded_evidence: next }));
            }}
            onTogglePrivate={(on) => void run("save", (v) => updateReview(review.id, { version: v, include_private: on }))}
            onRegather={() => void run("save", (v) => regatherReview(review.id, v))}
          />
        ) : stage === "draft" ? (
          <DraftStage
            review={review}
            busy={busy}
            initialOpenKey={openKey}
            onItem={(key, body) => run("save", (v) => reviewItemAction(review.id, key, { version: v, ...body }))}
            onDiscuss={(message, itemKey) => run("discuss", (v) => discussReview(review.id, { version: v, message, item_key: itemKey }))}
            onRedraft={() => void run("draft", (v) => draftReview(review.id, v))}
            onKeepDraftContext={() => void run("save", (v) => updateReview(review.id, { version: v, acknowledge_context_change: true }))}
            onNarrative={(text) => run("save", (v) => updateReview(review.id, { version: v, narrative_overview: text }))}
            onReview={toReview}
            onDraftWithAI={() => void run("draft", (v) => draftReview(review.id, v))}
          />
        ) : (
          <ReviewStage
            review={review}
            busy={busy}
            problems={problems}
            onWriteSummary={() => void run("summary", (v) => writeReviewSummary(review.id, v))}
            onEditSummary={(body) => run("save", (v) => editReviewSummary(review.id, { version: v, ...body }))}
            onBack={(key) => {
              setOpenKey(key || null);
              setProblems(null);
              void run("save", (v) => updateReview(review.id, { version: v, stage: "draft" }));
            }}
            onComplete={async () => {
              setProblems(null);
              const done = await run("complete", (v) => completeReview(review.id, { version: v, client_request_id: requestIdFor(review.id) }));
              if (done?.status === "completed") {
                setJustCompleted(true);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
          />
        )}
      </div>
    </PageShell>
  );
}

function PeriodEditor({
  review,
  busy,
  onCancel,
  onSave,
}: {
  review: PeriodAssessment;
  busy: boolean;
  onCancel: () => void;
  onSave: (cadence: ReviewCadence, start: string, end: string) => void;
}) {
  const [cadence, setCadence] = useState<ReviewCadence>((review.cadence as ReviewCadence) || "quarterly");
  const [start, setStart] = useState(review.period_start);
  const [end, setEnd] = useState(review.period_end);
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-hairline bg-surface p-4">
      <label className="text-xs text-ink-secondary">
        Kind
        <select value={cadence} onChange={(e) => setCadence(e.target.value as ReviewCadence)} className={`${INPUT} mt-1 w-40`}>
          <option value="quarterly">Quarterly</option>
          <option value="biannual">Biannual</option>
          <option value="off_cycle">Off-cycle</option>
        </select>
      </label>
      <label className="text-xs text-ink-secondary">
        From
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${INPUT} mt-1 w-44`} />
      </label>
      <label className="text-xs text-ink-secondary">
        To
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={`${INPUT} mt-1 w-44`} />
      </label>
      <button type="button" disabled={busy || !start || !end || end < start} onClick={() => onSave(cadence, start, end)} className={BTN_SECONDARY}>
        Use this period
      </button>
      <button type="button" onClick={onCancel} className="text-sm text-ink-secondary hover:text-ink">
        Cancel
      </button>
      <p className="w-full text-xs text-ink-muted">Changing the period reads the records again. Your added context and decisions are kept.</p>
    </div>
  );
}
