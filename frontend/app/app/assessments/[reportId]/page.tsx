"use client";

// One person's assessments: start a new period assessment (quarterly,
// biannual or off-cycle, dates always explicit and editable), resume the open
// draft, or open a completed one. Presets fill dates for the assessment being
// started — there is no org-wide cycle or reminder behind them.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import PageShell from "@/components/PageShell";
import { PageSkeleton } from "@/components/Skeleton";
import {
  ApiError,
  ReviewCadence,
  ReviewSummaryRow,
  Scorecard,
  createReview,
  getScorecard,
  listReviews,
} from "@/lib/api";
import { CADENCE_LABEL, firstName, formatDay, formatSpan, suggestPeriod } from "@/lib/assessment-periods";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, INPUT } from "@/lib/tokens";
import { PANEL } from "@/components/assessments/shared";

const STAGE_LABEL: Record<string, string> = {
  picture: "Checking the picture",
  draft: "Draft & discuss",
  review: "Final review",
};

export default function PersonAssessmentsPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const router = useRouter();
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [reviews, setReviews] = useState<ReviewSummaryRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cadence, setCadence] = useState<ReviewCadence>("quarterly");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [starting, setStarting] = useState<"ai" | "manual" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = suggestPeriod(cadence, new Date());
    setStart(p.start);
    setEnd(p.end);
  }, [cadence]);

  useEffect(() => {
    Promise.all([getScorecard(reportId), listReviews(reportId)])
      .then(([sc, rv]) => {
        setScorecard(sc);
        setReviews(rv);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiError && e.status === 404 ? "This person isn’t on your team." : "Assessments couldn’t be loaded. Nothing was changed."),
      )
      .finally(() => setLoading(false));
  }, [reportId]);

  if (loading) return <PageSkeleton label="Loading assessments" variant="cards" maxWidth="6xl" />;
  if (loadError || !scorecard) {
    return (
      <PageShell maxWidth="6xl">
        <p role="alert" className="text-red-700">{loadError}</p>
      </PageShell>
    );
  }

  const person = scorecard.direct_report;
  const first = firstName(person.name);
  const open = reviews.find((r) => r.status === "draft");
  const completed = reviews.filter((r) => r.status === "completed").sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));
  const configured = scorecard.skills.length + scorecard.values.length + scorecard.metrics.length;
  const levelLabel = (o: number | null | undefined) => scorecard.levels.find((l) => l.ordinal === o)?.label;
  const legacyOverall = scorecard.overall && scorecard.overall.source_type !== "performance_review" ? scorecard.overall : null;

  async function begin(mode: "ai" | "manual") {
    setStarting(mode);
    setError(null);
    try {
      const r = await createReview({ direct_report_id: reportId, cadence, period_start: start, period_end: end, mode });
      router.push(`/app/assessments/${reportId}/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError && e.status < 500 ? e.detail : "The assessment couldn’t be started. Try again.");
      setStarting(null);
    }
  }

  return (
    <PageShell maxWidth="6xl">
      <nav aria-label="Breadcrumb" className="text-xs font-semibold uppercase tracking-wide text-brand">
        <Link href="/app/assessments" className="hover:underline">Assessments</Link>
      </nav>
      <h1 className="mt-3 font-serif text-[2.3rem] font-normal leading-tight tracking-[-0.02em] text-ink">{person.name}</h1>
      <p className="mt-1 text-ink-secondary">
        {scorecard.role
          ? `${scorecard.role.job_role} · Level ${scorecard.role.job_level}${scorecard.role.functional_team ? ` · ${scorecard.role.functional_team}` : ""}`
          : person.role_title || "No role assigned"}
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <div className="space-y-5">
          {open ? (
            <section className={PANEL} aria-labelledby="open-title">
              <p className={EYEBROW}>In progress</p>
              <h2 id="open-title" className="mt-2 font-serif text-[1.7rem] font-normal text-ink">{open.review_period}</h2>
              <p className="mt-1 text-sm text-ink-secondary">
                {STAGE_LABEL[open.stage] || "Draft"} · last worked on {formatDay(open.updated_at)}
                {open.mode === "manual" ? " · manual" : ""}. Nothing is recorded until you complete it.
              </p>
              <Link href={`/app/assessments/${reportId}/${open.id}`} className={`${BTN_PRIMARY} mt-4 inline-block`}>
                Resume assessment
              </Link>
              <p className="mt-3 text-xs text-ink-muted">One assessment can be open per person. Finish or discard it to start another period.</p>
            </section>
          ) : (
            <section className={PANEL} aria-labelledby="start-title">
              <p className={EYEBROW}>Start an assessment</p>
              <h2 id="start-title" className="mt-2 font-serif text-[1.7rem] font-normal leading-tight text-ink">
                Which period are you assessing?
              </h2>
              <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Kind of assessment">
                {(["quarterly", "biannual", "off_cycle"] as ReviewCadence[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={cadence === c}
                    onClick={() => setCadence(c)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${cadence === c ? "bg-brand text-on-brand" : "border border-control text-ink-body hover:bg-sunken"}`}
                  >
                    {CADENCE_LABEL[c]}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="text-xs text-ink-secondary">
                  From
                  <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${INPUT} mt-1 w-44`} />
                </label>
                <label className="text-xs text-ink-secondary">
                  To
                  <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={`${INPUT} mt-1 w-44`} />
                </label>
                {start && end && end >= start && <p className="pb-2 text-sm text-ink-secondary">{formatSpan(start, end)}</p>}
              </div>
              {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => void begin("ai")} disabled={!!starting || !start || !end || end < start} className={BTN_PRIMARY}>
                  {starting === "ai" ? "Reading the records…" : "Start assessment"}
                </button>
                <button type="button" onClick={() => void begin("manual")} disabled={!!starting || !start || !end || end < start} className={BTN_SECONDARY}>
                  {starting === "manual" ? "Starting…" : "Assess manually"}
                </button>
              </div>
              <p className="mt-4 text-sm text-ink-secondary">
                AI brings together what your records show for this period and asks what’s missing before it drafts anything. You decide every judgment. Nothing is shared with {first}.
              </p>
              {configured === 0 && (
                <p className="mt-3 text-sm text-amber-700">
                  {scorecard.role ? "No skills, values or metrics are configured for this role yet" : "No role is assigned yet"} — only the overall judgment will be available.{" "}
                  <Link href={scorecard.role ? "/app/settings?section=roles" : "/app/settings?section=people"} className="underline">
                    Set up expectations
                  </Link>
                </p>
              )}
            </section>
          )}

          <section className={PANEL} aria-labelledby="history-title">
            <h2 id="history-title" className="font-serif text-[1.4rem] font-normal text-ink">Completed assessments</h2>
            {completed.length === 0 ? (
              <p className="mt-2 text-sm text-ink-secondary">None yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-divider">
                {completed.map((r) => (
                  <li key={r.id}>
                    <Link href={`/app/assessments/${reportId}/${r.id}`} className="flex flex-wrap items-baseline justify-between gap-2 py-3 hover:text-ink">
                      <span className="font-medium text-ink">{r.review_period}</span>
                      <span className="text-sm text-ink-secondary">
                        {r.rating_ordinal ? `Overall: ${levelLabel(r.rating_ordinal)}` : "No overall judgment"} · completed {formatDay(r.completed_at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className={`${PANEL} h-fit`} aria-labelledby="latest-title">
          <h2 id="latest-title" className={EYEBROW}>Latest recorded ratings</h2>
          {scorecard.overall ? (
            <p className="mt-2 text-ink-body">
              Overall: <span className="font-medium">{levelLabel(scorecard.overall.level_ordinal)}</span>{" "}
              <span className="text-sm text-ink-muted">({formatDay(scorecard.overall.created_at)})</span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-ink-secondary">No overall rating recorded.</p>
          )}
          {legacyOverall && (
            <p className="mt-1 text-xs text-ink-muted">Recorded before period assessments — shown as context, not as a completed assessment.</p>
          )}
          <ul className="mt-3 space-y-1 text-sm">
            {[...scorecard.skills, ...scorecard.values].map((it) => {
              const latest = it.latest as { evaluation_point?: number; assessed_at?: string } | null;
              const meaning = it.scale_definitions.find((d) => d.evaluation_point === latest?.evaluation_point);
              return (
                <li key={it.config_id} className="flex justify-between gap-3">
                  <span className="text-ink-body">{it.name}</span>
                  <span className="text-right text-ink-muted">
                    {latest?.evaluation_point != null
                      ? `${latest.evaluation_point}${meaning?.qualitative_output ? ` — ${meaning.qualitative_output}` : ""} · ${formatDay(latest.assessed_at)}`
                      : "—"}
                  </span>
                </li>
              );
            })}
            {scorecard.metrics.map((it) => {
              const latest = it.latest as { value?: number; period?: string | null } | null;
              return (
                <li key={it.config_id} className="flex justify-between gap-3">
                  <span className="text-ink-body">{it.name}</span>
                  <span className="text-right text-ink-muted">{latest?.value != null ? `${latest.value}${latest.period ? ` (${latest.period})` : ""}` : "—"}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs text-ink-muted">
            These are context for a new assessment, never carried into it. Reaffirming one for a new period is an explicit choice.
          </p>
          <Link href={`/app/reports/${reportId}`} className="mt-4 inline-block text-sm text-brand hover:underline">
            {first}’s page →
          </Link>
        </aside>
      </div>
    </PageShell>
  );
}
