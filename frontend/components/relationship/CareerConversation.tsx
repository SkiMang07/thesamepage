"use client";

// The career conversation card on the person page's Relationship view
// (2026-10-08). One of the person's ordinary 1:1s, chosen ahead of time and
// titled differently. Rules: backend/career_rhythm.py. The product never
// contacts the report: the heads-up is text the manager copies and sends.

import { useState } from "react";
import {
  markCareerHeld,
  planCareerConversation,
  skipCareerConversation,
  unplanCareerConversation,
  updateCareerPlan,
  type CareerPersonDetail,
} from "@/lib/api";
import { firstOf, longDay, shortDay } from "@/lib/career";
import { BTN_GHOST, BTN_PRIMARY_SM, BTN_SECONDARY, ERROR_TEXT, EYEBROW, META } from "@/lib/tokens";

export default function CareerConversation({
  career,
  failed,
  onChanged,
}: {
  career: CareerPersonDetail | null;
  failed: boolean;
  onChanged: (next: CareerPersonDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [copied, setCopied] = useState<"title" | "note" | null>(null);

  if (failed) {
    return <p className="mt-4 text-sm text-amber-700">The career conversation couldn&apos;t load.</p>;
  }
  if (!career || career.state === "off") return null;

  const first = firstOf(career.name);
  const choice = picked ?? career.suggested ?? career.choices[0] ?? null;

  async function run(action: () => Promise<CareerPersonDetail>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await action());
      setPicked(null);
      setChanging(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(kind: "title" | "note", text: string) {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied((c) => (c === kind ? null : c)), 2000);
    } catch {
      setError("Copy didn't work in this browser. Select the text instead.");
    }
  }

  if (career.state === "not_due") {
    return (
      <p className={`mt-4 ${META}`} data-testid="career-not-due">
        Career conversation: next due around {shortDay(career.due_on!)}
        {career.last_held_on ? ` · last one ${shortDay(career.last_held_on)}` : ""}.
      </p>
    );
  }

  const choices = (
    <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="1:1 dates">
      {career.choices.map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={choice === d}
          onClick={() => setPicked(d)}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            choice === d ? "border-brand bg-brand-tint text-brand" : "border-control bg-surface text-ink-body hover:bg-sunken"
          }`}
        >
          {shortDay(d)}
          {d === career.suggested && <span className="ml-1 text-2xs text-ink-muted">suggested</span>}
        </button>
      ))}
    </div>
  );

  return (
    <section aria-labelledby="career-heading" className="mt-4 rounded-xl border border-hairline bg-surface px-5 py-5" data-testid={`career-${career.state}`}>
      <p className={EYEBROW}>Career conversation</p>

      {career.state === "proposed" && (
        <>
          <h3 id="career-heading" className="mt-1 text-base font-medium text-ink">
            {first}&apos;s career conversation is due {career.due_on && career.due_on > todayIso() ? shortDay(career.due_on) : "now"}.
          </h3>
          {career.choices.length > 0 ? (
            <>
              <p className="mt-1 text-sm text-ink-secondary">
                Pick the 1:1 that becomes it. A week&apos;s notice leaves time to book a longer slot and give {first} a heads-up.
              </p>
              {choices}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy || !choice} className={BTN_PRIMARY_SM}
                  onClick={() => choice && run(() => planCareerConversation(career.direct_report_id, choice))}>
                  Make this the career conversation
                </button>
                <button type="button" disabled={busy} className={BTN_GHOST} onClick={() => run(() => skipCareerConversation(career.direct_report_id))}>
                  Not this time
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-ink-secondary">
                It becomes one of your 1:1s with {first}, and none is dated far enough ahead yet. Set the next 1:1&apos;s date above.
              </p>
              <button type="button" disabled={busy} className={`mt-3 ${BTN_GHOST}`} onClick={() => run(() => skipCareerConversation(career.direct_report_id))}>
                Not this time
              </button>
            </>
          )}
        </>
      )}

      {career.state === "planned" && career.planned?.planned_for && (
        <>
          <h3 id="career-heading" className="mt-1 text-base font-medium text-ink">
            Your 1:1 on {longDay(career.planned.planned_for)} is {first}&apos;s career conversation.
          </h3>
          <ol className="mt-4 space-y-4 text-sm">
            <li>
              <p className="font-medium text-ink">1. Book {career.suggested_length}</p>
              <p className="mt-0.5 text-ink-secondary">Longer than your usual 1:1. Rename it in your calendar:</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-sunken px-2 py-1 font-sans text-ink">{career.calendar_title}</code>
                <button type="button" className={BTN_SECONDARY} onClick={() => copy("title", career.calendar_title)}>
                  {copied === "title" ? "Copied" : "Copy title"}
                </button>
              </div>
            </li>
            <li>
              <p className="font-medium text-ink">2. Send {first} a heads-up</p>
              <p className="mt-0.5 text-ink-secondary">Best about a week before, so {first} comes with answers. Edit it as you like.</p>
              <p className="mt-2 whitespace-pre-line rounded-md bg-sunken px-3 py-2 text-ink-body">{career.heads_up}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className={BTN_SECONDARY} onClick={() => career.heads_up && copy("note", career.heads_up)}>
                  {copied === "note" ? "Copied" : "Copy message"}
                </button>
                {career.planned.heads_up_sent_at ? (
                  <span className={META}>
                    Sent {shortDay(career.planned.heads_up_sent_at)} ·{" "}
                    <button type="button" disabled={busy} className="underline hover:text-ink"
                      onClick={() => run(() => updateCareerPlan(career.planned!.id, { heads_up_sent: false }))}>
                      Undo
                    </button>
                  </span>
                ) : (
                  <button type="button" disabled={busy} className={BTN_GHOST}
                    onClick={() => run(() => updateCareerPlan(career.planned!.id, { heads_up_sent: true }))}>
                    Mark sent
                  </button>
                )}
              </div>
            </li>
            <li>
              <p className="font-medium text-ink">3. Prepare</p>
              <p className="mt-0.5 text-ink-secondary">Prep that 1:1 as usual. It shows as the career conversation on Mission Control, the 1:1s list and the prep page.</p>
            </li>
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-divider pt-3 text-sm">
            {career.choices.length > 0 && (
              <button type="button" className="font-medium text-brand hover:text-brand-hover" onClick={() => setChanging((v) => !v)}>
                {changing ? "Keep this date" : "Change date"}
              </button>
            )}
            <button type="button" disabled={busy} className="text-ink-secondary hover:text-ink"
              onClick={() => run(() => skipCareerConversation(career.direct_report_id))}>
              Not this time
            </button>
            <button type="button" disabled={busy} className="text-ink-secondary hover:text-ink"
              onClick={() => run(() => unplanCareerConversation(career.planned!.id))}>
              Undo the choice
            </button>
          </div>
          {changing && (
            <>
              {choices}
              <button type="button" disabled={busy || !choice || choice === career.planned.planned_for} className={`mt-3 ${BTN_PRIMARY_SM}`}
                onClick={() => choice && run(() => updateCareerPlan(career.planned!.id, { planned_for: choice }))}>
                Move it to {choice ? shortDay(choice) : "…"}
              </button>
            </>
          )}
        </>
      )}

      {career.state === "missed" && career.planned?.planned_for && (
        <>
          <h3 id="career-heading" className="mt-1 text-base font-medium text-ink">
            {first}&apos;s career conversation was planned for {longDay(career.planned.planned_for)}. That 1:1 isn&apos;t logged.
          </h3>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} className={BTN_PRIMARY_SM} onClick={() => run(() => markCareerHeld(career.planned!.id))}>
              It happened
            </button>
            <button type="button" disabled={busy} className={BTN_GHOST} onClick={() => run(() => skipCareerConversation(career.direct_report_id))}>
              Not this time
            </button>
          </div>
          {career.choices.length > 0 && (
            <>
              <p className="mt-4 text-sm text-ink-secondary">Or pick a new 1:1:</p>
              {choices}
              <button type="button" disabled={busy || !choice} className={`mt-3 ${BTN_SECONDARY}`}
                onClick={() => choice && run(() => updateCareerPlan(career.planned!.id, { planned_for: choice }))}>
                Move it to {choice ? shortDay(choice) : "…"}
              </button>
            </>
          )}
        </>
      )}

      {career.last_held_on && <p className={`mt-4 ${META}`}>Last career conversation {shortDay(career.last_held_on)}.</p>}
      {error && <p className={`mt-3 ${ERROR_TEXT}`}>{error}</p>}
    </section>
  );
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
