"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuickAdd } from "@/lib/quick-add-context";
import {
  MissionControlBrief,
  MissionControlCandidate,
  MissionControlEventInput,
  explainMissionControlCandidate,
  reconcileMissionControlOutcomes,
  recordMissionControlEvents,
} from "@/lib/api";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, ELEVATED, META } from "@/lib/tokens";
import PageShell from "@/components/PageShell";

type ImpressionMap = Record<string, string>;

function eventFor(
  brief: MissionControlBrief,
  candidate: MissionControlCandidate,
  eventType: MissionControlEventInput["event_type"],
  parentEventId?: string,
  snoozedUntil?: string
): MissionControlEventInput {
  return {
    brief_id: brief.brief_id,
    event_type: eventType,
    candidate_key: candidate.candidate_key,
    evidence_fingerprint: candidate.evidence_fingerprint,
    candidate_type: candidate.candidate_type,
    entity_type: candidate.entity_type,
    entity_id: candidate.entity_id,
    rank: candidate.rank,
    score: candidate.score,
    parent_event_id: parentEventId,
    snoozed_until: snoozedUntil,
    metadata: {
      reason_codes: candidate.evidence.map((item) => item.code),
      target_ids: candidate.target_ids,
      coverage: brief.coverage,
      mode: brief.mode,
    },
  };
}

function nextLocalMorning(days: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(8, 0, 0, 0);
  return value.toISOString();
}

function startOfNextLocalDay() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  value.setHours(0, 0, 0, 0);
  return value.toISOString();
}

function nextMondayMorning() {
  const value = new Date();
  const days = ((8 - value.getDay()) % 7) || 7;
  value.setDate(value.getDate() + days);
  value.setHours(8, 0, 0, 0);
  return value.toISOString();
}

function CoverageNotice({ brief }: { brief: MissionControlBrief }) {
  const missing = Object.entries(brief.coverage)
    .filter(([, status]) => status !== "ok")
    .map(([domain]) => domain.replace("_", " "));
  if (missing.length === 0) return null;
  return (
    <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700" role="status">
      Some sources could not be fully checked: {missing.join(", ")}. Recommendations below use only available records.
    </div>
  );
}

function CandidateControls({
  brief,
  candidate,
  impressionId,
  onDisposed,
  compact = false,
}: {
  brief: MissionControlBrief;
  candidate: MissionControlCandidate;
  impressionId?: string;
  onDisposed: (message: string) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [whyOpen, setWhyOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiState, setAiState] = useState<"idle" | "loading" | "failed">("idle");
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  async function record(eventType: MissionControlEventInput["event_type"], snoozedUntil?: string) {
    return recordMissionControlEvents([eventFor(brief, candidate, eventType, impressionId, snoozedUntil)]);
  }

  async function toggleWhy() {
    const opening = !whyOpen;
    setWhyOpen(opening);
    if (opening) record("why_opened").catch(() => undefined);
  }

  async function navigate() {
    setBusy(true);
    try {
      await record("cta_clicked");
    } finally {
      router.push(candidate.action.href);
    }
  }

  async function dispose(type: "addressed" | "not_relevant" | "snoozed", until?: string) {
    setBusy(true);
    try {
      await record(type, until);
      const message =
        type === "addressed"
          ? "Marked addressed. No underlying record was changed."
          : type === "not_relevant"
            ? "Marked not relevant. The source record was not changed."
            : "Snoozed. The source record was not changed.";
      onDisposed(message);
    } catch {
      onDisposed("Couldn’t save that response. Please try again.");
      setBusy(false);
    }
  }

  async function requestExplanation() {
    setAiState("loading");
    try {
      const result = await explainMissionControlCandidate(candidate);
      if (result.status === "ok" && result.explanation) {
        setAiExplanation(result.explanation);
        setAiState("idle");
        record("ai_explanation_succeeded").catch(() => undefined);
      } else {
        setAiState("failed");
        record("ai_explanation_failed").catch(() => undefined);
      }
    } catch {
      setAiState("failed");
      record("ai_explanation_failed").catch(() => undefined);
    }
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={navigate} disabled={busy} className={compact ? BTN_SECONDARY : BTN_PRIMARY}>
          {candidate.action.label}
        </button>
        <button type="button" onClick={toggleWhy} aria-expanded={whyOpen} className={BTN_GHOST}>
          Why this?
        </button>
        <div className="relative" ref={menuRef}>
          <button type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-haspopup="menu" className={BTN_SECONDARY}>
            More ···
          </button>
          {menuOpen && (
            <div role="menu" className={`absolute left-0 top-10 z-20 w-52 p-1 ${ELEVATED}`}>
              <button role="menuitem" disabled={busy} onClick={() => dispose("addressed")} className="block w-full rounded px-3 py-2 text-left text-sm text-ink-body hover:bg-sunken">Addressed</button>
              <div className="border-y border-divider py-1">
                <p className="px-3 py-1 text-[11px] uppercase tracking-wide text-ink-muted">Snooze</p>
                <button role="menuitem" disabled={busy} onClick={() => dispose("snoozed", nextLocalMorning(1))} className="block w-full rounded px-3 py-1.5 text-left text-sm text-ink-body hover:bg-sunken">Until tomorrow</button>
                <button role="menuitem" disabled={busy} onClick={() => dispose("snoozed", nextMondayMorning())} className="block w-full rounded px-3 py-1.5 text-left text-sm text-ink-body hover:bg-sunken">Until next Monday</button>
                <button role="menuitem" disabled={busy} onClick={() => dispose("snoozed", nextLocalMorning(7))} className="block w-full rounded px-3 py-1.5 text-left text-sm text-ink-body hover:bg-sunken">For one week</button>
              </div>
              <button role="menuitem" disabled={busy} onClick={() => dispose("not_relevant")} className="block w-full rounded px-3 py-2 text-left text-sm text-ink-body hover:bg-sunken">Not relevant</button>
            </div>
          )}
        </div>
      </div>

      {whyOpen && (
        <div className="mt-4 rounded-lg bg-brand-tint px-4 py-3 text-sm text-ink-body">
          <h3 className="font-medium text-ink">Why TSP suggested this</h3>
          <ul className="mt-2 space-y-2">
            {candidate.evidence.map((item) => (
              <li key={`${item.code}:${item.observed_at ?? "none"}`}>
                <span className="text-ink">{item.label}</span>
                <span className="ml-2 text-xs text-ink-muted">{item.source} · {item.freshness}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-teal-200 pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Ranking basis</p>
            <p className="mt-1 text-xs text-ink-secondary">{candidate.rank_basis.map((item) => item.label).join(" · ")}</p>
          </div>
          {(candidate.boundaries.length > 0 || Object.values(brief.coverage).some((status) => status !== "ok")) && (
            <div className="mt-3 border-t border-teal-200 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Boundaries</p>
              {candidate.boundaries.map((boundary) => <p key={boundary} className="mt-1 text-xs text-ink-secondary">{boundary}</p>)}
              {Object.values(brief.coverage).some((status) => status !== "ok") && <p className="mt-1 text-xs text-ink-secondary">Unavailable sources did not contribute to this recommendation.</p>}
            </div>
          )}
          {aiExplanation && <p className="mt-3 rounded-md bg-sunken px-3 py-2 text-sm text-ink-body">{aiExplanation}</p>}
          {aiState === "failed" && <p className="mt-3 text-xs text-ink-muted">An extra AI explanation is unavailable. The ranking and evidence above are unchanged.</p>}
          {!aiExplanation && aiState !== "failed" && (
            <button type="button" onClick={requestExplanation} disabled={aiState === "loading"} className="mt-3 text-xs text-blue-700 hover:text-blue-600">
              {aiState === "loading" ? "Explaining…" : "Explain in plain language with AI"}
            </button>
          )}
        </div>
      )}
    </>
  );
}

function SuggestedFocus({ brief, candidate, impressionId, onDisposed }: { brief: MissionControlBrief; candidate: MissionControlCandidate; impressionId?: string; onDisposed: (message: string) => void }) {
  return (
    <section className={`${CARD} border-t-4 border-t-brand p-5`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-brand">Suggested focus</p>
      <h2 className="mt-2 text-xl font-medium tracking-tight text-ink">{candidate.title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-body">{candidate.explanation}</p>
      <CandidateControls brief={brief} candidate={candidate} impressionId={impressionId} onDisposed={onDisposed} />
    </section>
  );
}

function TruthSignal({ brief }: { brief: MissionControlBrief }) {
  return (
    <aside className={`${CARD} flex min-h-48 flex-col justify-between p-5`}>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">This week</p>
      <div>
        <h2 className="text-lg font-medium text-ink">{brief.truth_signal.title}</h2>
        <p className="mt-2 text-sm leading-5 text-ink-secondary">{brief.truth_signal.detail}</p>
      </div>
    </aside>
  );
}

function SecondaryPriorities({ brief, impressions, onDisposed }: { brief: MissionControlBrief; impressions: ImpressionMap; onDisposed: (message: string) => void }) {
  if (brief.secondary.length === 0) return null;
  return (
    <section className={`${CARD} mt-5`}>
      <div className="border-b border-divider px-5 py-4">
        <h2 className="text-base font-medium text-ink">Also worth attention</h2>
      </div>
      <div className="divide-y divide-divider">
        {brief.secondary.map((candidate) => (
          <article key={candidate.candidate_key} className="px-5 py-4">
            <h3 className="text-sm font-medium text-ink">{candidate.title}</h3>
            <p className="mt-1 text-sm text-ink-secondary">{candidate.explanation}</p>
            <CandidateControls brief={brief} candidate={candidate} impressionId={impressions[candidate.candidate_key]} onDisposed={onDisposed} compact />
          </article>
        ))}
      </div>
    </section>
  );
}

function Supporting({ brief }: { brief: MissionControlBrief }) {
  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className={`${CARD} p-5`}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium text-ink">1:1 rhythm</h2>
          <Link href="/app/1-1s" className="text-xs text-brand hover:text-brand-hover">View 1:1s →</Link>
        </div>
        <div className="mt-3 divide-y divide-divider">
          {brief.supporting.conversations.length ? brief.supporting.conversations.map((item) => (
            <Link key={item.id} href={item.href} className="flex items-center justify-between gap-4 py-3 text-sm hover:text-brand">
              <span className="text-ink-body">{item.title}</span><span className={META}>{item.meta}</span>
            </Link>
          )) : <p className="py-3 text-sm text-ink-secondary">No conversation records yet.</p>}
        </div>
      </section>
      <section className={`${CARD} p-5`}>
        <h2 className="text-base font-medium text-ink">What has changed</h2>
        <div className="mt-3 divide-y divide-divider">
          {brief.supporting.changes.length ? brief.supporting.changes.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div><p className="text-ink-body">{item.title}</p><p className={META}>{item.meta}</p></div>
              <span className={META}>{item.freshness}</span>
            </div>
          )) : <p className="py-3 text-sm text-ink-secondary">No recent recorded changes.</p>}
        </div>
      </section>
    </div>
  );
}

export function ActionBrief({ brief, onRefresh }: { brief: MissionControlBrief; onRefresh: () => void }) {
  const { open: openQuickAdd } = useQuickAdd();
  const [impressions, setImpressions] = useState<ImpressionMap>({});
  const [toast, setToast] = useState("");
  const [stale, setStale] = useState(() => Date.now() >= new Date(brief.stale_after).getTime());
  const candidates = useMemo(() => [brief.primary, ...brief.secondary].filter((item): item is MissionControlCandidate => !!item), [brief]);

  useEffect(() => {
    const staleAt = new Date(brief.stale_after).getTime();
    setStale(Date.now() >= staleAt);
    const delay = Math.max(0, staleAt - Date.now());
    const timer = window.setTimeout(() => setStale(true), delay);
    return () => window.clearTimeout(timer);
  }, [brief.stale_after]);

  useEffect(() => {
    let cancelled = false;
    if (!candidates.length) return;
    recordMissionControlEvents(candidates.map((candidate) => eventFor(brief, candidate, "impression")))
      .then((result) => {
        if (cancelled) return;
        const map: ImpressionMap = {};
        candidates.forEach((candidate, index) => { map[candidate.candidate_key] = result.events[index]?.id; });
        setImpressions(map);
      })
      .catch(() => undefined);
    reconcileMissionControlOutcomes().catch(() => undefined);
    return () => { cancelled = true; };
  }, [brief.brief_id]); // candidates are immutable within a brief

  function disposed(message: string) {
    setToast(message);
    window.setTimeout(onRefresh, 700);
  }

  async function dismissOptionalContext() {
    if (!brief.optional_context || !brief.primary) return;
    const candidate: MissionControlCandidate = {
      ...brief.primary,
      candidate_key: brief.optional_context.candidate_key,
      evidence_fingerprint: brief.optional_context.evidence_fingerprint,
      candidate_type: "early_role_grounding",
      rank: 1,
    };
    await recordMissionControlEvents([eventFor(brief, candidate, "setup_dismissed_today", undefined, startOfNextLocalDay())]);
    setToast("Dismissed until tomorrow. No setup record was changed.");
    window.setTimeout(onRefresh, 700);
  }

  return (
    <PageShell maxWidth="7xl">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Mission Control</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {brief.mode === "busy" ? "Several signals are competing. The most actionable one is first." : brief.mode === "early_use" || brief.mode === "empty" ? "Start with one useful management moment." : "Here’s a useful place to start."}
          </p>
        </div>
        <button type="button" onClick={onRefresh} className="text-xs text-ink-muted hover:text-ink-secondary">Refresh</button>
      </div>

      {stale && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-surface px-4 py-3" role="status">
          <p className="text-sm text-ink-secondary">This brief is more than 24 hours old. Refresh when you want to check for changes.</p>
          <button type="button" onClick={onRefresh} className="text-xs font-medium text-brand hover:text-brand-hover">Refresh brief</button>
        </div>
      )}

      <CoverageNotice brief={brief} />
      {toast && <p className="mb-4 text-sm text-brand" aria-live="polite">{toast}</p>}

      {brief.mode === "empty" ? (
        <section className={`${CARD} border-t-4 border-t-brand p-6`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">Start here</p>
          <h2 className="mt-2 text-xl font-medium text-ink">Add your first direct report.</h2>
          <p className="mt-2 text-sm text-ink-secondary">TSP needs one real working relationship before it can offer a useful management brief.</p>
          <button type="button" onClick={openQuickAdd} className={`mt-4 ${BTN_PRIMARY}`}>Add a direct report</button>
        </section>
      ) : brief.primary ? (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,.7fr)]">
            <SuggestedFocus brief={brief} candidate={brief.primary} impressionId={impressions[brief.primary.candidate_key]} onDisposed={disposed} />
            <TruthSignal brief={brief} />
          </div>
          <SecondaryPriorities brief={brief} impressions={impressions} onDisposed={disposed} />
        </>
      ) : (
        <div>
          <section className={`${CARD} border-t-4 border-t-brand p-6`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">{brief.mode === "all_clear" ? "All clear" : "No focus available"}</p>
            <h2 className="mt-2 text-xl font-medium text-ink">{brief.truth_signal.title}</h2>
            <p className="mt-2 text-sm text-ink-secondary">{brief.truth_signal.detail}</p>
            {brief.mode === "partial" && <button type="button" onClick={onRefresh} className={`mt-4 ${BTN_SECONDARY}`}>Try again</button>}
            {brief.mode === "partial" && (
              <div className="mt-3 flex flex-wrap gap-3">
                <Link href="/app/1-1s" className="text-xs text-brand">View 1:1s →</Link>
                <Link href="/app/goals" className="text-xs text-brand">View goals →</Link>
                <Link href="/app/projects" className="text-xs text-brand">View projects →</Link>
              </div>
            )}
            {brief.mode === "all_clear" && <Link href="/app/1-1s" className="mt-4 inline-block text-xs text-brand">Review your 1:1 rhythm →</Link>}
          </section>
        </div>
      )}

      {brief.optional_context && (
        <section className="mt-5 rounded-lg border border-hairline bg-surface px-4 py-3">
          <p className="text-sm text-ink-body">{brief.optional_context.title}</p>
          <p className="mt-1 text-xs text-ink-muted">{brief.optional_context.detail}</p>
          <div className="mt-2 flex gap-3">
            <Link href={brief.optional_context.href} className="text-xs text-brand">Add role →</Link>
            <button type="button" onClick={dismissOptionalContext} className="text-xs text-ink-muted">Dismiss for today</button>
          </div>
        </section>
      )}
      <Supporting brief={brief} />
    </PageShell>
  );
}

export function ActionBriefLoading() {
  return (
    <PageShell maxWidth="7xl" className="animate-pulse">
      <div role="status" aria-label="Loading Mission Control">
        <div className="h-8 w-52 rounded bg-sunken" />
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,.7fr)]">
          <div className="h-64 rounded-xl bg-surface" /><div className="h-64 rounded-xl bg-surface" />
        </div>
      </div>
    </PageShell>
  );
}

export function ActionBriefLoadFailure({ onRetry, onLegacy }: { onRetry: () => void; onLegacy: () => void }) {
  return (
    <PageShell maxWidth="7xl">
      <section className={`${CARD} p-6`} role="alert">
        <h1 className="text-xl font-medium text-ink">Mission Control couldn’t be checked.</h1>
        <p className="mt-2 text-sm text-ink-secondary">No all-clear or recommendation has been inferred.</p>
        <div className="mt-4 flex gap-2"><button onClick={onRetry} className={BTN_PRIMARY}>Try again</button><button onClick={onLegacy} className={BTN_SECONDARY}>Open previous dashboard</button></div>
      </section>
    </PageShell>
  );
}
