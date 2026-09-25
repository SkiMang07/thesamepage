"use client";

// Last-to-next conversation: the Relationship Desk's lead surface. The latest
// reviewed summary's own opening words sit directly above the next
// occurrence, so "where we left it" and "what's gathering" read as one
// thread. Preparation and the call itself stay on the canonical /prep
// workspace; this surface previews and hands off.

import { useState } from "react";
import Link from "next/link";
import type { CaptureNote, OneOnOne } from "@/lib/api";
import type { OneOnOneSuggestion } from "@/lib/one-on-one-workspace";
import { BTN_PRIMARY } from "@/lib/tokens";
import { instantDate, localDateStr, shortDate } from "@/components/team/dates";
import {
  cadenceSentence,
  excerpt,
  fullDate,
  recurrenceLabel,
  sessionDate,
  type CadenceTruth,
  type WorkUpdate,
} from "./desk";

type Disclosure = "carry" | "captures" | "work" | "signals" | null;

const DISCLOSURE_BTN =
  "rounded-sm border-b border-dotted border-ink-muted pb-0.5 text-xs text-ink-secondary hover:border-brand hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand aria-expanded:border-brand aria-expanded:text-brand";

export default function ConversationPanel({
  personId,
  personFirstName,
  lastCompleted,
  historyFailed,
  next,
  cadence,
  captures,
  capturesFailed,
  onRemoveCapture,
  removingCaptureId,
  workUpdates,
  workSince,
  workFailed,
  signals,
  openCommitmentCount,
  commitmentsFailed,
  onReadLastSummary,
  onShowCommitments,
}: {
  personId: string;
  personFirstName: string;
  lastCompleted: OneOnOne | null;
  historyFailed: boolean;
  next: OneOnOne | null;
  cadence: CadenceTruth;
  captures: CaptureNote[];
  capturesFailed: boolean;
  onRemoveCapture: (id: string) => void;
  removingCaptureId: string | null;
  workUpdates: WorkUpdate[];
  workSince: WorkUpdate[] | null;
  workFailed: boolean;
  signals: OneOnOneSuggestion[];
  openCommitmentCount: number;
  commitmentsFailed: boolean;
  onReadLastSummary: () => void;
  onShowCommitments: () => void;
}) {
  const [open, setOpen] = useState<Disclosure>(null);
  const toggle = (d: Exclude<Disclosure, null>) => setOpen((cur) => (cur === d ? null : d));

  const prepared = next?.status === "planned" ? next : null;
  const guide = prepared?.prep_guide ?? null;
  const nextDate = sessionDate(next && next.scheduled_at ? next : null);
  const datePassed = nextDate != null && nextDate < localDateStr();
  const repeat = recurrenceLabel(next?.recurrence_weeks);
  const carried = next?.carry_forward_items ?? [];
  const lastDate = sessionDate(lastCompleted);

  const prepBase = `/app/reports/${personId}/prep`;
  const startHref = prepared ? `${prepBase}?resume=${prepared.id}` : prepBase;
  const reviewHref = prepared ? `${prepBase}?resume=${prepared.id}&edit=1` : prepBase;
  const scheduleHref = `${prepared ? `${prepBase}?resume=${prepared.id}` : prepBase}#schedule`;

  // Work evidence label. "Since the last 1:1" only with a known prior date;
  // otherwise the true basis ("latest recorded"). A failed fetch says so.
  const shownUpdates = workSince && workSince.length > 0 ? workSince : workUpdates.slice(0, 3);
  const workLabel = workFailed
    ? "Work updates couldn't load"
    : workSince
      ? workSince.length > 0
        ? `${workSince.length} work update${workSince.length === 1 ? "" : "s"} since the last 1:1`
        : "No work updates since the last 1:1"
      : workUpdates.length > 0
        ? "Latest recorded work update"
        : "No recorded work updates";

  return (
    <section aria-labelledby="next-conversation-heading" className="overflow-hidden rounded-xl border border-hairline bg-surface">
      {/* Last 1:1 — the reviewed summary's own words, not an interpretation. */}
      <div className="flex flex-col gap-1 border-b border-hairline px-5 py-5 sm:flex-row sm:gap-8 sm:px-6">
        <div className="shrink-0 sm:w-20">
          <p className="text-xs text-ink-muted">Last 1:1</p>
          <p className="mt-0.5 text-sm font-medium text-ink">{lastDate ? shortDate(lastDate) : "—"}</p>
        </div>
        <div className="min-w-0">
          {historyFailed ? (
            <p className="text-sm text-amber-700">Past conversations couldn&apos;t load, so the last summary isn&apos;t shown.</p>
          ) : lastCompleted ? (
            <>
              <p className="text-sm leading-6 text-ink-body">{excerpt(lastCompleted.summary, 180)}</p>
              <button
                type="button"
                onClick={onReadLastSummary}
                className="mt-1.5 text-xs font-medium text-brand hover:text-brand-hover focus-visible:underline"
              >
                Read reviewed summary <span aria-hidden="true">↗</span>
              </button>
            </>
          ) : (
            <p className="text-sm leading-6 text-ink-secondary">
              No logged 1:1 with {personFirstName} yet. The first reviewed summary will show here.
            </p>
          )}
        </div>
      </div>

      {/* Next conversation */}
      <div className="bg-feature px-5 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xs font-medium uppercase tracking-[0.16em] text-ink-muted">Next conversation</p>
          {next && (
            <span className={`rounded-full px-2.5 py-1 text-2xs font-medium ${prepared ? "bg-brand-tint text-brand" : "bg-sunken text-ink-secondary"}`}>
              {prepared ? "Prep ready" : "Gathering context"}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="next-conversation-heading" className="font-serif text-[1.9rem] font-normal leading-tight tracking-[-0.01em] text-ink">
            {historyFailed ? "Couldn't load" : nextDate ? fullDate(nextDate) : "No date set"}
          </h2>
          <Link href={scheduleHref} className="text-xs font-medium text-brand hover:text-brand-hover">
            Date &amp; repeat <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <p className={`mt-1 text-xs ${historyFailed ? "text-amber-700" : "text-ink-secondary"}`}>
          {historyFailed
            ? "The next conversation's date and preparation couldn't load. Refresh to try again."
            : nextDate
            ? [repeat ?? "Doesn't repeat", "No start time recorded"].join(" · ")
            : cadenceSentence(cadence) ?? "Not scheduled. Pick a date when you know it."}
        </p>
        {datePassed && (
          <p className="mt-1 text-xs text-amber-700">
            This date has passed and nothing is logged for it yet. Log it, or pick a new date.
          </p>
        )}

        {/* The middle: a saved guide once prepared, otherwise what's carried. */}
        {prepared && guide ? (
          <div className="mt-5">
            <p className="text-xs text-ink-muted">Your prepared sheet</p>
            {guide.situation_summary && (
              <p className="mt-1.5 text-sm leading-6 text-ink-body">{excerpt(guide.situation_summary, 200)}</p>
            )}
            {guide.agenda_items.length > 0 && (
              <ol className="mt-2 space-y-1">
                {guide.agenda_items.slice(0, 3).map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-ink-body">
                    <span className="shrink-0 font-sans tabular-nums text-ink-muted">{i + 1}.</span>
                    <span className="min-w-0">{item.title}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-2xs text-ink-muted">
              {guide.agenda_items.length > 3 ? `${guide.agenda_items.length - 3} more on the sheet · ` : ""}
              Rationale and questions are on the prep sheet.
            </p>
            {captures.length > 0 && (
              <p className="mt-2 text-xs text-ink-secondary">
                {captures.length} thought{captures.length === 1 ? "" : "s"} kept since you prepared. They join the sheet when you review sources.
              </p>
            )}
          </div>
        ) : carried.length > 0 ? (
          <div className="mt-5">
            <p className="text-xs text-ink-muted">Carry-forward · Confirmed at a previous wrap-up</p>
            <p className="mt-1.5 text-sm text-ink">{carried[0]}</p>
            {carried.length > 1 && (
              <button
                type="button"
                aria-expanded={open === "carry"}
                aria-controls="disclosure-carry"
                onClick={() => toggle("carry")}
                className="mt-1 text-xs font-medium text-brand hover:text-brand-hover"
              >
                {open === "carry" ? "Show fewer" : `View all ${carried.length} carried topics`}
              </button>
            )}
            {open === "carry" && (
              <ul id="disclosure-carry" className="mt-2 space-y-1.5 border-l border-hairline pl-3">
                {carried.slice(1).map((item, i) => (
                  <li key={i} className="text-sm text-ink-body">{item}</li>
                ))}
              </ul>
            )}
          </div>
        ) : historyFailed ? null : (
          <p className="mt-5 text-sm text-ink-secondary">
            {captures.length > 0 ? "Your kept thoughts are waiting for review." : "Nothing gathered yet."}
          </p>
        )}

        {/* Compact source disclosures — evidence, not agenda items. */}
        <div className="mt-5 border-t border-hairline/70 pt-4">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <button
              type="button"
              className={DISCLOSURE_BTN}
              aria-expanded={open === "captures"}
              aria-controls="disclosure-captures"
              onClick={() => toggle("captures")}
            >
              {capturesFailed
                ? "Kept thoughts couldn't load"
                : `${captures.length} kept thought${captures.length === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              className={DISCLOSURE_BTN}
              aria-expanded={open === "work"}
              aria-controls="disclosure-work"
              onClick={() => toggle("work")}
            >
              {workLabel}
            </button>
            {signals.length > 0 && (
              <button
                type="button"
                className={DISCLOSURE_BTN}
                aria-expanded={open === "signals"}
                aria-controls="disclosure-signals"
                onClick={() => toggle("signals")}
              >
                {signals.length} suggested topic{signals.length === 1 ? "" : "s"}
              </button>
            )}
            <button type="button" className={DISCLOSURE_BTN} onClick={onShowCommitments}>
              {commitmentsFailed
                ? "Commitments couldn't load"
                : `${openCommitmentCount} open commitment${openCommitmentCount === 1 ? "" : "s"}`}
            </button>
          </div>

          {open === "captures" && (
            <div id="disclosure-captures" className="mt-3 rounded-lg bg-canvas/50 px-3.5 py-3">
              {capturesFailed ? (
                <p className="text-xs text-amber-700">Couldn&apos;t load your kept thoughts. Refresh to try again.</p>
              ) : captures.length === 0 ? (
                <p className="text-xs text-ink-muted">Nothing kept since the last preparation.</p>
              ) : (
                <ul className="space-y-2">
                  {captures.map((capture) => (
                    <li key={capture.id} className="flex items-start justify-between gap-3 text-sm text-ink-body">
                      <span className="min-w-0 whitespace-pre-wrap">
                        <span className="text-xs text-ink-muted">{instantDate(capture.created_at)} · </span>
                        {capture.content}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveCapture(capture.id)}
                        disabled={removingCaptureId === capture.id}
                        className="shrink-0 rounded px-1.5 text-xs text-ink-muted hover:text-red-700 disabled:opacity-50"
                      >
                        {removingCaptureId === capture.id ? "Removing…" : "Remove"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-2xs text-ink-muted">Private to you. Included when you review sources, then folded into the prepared sheet.</p>
            </div>
          )}

          {open === "work" && (
            <div id="disclosure-work" className="mt-3 rounded-lg bg-canvas/50 px-3.5 py-3">
              {workFailed ? (
                <p className="text-xs text-amber-700">Goals or projects couldn&apos;t load, so updates may be missing. Refresh to try again.</p>
              ) : shownUpdates.length === 0 ? (
                <p className="text-xs text-ink-muted">No check-ins recorded on {personFirstName}&apos;s goals or projects.</p>
              ) : (
                <>
                  {workSince && workSince.length === 0 && (
                    <p className="mb-2 text-2xs text-ink-muted">Nothing since the last 1:1. Latest recorded:</p>
                  )}
                  <ul className="space-y-2.5">
                    {shownUpdates.map((u) => (
                      <li key={u.key} className="text-sm">
                        <p className="text-ink">
                          <span className="text-xs text-ink-muted">{u.kind} · </span>
                          {u.title}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-secondary">
                          Check-in · {instantDate(u.at)}
                          {u.note ? ` · ${u.note}` : " · No note recorded"}
                        </p>
                        <Link href={u.href} className="text-2xs text-brand hover:text-brand-hover">
                          Open in {u.kind === "Goal" ? "Goals" : "Projects"} →
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-2 text-2xs text-ink-muted">Read-only evidence. Check-ins aren&apos;t added to the agenda automatically.</p>
            </div>
          )}

          {open === "signals" && (
            <div id="disclosure-signals" className="mt-3 rounded-lg bg-canvas/50 px-3.5 py-3">
              <ul className="space-y-1.5">
                {signals.map((s) => (
                  <li key={s.key} className="text-sm text-ink-body">{s.text}</li>
                ))}
              </ul>
              <p className="mt-2 text-2xs text-ink-muted">From current goals and the saved development plan. You choose what stays when you review sources.</p>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link href={startHref} className={`${BTN_PRIMARY} whitespace-nowrap`}>
            {prepared ? "Start 1:1 →" : "Review & prepare →"}
          </Link>
          {prepared && (
            <Link href={reviewHref} className="text-sm font-medium text-brand hover:text-brand-hover">
              Review sources
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
