"use client";

// Team goals in setup: the second half of step 6 (docs/design-proposals/2026-10-20-team-goals-step/).
//
// A manager who has just written detailed role expectations is asked for goals
// next, and can read it as double entry (Susie's run). This modal puts the two
// side by side from their own records: the job (expectations, which hold every
// period) against this period (team goals, which change something by a date),
// with what each gets them. Then up to three goals to start from, each drafted
// from one expectation or one goal above their unit (POST
// /api/onboarding/team-goals/suggest, the one AI call). Nothing is saved here:
// "Use this" opens the normal New goal form already filled in, and only "Add
// goal" there saves (Hard Rule 6). Targets are left for the manager to set.
//
// Voice: literal labels, no cheer.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  TeamGoalSuggestion,
  TeamGoalsContext,
  getTeamGoalsContext,
  reportAiDraft,
  suggestTeamGoals,
} from "@/lib/api";
import { formatDay, goalsHref } from "@/lib/goals";
import { saveGoalDraft } from "@/lib/goalDraft";
import WaitNote from "@/components/WaitNote";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, EYEBROW } from "@/lib/tokens";

// One AI call per unit per visit: reopening the modal shows the same drafts.
const cache = new Map<string, TeamGoalSuggestion[]>();

const MAX_SHOWN_LINES = 4;

export default function TeamGoalsModal({ onClose, supportsGoalId = null }: { onClose: () => void; supportsGoalId?: string | null }) {
  const router = useRouter();
  const [ctx, setCtx] = useState<TeamGoalsContext | null>(null);
  const [ctxError, setCtxError] = useState(false);
  const [suggestions, setSuggestions] = useState<TeamGoalSuggestion[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const shownAt = useRef(0);
  const used = useRef(false);

  useEffect(() => {
    let live = true;
    getTeamGoalsContext()
      .then((c) => {
        if (!live) return;
        setCtx(c);
        if (c.can_suggest) void suggest(c);
      })
      .catch(() => live && setCtxError(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function suggest(c: TeamGoalsContext) {
    const key = `${c.unit?.id ?? "none"}:${supportsGoalId ?? ""}`;
    const hit = cache.get(key);
    if (hit) {
      setSuggestions(hit);
      shownAt.current = Date.now();
      return;
    }
    setSuggesting(true);
    setSuggestError(null);
    try {
      const r = await suggestTeamGoals(supportsGoalId);
      cache.set(key, r.suggestions);
      setSuggestions(r.suggestions);
      shownAt.current = Date.now();
    } catch (e) {
      setSuggestError(e instanceof ApiError && e.status < 500 ? e.detail : "Suggestions didn’t load. You can still write your own.");
    } finally {
      setSuggesting(false);
    }
  }

  // Suggestions shown and none used: reported once, on close or on "Write my own".
  function reportDiscarded() {
    const shown = (suggestions ?? []).length;
    if (shown && !used.current) {
      used.current = true;
      void reportAiDraft({
        surface: "team_goal_suggestions",
        outcome: "discarded",
        edit_bucket: "none",
        seconds_to_confirm: Math.min(86_400, Math.round((Date.now() - shownAt.current) / 1000)),
        items_drafted: shown,
        items_kept: 0,
      });
    }
  }

  function close() {
    reportDiscarded();
    onClose();
  }

  const word = ctx?.word ?? "team";
  const Word = word === "department" ? "Department" : "Team";
  const unitName = ctx?.unit?.name ?? `your ${word}`;
  const formHref = (supports: string | null) =>
    goalsHref({ level: ctx?.unit?.level ?? "team", scope: ctx?.unit?.id ?? null, create: true, supports });

  function use(s: TeamGoalSuggestion) {
    used.current = true;
    const ok = saveGoalDraft({
      title: s.title,
      dueDate: s.due_date,
      parentGoalId: s.supports_goal_id,
      measure: s.measure,
      source: { kind: s.source.kind, label: s.source.label, role: s.source.role, where: s.source.where ?? null },
      targetHint: s.target_hint,
      drafted: (suggestions ?? []).length,
      shownAt: shownAt.current || Date.now(),
    });
    router.push(ok ? `${formHref(s.supports_goal_id)}&draft=1` : formHref(s.supports_goal_id));
  }

  const lines = (ctx?.roles ?? []).flatMap((r) => r.items.map((i) => ({ ...i, role: r.label }))).slice(0, MAX_SHOWN_LINES);
  const firstRole = ctx?.roles[0]?.label;
  const visible = (suggestions ?? []).filter((s) => !dismissed.has(s.key));
  const fromGoals = !!ctx?.above_goals.length;
  const fromExpectations = !!ctx?.roles.length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-10" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-goals-title"
        className="w-full max-w-3xl rounded-xl border border-hairline bg-surface p-5 shadow-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={EYEBROW}>Setup · Goals</p>
            <h2 id="team-goals-title" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
              Your {word}’s goals for this period
            </h2>
            <p className="mt-2 max-w-[62ch] text-sm text-ink-secondary">
              {firstRole
                ? `You’ve set what the ${firstRole} role asks for. A ${word} goal is different: what ${unitName} is pushing to change, by a date.`
                : `Expectations are the job itself, and they hold every period. A ${word} goal is what ${unitName} is pushing to change, by a date.`}
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="rounded px-2 text-lg leading-none text-ink-muted hover:text-ink">
            ×
          </button>
        </div>

        {ctxError && <p role="alert" className="mt-4 text-sm text-red-700">This didn’t load. Close it and try again, or write your goal on the Goals page.</p>}

        {ctx && (
          <>
            <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-2">
              <section className="min-w-0 bg-sunken/60 p-4">
                <p className={EYEBROW}>The job · Role expectations</p>
                <h3 className="mt-1 font-serif text-[1.15rem] text-ink">Holds every period</h3>
                {lines.length ? (
                  <ul className="mt-2 space-y-1.5 text-[13px] text-ink-body">
                    {lines.map((l) => (
                      <li key={l.id} className="flex gap-2">
                        <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-faint" />
                        <span className="min-w-0">
                          {l.line}
                          {(ctx.roles.length > 1) && <span className="text-ink-muted"> · {l.role}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[13px] text-ink-muted">No role expectations set yet.</p>
                )}
                <p className="mt-3 border-t border-divider pt-3 text-[13px] text-ink-secondary">
                  <span className="font-medium text-ink">What you get:</span> assessments rate each person against these, and prep sheets hold their work against them.
                </p>
              </section>
              <section className="min-w-0 bg-sunken/60 p-4">
                <p className={`${EYEBROW} !text-brand`}>This period · {Word} goals</p>
                <h3 className="mt-1 font-serif text-[1.15rem] text-ink">Has an end date</h3>
                <p className="mt-2 text-[13px] text-ink-body">What the whole {word} pushes on together. You own the result.</p>
                {ctx.own_goals.length > 0 && (
                  <ul className="mt-2 space-y-1.5 text-[13px] text-ink-body">
                    {ctx.own_goals.slice(0, 3).map((g) => (
                      <li key={g.id} className="flex gap-2">
                        <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                        <span className="min-w-0">
                          {g.title}
                          {g.due_date && <span className="text-ink-muted"> · due {formatDay(g.due_date)}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 border-t border-divider pt-3 text-[13px] text-ink-secondary">
                  <span className="font-medium text-ink">What you get:</span> Mission Control and prep sheets show which goals are at risk, and progress is tracked against the date.
                </p>
              </section>
            </div>

            <p className="mt-4 flex gap-3 rounded-lg bg-amber-50 px-4 py-3 text-[13px] text-ink-body">
              <span className="shrink-0 pt-px text-[11px] font-semibold uppercase tracking-wide text-amber-700">Quick test</span>
              <span>If hitting it just means everyone doing their job well, it’s already an expectation. A goal changes something and has a date.</span>
            </p>

            <section className="mt-6" aria-labelledby="team-goals-suggested">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="team-goals-suggested" className="font-serif text-[1.15rem] text-ink">Goals to start from</h3>
                {ctx.can_suggest && (
                  <p className="text-xs text-ink-muted">
                    Drafted from {fromExpectations && fromGoals ? "your expectations and the goals above you" : fromGoals ? "the goals above you" : "your expectations"}. Nothing is saved until you add one.
                  </p>
                )}
              </div>

              {!ctx.can_suggest && (
                <div className="mt-3 rounded-lg border border-dashed border-hairline p-4 text-[13px] text-ink-secondary">
                  There’s nothing to suggest goals from yet: no role expectations and no company or department goals. Add either and suggestions show up here, or write your own now.
                </div>
              )}

              {suggesting && (
                <>
                  <p className="mt-3 text-[13px] text-ink-secondary">Drafting from what you’ve entered…</p>
                  <WaitNote active={suggesting} typical="about 15 seconds" className="mt-1" />
                </>
              )}
              {suggestError && <p role="alert" className="mt-3 text-sm text-red-700">{suggestError}</p>}
              {suggestions && suggestions.length === 0 && (
                <p className="mt-3 text-[13px] text-ink-secondary">No suggestion held up against your records this time. Write your own below.</p>
              )}

              {visible.length > 0 && (
                <ul className="mt-3 space-y-3">
                  {visible.map((s) => (
                    <li key={s.key} className="grid gap-x-5 gap-y-1.5 rounded-lg border border-hairline bg-canvas p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <p className="sm:col-span-2">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] ${
                            s.source.kind === "goal" ? "bg-brand-tint text-brand" : "bg-sunken text-ink-secondary"
                          }`}
                        >
                          {s.source.kind === "goal"
                            ? `From a goal above you · ${s.source.where ?? ""} · ${s.source.label}`
                            : `From an expectation · ${s.source.role ? `${s.source.role} · ` : ""}${s.source.label}`}
                        </span>
                      </p>
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-ink">{s.title}</p>
                        <p className="mt-0.5 text-xs text-ink-muted">
                          {s.due_date ? `Due ${formatDay(s.due_date)}` : "No due date"}
                          {s.target_hint && ` · the role’s bar is ${s.target_hint}; you set the ${word}’s target`}
                          {!s.target_hint && s.measure && ` · you set the target`}
                        </p>
                        {s.why && <p className="mt-1.5 text-[13px] text-ink-body">{s.why}</p>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-stretch sm:justify-center">
                        <button type="button" onClick={() => use(s)} className={BTN_PRIMARY}>
                          Use this
                        </button>
                        <button
                          type="button"
                          onClick={() => setDismissed(new Set(dismissed).add(s.key))}
                          className={BTN_GHOST}
                        >
                          Not this one
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {suggestions && suggestions.length > 0 && (
                <p className="mt-3 border-l-2 border-hairline pl-3 text-xs text-ink-muted">
                  These never add up everyone’s expectations (“the {word} resolves 56 cases a day”). That’s the job already, and it’s tracked per person.
                </p>
              )}
            </section>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
              <p className="max-w-[52ch] text-[13px] text-ink-muted">
                You won’t set individual goals here. Each person starts with what their role expects; add goals of their own later from their page.
              </p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={close} className={BTN_GHOST}>
                  Later
                </button>
                <Link href={formHref(supportsGoalId)} onClick={reportDiscarded} className={BTN_SECONDARY}>
                  Write my own
                </Link>
              </div>
            </div>
          </>
        )}
        {!ctx && !ctxError && <p className="mt-4 text-sm text-ink-muted">Loading…</p>}
      </div>
    </div>
  );
}
