"use client";

// The action brief's recommendation controls, shared by Mission Control's
// "Your week, in focus" page (components/mission-control/WeekInFocus.tsx).
//
// What lives here is the part of the action brief whose semantics must not
// drift: the event shape every disposition writes, the CTA → cta_clicked
// sequence, Why this? (deterministic evidence, ranking basis, boundaries, the
// optional bounded AI paraphrase), and Addressed / Snooze / Not relevant.
// None of these handlers calls a source-record writer — see
// docs/systems/mission-control.md → Dispositions and analytics.
//
// The management-runway presentation that used to live here was replaced by
// the week-in-focus layout (docs/design-proposals/2026-09-24-week-in-focus/).
// Candidate eligibility, ranking and coverage are unchanged.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MissionControlBrief,
  MissionControlCandidate,
  MissionControlEventInput,
  explainMissionControlCandidate,
  recordMissionControlEvents,
} from "@/lib/api";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, ELEVATED } from "@/lib/tokens";
import PageShell from "@/components/PageShell";

export type ImpressionMap = Record<string, string>;

export function eventFor(
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

export function startOfNextLocalDay() {
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

/** Names every source that could not be fully checked — the brief's own
 *  domains plus any the week view could not load — so a quiet section never
 *  reads as an all-clear. */
export function CoverageNotice({ domains }: { domains: string[] }) {
  if (domains.length === 0) return null;
  return (
    <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700" role="status">
      Some sources could not be fully checked: {domains.join(", ")}. What you see below uses only the records that loaded.
    </div>
  );
}

export function CandidateControls({
  brief,
  candidate,
  impressionId,
  onDisposed,
  variant = "full",
}: {
  brief: MissionControlBrief;
  candidate: MissionControlCandidate;
  impressionId?: string;
  onDisposed: (message: string) => void;
  /** `quiet` renders the CTA as a text action and the controls as small text
   *  buttons, for Mission Control's secondary right-hand column. Same events. */
  variant?: "full" | "quiet";
}) {
  const router = useRouter();
  const [whyOpen, setWhyOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiState, setAiState] = useState<"idle" | "loading" | "failed">("idle");
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const quiet = variant === "quiet";

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
    setMenuOpen(false);
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

  const smallBtn = "rounded text-[11px] text-ink-muted hover:text-ink-secondary disabled:opacity-50";

  return (
    <>
      {quiet && (
        <button
          type="button"
          onClick={navigate}
          disabled={busy}
          className="mt-2.5 block rounded text-left text-xs font-medium text-brand hover:text-brand-hover disabled:opacity-50"
        >
          {candidate.action.label}<span aria-hidden="true"> →</span>
        </button>
      )}
      <div className={quiet ? "mt-2 flex flex-wrap items-center gap-x-4 gap-y-2" : "mt-4 flex flex-wrap items-center gap-2"}>
        {!quiet && (
          <button type="button" onClick={navigate} disabled={busy} className={BTN_PRIMARY}>
            {candidate.action.label}
          </button>
        )}
        <button type="button" onClick={toggleWhy} aria-expanded={whyOpen} className={quiet ? smallBtn : BTN_GHOST}>
          Why this?
        </button>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={quiet ? `More responses for ${candidate.title}` : undefined}
            className={quiet ? smallBtn : BTN_SECONDARY}
          >
            More ···
          </button>
          {menuOpen && (
            <div role="menu" className={`absolute ${quiet ? "right-0" : "left-0"} top-7 z-20 w-52 p-1 ${ELEVATED}`}>
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
        <div className={`mt-3 rounded-lg ${quiet ? "bg-sunken px-3 py-3 text-xs" : "bg-brand-tint px-4 py-3 text-sm"} text-ink-body`}>
          <h3 className="font-medium text-ink">Why this was suggested</h3>
          <ul className="mt-2 space-y-2">
            {candidate.evidence.map((item) => (
              <li key={`${item.code}:${item.observed_at ?? "none"}`}>
                <span className="text-ink">{item.label}</span>
                <span className="block text-[11px] text-ink-muted">{item.source} · {item.freshness}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-divider pt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Ranking basis</p>
            <p className="mt-1 text-xs text-ink-secondary">{candidate.rank_basis.map((item) => item.label).join(" · ")}</p>
          </div>
          {(candidate.boundaries.length > 0 || Object.values(brief.coverage).some((status) => status !== "ok")) && (
            <div className="mt-3 border-t border-divider pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Boundaries</p>
              {candidate.boundaries.map((boundary) => <p key={boundary} className="mt-1 text-xs text-ink-secondary">{boundary}</p>)}
              {Object.values(brief.coverage).some((status) => status !== "ok") && <p className="mt-1 text-xs text-ink-secondary">Unavailable sources did not contribute to this recommendation.</p>}
            </div>
          )}
          {aiExplanation && <p className="mt-3 rounded-md bg-surface px-3 py-2 text-xs text-ink-body">{aiExplanation}</p>}
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

/** Page-shaped skeleton for the week-in-focus layout. */
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
