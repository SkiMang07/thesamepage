"use client";

// The AI thought partner beside the draft: focused questions tied to real
// gaps, answered in place or by editing the draft; separately reviewable
// suggestions that change nothing until accepted; and what's parked for
// later, with its date.

import { useState } from "react";
import { RoleDraft, RoleItem, RoleQuestion, RoleSuggestion } from "@/lib/api";
import { BTN_GHOST, BTN_PRIMARY_SM, BTN_SECONDARY, TEXTAREA } from "@/lib/tokens";
import { FollowUpPicker, formatDay } from "@/components/expectations/shared";

type Props = {
  draft: RoleDraft;
  items: RoleItem[];
  answers: Record<string, string>;
  statuses: Record<string, RoleQuestion["status"]>;
  busy: boolean;
  focusId: string | null;
  onAnswerChange: (qid: string, text: string) => void;
  onAnswer: (q: RoleQuestion) => void;
  onDismiss: (q: RoleQuestion) => void;
  onDefer: (q: RoleQuestion, isoDate: string) => void;
  onGoToField: (itemKey: string, field: string) => void;
  onSuggestion: (s: RoleSuggestion, action: "accept" | "dismiss") => void;
  onRetry: () => void;
};

const FIELD_LABEL: Record<string, string> = {
  title: "Name",
  responsibility: "What they own",
  meets: "Meets expectations",
  exceeds: "Exceeds expectations",
};

export default function CoachPanel(p: Props) {
  const status = (q: RoleQuestion) => p.statuses[q.id] ?? q.status;
  const open = p.draft.questions.filter((q) => status(q) === "open");
  const parked = p.draft.questions.filter((q) => status(q) === "deferred");
  const answered = p.draft.questions.filter((q) => status(q) === "answered" && q.topic !== "target");
  const suggestions = p.draft.suggestions.filter((s) => s.status === "pending");
  const titleOf = (key: string | null) => (key ? p.items.find((i) => i.key === key)?.title : undefined);
  const analysis = p.draft.analysis || {};

  const heading = open.length
    ? `${open.length} decision${open.length === 1 ? "" : "s"} to make`
    : suggestions.length
      ? "Suggestions to consider"
      : "Nothing open right now";

  return (
    <aside className="rounded-xl border-t-4 border-blue-600 bg-blue-50 p-5 lg:sticky lg:top-20" aria-labelledby="coach-heading">
      <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-blue-700">AI thought partner</p>
      <h2 id="coach-heading" className="mt-2 text-lg font-semibold text-ink">
        {heading}
      </h2>

      {analysis.status === "failed" ? (
        <div className="mt-2 rounded-md bg-surface px-3 py-2 text-sm text-ink-body" role="alert">
          {analysis.error || "Your draft is saved. The analysis couldn’t run just now."}{" "}
          <button type="button" onClick={p.onRetry} disabled={p.busy} className="font-medium text-brand underline hover:text-brand-hover">
            Try again
          </button>
        </div>
      ) : analysis.summary ? (
        <p className="mt-1.5 text-sm text-ink-secondary">{analysis.summary}</p>
      ) : open.length === 0 && suggestions.length === 0 ? (
        <p className="mt-1.5 text-sm text-ink-secondary">When you’re ready, review the whole role and approve it — or save and reanalyze after you edit.</p>
      ) : null}

      {open.length > 0 && (
        <ul className="mt-4 space-y-3">
          {open.map((q) => (
            <li
              key={q.id}
              id={`q-${q.id}`}
              className={`scroll-mt-24 rounded-lg bg-surface p-3.5 ${p.focusId === q.id ? "ring-2 ring-blue-600/50" : ""}`}
            >
              {titleOf(q.item_key) && (
                <button
                  type="button"
                  onClick={() => q.item_key && p.onGoToField(q.item_key, q.field ?? "title")}
                  className="text-[11px] font-medium uppercase tracking-wide text-blue-700 hover:underline"
                >
                  {titleOf(q.item_key)}
                </button>
              )}
              <p className="mt-1 text-sm font-medium text-ink">{q.question}</p>
              {q.why && <p className="mt-1 text-xs text-ink-secondary">{q.why}</p>}
              {q.topic === "target" ? (
                <div className="mt-3 space-y-3">
                  <button type="button" className={BTN_SECONDARY} onClick={() => q.item_key && p.onGoToField(q.item_key, "target")}>
                    Add the target
                  </button>
                  <FollowUpPicker busy={p.busy} onChoose={(d) => p.onDefer(q, d)} />
                  <p className="text-xs text-ink-muted">The role can still be approved. An unset target is never treated as a standard.</p>
                </div>
              ) : (
                <div className="mt-3">
                  <label className="sr-only" htmlFor={`answer-${q.id}`}>
                    Your answer
                  </label>
                  <textarea
                    id={`answer-${q.id}`}
                    rows={2}
                    value={p.answers[q.id] ?? ""}
                    onChange={(e) => p.onAnswerChange(q.id, e.target.value)}
                    placeholder="Answer in a sentence — or edit the draft directly"
                    className={`${TEXTAREA} px-3 py-2 text-sm`}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" disabled={p.busy || !(p.answers[q.id] ?? "").trim()} onClick={() => p.onAnswer(q)} className={BTN_PRIMARY_SM}>
                      Save answer
                    </button>
                    <button type="button" disabled={p.busy} onClick={() => p.onDismiss(q)} className={BTN_GHOST}>
                      Not needed
                    </button>
                  </div>
                  <div className="mt-3">
                    <FollowUpPicker busy={p.busy} onChoose={(d) => p.onDefer(q, d)} />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {suggestions.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-ink">Suggestions</h3>
          <p className="text-xs text-ink-secondary">Nothing changes until you use one.</p>
          <ul className="mt-2 space-y-3">
            {suggestions.map((s) => (
              <li key={s.id} className="rounded-lg bg-surface p-3.5">
                {s.type === "rewrite" && (
                  <>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-blue-700">
                      {FIELD_LABEL[s.field]} · {titleOf(s.item_key)}
                    </p>
                    <p className="mt-1 text-sm text-ink">{s.text}</p>
                  </>
                )}
                {s.type === "target" && (
                  <>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-blue-700">Target · {titleOf(s.item_key)}</p>
                    <p className="mt-1 text-sm text-ink">{s.text}</p>
                    <p className="text-xs text-ink-muted">{s.source === "manager" ? "From your answer" : "From the job description"}</p>
                  </>
                )}
                {s.type === "add" && (
                  <>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-blue-700">Add to the draft</p>
                    <p className="mt-1 text-sm font-medium text-ink">{s.item.title}</p>
                    {s.item.meets && <p className="text-sm text-ink-secondary">{s.item.meets}</p>}
                  </>
                )}
                {s.why && <p className="mt-1.5 text-xs text-ink-secondary">{s.why}</p>}
                <div className="mt-2.5 flex gap-2">
                  <button type="button" disabled={p.busy} onClick={() => p.onSuggestion(s, "accept")} className={BTN_PRIMARY_SM}>
                    Use this
                  </button>
                  <button type="button" disabled={p.busy} onClick={() => p.onSuggestion(s, "dismiss")} className={BTN_GHOST}>
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {parked.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-ink">Coming back to</h3>
          <ul className="mt-2 space-y-2">
            {parked.map((q) => (
              <ParkedRow
                key={q.id}
                q={q}
                title={titleOf(q.item_key)}
                busy={p.busy}
                focused={p.focusId === q.id}
                answer={p.answers[q.id] ?? ""}
                onAnswerChange={(t) => p.onAnswerChange(q.id, t)}
                onAnswer={() => p.onAnswer(q)}
                onDismiss={() => p.onDismiss(q)}
                onDefer={p.onDefer}
                onGoToField={p.onGoToField}
              />
            ))}
          </ul>
        </div>
      )}

      {answered.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-sm font-semibold text-ink">Your answers ({answered.length})</summary>
          <ul className="mt-2 space-y-2">
            {answered.map((q) => (
              <li key={q.id} className="rounded-md bg-surface px-3 py-2 text-sm">
                <p className="text-ink-secondary">{q.question}</p>
                <p className="mt-0.5 text-ink">{p.answers[q.id] ?? q.answer}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="mt-5 border-t border-blue-600/20 pt-3">
        <summary className="cursor-pointer text-sm font-medium text-ink">Why these questions?</summary>
        <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
          Responsibilities come from your job description; the “meets” and “exceeds” wording is proposed for you to review. Questions only cover what the description leaves open. No number is added unless it’s in your job description or your own words — a missing target stays missing until you set it.
        </p>
      </details>
    </aside>
  );
}

function ParkedRow({
  q,
  title,
  busy,
  focused,
  answer,
  onAnswerChange,
  onAnswer,
  onDismiss,
  onDefer,
  onGoToField,
}: {
  q: RoleQuestion;
  title?: string;
  busy: boolean;
  focused: boolean;
  answer: string;
  onAnswerChange: (text: string) => void;
  onAnswer: () => void;
  onDismiss: () => void;
  onDefer: (q: RoleQuestion, isoDate: string) => void;
  onGoToField: (itemKey: string, field: string) => void;
}) {
  const [changing, setChanging] = useState(false);
  const [answering, setAnswering] = useState(false);
  return (
    <li id={`q-${q.id}`} className={`scroll-mt-24 rounded-md bg-surface px-3 py-2.5 ${focused ? "ring-2 ring-blue-600/50" : ""}`}>
      {title && <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{title}</p>}
      <p className="text-sm text-ink">{q.question}</p>
      <p className="mt-0.5 text-xs text-amber-700">Back {formatDay(q.follow_up_on)} · stays in Needs review until resolved</p>
      <div className="mt-2 flex flex-wrap gap-3">
        {q.topic === "target" && q.item_key && (
          <button type="button" onClick={() => onGoToField(q.item_key!, "target")} className="text-xs font-medium text-brand hover:text-brand-hover">
            Set it now
          </button>
        )}
        {q.topic !== "target" && (
          <button type="button" onClick={() => setAnswering((a) => !a)} aria-expanded={answering} className="text-xs font-medium text-brand hover:text-brand-hover">
            Answer now
          </button>
        )}
        <button type="button" onClick={() => setChanging((c) => !c)} aria-expanded={changing} className="text-xs font-medium text-ink-secondary hover:text-ink">
          Change date
        </button>
        {q.topic !== "target" && (
          <button type="button" disabled={busy} onClick={onDismiss} className="text-xs font-medium text-ink-secondary hover:text-ink">
            Not needed
          </button>
        )}
      </div>
      {answering && (
        <div className="mt-2">
          <label className="sr-only" htmlFor={`answer-${q.id}`}>
            Your answer
          </label>
          <textarea
            id={`answer-${q.id}`}
            rows={2}
            value={answer}
            onChange={(e) => onAnswerChange(e.target.value)}
            className={`${TEXTAREA} px-3 py-2 text-sm`}
          />
          <button type="button" disabled={busy || !answer.trim()} onClick={onAnswer} className={`${BTN_PRIMARY_SM} mt-2`}>
            Save answer
          </button>
        </div>
      )}
      {changing && (
        <div className="mt-2">
          <FollowUpPicker
            busy={busy}
            current={q.follow_up_on}
            label="Come back on"
            onChoose={(d) => {
              setChanging(false);
              onDefer(q, d);
            }}
          />
        </div>
      )}
    </li>
  );
}
