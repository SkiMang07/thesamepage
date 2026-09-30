"use client";

// Org goals on-ramp (setup mode chunk C; docs/design-proposals/2026-09-29-onboarding-path/
// CHUNK_C_PLAN.md). Company and department goals usually exist somewhere already
// (an annual plan, an OKR page, a strategy deck). The manager pastes, speaks or
// attaches them; "Read this" is the one AI call (POST .../org-goals/parse) and
// returns drafts only. Nothing is saved and the input is not kept. Review: a
// ranked, capped list; rows the text did not state plainly start unchecked;
// nothing saves until "Save selected", and only the checked rows are sent
// (Hard Rule 6). Team goals are the manager's own to write and are not drafted.
//
// "Don't know yet" is a recorded answer, not a skip: it parks the goals step and
// puts one question on the next meeting with their boss.
//
// Voice: literal labels, no cheer. Counts and fixed values only go to analytics
// (sent by the server).

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  OrgGoalDraft,
  OrgGoalsApplyResult,
  OrgGoalsParsed,
  applyOrgGoals,
  markOrgGoalsUnknown,
  parseOrgGoals,
} from "@/lib/api";
import WaitNote from "@/components/WaitNote";
import NoteField from "@/components/NoteField";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, EYEBROW, INPUT } from "@/lib/tokens";

const ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";
const MAX_FILES = 3;

type Phase = "input" | "reading" | "review" | "saving" | "receipt" | "unknown";

// What the manager can change in a row, keyed by the server's row key.
type RowEdit = { title?: string; period?: string; setBy?: string };

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export default function OrgGoalsModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("input");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<OrgGoalsParsed | null>(null);
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [result, setResult] = useState<OrgGoalsApplyResult | null>(null);
  const [unknownAdded, setUnknownAdded] = useState(false);
  const shownAt = useRef<number>(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = phase === "reading" || phase === "saving";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_FILES));
  }

  async function read() {
    setError(null);
    setPhase("reading");
    try {
      const d = await parseOrgGoals({ text, files });
      setDraft(d);
      setKept(Object.fromEntries(d.goals.map((g) => [g.key, !g.low])));
      setEdits({});
      shownAt.current = Date.now();
      setPhase("review");
    } catch (e) {
      setError(readable(e));
      setPhase("input");
    }
  }

  async function dontKnow() {
    setError(null);
    setPhase("saving");
    try {
      const r = await markOrgGoalsUnknown();
      setUnknownAdded(r.added_to_meeting);
      setPhase("unknown");
    } catch (e) {
      setError(readable(e));
      setPhase("input");
    }
  }

  const goals = useMemo(() => draft?.goals ?? [], [draft]);
  const keptCount = goals.filter((g) => kept[g.key]).length;
  const isEdited = (g: OrgGoalDraft) => {
    const e = edits[g.key];
    return !!e && ((e.title !== undefined && e.title !== g.title) || (e.period !== undefined && e.period !== (g.period_label ?? "")) || (e.setBy !== undefined && e.setBy !== (g.set_by ?? "")));
  };
  const editedCount = goals.filter((g) => kept[g.key] && isEdited(g)).length;

  async function save() {
    if (!draft) return;
    setError(null);
    setPhase("saving");
    try {
      const r = await applyOrgGoals({
        goals: goals
          .filter((g) => kept[g.key])
          .map((g) => {
            const e = edits[g.key] ?? {};
            return {
              level: g.level,
              title: (e.title ?? g.title).trim() || g.title,
              success_metrics: g.success_metrics,
              org_unit_name: g.org_unit_name,
              period_label: (e.period ?? g.period_label ?? "").trim() || null,
              set_by: (e.setBy ?? g.set_by ?? "").trim() || null,
              due_date: g.due_date,
            };
          }),
        proposed: goals.length,
        edited: editedCount,
        seconds_to_confirm: Math.max(0, Math.round((Date.now() - shownAt.current) / 1000)),
      });
      setResult(r);
      setPhase("receipt");
    } catch (e) {
      setError(readable(e));
      setPhase("review");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-10"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="org-goals-title"
        className="w-full max-w-2xl rounded-xl border border-hairline bg-surface p-5 shadow-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {(phase === "input" || phase === "reading" || (phase === "saving" && !draft)) && (
          <>
            <p className={EYEBROW}>Setup</p>
            <h2 id="org-goals-title" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
              Add your company or department goals
            </h2>
            <p className="mt-2 text-sm text-ink-secondary">
              What were you asked to deliver, and by when? Paste it, say it, or attach the plan, deck or goals page. Only company and department goals: a team goal is yours to write. You review everything before it is saved.
            </p>

            <NoteField
              id="org-goals-text"
              aria-label="Your company or department goals"
              value={text}
              onChange={setText}
              disabled={phase !== "input"}
              rows={8}
              placeholder="e.g. FY26: reach $12M ARR by Dec 31 (set by the CEO). Support: keep CSAT above 92 percent."
              className="mt-4 text-sm leading-relaxed"
            />

            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <button
                type="button"
                disabled={phase !== "input" || files.length >= MAX_FILES}
                onClick={() => fileInput.current?.click()}
                className="font-medium text-brand hover:text-brand-hover disabled:opacity-50"
              >
                Attach files
              </button>
              <span>PDF, Word or text · up to {MAX_FILES}</span>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-control bg-sunken px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-ink">
                      {f.name} <span className="ml-1 text-ink-muted">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                    </span>
                    <button
                      type="button"
                      disabled={phase !== "input"}
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="shrink-0 text-ink-secondary hover:text-ink"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 rounded-lg bg-sunken px-4 py-3 text-[13px] leading-relaxed text-ink-secondary">
              <p className="font-medium text-ink">What is stored</p>
              <p className="mt-1">
                This is read once to draft suggestions. The text and files are not kept. Only the goals you choose to save are stored, as ordinary goals you can edit or delete. Leave out anything you aren’t allowed to share outside your company.
              </p>
            </div>

            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <button type="button" disabled={phase !== "input"} onClick={dontKnow} className={BTN_GHOST}>
                  Don’t know yet
                </button>
                <p className="mt-0.5 max-w-xs text-xs text-ink-muted">Recorded, and added to your next meeting with your boss. This step stays open until a goal is added.</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" disabled={phase !== "input"} onClick={onClose} className={BTN_SECONDARY}>
                  Close
                </button>
                <button type="button" onClick={read} disabled={phase !== "input" || (!text.trim() && files.length === 0)} className={BTN_PRIMARY}>
                  {phase === "reading" ? "Reading…" : "Read this"}
                </button>
              </div>
            </div>
            <WaitNote active={phase === "reading"} typical="up to a minute" className="mt-2 text-right" />
          </>
        )}

        {(phase === "review" || (phase === "saving" && draft)) && draft && (
          <>
            <p className={EYEBROW}>Review</p>
            <h2 id="org-goals-title" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
              {goals.length === 0 ? "No company or department goals found" : `${plural(goals.length, "goal", "goals")} from your text`}
            </h2>
            <p className="mt-2 text-sm text-ink-secondary">
              {goals.length === 0
                ? "Nothing in it read as a company or department goal. Nothing was saved."
                : "Nothing is saved until you choose Save selected. Goals the text did not state plainly start unchecked. Numbers come only from your text."}
            </p>

            {goals.length > 0 && (
              <ul className="mt-4 divide-y divide-hairline rounded-lg border border-hairline">
                {goals.map((g) => (
                  <li key={g.key} className="flex items-start gap-3 px-3 py-3">
                    <input
                      id={`og-${g.key}`}
                      type="checkbox"
                      checked={!!kept[g.key]}
                      onChange={(e) => setKept({ ...kept, [g.key]: e.target.checked })}
                      className="mt-1 h-4 w-4 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <label htmlFor={`og-${g.key}`} className="block text-xs font-medium text-ink-secondary">
                        {g.level === "company" ? "Company goal" : `Department goal${g.org_unit_name ? ` · ${g.org_unit_name}` : ""}`}
                        {g.due_date && <span className="ml-2 font-normal text-ink-muted">· ends {g.due_date}</span>}
                        {g.low && <span className="ml-2 font-normal text-ink-muted">· not stated plainly</span>}
                      </label>
                      <input
                        aria-label="Goal"
                        className={`${INPUT} mt-1`}
                        value={edits[g.key]?.title ?? g.title}
                        onChange={(e) => setEdits({ ...edits, [g.key]: { ...edits[g.key], title: e.target.value } })}
                      />
                      {g.success_metrics && <p className="mt-1 text-xs text-ink-muted">Measure: {g.success_metrics}</p>}
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <input
                          aria-label="Period"
                          placeholder="Period, e.g. FY26"
                          maxLength={80}
                          className={INPUT}
                          value={edits[g.key]?.period ?? g.period_label ?? ""}
                          onChange={(e) => setEdits({ ...edits, [g.key]: { ...edits[g.key], period: e.target.value } })}
                        />
                        <input
                          aria-label="Set by"
                          placeholder="Set by, e.g. CEO"
                          maxLength={80}
                          className={INPUT}
                          value={edits[g.key]?.setBy ?? g.set_by ?? ""}
                          onChange={(e) => setEdits({ ...edits, [g.key]: { ...edits[g.key], setBy: e.target.value } })}
                        />
                      </div>
                      {g.excerpt && <p className="mt-1 text-xs text-ink-muted">From your text: “{g.excerpt}”</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {draft.overflow > 0 && (
              <p className="mt-3 text-[13px] text-ink-secondary">
                {plural(draft.overflow, "more goal was", "more goals were")} found and not shown, and will not be saved. Run it again with a shorter text to see them.
              </p>
            )}
            {draft.truncated && (
              <p className="mt-2 text-[13px] text-ink-secondary">Your text was longer than we can read at once. Only the first part was read.</p>
            )}

            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <button type="button" disabled={phase === "saving"} onClick={() => setPhase("input")} className={BTN_GHOST}>
                Back to text
              </button>
              <div className="flex items-center gap-2">
                <button type="button" disabled={phase === "saving"} onClick={onClose} className={BTN_SECONDARY}>
                  Close without saving
                </button>
                <button type="button" onClick={save} disabled={phase === "saving" || keptCount === 0} className={BTN_PRIMARY}>
                  {phase === "saving" ? "Saving…" : `Save ${keptCount} selected`}
                </button>
              </div>
            </div>
          </>
        )}

        {phase === "receipt" && result && (
          <>
            <p className={EYEBROW}>Saved</p>
            <h2 id="org-goals-title" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
              {result.saved ? plural(result.saved, "goal", "goals") : "Nothing was saved"}
            </h2>
            {result.saved > 0 && (
              <p className="mt-2 text-sm text-ink-secondary">
                Each is marked as confirmed today. You are asked again after a quarter whether it is still current.
              </p>
            )}
            {result.skipped_existing > 0 && (
              <p className="mt-2 text-sm text-ink-secondary">{plural(result.skipped_existing, "goal was", "goals were")} already there and not duplicated.</p>
            )}
            {result.refused.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-ink-secondary">
                {result.refused.map((r, i) => (
                  <li key={i}>Not saved: {r.reason}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-sm text-ink-secondary">
              A team goal is yours to write. <Link href="/app/goals" className="font-medium text-brand hover:text-brand-hover">Add one on the Goals page</Link>.
            </p>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={onClose} className={BTN_PRIMARY}>
                Done
              </button>
            </div>
          </>
        )}

        {phase === "unknown" && (
          <>
            <p className={EYEBROW}>Recorded</p>
            <h2 id="org-goals-title" className="mt-1 font-serif text-[1.5rem] font-normal leading-tight tracking-[-0.02em] text-ink">
              Company and department goals: not known yet
            </h2>
            <p className="mt-2 text-sm text-ink-secondary">
              {unknownAdded ? (
                <>“Ask for this period’s company or department goals” is now on your next meeting with your boss.</>
              ) : (
                <>
                  It goes on the first meeting you set up with your boss.{" "}
                  <Link href="/app/beyond" className="font-medium text-brand hover:text-brand-hover">Add that meeting in Beyond the team</Link>.
                </>
              )}{" "}
              The goals step stays open until a company or department goal is added. Come back to it any time.
            </p>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={onClose} className={BTN_PRIMARY}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function readable(e: unknown) {
  if (e instanceof ApiError) {
    try {
      const d = JSON.parse(e.detail)?.detail;
      if (typeof d === "string") return d;
    } catch {
      /* not JSON */
    }
    return e.status < 500 ? e.detail : "That didn’t work. Your text is still here, try again.";
  }
  return "That didn’t work. Your text is still here, try again.";
}
